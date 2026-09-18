/** <instrument-panel> —— 主面板，组合子组件 + 持有 controllers + 编排连接/配对流程。
 *  UI 是 Lit 类，逻辑是纯函数，副作用进 Controller。render 只读状态。 */
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Metric, ConnStatus } from "../core/types.js";
import { DEFAULT_METRICS } from "../core/metrics.js";
import { parseJsonLine, pickMetric } from "../core/parse.js";
import { BleController } from "../controllers/ble-controller.js";
import { SerialController } from "../controllers/serial-controller.js";
import { DataStreamController } from "../controllers/data-stream-controller.js";
import "./metric-card.js";
import "./conn-bar.js";
import "./data-stream-bar.js";
import "./pair-hint.js";

const BUSY: ReadonlySet<ConnStatus> = new Set(["selecting", "connecting", "pairing", "connected", "paired"]);

/** 纯函数：状态 → 状态文字。 */
function statusText(status: ConnStatus, lastManual: boolean, error: string | null): string {
  switch (status) {
    case "idle": return "未连接";
    case "selecting": return "选择设备...";
    case "connecting": return "连接中...";
    case "pairing": return "配对中...";
    case "connected": return "已连接";
    case "paired": return "已连接";
    case "disconnected": return lastManual ? "已断开" : "已意外断开";
    case "error": return `错误: ${error ?? "断开"}`;
  }
}

@customElement("instrument-panel")
export class InstrumentPanel extends LitElement {
  @property({ attribute: false }) metrics: readonly Metric[] = DEFAULT_METRICS;

  @state() private entered = false;
  @state() private values: Record<string, number | null> = {};
  @state() private pairHintKey: string | null = null;
  @state() private bleManual = false;
  @state() private bleLastManual = false;
  @state() private serialManual = false;
  @state() private serialLastManual = false;

  private ble: BleController;
  private serial: SerialController;
  private dataStream: DataStreamController;


  static styles = css`
    :host { display: block; }
    .conn-group {
      display: grid; grid-template-columns: 1fr 1fr auto;
      padding: 11px 16px; margin-bottom: 16px;
      background: var(--it-surface); border: 1px solid var(--it-border);
      border-radius: var(--it-radius);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
    }
    .conn-cell { min-width: 0; }
    .conn-cell + .conn-cell { border-left: 1px solid var(--it-border); padding-left: 16px; }
    .conn-cell:not(:last-child) { padding-right: 16px; }
    .data-cell { display: flex; align-items: center; justify-content: center; }
    @media (max-width: 560px) {
      .conn-group { grid-template-columns: 1fr; gap: 10px; }
      .conn-cell + .conn-cell { border-left: none; padding-left: 0; border-top: 1px solid var(--it-border); padding-top: 10px; }
      .conn-cell:not(:last-child) { padding-right: 0; }
    }
    .metrics { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
    .intro { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(7, 9, 15, .78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 10; padding: 20px; }
    .intro-card { text-align: center; padding: 34px 28px; background: var(--it-surface); border: 1px solid var(--it-border-strong); border-radius: 20px; max-width: 340px; width: 100%; backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); box-shadow: 0 30px 70px rgba(0, 0, 0, .5); }
    .intro-icon { font-size: 2.6rem; margin-bottom: 14px; }
    .intro-title { font-size: 1.15rem; font-weight: 700; margin-bottom: 8px; }
    .intro-desc { color: var(--it-muted); font-size: .84rem; margin-bottom: 20px; line-height: 1.65; }
    .btn-primary { border: none; border-radius: 9px; padding: 12px 26px; font-size: .9rem; font-weight: 600; cursor: pointer; color: #fff; background: var(--it-grad); box-shadow: 0 10px 26px rgba(91, 156, 255, .35); }
    .btn-primary:active { transform: translateY(1px) scale(.98); }
  `;

  constructor() {
    super();
    this.ble = new BleController(this, { onLine: this.onLine, onStatus: this.onBleStatus });
    this.serial = new SerialController(this, 921600, { onLine: this.onLine, onStatus: this.onSerialStatus });
    this.dataStream = new DataStreamController(this);

  }

  // ===== 回调（箭头函数绑定 this） =====
  private onLine = (line: string): void => {
    const sample = parseJsonLine(line);
    if (!sample) return;
    const next = { ...this.values };
    for (const m of this.metrics) {
      const v = pickMetric(sample, m.key);
      if (v !== null) next[m.key] = v;
    }
    this.values = next;
    this.dataStream.pulse();
  };

