/** <data-stream-bar> —— 数据流呼吸灯指示（仅指示灯，无文字/无时间）。契约：active。
 *  active=true 绿色呼吸闪烁表示有数据上报，否则暗灯表示无数据。 */
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("data-stream-bar")
export class DataStreamBar extends LitElement {
  @property({ type: Boolean }) active = false;

  static styles = css`
    :host { display: inline-flex; align-items: center; justify-content: center; }
    .dot {
      width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
      background: rgba(125, 138, 166, .3); transition: background .25s;
    }
    .dot.live { background: var(--it-accent-2); animation: breathe 1.1s ease-in-out infinite; }
    @keyframes breathe {
      0%   { box-shadow: 0 0 0 0 rgba(52, 211, 153, .55); transform: scale(1); }
      50%  { box-shadow: 0 0 9px 3px rgba(52, 211, 153, .45); transform: scale(1.22); }
      100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); transform: scale(1); }
    }
  `;

  protected render() {
    return html`<span class="dot ${this.active ? "live" : ""}" part="dot" role="status"
      aria-label=${this.active ? "数据上报中" : "等待数据上报"}
      title=${this.active ? "数据上报中" : "等待数据上报"}></span>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "data-stream-bar": DataStreamBar; }
}