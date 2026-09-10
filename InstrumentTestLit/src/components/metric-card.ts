/** <metric-card> —— 单个指标卡片，纯展示，契约：label/unit/value/precision。 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { formatMetricValue } from "../core/format.js";

@customElement("metric-card")
export class MetricCard extends LitElement {
  @property() label = "";
  @property() unit = "";
  @property({ attribute: false }) value: number | null = null;
  @property({ type: Number }) precision = 4;

  static styles = css`
    :host { display: block; }
    .card {
      background: var(--it-surface);
      border: 1px solid var(--it-border);
      border-radius: var(--it-radius);
      padding: 18px 16px;
      position: relative;
      overflow: hidden;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      transition: border-color .25s, transform .25s;
    }
    .card::before {
      content: ""; position: absolute; top: 0; left: 14%; right: 14%; height: 1px;
      background: linear-gradient(90deg, transparent, rgba(91, 156, 255, .55), transparent);
    }
    .card::after {
      content: ""; position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(120px 80px at 85% -10%, rgba(91, 156, 255, .1), transparent 60%);
    }
    .card:hover { border-color: var(--it-border-strong); transform: translateY(-2px); }
    .label { font-size: .8rem; color: var(--it-muted); letter-spacing: .04em; margin-bottom: 10px; font-weight: 500; }
    .value { display: flex; align-items: baseline; gap: 6px; }
    .num {
      font-size: 1.75rem; font-weight: 700; font-family: var(--it-mono);
      font-variant-numeric: tabular-nums; color: var(--it-text);
      letter-spacing: -.02em; text-shadow: 0 0 22px rgba(91, 156, 255, .18);
    }
    .unit { font-size: .8rem; color: var(--it-muted); font-family: var(--it-mono); }
    @media (max-width: 480px) { .num { font-size: 1.45rem; } .card { padding: 14px 12px; } }
  `;

  protected render() {
    return html`<div class="card" part="card">
      <div class="label" part="label">${this.label}</div>
      <div class="value">
        <span class="num" part="num">${formatMetricValue(this.value, this.precision)}</span>
        <span class="unit" part="unit">${this.unit || nothing}</span>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "metric-card": MetricCard; }
}