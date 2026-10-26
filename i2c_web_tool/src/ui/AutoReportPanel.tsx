import { useCallback, useEffect, useRef, useState } from "react";
import type {
  I2cReportConfig,
  I2cReportFrame,
  I2cReportInfo,
  I2cReportStatus,
  I2cReportStopped,
  I2cReportTask,
} from "../types.ts";
import {
  AUTO_REPORT_LIMITS,
  createReportTracker,
  formatReportBytes,
} from "../serial/auto_report.mjs";

interface AutoReportPanelProps {
  connected: boolean;
  busy: boolean;
  /** 跳到「I²C 操作台」建立连接：器件页不再自带串口 / 蓝牙连接按钮 */
  onGoConnect: () => void;
  /** 写入一个任务槽位；运行中的槽位由固件回 ERR_ARG，面板负责提示。 */
  onConfigure: (task: I2cReportTask) => Promise<I2cReportConfig>;
  onStart: (taskId?: number) => Promise<I2cReportInfo>;
  onStop: (taskId?: number) => Promise<I2cReportStopped[]>;
  onStatus: () => Promise<I2cReportStatus>;
  onClear: () => Promise<number>;
  /** 订阅设备主动推送的 REPORT_DATA 帧；旧固件不会产生任何帧。 */
  onSubscribe: (listener: (frame: I2cReportFrame) => void) => () => void;
}

/** 上报帧在界面侧的累计信息：帧数、丢帧与设备时间轴间隔。 */
interface LiveEntry {
  taskId: number;
  address: number;
  seq: number;
  atMs: number;
  bytes: number[];
  frames: number;
  lost: number;
  intervalMs: number;
}

interface ReportTracker {
  observe(frame: I2cReportFrame): LiveEntry;
  snapshot(taskId: number): LiveEntry | null;
  all(): LiveEntry[];
  reset(): void;
}

/** REPORT_START / REPORT_STOP 的「全部任务」编号。 */
const ALL_TASKS = 0xff;
/** REPORT_CONFIG 的 onlyChanged 能力位。 */
const FLAG_ONLY_CHANGED = 0x01;
/** 渲染节流：设备可能几十毫秒一帧，界面按 10 FPS 刷新足够。 */
const FLUSH_INTERVAL_MS = 100;
const DEFAULT_MAX_TASKS = AUTO_REPORT_LIMITS.tasks;

function byteHex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** 支持 0x 前缀十六进制与十进制，无法解析时返回 fallback。 */
function parseNumber(text: string, fallback = 0): number {
  const trimmed = text.trim().toLowerCase();
  const parsed = trimmed.startsWith("0x")
    ? Number.parseInt(trimmed.slice(2), 16)
    : Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败。";
}

function isUnsupported(message: string): boolean {
  return message.includes("ERR_UNSUPPORTED") || message.includes("不支持");
}

