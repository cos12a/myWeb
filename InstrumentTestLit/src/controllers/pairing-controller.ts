/** 配对模态 Controller —— 副作用：倒计时定时器 + Promise resolve。
 *  弹出模态等待用户输入 6 位密钥，PAIR_WINDOW_MS 窗口期，超时/取消返回 null。 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { PairResult } from "../core/types.js";

export const PAIR_WINDOW_MS = 40000;
const TICK_MS = 1000;

export class PairingController implements ReactiveController {
  private host: ReactiveControllerHost;
  private resolve: ((r: PairResult) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** 模态是否显示。 */
  open = false;
  /** 剩余秒数。 */
  remaining = 0;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {}
  hostDisconnected(): void { this.cancel(); }

  /** 弹出模态，返回 Promise；用户提交/取消/超时 resolve。 */
  ask(): Promise<PairResult> {
    return new Promise<PairResult>((resolve) => {
      this.resolve = resolve;
      this.open = true;
      this.remaining = Math.floor(PAIR_WINDOW_MS / TICK_MS);
      this.host.requestUpdate();
      this.timer = setInterval(() => this.tick(), TICK_MS);
    });
  }

  private tick(): void {
    this.remaining -= 1;
    this.host.requestUpdate();
    if (this.remaining <= 0) this.cancel();
  }

  /** 用户提交密钥。 */
  submit(passkey: string): void {
    this.finish(passkey);
  }

  /** 取消/超时/设备断开。 */
  cancel(): void {
    this.finish(null);
  }

  private finish(result: PairResult): void {
    if (!this.resolve) return;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const resolve = this.resolve;
    this.resolve = null;
    this.open = false;
    this.host.requestUpdate();
    resolve(result);
  }
}