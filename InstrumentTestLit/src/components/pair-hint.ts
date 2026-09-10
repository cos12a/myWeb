/** <pair-hint> —— 配对提示横幅，契约：key/open，事件：close。 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("pair-hint")
export class PairHint extends LitElement {
  @property() key = "";
  @property({ type: Boolean }) open = false;

  static styles = css`
    :host { display: block; }
    :host([hidden]) { display: none; }
    .hint {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      padding: 12px 14px; margin-bottom: 16px;
      background: linear-gradient(135deg, rgba(91, 156, 255, .14), rgba(52, 211, 153, .08));
      border: 1px solid rgba(91, 156, 255, .35); border-radius: 12px;
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      font-size: .84rem; animation: in .25s ease-out;
    }
    @keyframes in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .label {
      font: 600 .7rem var(--it-mono); letter-spacing: .14em; color: var(--it-accent);
      text-transform: uppercase; padding: 3px 8px; border: 1px solid rgba(91, 156, 255, .4); border-radius: 6px;
    }
    .text { color: var(--it-text); }
    .key {
      font-family: var(--it-mono); font-size: 1.15rem; font-weight: 700; letter-spacing: .25em;
      color: var(--it-accent-2); text-shadow: 0 0 14px rgba(52, 211, 153, .4);
      padding: 2px 10px; background: rgba(7, 9, 15, .5); border-radius: 7px;
    }
    .close {
      margin-left: auto; width: 26px; height: 26px; border: none; border-radius: 50%;
      background: rgba(255, 255, 255, .08); color: var(--it-muted); font-size: 1rem; cursor: pointer;
      transition: background .2s, color .2s;
    }
    .close:hover { background: rgba(255, 255, 255, .16); color: var(--it-text); }
  `;

  private dismiss(): void {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  protected render() {
    if (!this.open) return nothing;
    return html`<div class="hint" part="hint">
      <span class="label">配对中</span>
      <span class="text">${this.key
        ? html`请在系统蓝牙配对弹窗中输入：`
        : html`正在配对，请在系统蓝牙弹窗输入密钥`}</span>
      ${this.key ? html`<span class="key" part="key">${this.key}</span>` : nothing}
      <button class="close" part="close" @click=${this.dismiss} aria-label="关闭">×</button>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "pair-hint": PairHint; }
}