/** <pair-modal> —— 配对密钥模态框，契约：open/remaining，事件：submit(detail)/cancel。 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { isValidPasskey } from "../core/format.js";

@customElement("pair-modal")
export class PairModal extends LitElement {
  @property({ type: Boolean }) open = false;
  @property({ type: Number }) remaining = 0;

  @state() private shaking = false;
  private inputEl: HTMLInputElement | null = null;

  static styles = css`
    :host { display: contents; }
    .overlay {
      position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 20px;
      background: rgba(7, 9, 15, .82); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      animation: in .2s ease-out;
    }
    @keyframes in { from { opacity: 0; } to { opacity: 1; } }
    .card {
      width: 100%; max-width: 360px; padding: 28px 24px;
      background: var(--it-surface); border: 1px solid var(--it-border-strong); border-radius: 18px;
      backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      box-shadow: 0 30px 70px rgba(0, 0, 0, .55); text-align: center;
    }
    .title { font-size: 1.2rem; font-weight: 700; margin-bottom: 10px; }
    .desc { color: var(--it-muted); font-size: .82rem; line-height: 1.6; margin-bottom: 18px; text-align: left; }
    .input {
      width: 100%; padding: 14px 16px; font-family: var(--it-mono); font-size: 1.4rem; font-weight: 700;
      letter-spacing: .4em; text-align: center; color: var(--it-text);
      background: rgba(7, 9, 15, .55); border: 1px solid var(--it-border-strong); border-radius: 11px;
      outline: none; transition: border-color .2s, box-shadow .2s;
    }
    .input::placeholder { color: var(--it-muted); letter-spacing: .04em; font-weight: 500; }
    .input:focus { border-color: var(--it-accent); box-shadow: 0 0 0 3px rgba(91, 156, 255, .15); }
    .input.shake { animation: shake .4s; border-color: var(--it-danger); }
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-6px); }
      40%, 80% { transform: translateX(6px); }
    }
    .countdown { margin: 14px 0 18px; font-family: var(--it-mono); font-size: .8rem; color: var(--it-muted); letter-spacing: .06em; }
    .countdown.urgent { color: var(--it-warn); }
    .actions { display: flex; gap: 10px; justify-content: center; }
    .btn {
      flex: 1; max-width: 140px; border: 1px solid transparent; border-radius: 9px; padding: 10px 16px;
      font-size: .86rem; font-weight: 600; cursor: pointer; color: #fff;
      background: linear-gradient(135deg, var(--it-accent), #4a7fff); box-shadow: 0 6px 18px rgba(91, 156, 255, .28);
    }
    .btn.ghost { background: transparent; border-color: var(--it-border-strong); color: var(--it-muted); box-shadow: none; }
  `;

  protected override updated(): void {
    if (this.open && !this.inputEl) {
      this.inputEl = this.renderRoot.querySelector(".input");
      requestAnimationFrame(() => this.inputEl?.focus());
    }
    if (!this.open) this.inputEl = null;
  }

  private submit(): void {
    const v = (this.inputEl?.value ?? "").trim();
    if (!isValidPasskey(v)) {
      this.shaking = true;
      setTimeout(() => (this.shaking = false), 400);
      return;
    }
    this.dispatchEvent(new CustomEvent("submit", { bubbles: true, composed: true, detail: v }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent("cancel", { bubbles: true, composed: true }));
  }

  protected render() {
    if (!this.open) return nothing;
    return html`<div class="overlay" part="overlay">
      <div class="card" part="card">
        <div class="title">发起配对请求</div>
        <div class="desc">设备已连接。请在设备端查看 6 位配对密钥后输入，点击「开始配对」将向设备发起配对请求，系统会弹出配对弹窗，请在其中输入同一密钥完成配对。</div>
        <input class="input ${this.shaking ? "shake" : ""}" part="input" inputmode="numeric" maxlength="6"
               placeholder="6 位密钥" autocomplete="off" @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this.submit()}>
        <div class="countdown ${this.remaining <= 10 ? "urgent" : ""}" part="countdown">剩余 ${this.remaining} 秒</div>
        <div class="actions">
          <button class="btn ghost" part="cancel" @click=${this.cancel}>取消</button>
          <button class="btn" part="submit" @click=${this.submit}>开始配对</button>
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap { "pair-modal": PairModal; }
}