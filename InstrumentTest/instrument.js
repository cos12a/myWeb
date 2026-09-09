/**
 * 仪器指标面板模块
 *
 * 组合 BleSerial 与 WebSerial 双数据源，接收 JSON 行数据并渲染指标卡片。
 * 数据协议（每行一个 JSON，以 \n 结尾）：
 *   {"vbus":4.0280,"vshunt":-0.0200,"ibus":-0.2000,"pbus":0.0000}
 *
 * 交互流程：
 *   1. 进入页面显示一次性提示，用户点"确定"后进入主页
 *   2. 主页提供「蓝牙」与「串口」两个独立连接区，任一连接即可驱动指标
 *   3. 主动断开、故障断开、页面关闭 均释放连接并清理数据
 *
 * 挪用方式：
 *   import { InstrumentPanel } from "./instrument.js";
 *   new InstrumentPanel(document.getElementById("instrument"));
 * 指标定义可通过 options.metrics 扩展。
 */

import { BleSerial } from "./ble.js";
import { WebSerial } from "./serial.js";

const DEFAULT_METRICS = [
  { key: "vbus", label: "VBUS", unit: "V", precision: 4 },
  { key: "vshunt", label: "VSHUNT", unit: "mV", precision: 4 },
  { key: "ibus", label: "IBUS", unit: "mA", precision: 4 },
  { key: "pbus", label: "PBUS", unit: "mW", precision: 4 },
];

export class InstrumentPanel {
  constructor(root, options = {}) {
    this.root = root;
    this.metrics = options.metrics || DEFAULT_METRICS;
    this._bleManual = false;
    this._serialManual = false;
    this._cleaned = false;
    this.ble = new BleSerial({
      onStatus: (s) => this._onBleStatus(s),
      onLine: (l) => this._onLine(l),
    });
    this.serial = new WebSerial({
      baudRate: options.baudRate || 921600,
      onStatus: (s, e) => this._onSerialStatus(s, e),
      onLine: (l) => this._onLine(l),
    });
    this._render();
    this._bind();
    this._bindLifecycle();
  }

  _render() {
    this.root.innerHTML = `
      <div class="intro-overlay" data-role="intro">
        <div class="intro-card">
          <div class="intro-icon">📡</div>
          <p class="intro-title">仪器指标 · 数据连接</p>
          <p class="intro-desc">通过 Web Bluetooth 或 Web Serial 连接仪器，实时显示 VBUS / VSHUNT / IBUS / PBUS。请使用 Chrome / Edge，并确保仪器已开启。</p>
          <button class="ble-btn primary" data-act="enter">确定</button>
        </div>
      </div>
      <div class="panel-main hidden" data-role="main">
        <div class="conn-bar">
          <span class="conn-label">蓝牙</span>
          <button class="ble-btn" data-act="ble-connect">连接</button>
          <button class="ble-btn ghost" data-act="ble-disconnect" disabled>断开</button>
          <span class="ble-status" data-role="ble-status">● 未连接</span>
        </div>
        <div class="conn-bar">
          <span class="conn-label">串口</span>
          <button class="ble-btn" data-act="serial-connect">连接</button>
          <button class="ble-btn ghost" data-act="serial-disconnect" disabled>断开</button>
          <span class="serial-baud">921600</span>
          <span class="ble-status" data-role="serial-status">● 未连接</span>
        </div>
        <div class="metrics">
          ${this.metrics.map((m) => `
            <div class="metric-card" data-key="${m.key}">
              <div class="metric-label">${m.label}</div>
              <div class="metric-value">
                <span class="num" data-role="num">--</span>
                <span class="unit">${m.unit}</span>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
    this.el = {
      intro: this.root.querySelector('[data-role="intro"]'),
      main: this.root.querySelector('[data-role="main"]'),
      bleConnects: this.root.querySelectorAll('[data-act="ble-connect"]'),
      bleDisconnect: this.root.querySelector('[data-act="ble-disconnect"]'),
      bleStatus: this.root.querySelector('[data-role="ble-status"]'),
      serialConnects: this.root.querySelectorAll('[data-act="serial-connect"]'),
      serialDisconnect: this.root.querySelector('[data-act="serial-disconnect"]'),
      serialStatus: this.root.querySelector('[data-role="serial-status"]'),
      nums: Object.fromEntries(
        this.metrics.map((m) => [
          m.key,
          this.root.querySelector(`[data-key="${m.key}"] [data-role="num"]`),
        ]),
      ),
    };
  }

