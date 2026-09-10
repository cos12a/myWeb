/** 数据流呼吸灯 Controller —— 副作用：定时器。
 *  收到数据时激活呼吸灯，DATA_TIMEOUT_MS 内无新数据则熄灭。 */
import type { ReactiveController, ReactiveControllerHost } from "lit";

export const DATA_TIMEOUT_MS = 1000;

export class DataStreamController implements ReactiveController {
  private host: ReactiveControllerHost;
  private timer: ReturnType<typeof setTimeout> | null = null;

  active = false;
  lastAt = 0;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  hostConnected(): void {}
  hostDisconnected(): void { this.stop(); }

  /** 收到一帧数据时调用：激活呼吸灯并重置超时。 */
  pulse(): void {
    this.lastAt = Date.now();
    if (!this.active) {
      this.active = true;
      this.host.requestUpdate();
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.stop(), DATA_TIMEOUT_MS);
  }

  /** 停止数据流指示（熄灭）。 */
  stop(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.active) return;
    this.active = false;
    this.host.requestUpdate();
  }
}