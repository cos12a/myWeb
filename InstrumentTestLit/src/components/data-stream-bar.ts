/** <data-stream-bar> —— 数据流呼吸灯提醒条，契约：active/lastAt/text。 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { formatClock } from "../core/format.js";

@customElement("data-stream-bar")
export class DataStreamBar extends LitElement {
  @property({ type: Boolean }) active = false;
  @property({ type: Number }) lastAt = 0;

  static styles = css`
    :host { display: block; }
    .bar {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px; margin-bottom: 16px;
      background: var(--it-surface-2);
      border: 1px solid var(--it-border); border-radius: 12px;
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      font-family: var(--it-mono); font-size: .78rem; color: var(--it-muted);
    }
    .dot {
      width: 9px; height: 9px; border-radius: 50%;
      background: rgba(125, 138, 166, .3); flex-shrink: 0; transition: background .25s;
    }
    .dot.live { background: var(--it-accent-2); animation: breathe 1s ease-in-out infinite; }
    @keyframes breathe {
      0%   { box-shadow: 0 0 0 0 rgba(52, 211, 153, .55); transform: scale(1); }
      50%  { box-shadow: 0 0 10px 3px rgba(52, 211, 153, .45); transform: scale(1.18); }
      100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0); transform: scale(1); }
    }
    .text { color: var(--it-text); font-weight: 600; letter-spacing: .04em; }
    .text.idle { color: var(--it-muted); font-weight: 500; }
    .meta { margin-left: auto; color: var(--it-accent); font-size: .72rem; letter-spacing: .06em; }
  `;

  protected render() {
    const text = this.active ? "数据上报中" : "等待数据上报";
    return html`<div class="bar" part="bar">
      <span class="dot ${this.active ? "live" : ""}" part="dot"></span>
      <span class="text ${this.active ? "" : "idle"}" part="text">${text}</span>
      <span class="meta" part="meta">${this.active && this.lastAt ? formatClock(this.lastAt) : nothing}</span>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "data-stream-bar": DataStreamBar; }
}