// 周期自动上报控制器（AR-1.0）：把 I2cBackend 的可选 REPORT_* 方法面
// 收口成 UI 可用的 Promise API，并在旧固件上给出可读的降级提示。
import type {
  I2cBackend,
  I2cReportConfig,
  I2cReportFrame,
  I2cReportInfo,
  I2cReportStatus,
  I2cReportStopped,
  I2cReportTask,
} from "./backend.ts";
import { AUTO_REPORT_ALL, normalizeReportTask } from "./auto_report.mjs";

const UNSUPPORTED =
  "当前固件不支持周期自动上报（需 REPORT_* 0x0240–0x0245），请先升级固件。";

export class AutoReportController {
  #backend: I2cBackend;

  constructor(backend: I2cBackend) {
    this.#backend = backend;
  }

  /** 当前后端是否实现了 REPORT_* 方法面（传输层支持即可，固件另行判定）。 */
  supportsReport(): boolean {
    return typeof this.#backend.configureReport === "function";
  }

  /** 写入一个任务槽位；运行中的槽位需先停止，否则固件回 ERR_ARG。 */
  async configure(task: I2cReportTask): Promise<I2cReportConfig> {
    const configure = this.#backend.configureReport;
    if (!configure) throw new Error(UNSUPPORTED);
    return await configure.call(
      this.#backend,
      normalizeReportTask(task) as I2cReportTask,
    );
  }

  /** 启动任务表（默认全部已配置任务）。 */
  async start(taskId: number = AUTO_REPORT_ALL): Promise<I2cReportInfo> {
    const start = this.#backend.startReport;
    if (!start) throw new Error(UNSUPPORTED);
    return await start.call(this.#backend, taskId);
  }

  /** 停止任务表（默认全部），返回各任务在固件侧的帧数统计。 */
  async stop(taskId: number = AUTO_REPORT_ALL): Promise<I2cReportStopped[]> {
    const stop = this.#backend.stopReport;
    if (!stop) throw new Error(UNSUPPORTED);
    return await stop.call(this.#backend, taskId);
  }

  /** 查询任务表快照。 */
  async status(): Promise<I2cReportStatus> {
    const query = this.#backend.queryReport;
    if (!query) throw new Error(UNSUPPORTED);
    return await query.call(this.#backend);
  }

  /** 停止全部并清空任务表。 */
  async clear(): Promise<number> {
    const clear = this.#backend.clearReport;
    if (!clear) throw new Error(UNSUPPORTED);
    return await clear.call(this.#backend);
  }

  /** 订阅设备主动上报帧；后端不支持时返回空订阅函数。 */
  subscribe(listener: (frame: I2cReportFrame) => void): () => void {
    const subscribe = this.#backend.subscribeReport;
    if (!subscribe) return () => {};
    return subscribe.call(this.#backend, listener);
  }
}
