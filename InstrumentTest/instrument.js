/**
 * 仪器指标面板模块
 *
 * 组合 BleSerial，接收 JSON 行数据并渲染指标卡片。
 * 数据协议（每行一个 JSON，以 \n 结尾）：
 *   {"vbus":4.0280,"vshunt":-0.0200,"ibus":-0.2000,"pbus":0.0000}
 *
 * 交互流程：
 *   1. 进入页面显示一次性提示，用户点"确定"后进入主页
 *   2. 主页常驻"连接蓝牙/断开蓝牙"按钮，未连接时指标显示 --
 *   3. 主动断开、故障断开(gattserverdisconnected)、页面关闭(pagehide/beforeunload)
 *      均释放蓝牙并清理数据
 *
 * 挪用方式：
 *   import { InstrumentPanel } from "./instrument.js";
 *   new InstrumentPanel(document.getElementById("instrument"));
 * 指标定义可通过 options.metrics 扩展。
 */

import { BleSerial } from "./ble.js";

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
    this._manual = false;
    this._cleaned = false;
    this.ble = new BleSerial({
      onStatus: (s) => this._onStatus(s),
      onLine: (line) => this._onLine(line),
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
          <p class="intro-title">仪器指标 · 蓝牙连接</p>
          <p class="intro-desc">本页面通过 Web Bluetooth 连接仪器，实时显示 VBUS / VSHUNT / IBUS / PBUS。请使用支持蓝牙的浏览器（Chrome / Edge），并确保仪器已开启。</p>
          <button class="ble-btn primary" data-act="enter">确定</button>
        </div>
      </div>
      <div class="panel-main hidden" data-role="main">
        <div class="ble-bar">
          <button class="ble-btn" data-act="connect">连接蓝牙</button>
          <button class="ble-btn ghost" data-act="disconnect" disabled>断开蓝牙</button>
          <span class="ble-status" data-role="status">● 未连接</span>
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
      connects: this.root.querySelectorAll('[data-act="connect"]'),
      disconnect: this.root.querySelector('[data-act="disconnect"]'),
      status: this.root.querySelector('[data-role="status"]'),
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
      else if (act === "connect") await this._connect();
      else if (act === "disconnect") await this._disconnect();
    });
  }

  _enter() {
    this.el.intro.classList.add("hidden");
    this.el.main.classList.remove("hidden");
  }

  _bindLifecycle() {
    // 页面关闭/导航离开时释放蓝牙并清理（pagehide 兼容 iOS Safari，beforeunload 兜底）
    const cleanup = () => this._cleanup();
    window.addEventListener("pagehide", cleanup);
    window.addEventListener("beforeunload", cleanup);
  }

  async _connect() {
    try {
      this._setConnecting(true);
      this.el.status.textContent = "● 连接中...";
      await this.ble.connect();
    } catch (err) {
      this._setConnecting(false);
      if (err.name === "NotFoundError") this.el.status.textContent = "● 未选择设备";
      else this.el.status.textContent = `● 连接失败: ${err.message}`;
    }
  }

  async _disconnect() {
    this._manual = true;
    try { await this.ble.disconnect(); } catch (_) {}
  }

  _cleanup() {
    if (this._cleaned) return;
    this._cleaned = true;
    try { this.ble.disconnect(); } catch (_) {}
    this._resetMetrics();
  }

  _setConnecting(flag) {
    this.el.connects.forEach((b) => (b.disabled = flag));
  }

  _resetMetrics() {
    this.metrics.forEach((m) => {
      if (this.el.nums[m.key]) this.el.nums[m.key].textContent = "--";
    });
  }

  _onStatus(status) {
    if (status === "connected") {
      this.el.status.textContent = "● 已连接";
      this.el.status.classList.add("ok");
      this.el.connects.forEach((b) => (b.disabled = true));
      this.el.disconnect.disabled = false;
    } else {
      // 断开：区分主动断开与故障断开
      const manual = this._manual;
      this._manual = false;
      this.el.status.textContent = manual ? "● 已断开" : "● 已意外断开";
      this.el.status.classList.remove("ok");
      this.el.connects.forEach((b) => (b.disabled = false));
      this.el.disconnect.disabled = true;
      this._resetMetrics();
    }
  }

  _onLine(line) {
    let data;
    try { data = JSON.parse(line); } catch (_) { return; }
    this.metrics.forEach((m) => {
      if (typeof data[m.key] === "number") {
        this.el.nums[m.key].textContent = data[m.key].toFixed(m.precision);
      }
    });
  }
}
