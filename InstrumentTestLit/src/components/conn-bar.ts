/** <conn-bar> —— 连接栏（紧凑版），契约：icon/label/statusText/dotOn/按钮禁用态，事件：connect/disconnect。
 *  自身不带卡片外框，由父级 .conn-group 统一包裹，便于蓝牙/串口并排合并显示。 */
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("conn-bar")
export class ConnBar extends LitElement {
  @property() icon = "";
  @property() label = "";
  @property() statusText = "未连接";
  @property({ type: Boolean }) dotOn = false;
  @property({ type: Boolean }) connectDisabled = false;
  @property({ type: Boolean }) disconnectDisabled = true;

  static styles = css`
    :host { display: block; min-width: 0; }
    .bar { display: flex; align-items: center; gap: 8px; }
    .label {
      display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
      font: 600 .72rem var(--it-mono); letter-spacing: .1em;
      color: var(--it-text); text-transform: uppercase;
    }
    .icon { font-size: .86rem; line-height: 1; }
    .status {
      display: inline-flex; align-items: center; gap: 5px; min-width: 0;
      font-size: .74rem; color: var(--it-muted); font-family: var(--it-mono);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .dot {
      width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
      background: rgba(125, 138, 166, .35); transition: background .25s, box-shadow .25s;
    }
    .dot.on { background: var(--it-accent-2); box-shadow: 0 0 7px rgba(52, 211, 153, .6); }
    .actions { margin-left: auto; display: inline-flex; gap: 6px; flex-shrink: 0; }
    .btn {
      border: 1px solid transparent; border-radius: 8px; padding: 5px 13px;
      font-size: .78rem; font-weight: 600; cursor: pointer; color: #fff;
      background: linear-gradient(135deg, var(--it-accent), #4a7fff);
      transition: transform .12s, box-shadow .2s, opacity .2s;
      box-shadow: 0 4px 12px rgba(91, 156, 255, .24);
    }
    .btn:disabled { opacity: .32; cursor: not-allowed; box-shadow: none; }
    .btn:active:not(:disabled) { transform: translateY(1px) scale(.97); }
    .btn.ghost { background: transparent; border-color: var(--it-border-strong); color: var(--it-muted); box-shadow: none; }
    .btn.ghost:hover:not(:disabled) { color: var(--it-text); border-color: var(--it-accent); }
  `;

  private emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  protected render() {
    return html`<div class="bar" part="bar">
      <span class="label" part="label">${this.icon ? html`<span class="icon" part="icon">${this.icon}</span>` : ""}${this.label}</span>
      <span class="status" part="status">
        <span class="dot ${this.dotOn ? "on" : ""}" part="dot"></span>
        <span part="status-text">${this.statusText}</span>
      </span>
      <span class="actions" part="actions">
        <button class="btn" part="btn" ?disabled=${this.connectDisabled} @click=${() => this.emit("connect")}>连接</button>
        <button class="btn ghost" part="btn-ghost" ?disabled=${this.disconnectDisabled} @click=${() => this.emit("disconnect")}>断开</button>
      </span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "conn-bar": ConnBar; }
}