function AutoReportPanel(props: AutoReportPanelProps) {
  const { connected, busy, onGoConnect, onSubscribe } = props;

  const [taskIdText, setTaskIdText] = useState("0");
  const [addressText, setAddressText] = useState("0x18");
  const [registerText, setRegisterText] = useState("0x28");
  const [lengthText, setLengthText] = useState("6");
  const [periodText, setPeriodText] = useState("100");
  const [countText, setCountText] = useState("0");
  const [onlyChanged, setOnlyChanged] = useState(false);

  const [statusInfo, setStatusInfo] = useState<I2cReportStatus | null>(null);
  const [live, setLive] = useState<LiveEntry[]>([]);
  const [notice, setNotice] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [pending, setPending] = useState(false);

  const trackerRef = useRef<ReportTracker | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  const refresh = useCallback(
    async (silent = false) => {
      try {
        const value = await props.onStatus();
        setStatusInfo(value);
        setUnavailable(false);
        if (!silent) {
          setNotice(
            `任务表已刷新：${value.tasks.length} 个槽位，运行中 ${value.activeCount} 个。`,
          );
        }
      } catch (error) {
        const message = errorText(error);
        setNotice(message);
        if (isUnsupported(message)) setUnavailable(true);
      }
    },
    [props.onStatus],
  );

  // 连接建立后订阅上报帧；断开时清空累计，避免旧数据混入新会话。
  useEffect(() => {
    if (!connected) {
      trackerRef.current = null;
      setLive([]);
      setStatusInfo(null);
      setNotice("");
      setUnavailable(false);
      return;
    }
    const tracker = createReportTracker() as ReportTracker;
    trackerRef.current = tracker;
    const unsubscribe = onSubscribe((frame) => {
      tracker.observe(frame);
      if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null;
          setLive(tracker.all());
        }, FLUSH_INTERVAL_MS);
      }
    });
    return () => {
      unsubscribe();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      trackerRef.current = null;
    };
  }, [connected, onSubscribe]);

  // 连接后先拉一次任务表：旧固件会在这里暴露 ERR_UNSUPPORTED。
  useEffect(() => {
    if (!connected) return;
    void refresh(true);
  }, [connected, refresh]);

  const runAction = async (label: string, action: () => Promise<string>) => {
    if (pending || busy) return;
    setPending(true);
    try {
      setNotice(`${label} · ${await action()}`);
    } catch (error) {
      const message = errorText(error);
      setNotice(message);
      if (isUnsupported(message)) setUnavailable(true);
    } finally {
      setPending(false);
    }
  };

  const buildTask = (): I2cReportTask => ({
    taskId: parseNumber(taskIdText, -1),
    address: parseNumber(addressText, -1),
    register: parseNumber(registerText, -1),
    length: parseNumber(lengthText, -1),
    periodMs: parseNumber(periodText, -1),
    count: parseNumber(countText, -1),
    flags: onlyChanged ? FLAG_ONLY_CHANGED : 0,
  });

  const configure = () =>
    runAction("配置任务", async () => {
      const config = await props.onConfigure(buildTask());
      await refresh(true);
      return `槽位 ${config.taskId} · ${config.periodMs} ms${
        config.onlyChanged ? " · 仅变化上报" : ""
      }`;
    });

  const start = (target: number) =>
    runAction(
      target === ALL_TASKS ? "启动全部任务" : `启动任务 ${target}`,
      async () => {
        const info = await props.onStart(target);
        await refresh(true);
        return `${info.started} 个任务已启动 · tick ${info.tickMs} ms`;
      },
    );

  const stop = (target: number) =>
    runAction(
      target === ALL_TASKS ? "停止全部任务" : `停止任务 ${target}`,
      async () => {
        const stopped = await props.onStop(target);
        await refresh(true);
        if (stopped.length === 0) return "没有正在运行的任务";
        const frames = stopped.reduce((sum, item) => sum + item.frames, 0);
        return `已停止 ${stopped.length} 个任务，共上报 ${frames} 帧`;
      },
    );

  const clear = () =>
    runAction("清空任务表", async () => {
      const cleared = await props.onClear();
      trackerRef.current?.reset();
      setLive([]);
      await refresh(true);
      return `已清空 ${cleared} 个槽位`;
    });

  const locked = !connected || pending || busy || unavailable;
  const maxTasks = statusInfo?.maxTasks ?? DEFAULT_MAX_TASKS;
  const taskIdNow = parseNumber(taskIdText, 0);
  const canStartTask = connected && taskIdNow !== ALL_TASKS &&
    taskIdNow >= 0 && taskIdNow < maxTasks;

  return (
    <section className="ch224-page" aria-label="周期自动上报">
      {!connected && (
        <div className="page-connect-hint">
          未连接设备 · 请先在
          <button
            type="button"
            className="text-button hint-link"
            onClick={onGoConnect}
          >
            I²C 操作台
          </button>
          完成串口 / 蓝牙连接，本页与总线操作台共用同一连接
        </div>
      )}

      {unavailable && (
        <div className="connection-note warning">
          <span>!</span>{" "}
          当前固件不支持周期自动上报（需 REPORT_* 0x0240–0x0245）。请升级固件后重连；协议见
          docs/AUTO_REPORT_PROTOCOL.md。
        </div>
      )}

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>01</span>
          <div>
            <h3>任务槽位配置</h3>
            <p>
              固件按 periodMs 自行读取寄存器并主动推送 REPORT_DATA，主机无需轮询；
              一个槽位固定「地址 + 起始寄存器 + 长度」，最多
              {" "}{maxTasks} 个槽位并行。
            </p>
          </div>
        </div>

        <div className="mlx-toolbar">
          <div className="mlx-field autoreport-field">
            <label htmlFor="report-task-id">任务编号</label>
            <input
              id="report-task-id"
              type="number"
              min={0}
              max={maxTasks - 1}
              value={taskIdText}
              onChange={(event) => setTaskIdText(event.target.value)}
            />
          </div>
          <div className="mlx-field autoreport-field">
            <label htmlFor="report-address">器件地址</label>
            <input
              id="report-address"
              value={addressText}
              onChange={(event) => setAddressText(event.target.value)}
            />
          </div>
          <div className="mlx-field autoreport-field">
            <label htmlFor="report-register">起始寄存器</label>
            <input
              id="report-register"
              value={registerText}
              onChange={(event) => setRegisterText(event.target.value)}
            />
          </div>
          <div className="mlx-field autoreport-field">
            <label htmlFor="report-length">读取长度</label>
            <input
              id="report-length"
              type="number"
              min={1}
              max={AUTO_REPORT_LIMITS.length}
              value={lengthText}
              onChange={(event) => setLengthText(event.target.value)}
            />
          </div>
          <div className="mlx-field autoreport-field">
            <label htmlFor="report-period">上报周期 ms</label>
            <input
              id="report-period"
              type="number"
              min={AUTO_REPORT_LIMITS.periodMinMs}
              max={AUTO_REPORT_LIMITS.periodMaxMs}
              value={periodText}
              onChange={(event) => setPeriodText(event.target.value)}
            />
          </div>
          <div className="mlx-field autoreport-field">
            <label htmlFor="report-count">帧数上限</label>
            <input
              id="report-count"
              type="number"
              min={0}
              max={AUTO_REPORT_LIMITS.countMax}
              value={countText}
              onChange={(event) => setCountText(event.target.value)}
            />
          </div>
          <div className="mlx-field mlx-toggle-field">
            <label>仅变化上报</label>
            <button
              type="button"
              className={`mlx-switch ${onlyChanged ? "on" : ""}`}
              role="switch"
              aria-checked={onlyChanged}
              disabled={pending}
              onClick={() => setOnlyChanged((value) => !value)}
            >
              <i />
            </button>
          </div>
          <button
            className="button primary"
            disabled={locked}
            onClick={() => void configure()}
          >
            下发配置
          </button>
        </div>

        <div className="autoreport-actions">
          <button
            className="button secondary"
            disabled={locked || !canStartTask}
            onClick={() => void start(taskIdNow)}
          >
            启动本槽位
          </button>
          <button
            className="button secondary"
            disabled={locked || !canStartTask}
            onClick={() => void stop(taskIdNow)}
          >
            停止本槽位
          </button>
          <button
            className="button secondary"
            disabled={locked}
            onClick={() => void refresh()}
          >
            刷新任务表
          </button>
        </div>

        <p className="lis3dh-hint">
          顺序固定：先「下发配置」→ 再「启动」→ 数据卡自动累积帧。运行中的槽位再配置会被固件拒绝（ERR_ARG），需先停止；
          周期 1–60000 ms，帧数上限 0 表示不限。周期自动上报与中断推送（STREAM）互斥，同一时刻只能用一种主动上报。
        </p>
      </section>

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>02</span>
          <div>
            <h3>固件任务表</h3>
            <p>
              REPORT_STATUS 快照：槽位状态（未配置 / 已配置 / 运行中）、周期与计数方式以固件为准。
            </p>
          </div>
        </div>

        <div className="autoreport-meta">
          <span>MAX TASKS <b>{maxTasks}</b></span>
          <span>TICK <b>{statusInfo ? `${statusInfo.tickMs} ms` : "—"}</b></span>
          <span>运行中 <b>{statusInfo?.activeCount ?? 0}</b></span>
          <span>协议版本 <b>{statusInfo ? `v${statusInfo.version}` : "—"}</b></span>
        </div>

        <div className="autoreport-toolbar">
          <button
            className="button primary"
            disabled={locked}
            onClick={() => void start(ALL_TASKS)}
          >
            启动全部
          </button>
          <button
            className="button secondary"
            disabled={locked}
            onClick={() => void stop(ALL_TASKS)}
          >
            停止全部
          </button>
          <button
            className="button secondary"
            disabled={locked}
            onClick={() => void clear()}
          >
            清空任务表
          </button>
        </div>

        {statusInfo && statusInfo.tasks.length > 0
          ? (
            <div className="autoreport-table-wrap">
              <table className="autoreport-table">
                <thead>
                  <tr>
                    <th>槽位</th>
                    <th>地址</th>
                    <th>寄存器</th>
                    <th>长度</th>
                    <th>周期</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {statusInfo.tasks.map((task) => (
                    <tr
                      key={task.taskId}
                      className={task.state === 2 ? "running" : ""}
                    >
                      <td className="mono">{task.taskId}</td>
                      <td className="mono">{byteHex(task.address)}</td>
                      <td className="mono">{byteHex(task.register)}</td>
                      <td className="mono">{task.length}</td>
                      <td className="mono">{task.periodMs} ms</td>
                      <td>
                        <span
                          className={`result-badge ${
                            task.state === 2 ? "ok" : "idle"
                          }`}
                        >
                          {task.stateText}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          disabled={locked || task.state === 0}
                          onClick={() => void start(task.taskId)}
                        >
                          启动
                        </button>
                        <button
                          type="button"
                          className="text-button"
                          disabled={locked || task.state !== 2}
                          onClick={() => void stop(task.taskId)}
                        >
                          停止
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          : (
            <div className="autoreport-empty">
              <span>⌁</span>
              <p>{connected ? "任务表为空" : "未连接设备"}</p>
              <small>
                {connected
                  ? "在 01 区填写地址 / 寄存器 / 周期后下发配置，槽位会出现在这里"
                  : "连接后自动读取固件的任务表快照"}
              </small>
            </div>
          )}

        {notice && <div className="ch224-notice" role="status">{notice}</div>}
      </section>

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>03</span>
          <div>
            <h3>实时上报数据</h3>
            <p>
              按 taskId 汇总 REPORT_DATA：帧数、丢帧（seq 跳号）、设备侧间隔（atMs 差值，u32 回绕安全）与最近一次原始字节。
            </p>
          </div>
        </div>

        {live.length > 0
          ? (
            <div className="autoreport-cards">
              {live.map((entry) => {
                const task = statusInfo?.tasks.find((item) =>
                  item.taskId === entry.taskId
                );
                return (
                  <article className="autoreport-card" key={entry.taskId}>
                    <header>
                      <b>任务 {entry.taskId}</b>
                      <span>
                        {task
                          ? `${byteHex(task.address)} / ${
                            byteHex(task.register)
                          } · ${task.length} B`
                          : byteHex(entry.address)}
                      </span>
                    </header>
                    <code>{formatReportBytes(entry.bytes)}</code>
                    <dl>
                      <div>
                        <dt>seq</dt>
                        <dd>{entry.seq}</dd>
                      </div>
                      <div>
                        <dt>帧数</dt>
                        <dd>{entry.frames}</dd>
                      </div>
                      <div>
                        <dt>丢帧</dt>
                        <dd className={entry.lost > 0 ? "warn" : ""}>
                          {entry.lost}
                        </dd>
                      </div>
                      <div>
                        <dt>设备间隔</dt>
                        <dd>
                          {entry.frames > 1 ? `${entry.intervalMs} ms` : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>atMs</dt>
                        <dd>{entry.atMs}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          )
          : (
            <div className="autoreport-empty">
              <span>◎</span>
              <p>还没有上报帧</p>
              <small>
                启动任务后，固件会按周期主动推送；I²C 读失败的周期不推帧、seq 也不递增
              </small>
            </div>
          )}
      </section>
    </section>
  );
}

export default AutoReportPanel;
