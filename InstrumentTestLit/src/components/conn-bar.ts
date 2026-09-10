/** <conn-bar> —— 连接栏，契约：label/statusText/dotOn/按钮禁用态，事件：connect/disconnect。 */
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("conn-bar")
export class ConnBar extends LitElement {
  @property() label = "";
  @property() statusText = "未连接";
  @property({ type: Boolean }) dotOn = false;
  @property({ type: Boolean }) connectDisabled = false;
  @property({ type: Boolean }) disconnectDisabled = true;

  static styles = css`
    :host { display: block; }
    .bar {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 12px 14px; background: var(--it-surface);
      border: 1px solid var(--it-border); border-radius: var(--it-radius);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); margin-bottom: 16px;
    }
    .label {
      font: 600 .72rem var(--it-mono); letter-spacing: .14em; color: var(--it-muted);
      text-transform: uppercase; padding-right: 4px; border-right: 1px solid var(--it-border); margin-right: 2px;
    }
    .btn {
      border: 1px solid transparent; border-radius: 9px; padding: 8px 16px;
      font-size: .86rem; font-weight: 600; cursor: pointer; color: #fff;
      background: linear-gradient(135deg, var(--it-accent), #4a7fff);
      transition: transform .12s, box-shadow .2s, opacity .2s;
      box-shadow: 0 6px 18px rgba(91, 156, 255, .28);
    }
    .btn:disabled { opacity: .35; cursor: not-allowed; box-shadow: none; }
    .btn:active:not(:disabled) { transform: translateY(1px) scale(.98); }
    .btn.ghost { background: transparent; border-color: var(--it-border-strong); color: var(--it-muted); box-shadow: none; }
    .btn.ghost:hover:not(:disabled) { color: var(--it-text); border-color: var(--it-accent); }
    .status { margin-left: auto; font-size: .82rem; color: var(--it-muted); font-family: var(--it-mono); display: inline-flex; align-items: center; gap: 6px; }
    .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: rgba(125, 138, 166, .35); transition: background .25s, box-shadow .25s; flex-shrink: 0;
    }
    .dot.on { background: var(--it-accent-2); box-shadow: 0 0 8px rgba(52, 211, 153, .6); }
    @media (max-width: 480px) { .status { margin-left: 0; width: 100%; } }
  `;

  private emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  protected render() {
    return html`<div class="bar" part="bar">
      <span class="label" part="label">${this.label}</span>
      <button class="btn" part="btn" ?disabled=${this.connectDisabled} @click=${() => this.emit("connect")}>连接</button>
      <button class="btn ghost" part="btn-ghost" ?disabled=${this.disconnectDisabled} @click=${() => this.emit("disconnect")}>断开</button>
      <span class="status" part="status">
        <span class="dot ${this.dotOn ? "on" : ""}" part="dot"></span>
        <span part="status-text">${this.statusText}</span>
      </span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "conn-bar": ConnBar; }
}