  _bind() {
    this.root.addEventListener("click", async (e) => {
      const act = e.target.dataset.act;
      if (act === "enter") this._enter();
      else if (act === "ble-connect") await this._bleConnect();
      else if (act === "ble-disconnect") await this._bleDisconnect();
      else if (act === "serial-connect") await this._serialConnect();
      else if (act === "serial-disconnect") await this._serialDisconnect();
    });
  }

  _enter() {
    this.el.intro.classList.add("hidden");
    this.el.main.classList.remove("hidden");
  }

  _bindLifecycle() {
    const cleanup = () => this._cleanup();
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("beforeunload", cleanup);
  }

  // ===== 蓝牙 =====
  async _bleConnect() {
    try {
      this.el.bleConnects.forEach((b) => (b.disabled = true));
      this.el.bleStatus.textContent = "● 连接中...";
      await this.ble.connect();
    } catch (err) {
      this.el.bleConnects.forEach((b) => (b.disabled = false));
      if (err.name === "NotFoundError") this.el.bleStatus.textContent = "● 未选择设备";
      else this.el.bleStatus.textContent = `● 连接失败: ${err.message}`;
    }
  }

  async _bleDisconnect() {
    this._bleManual = true;
    try { await this.ble.disconnect(); } catch (_) {}
  }

  _onBleStatus(status) {
    if (status === "connected") {
      this.el.bleStatus.textContent = "● 已连接";
      this.el.bleStatus.classList.add("ok");
      this.el.bleConnects.forEach((b) => (b.disabled = true));
      this.el.bleDisconnect.disabled = false;
    } else {
      const manual = this._bleManual;
      this._bleManual = false;
      this.el.bleStatus.textContent = manual ? "● 已断开" : "● 已意外断开";
      this.el.bleStatus.classList.remove("ok");
      this.el.bleConnects.forEach((b) => (b.disabled = false));
      this.el.bleDisconnect.disabled = true;
      this._maybeResetMetrics();
    }
  }

  // ===== 串口 =====
  async _serialConnect() {
    try {
      this.el.serialConnects.forEach((b) => (b.disabled = true));
      this.el.serialStatus.textContent = "● 连接中...";
      await this.serial.connect();
    } catch (err) {
      this.el.serialConnects.forEach((b) => (b.disabled = false));
      if (err.name === "NotFoundError") this.el.serialStatus.textContent = "● 未选择串口";
      else this.el.serialStatus.textContent = `● 连接失败: ${err.message}`;
    }
  }

  async _serialDisconnect() {
    this._serialManual = true;
    try { await this.serial.disconnect(); } catch (_) {}
  }

  _onSerialStatus(status, err) {
    if (status === "connected") {
      this.el.serialStatus.textContent = "● 已连接";
      this.el.serialStatus.classList.add("ok");
      this.el.serialConnects.forEach((b) => (b.disabled = true));
      this.el.serialDisconnect.disabled = false;
    } else if (status === "error") {
      this.el.serialStatus.textContent = `● 错误: ${(err && err.message) || "断开"}`;
      this.el.serialStatus.classList.remove("ok");
      this.el.serialConnects.forEach((b) => (b.disabled = false));
      this.el.serialDisconnect.disabled = true;
      this._maybeResetMetrics();
    } else {
      const manual = this._serialManual;
      this._serialManual = false;
      this.el.serialStatus.textContent = manual ? "● 已断开" : "● 已意外断开";
      this.el.serialStatus.classList.remove("ok");
      this.el.serialConnects.forEach((b) => (b.disabled = false));
      this.el.serialDisconnect.disabled = true;
      this._maybeResetMetrics();
    }
  }

  // ===== 指标 =====
  _onLine(line) {
    let data;
    try { data = JSON.parse(line); } catch (_) { return; }
    this.metrics.forEach((m) => {
      if (typeof data[m.key] === "number") {
        this.el.nums[m.key].textContent = data[m.key].toFixed(m.precision);
      }
    });
  }

  _maybeResetMetrics() {
    if (!this.ble.connected && !this.serial.connected) this._resetMetrics();
  }

  _resetMetrics() {
    this.metrics.forEach((m) => {
      if (this.el.nums[m.key]) this.el.nums[m.key].textContent = "--";
    });
  }

  _cleanup() {
    if (this._cleaned) return;
    this._cleaned = true;
    try { this.ble.disconnect(); } catch (_) {}
    try { this.serial.disconnect(); } catch (_) {}
    this._resetMetrics();
  }
}