  private onBleStatus = (status: ConnStatus): void => {
    console.log("[BLE] onBleStatus:", status);
    if (status === "disconnected") {
      this.bleLastManual = this.bleManual || this.bleLastManual;
      this.bleManual = false;
      this.pairHintKey = null;
    }
    if (this.ble.status !== "paired" && this.serial.status !== "connected") this.dataStream.stop();
  };

  private onSerialStatus = (status: ConnStatus): void => {
    if (status === "disconnected" || status === "error") {
      this.serialLastManual = this.serialManual;
      this.serialManual = false;
    }
    if (this.ble.status !== "paired" && this.serial.status !== "connected") this.dataStream.stop();
  };

  // ===== 蓝牙流程：选设备 → 连接 → 发现服务（OS 隐式触发配对） =====
  private async bleConnect(): Promise<void> {
    console.log("[BLE] bleConnect: 开始");
    try {
      await this.ble.pickDevice("BleUart");
      console.log("[BLE] bleConnect: pickDevice 完成");
      await this.ble.connectGatt();
      console.log("[BLE] bleConnect: connectGatt 完成，直接 discoverServices");
      this.pairHintKey = "";
      await this.ble.discoverServices();
      console.log("[BLE] bleConnect: discoverServices 完成");
      this.pairHintKey = null;
    } catch (e) {
      console.log("[BLE] bleConnect: 异常", e);
      this.pairHintKey = null;
    }
  }

  private async bleDisconnect(): Promise<void> {
    this.bleManual = true;
    try { await this.ble.disconnect(); } catch { /* ignore */ }
  }

  private async serialConnect(): Promise<void> {
    try { await this.serial.connect(); } catch { /* status 已由 controller 反映 */ }
  }

  private async serialDisconnect(): Promise<void> {
    this.serialManual = true;
    try { await this.serial.disconnect(); } catch { /* ignore */ }
  }


  private onPairHintClose = (): void => { this.pairHintKey = null; };

  // ===== render：只读状态 =====
  protected render() {
    if (!this.entered) {
      return html`<div class="intro">
        <div class="intro-card">
          <div class="intro-icon">📡</div>
          <p class="intro-title">测量参数显示 · 数据连接</p>
          <p class="intro-desc">通过 Web Bluetooth 或 Web Serial 连接仪器，实时显示总线电压 / 分流电压 / 电流 / 功率。请使用 Chrome / Edge，并确保仪器已开启。</p>
          <button class="btn-primary" @click=${() => (this.entered = true)}>确定</button>
        </div>
      </div>`;
    }
    const bleText = statusText(this.ble.status, this.bleLastManual, this.ble.errorMessage);
    const serialText = statusText(this.serial.status, this.serialLastManual, this.serial.errorMessage);
    return html`
      <pair-hint .open=${this.pairHintKey !== null} .key=${this.pairHintKey ?? ""} @close=${this.onPairHintClose}></pair-hint>
      <div class="conn-group" part="conn-group">
        <div class="conn-cell">
          <conn-bar icon="📶" label="蓝牙" .statusText=${bleText} .dotOn=${this.ble.status === "paired"}
                     .connectDisabled=${BUSY.has(this.ble.status)} .disconnectDisabled=${!this.ble.connected}
                     @connect=${this.bleConnect} @disconnect=${this.bleDisconnect}></conn-bar>
        </div>
        <div class="conn-cell">
          <conn-bar icon="🔌" label="串口" .statusText=${serialText} .dotOn=${this.serial.connected}
                     .connectDisabled=${BUSY.has(this.serial.status)} .disconnectDisabled=${!this.serial.connected}
                     @connect=${this.serialConnect} @disconnect=${this.serialDisconnect}></conn-bar>
        </div>
        <div class="conn-cell data-cell" part="data-cell">
          <data-stream-bar .active=${this.dataStream.active}></data-stream-bar>
        </div>
      </div>
      <div class="metrics">
        ${this.metrics.map((m) => html`<metric-card .label=${m.label} .unit=${m.unit}
          .value=${this.values[m.key] ?? null} .precision=${m.precision}></metric-card>`)}
      </div>

    `;
  }
}

declare global {
  interface HTMLElementTagNameMap { "instrument-panel": InstrumentPanel; }
}