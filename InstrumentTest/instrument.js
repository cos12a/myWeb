/**
 * 仪器指标面板模块
 *
 * 组合 BleSerial，接收 JSON 行数据并渲染指标卡片。
 * 数据协议（每行一个 JSON，以 \n 结尾）：
 *   {"vbus":4.0280,"vshunt":-0.0200,"ibus":-0.2000,"pbus":0.0000}
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
    this.ble = new BleSerial({
      onStatus: (s) => this._onStatus(s),
      onLine: (line) => this._onLine(line),
    });
    this._render();
    this._bind();
  }

  _render() {
    this.root.innerHTML = `
      <div class="ble-bar">
        <button class="ble-btn" data-act="connect">连接蓝牙</button>
        <button class="ble-btn ghost" data-act="disconnect" disabled>断开</button>
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
      <div class="ble-overlay" data-role="overlay">
        <div class="overlay-card">
          <div class="overlay-icon">📡</div>
          <p class="overlay-title">未连接蓝牙</p>
          <p class="overlay-desc">请连接蓝牙设备以接收实时仪器数据</p>
          <button class="ble-btn primary" data-act="connect">连接蓝牙</button>
        </div>
      </div>
    `;
    this.el = {
      connects: this.root.querySelectorAll('[data-act="connect"]'),
      disconnect: this.root.querySelector('[data-act="disconnect"]'),
      status: this.root.querySelector('[data-role="status"]'),
      overlay: this.root.querySelector('[data-role="overlay"]'),
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
      if (act === "connect") await this._connect();
      else if (act === "disconnect") await this.ble.disconnect();
    });
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

  _setConnecting(flag) {
    this.el.connects.forEach((b) => (b.disabled = flag));
  }

  _onStatus(status) {
    if (status === "connected") {
      this.el.status.textContent = "● 已连接";
      this.el.status.classList.add("ok");
      this.el.connects.forEach((b) => (b.disabled = true));
      this.el.disconnect.disabled = false;
      this.el.overlay.classList.add("hidden");
    } else {
      this.el.status.textContent = "● 未连接";
      this.el.status.classList.remove("ok");
      this.el.connects.forEach((b) => (b.disabled = false));
      this.el.disconnect.disabled = true;
      this.el.overlay.classList.remove("hidden");
      this.metrics.forEach((m) => { this.el.nums[m.key].textContent = "--"; });
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