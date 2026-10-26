import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  I2cBusConfig,
  I2cCapabilities,
  I2cReportConfig,
  I2cReportFrame,
  I2cReportInfo,
  I2cReportStatus,
  I2cReportStopped,
  I2cReportSummary,
  I2cReportTask,
  I2cStreamFrame,
  I2cStreamInfo,
  I2cStreamRequest,
  Lis3dhAxes,
  Lis3dhConfig,
  Lis3dhConfigResult,
  Lis3dhDecodedConfig,
  Lis3dhDiscoverResult,
  Lis3dhFifoBatch,
  Lis3dhFifoHint,
  Lis3dhReadMode,
  Lis3dhRegisterCatalog,
  Lis3dhRegisterReadResult,
  Lis3dhRegisterWriteResult,
  Lis3dhSample,
  Lis3dhTemperature,
} from "../types.ts";
import {
  buildIntPinChoices,
  formatIntPin,
  formatIntPinCode,
} from "../serial/int_pins.mjs";
import { createReportTracker } from "../serial/auto_report.mjs";

interface IntPinOption {
  value: number;
  label: string;
  note: string;
}

/** auto_report.mjs 的 tracker 只暴露部分字段，按 UI 需要收口。 */
interface ReportTracker {
  observe(frame: I2cReportFrame): {
    frames: number;
    lost: number;
    intervalMs: number;
  };
  reset(): void;
}

/** 中断引脚候选：ESP32 来自 CAPS 自由引脚表，STM32 按 port*16+pin 静态生成。 */
interface IntPinChoices {
  mode: "select" | "number";
  options: IntPinOption[];
  groups: Array<{ label: string; options: IntPinOption[] }>;
  preferred: number;
  hint: string;
}

interface Lis3dhPanelProps {
  connected: boolean;
  busy: boolean;
  /** 固件能力：决定中断引脚是自由 GPIO（ESP32）还是固定端口编码（STM32）。 */
  capabilities: I2cCapabilities | null;
  /** 当前 I²C 引脚：中断引脚候选要排除已占用的 SDA/SCL。 */
  busConfig: I2cBusConfig | null;
  /** 跳到「I²C 操作台」建立连接：器件页不再自带串口 / 蓝牙连接按钮 */
  onGoConnect: () => void;
  onDiscover: () => Promise<Lis3dhDiscoverResult | undefined>;
  onListRegisters: () => Promise<Lis3dhRegisterCatalog | undefined>;
  onReadSample: (
    address: number,
    fullScale: number,
  ) => Promise<Lis3dhSample | undefined>;
  onReadTemperature: (
    address: number,
  ) => Promise<Lis3dhTemperature | undefined>;
  onReadFifoBatch: (
    address: number,
    fullScale: number,
    maxSamples: number,
    odrHz: number,
  ) => Promise<Lis3dhFifoBatch | undefined>;
  onResetFifo: (address: number) => Promise<void>;
  /** 不溢出前提下 FIFO 建议的最大读取间隔。 */
  onFifoHint: (
    odrCode: number,
    outputMode: string,
    threshold?: number,
  ) => Promise<Lis3dhFifoHint>;
  /** 设备主动上报：固件需实现 STREAM_* 命令，旧固件报错后页面降级。 */
  onStartStream: (
    request: I2cStreamRequest,
  ) => Promise<I2cStreamInfo | undefined>;
  onStopStream: () => Promise<{ frames: number } | undefined>;
  /** 订阅解码后的推送样本；fullScale 为订阅时使用的换算量程。 */
  onSubscribeStream: (
    listener: (sample: Lis3dhSample, frame: I2cStreamFrame) => void,
    fullScale: number,
  ) => () => void;
  /** 周期上报（REPORT_*）：本页只用「一个槽位 + 固定 0xA8 / 6 字节」。 */
  onReportConfigure: (task: I2cReportTask) => Promise<I2cReportConfig>;
  onReportStart: (taskId?: number) => Promise<I2cReportInfo>;
  onReportStop: (taskId?: number) => Promise<I2cReportStopped[]>;
  onReportStatus: () => Promise<I2cReportStatus>;
  onSubscribeReportSample: (
    taskId: number,
    listener: (sample: Lis3dhSample, frame: I2cReportFrame) => void,
    fullScale: number,
  ) => () => void;
  onConfigure: (
    address: number,
    config: Lis3dhConfig,
  ) => Promise<Lis3dhConfigResult | undefined>;
  onReadRegister: (
    address: number,
    register: number,
  ) => Promise<Lis3dhRegisterReadResult | undefined>;
  onWriteRegister: (
    address: number,
    register: number,
    value: number,
  ) => Promise<Lis3dhRegisterWriteResult | undefined>;
}

/** 温度通道刷新节拍：轮询模式下每 N 次采样读一次温度，不占用采样周期。 */
const TEMP_REFRESH_EVERY = 10;
/** 单次轮询间隔选项：越大总线越轻松，越小越实时。 */
const POLL_INTERVAL_OPTIONS = [20, 50, 100, 200, 500, 1000];
/** FIFO 批量读取周期选项。 */
const FIFO_INTERVAL_OPTIONS = [50, 100, 200, 500, 1000];
/** 渲染节流：数据再快也只按显示帧率更新 React 状态。 */
const RENDER_THROTTLE_FPS = 60;
/** 周期上报：三轴固定从 0x28 自增块（0xA8）起读 6 字节。 */
const REPORT_REGISTER = 0xa8;
const REPORT_LENGTH = 6;
const REPORT_PERIOD_MIN_MS = 1;
const REPORT_PERIOD_MAX_MS = 60_000;
const REPORT_PERIOD_PRESETS = [20, 50, 100, 200, 500, 1000];
const REPORT_SLOT_OPTIONS = Array.from({ length: 16 }, (_, index) => index);

const ADDRESS_OPTIONS = [
  { value: 0x18, label: "0x18 · SA0/SDO = 0（默认）" },
  { value: 0x19, label: "0x19 · SA0/SDO = 1" },
];

/** 量程表：accRange 与 lis3dh.mjs 的 FULL_SCALES 保持一致（1 g 对应计数）。 */
const FULL_SCALE_OPTIONS = [
  { id: 0, label: "±2 g", accRange: 16000, mgPerDigit: 1 },
  { id: 1, label: "±4 g", accRange: 7282, mgPerDigit: 2 },
  { id: 2, label: "±8 g", accRange: 3968, mgPerDigit: 4 },
  { id: 3, label: "±16 g", accRange: 1280, mgPerDigit: 12 },
];

/**
 * ODR 档位：code 直接写入 CTRL_REG1 bit7:4。
 * 与 lis3dh.mjs 的 ODR_OPTIONS 保持一致；code 8/9 在低功耗模式下速率更高。
 */
const ODR_OPTIONS = [
  { code: 0x0, hz: 0, hzLowPower: 0, label: "掉电 · Power-down" },
  { code: 0x1, hz: 1, label: "1 Hz" },
  { code: 0x2, hz: 10, label: "10 Hz" },
  { code: 0x3, hz: 25, label: "25 Hz" },
  { code: 0x4, hz: 50, label: "50 Hz" },
  { code: 0x5, hz: 100, label: "100 Hz（常用）" },
  { code: 0x6, hz: 200, label: "200 Hz" },
  { code: 0x7, hz: 400, label: "400 Hz" },
  { code: 0x8, hz: 1344, hzLowPower: 1600, label: "1.344 kHz（低功耗 1.6 kHz）" },
  { code: 0x9, hz: 1344, hzLowPower: 5376, label: "1.344 kHz（低功耗 5.376 kHz）" },
];

/** 输出模式三档：与 lis3dh.mjs 的 OUTPUT_MODES 保持一致。 */
const OUTPUT_MODE_OPTIONS = [
  { id: "lowPower", label: "低功耗 · 8 位", note: "噪声最大，但支持 1.6/5.376 kHz" },
  { id: "normal", label: "正常 · 10 位", note: "噪声与功耗折中" },
  { id: "highResolution", label: "高分辨率 · 12 位", note: "默认，噪声最低" },
];

/** FIFO 模式：与 lis3dh.mjs 的 FIFO_MODES 保持一致。 */
const FIFO_MODE_OPTIONS = [
  { id: "bypass", label: "Bypass · 关闭（复位 FIFO）" },
  { id: "fifo", label: "FIFO · 填满即停" },
  { id: "stream", label: "Stream · 循环覆盖（推荐）" },
  { id: "streamToFifo", label: "Stream-to-FIFO · 触发转存" },
];

/** INT1 路由：与 lis3dh.mjs 的 INT_ROUTES 保持一致。 */
const INT_ROUTE_OPTIONS = [
  { id: "none", label: "不输出中断" },
  { id: "dataReady", label: "数据就绪 ZYXDA → INT1" },
  { id: "fifoWatermark", label: "FIFO 水印 WTM → INT1" },
];

/** 三种采样读取模式（01 区选择器）。 */
const READ_MODE_OPTIONS: Array<{
  id: Lis3dhReadMode;
  label: string;
  note: string;
}> = [
  { id: "poll", label: "单次轮询", note: "每次发读命令（1 次事务）；最简单，速率受往返时间限制" },
  { id: "fifo", label: "FIFO 批量", note: "芯片缓存 32 组，一次事务拿多组；降低总线压力，不丢样本" },
  { id: "stream", label: "中断推送", note: "固件读好后主动上报；页面零轮询，需固件支持 STREAM_* 命令" },
  { id: "report", label: "周期上报", note: "按设定周期自读 0xA8 六字节并上报；可跨页持续，需固件支持 REPORT_*" },
];

const DEFAULT_CONFIG: Lis3dhConfig = {
  odrCode: 0x5,
  fullScale: 0,
  outputMode: "highResolution",
  blockDataUpdate: true,
  axes: { x: true, y: true, z: true },
  tempEnable: false,
  intRoute: "none",
  fifo: { enabled: false, mode: "stream", threshold: 16 },
};

const KIND_LABELS: Record<string, string> = {
  id: "识别 · 只读",
  status: "状态 · 只读",
  out: "输出 · 只读",
  ctrl: "控制 · 读写",
  int: "中断 · 读写",
};

/** 性能参数展示文案（纯 UI 数据，逻辑层不参与）。 */
const PERFORMANCE_ROWS = [
  { label: "供电电压", value: "1.71 – 3.6 V", note: "模块常见 3.3 V；I²C 电平随 VDD" },
  { label: "量程", value: "±2 / ±4 / ±8 / ±16 g", note: "CTRL_REG4.FS 选择，默认 ±2 g" },
  { label: "分辨率", value: "12 位（HR）/ 10 位（正常）/ 8 位（低功耗）", note: "数据 16 位左对齐，低 4 位为 0" },
  { label: "灵敏度", value: "1 / 2 / 4 / 12 mg/digit", note: "对应 ±2/±4/±8/±16 g（12 位，手册标称）" },
  { label: "输出数据速率", value: "1 Hz – 5 kHz", note: "ODR 共 10 档，掉电档为 0x00" },
  { label: "I²C 速率", value: "最高 400 kHz（Fast mode）", note: "本工具默认 100 kHz 更稳" },
  { label: "I²C 地址", value: "0x18（SA0=0）/ 0x19（SA0=1）", note: "WHO_AM_I 固定 0x33" },
  { label: "噪声密度", value: "约 220 µg/√Hz（HR，±2 g）", note: "低功耗模式噪声更低但带宽更小" },
  { label: "工作电流", value: "约 2 – 11 µA（低功耗）～ 250 µA（HR 400 Hz）", note: "随 ODR 与模式变化" },
  { label: "温度传感器", value: "约 1 °C/LSB，+25 °C 偏移", note: "精度有限，仅供相对参考；启用后 ADC3 被占用" },
  { label: "中断能力", value: "INT1 / INT2、6D 方向、自由落体、单击/双击", note: "阈值与持续时间可编程" },
  { label: "内置 FIFO", value: "32 级（Bypass / FIFO / Stream）", note: "可批量读取，降低主机轮询压力" },
];

function byteHex(value: number): string {
  return `0x${(value & 0xff).toString(16).toUpperCase().padStart(2, "0")}`;
}

function parseHexByte(value: string): number | null {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[\da-f]{1,2}$/i.test(normalized)) return null;
  return Number.parseInt(normalized, 16);
}

function formatAxis(value: number, digits = 3): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function fullScaleLabel(id: number): string {
  return FULL_SCALE_OPTIONS.find((item) => item.id === id)?.label ?? "±2 g";
}

/** 当前输出模式下 ODR 档的实际速率（低功耗 8/9 档更高）。 */
function odrHzForMode(code: number, outputMode: string): number {
  const option = ODR_OPTIONS.find((item) => item.code === code);
  if (!option) return 0;
  if (outputMode === "lowPower" && option.hzLowPower !== undefined) {
    return option.hzLowPower;
  }
  return option.hz;
}

/** ODR 下拉文案：8/9 档按当前输出模式显示实际速率。 */
function odrLabelFor(code: number, outputMode: string): string {
  const option = ODR_OPTIONS.find((item) => item.code === code);
  if (!option) return "—";
  if (code === 0x8 || code === 0x9) {
    return outputMode === "lowPower"
      ? `${option.hzLowPower ?? option.hz} Hz（低功耗模式）`
      : `${option.hz} Hz`;
  }
  return option.label;
}

function outputModeLabel(id: string): string {
  return OUTPUT_MODE_OPTIONS.find((item) => item.id === id)?.label ?? id;
}

function readModeLabel(id: Lis3dhReadMode): string {
  return READ_MODE_OPTIONS.find((item) => item.id === id)?.label ?? id;
}

/** FIFO 模式短名（取「·」前的部分，便于状态卡展示）。 */
function fifoModeLabel(id: string): string {
  const option = FIFO_MODE_OPTIONS.find((item) => item.id === id);
  return option ? option.label.split(" ·")[0] ?? option.label : id;
}

function intRouteLabel(id: string): string {
  return INT_ROUTE_OPTIONS.find((item) => item.id === id)?.label ?? id;
}

function Lis3dhPanel({
  connected,
  busy,
  capabilities,
  busConfig,
  onGoConnect,
  onDiscover,
  onListRegisters,
  onReadSample,
  onReadTemperature,
  onReadFifoBatch,
  onResetFifo,
  onFifoHint,
  onStartStream,
  onStopStream,
  onSubscribeStream,
  onReportConfigure,
  onReportStart,
  onReportStop,
  onReportStatus,
  onSubscribeReportSample,
  onConfigure,
  onReadRegister,
  onWriteRegister,
}: Lis3dhPanelProps) {
  const [address, setAddress] = useState(0x18);
  const [autoOn, setAutoOn] = useState(true);
  const [readMode, setReadMode] = useState<Lis3dhReadMode>("poll");
  const [pollIntervalMs, setPollIntervalMs] = useState(100);
  const [fifoIntervalMs, setFifoIntervalMs] = useState(200);
  const [sample, setSample] = useState<Lis3dhSample | null>(null);
  const [temperature, setTemperature] = useState<Lis3dhTemperature | null>(
    null,
  );
  const [sampleCount, setSampleCount] = useState(0);
  const [rateHz, setRateHz] = useState(0);
  const [notice, setNotice] = useState("");
  const [found, setFound] = useState<Lis3dhDiscoverResult | null>(null);

  const [config, setConfig] = useState<Lis3dhConfig>(DEFAULT_CONFIG);
  const [configResult, setConfigResult] = useState<Lis3dhConfigResult | null>(
    null,
  );
  const [fifoBatch, setFifoBatch] = useState<Lis3dhFifoBatch | null>(null);
  const [fifoHint, setFifoHint] = useState<Lis3dhFifoHint | null>(null);
  const [streamInfo, setStreamInfo] = useState<I2cStreamInfo | null>(null);
  const [streamMode, setStreamMode] = useState<"int" | "poll">("int");
  const [streamPeriodMs, setStreamPeriodMs] = useState(10);
  const [streamIntPin, setStreamIntPin] = useState(4);
  const [streamLost, setStreamLost] = useState(0);
  const [streamFrames, setStreamFrames] = useState(0);
  /** 周期上报（REPORT_*）：本页只占用一个槽位，周期/上限可随时改。 */
  const [reportTaskId, setReportTaskId] = useState(0);
  const [reportPeriodMs, setReportPeriodMs] = useState(100);
  const [reportCount, setReportCount] = useState(0);
  const [reportRunning, setReportRunning] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportUnavailable, setReportUnavailable] = useState(false);
  const [reportSummary, setReportSummary] = useState<I2cReportSummary | null>(
    null,
  );
  const [reportInfo, setReportInfo] = useState("");
  const [reportFrames, setReportFrames] = useState(0);
  const [reportLost, setReportLost] = useState(0);
  const [reportInterval, setReportInterval] = useState(0);

  const intPinMachine = capabilities?.machine ?? "unknown";
  const intPinChoices = useMemo(() => {
    return buildIntPinChoices({
      machine: intPinMachine,
      pins: capabilities?.pins ?? [],
      sda: busConfig?.sda ?? null,
      scl: busConfig?.scl ?? null,
    }) as unknown as IntPinChoices;
  }, [intPinMachine, capabilities, busConfig]);

  // 能力表到达或换芯片后，把选中引脚收敛到仍合法的候选（ESP32 优先 GPIO4）。
  useEffect(() => {
    if (intPinChoices.mode !== "select") return;
    const values = intPinChoices.options.map((item) => item.value);
    setStreamIntPin((current) =>
      values.includes(current) ? current : intPinChoices.preferred
    );
  }, [intPinChoices]);

  const [registerAddress, setRegisterAddress] = useState("0F");
  const [registerWriteValue, setRegisterWriteValue] = useState("00");
  const [readResult, setReadResult] = useState<Lis3dhRegisterReadResult | null>(
    null,
  );
  const [writeResult, setWriteResult] =
    useState<Lis3dhRegisterWriteResult | null>(null);
  const [registerMap, setRegisterMap] = useState<Lis3dhRegisterCatalog["registers"]>(
    [],
  );

  const busyRef = useRef(busy);
  busyRef.current = busy;
  const pollingRef = useRef(false);
  const tickRef = useRef(0);
  const registerLoadedRef = useRef(false);
  /** 渲染节流：最新样本先写入 ref，按显示帧率再同步到 React 状态。 */
  const latestSampleRef = useRef<Lis3dhSample | null>(null);
  const renderPendingRef = useRef(false);
  const renderRafRef = useRef(0);
  /** 实测速率统计：累计计数 + 窗口起点。 */
  const rateRef = useRef({ count: 0, since: performance.now() });
  /** 流式帧序号追踪：用于统计丢帧。 */
  const streamSeqRef = useRef(-1);
  const unsubscribeStreamRef = useRef<(() => void) | null>(null);
  /** 流式是否运行中：退出清理与卸载收尾用 ref，避免依赖 state 形成环。 */
  const streamingRef = useRef(false);
  /** 卸载/清理时调用的停止推送 handler（始终指向最新 props）。 */
  const stopStreamRef = useRef(onStopStream);
  stopStreamRef.current = onStopStream;
  /** 周期上报：运行标记与停止 handler 用 ref，避免依赖环。 */
  const reportRunningRef = useRef(false);
  const reportTaskIdRef = useRef(reportTaskId);
  reportTaskIdRef.current = reportTaskId;
  const stopReportRef = useRef(onReportStop);
  stopReportRef.current = onReportStop;
  const reportTrackerRef = useRef<ReportTracker | null>(null);
  if (!reportTrackerRef.current) {
    reportTrackerRef.current = createReportTracker() as unknown as ReportTracker;
  }
  const readModeRef = useRef(readMode);
  readModeRef.current = readMode;

  useEffect(() => {
    if (registerLoadedRef.current) return;
    registerLoadedRef.current = true;
    void onListRegisters().then((result) => {
      if (result) setRegisterMap(result.registers);
    });
  }, [onListRegisters]);

  /** 把最新样本推到 UI：无论数据多快，每帧最多一次 setState。 */
  const publishSample = useCallback((next: Lis3dhSample) => {
    latestSampleRef.current = next;
    if (renderPendingRef.current) return;
    renderPendingRef.current = true;
    renderRafRef.current = window.requestAnimationFrame(() => {
      renderPendingRef.current = false;
      setSample(latestSampleRef.current);
    });
  }, []);

  /** 中断/定时推送帧：控制器已解码成样本，这里只做渲染节流与速率/丢帧统计。 */
  const handleStreamFrame = useCallback(
    (next: Lis3dhSample, frame: I2cStreamFrame) => {
      publishSample(next);
      rateRef.current.count += 1;
      setSampleCount((count) => count + 1);
      setStreamFrames((count) => count + 1);
      const lastSeq = streamSeqRef.current;
      if (lastSeq >= 0 && frame.seq > lastSeq + 1) {
        setStreamLost((lost) => lost + (frame.seq - lastSeq - 1));
      }
      streamSeqRef.current = frame.seq;
    },
    [publishSample],
  );

  // 卸载时取消防抖帧、退订推送并停掉固件流式，避免对已卸载组件 setState。
  useEffect(() => () => {
    if (renderRafRef.current) window.cancelAnimationFrame(renderRafRef.current);
    unsubscribeStreamRef.current?.();
    unsubscribeStreamRef.current = null;
    if (streamingRef.current) {
      streamingRef.current = false;
      void stopStreamRef.current().catch(() => {});
    }
    if (reportRunningRef.current) {
      reportRunningRef.current = false;
      void stopReportRef.current(reportTaskIdRef.current).catch(() => {});
    }
  }, []);

  /** 周期上报帧：控制器已解码成样本，这里只做渲染节流与帧数/丢帧/设备间隔统计。 */
  const handleReportFrame = useCallback(
    (next: Lis3dhSample, frame: I2cReportFrame) => {
      publishSample(next);
      rateRef.current.count += 1;
      setSampleCount((count) => count + 1);
      const stats = reportTrackerRef.current?.observe(frame);
      if (!stats) return;
      setReportFrames(stats.frames);
      setReportLost(stats.lost);
      setReportInterval(stats.intervalMs);
    },
    [publishSample],
  );

  /** 固件不支持 REPORT_*：只认协议错误码或明确的「不支持」字样。 */
  const isReportUnsupported = (message: string) =>
    message.includes("ERR_UNSUPPORTED") || message.includes("不支持");

  /** 拉固件任务表：顺带判断本页槽位是否已在运行（重进页面时恢复显示）。 */
  const refreshReport = useCallback(async (silent = false) => {
    try {
      const status = await onReportStatus();
      const summary = status.tasks.find((item) => item.taskId === reportTaskId) ??
        null;
      setReportSummary(summary);
      setReportUnavailable(false);
      const matches = Boolean(
        summary && summary.state === 2 &&
          summary.address === address &&
          summary.register === REPORT_REGISTER &&
          summary.length === REPORT_LENGTH,
      );
      // 只在报告模式下恢复运行标记，避免别的页面启动的任务被本页误接管。
      if (matches && readModeRef.current === "report") {
        reportRunningRef.current = true;
        setReportRunning(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isReportUnsupported(message)) {
        setReportUnavailable(true);
        setReportInfo(
          "当前固件不支持周期自动上报（需 REPORT_* 0x0240–0x0245），请升级固件后重连。",
        );
      } else if (!silent) {
        setReportInfo(`任务表读取失败：${message}`);
      }
    }
  }, [onReportStatus, reportTaskId, address]);

  /** 下发配置并启动本槽位；运行中再次点击会先停再配（用于应用新周期）。 */
  const startReportMode = useCallback(async () => {
    if (!connected) {
      setReadMode("report");
      setNotice(
        "已切换到周期上报模式（未连接）：连接设备后设好周期并点「下发并启动」即可。",
      );
      return;
    }
    setReportBusy(true);
    try {
      if (reportRunningRef.current) {
        await onReportStop(reportTaskId);
        reportRunningRef.current = false;
        setReportRunning(false);
      }
      const config = await onReportConfigure({
        taskId: reportTaskId,
        address,
        register: REPORT_REGISTER,
        length: REPORT_LENGTH,
        periodMs: reportPeriodMs,
        count: reportCount,
        flags: 0,
      });
      const info = await onReportStart(reportTaskId);
      reportRunningRef.current = true;
      setReportRunning(true);
      setReportUnavailable(false);
      reportTrackerRef.current?.reset();
      setReportFrames(0);
      setReportLost(0);
      setReportInterval(0);
      rateRef.current = { count: 0, since: performance.now() };
      setReadMode("report");
      setReportInfo(
        `槽位 ${config.taskId} 运行中 · 实际周期 ${config.periodMs} ms · 调度 tick ${info.tickMs} ms · 本次新启动 ${info.started} 个任务`,
      );
      setNotice(
        `周期上报已启动：固件每 ${config.periodMs} ms 读 0xA8 / 6 字节并主动推帧。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const unsupported = isReportUnsupported(message);
      if (unsupported) setReportUnavailable(true);
      setReportInfo(`启动失败：${message}`);
      setNotice(
        `周期上报启动失败：${message}${
          unsupported
            ? "。固件需实现 REPORT_*（0x0240–0x0245），协议见 docs/AUTO_REPORT_PROTOCOL.md。"
            : ""
        }`,
      );
    } finally {
      setReportBusy(false);
      void refreshReport(true);
    }
  }, [
    address,
    connected,
    onReportConfigure,
    onReportStart,
    onReportStop,
    refreshReport,
    reportCount,
    reportPeriodMs,
    reportTaskId,
  ]);

  /** 停止本槽位上报，并给出固件侧与页面侧的帧数对照。 */
  const stopReportMode = useCallback(async () => {
    if (!reportRunningRef.current) {
      setReportInfo("当前槽位没有运行中的上报任务。");
      return;
    }
    setReportBusy(true);
    try {
      const stopped = await onReportStop(reportTaskId);
      const mine = stopped.find((item) => item.taskId === reportTaskId);
      reportRunningRef.current = false;
      setReportRunning(false);
      setReportInfo(
        `槽位 ${reportTaskId} 已停止 · 固件累计 ${mine?.frames ?? 0} 帧`,
      );
      setNotice(
        `周期上报已停止：本页收到 ${reportFrames} 帧${
          reportLost > 0 ? `，丢 ${reportLost} 帧` : ""
        }。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setReportInfo(`停止失败：${message}`);
    } finally {
      setReportBusy(false);
      void refreshReport(true);
    }
  }, [onReportStop, refreshReport, reportFrames, reportLost, reportTaskId]);

  // 实测速率窗口：每 500 ms 结算一次，不参与渲染节流。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      const span = (now - rateRef.current.since) / 1000;
      if (span < 0.4) return;
      setRateHz(rateRef.current.count / span);
      rateRef.current = { count: 0, since: now };
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const fullScale = config.fullScale;
  const odrNow = odrHzForMode(config.odrCode, config.outputMode);

  const poll = useCallback(async () => {
    // 上一次读数还没结束时跳过本次，避免后端报「已有请求」。
    if (busyRef.current || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const result = await onReadSample(address, fullScale);
      if (!result) {
        setNotice(
          "读取失败：请确认已连接设备、器件已上电（0x18/0x19）且 SDA/SCL 有上拉。",
        );
        return;
      }
      publishSample(result);
      rateRef.current.count += 1;
      setSampleCount((count) => count + 1);
      setNotice(result.message);
      tickRef.current += 1;
      if (tickRef.current === 1 || tickRef.current % TEMP_REFRESH_EVERY === 0) {
        const temp = await onReadTemperature(address);
        if (temp) setTemperature(temp);
      }
    } finally {
      pollingRef.current = false;
    }
  }, [address, fullScale, onReadSample, onReadTemperature, publishSample]);

  /** FIFO 批量读：一次事务带回多组样本，只把最后一条推给 UI。 */
  const fifoPoll = useCallback(async () => {
    if (busyRef.current || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const batch = await onReadFifoBatch(address, fullScale, 32, odrNow);
      if (!batch) {
        setNotice(
          "FIFO 批量读取失败：请确认已连接设备且在下方启用 FIFO（Stream 模式）。",
        );
        return;
      }
      setFifoBatch(batch);
      setNotice(batch.message);
      if (batch.samples.length === 0) return;
      const last = batch.samples[batch.samples.length - 1];
      if (last) publishSample(last);
      rateRef.current.count += batch.samples.length;
      setSampleCount((count) => count + batch.samples.length);
    } finally {
      pollingRef.current = false;
    }
  }, [address, fullScale, odrNow, onReadFifoBatch, publishSample]);

  const readTemperatureNow = async () => {
    const result = await onReadTemperature(address);
    if (!result) return;
    setTemperature(result);
    setNotice(result.message);
  };

  // 单次轮询：仅在轮询模式 + 自动读取开启时运行。
  useEffect(() => {
    if (!autoOn || !connected || readMode !== "poll") return;
    void poll();
    const timer = window.setInterval(() => void poll(), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [autoOn, connected, readMode, pollIntervalMs, poll]);

  // FIFO 批量：芯片 FIFO 已启用时按设定周期整批取走样本。
  useEffect(() => {
    if (!autoOn || !connected || readMode !== "fifo" || !config.fifo.enabled) {
      return;
    }
    void fifoPoll();
    const timer = window.setInterval(() => void fifoPoll(), fifoIntervalMs);
    return () => window.clearInterval(timer);
  }, [
    autoOn,
    connected,
    readMode,
    fifoIntervalMs,
    config.fifo.enabled,
    fifoPoll,
  ]);

  // FIFO 建议间隔：ODR / 阈值变化时刷新（不溢出的最大读取周期）。
  useEffect(() => {
    if (readMode !== "fifo") return;
    let cancelled = false;
    void onFifoHint(config.odrCode, config.outputMode, config.fifo.threshold)
      .then((hint) => {
        if (!cancelled) setFifoHint(hint);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    readMode,
    onFifoHint,
    config.odrCode,
    config.outputMode,
    config.fifo.threshold,
  ]);

  // 退出流式（切模式 / 断开 / 换地址）：退订 + 停止固件推送。
  useEffect(() => {
    if (readMode === "stream" && connected) return;
    if (!streamingRef.current) return;
    streamingRef.current = false;
    unsubscribeStreamRef.current?.();
    unsubscribeStreamRef.current = null;
    streamSeqRef.current = -1;
    void stopStreamRef.current()
      .then(() => setStreamInfo(null))
      .catch(() => setStreamInfo(null));
  }, [readMode, connected, address]);

  // 地址切换后旧读数不再可信。
  useEffect(() => {
    setSample(null);
    setTemperature(null);
    setSampleCount(0);
    setFifoBatch(null);
    setRateHz(0);
    rateRef.current = { count: 0, since: performance.now() };
    tickRef.current = 0;
  }, [address]);

  // 连接建立后拉一次固件任务表；断开则清运行标记（任务随固件重启消失）。
  useEffect(() => {
    if (!connected) {
      reportRunningRef.current = false;
      setReportRunning(false);
      setReportSummary(null);
      return;
    }
    void refreshReport(true);
  }, [connected, refreshReport]);

  // 周期上报运行中才订阅（只收本槽位的帧）；换槽位/重量程/重连都会重建。
  useEffect(() => {
    if (!connected || readMode !== "report" || !reportRunning) return;
    return onSubscribeReportSample(reportTaskId, handleReportFrame, fullScale);
  }, [
    connected,
    readMode,
    reportRunning,
    reportTaskId,
    fullScale,
    onSubscribeReportSample,
    handleReportFrame,
  ]);

  // 离开周期上报模式：停掉本页槽位，避免后台持续推帧（与中断推送同一收尾策略）。
  useEffect(() => {
    if (readMode === "report" || !reportRunningRef.current) return;
    reportRunningRef.current = false;
    setReportRunning(false);
    void stopReportRef.current(reportTaskIdRef.current)
      .then(() => refreshReport(true))
      .catch(() => {});
  }, [readMode, refreshReport]);

  // 地址切换：槽位仍指向旧器件，先停掉再让用户重新启动。
  useEffect(() => {
    if (!reportRunningRef.current) return;
    reportRunningRef.current = false;
    setReportRunning(false);
    void stopReportRef.current(reportTaskIdRef.current).catch(() => {});
  }, [address]);

  const discover = async () => {
    const result = await onDiscover();
    if (!result) return;
    setFound(result);
    setNotice(result.message);
    const target = result.devices.find((item) => item.identified) ??
      result.devices[0];
    if (!target) return;
    setAddress(target.address);
    if (target.config) {
      setConfig({
        odrCode: target.config.odrCode,
        fullScale: target.config.fullScale,
        outputMode: target.config.outputMode,
        blockDataUpdate: target.config.blockDataUpdate,
        axes: target.config.axes,
        tempEnable: target.config.tempEnable,
        intRoute: target.config.intRoute,
        fifo: target.config.fifo,
      });
    }
  };

  const applyConfig = async () => {
    const result = await onConfigure(address, config);
    if (!result) return;
    setConfigResult(result);
    setConfig(result.config);
    setTemperature(null);
    setFifoBatch(null);
    rateRef.current = { count: 0, since: performance.now() };
    tickRef.current = 0;
    setNotice(result.message);
  };

  /** 切到 FIFO 批量：必要时先把芯片配成 FIFO 模式，再交给定时效应读取。 */
  const startFifoMode = async () => {
    if (!connected) {
      setReadMode("fifo");
      setNotice(
        "已切换到 FIFO 批量模式（未连接）：连接设备后再次点击「FIFO 批量」卡片即可启用 FIFO 并开始批量读取。",
      );
      return;
    }
    if (!config.fifo.enabled || config.fifo.mode === "bypass") {
      const fifoMode = config.fifo.mode && config.fifo.mode !== "bypass"
        ? config.fifo.mode
        : "stream";
      const threshold = config.fifo.threshold || 16;
      const result = await onConfigure(address, {
        ...config,
        fifo: { enabled: true, mode: fifoMode, threshold },
      });
      if (!result) return;
      setConfigResult(result);
      setConfig(result.config);
      setNotice(
        `${result.message} 已自动启用 ${fifoMode} FIFO（阈值 ${threshold} 级）。`,
      );
    }
    setFifoBatch(null);
    rateRef.current = { count: 0, since: performance.now() };
    setReadMode("fifo");
  };

  /** 切回单次轮询：关闭芯片 FIFO，避免轮询读数与 FIFO 弹出语义互相干扰。 */
  const stopFifoMode = async () => {
    setReadMode("poll");
    setFifoBatch(null);
    if (!connected) {
      setNotice(
        "已切换到单次轮询模式（未连接）：连接设备后点击「读取一次」或开启「自动读取」即可。",
      );
      return;
    }
    if (!config.fifo.enabled) {
      setNotice("已切换到单次轮询模式：点击「读取一次」或开启「自动读取」即可。");
      return;
    }
    const result = await onConfigure(address, {
      ...config,
      fifo: { ...config.fifo, enabled: false, mode: "bypass" },
    });
    if (!result) return;
    setConfigResult(result);
    setConfig(result.config);
    setNotice(result.message);
  };

  /** 复位 FIFO（写 Bypass）：采集异常时从头开始。 */
  const resetFifoNow = async () => {
    await onResetFifo(address);
    setFifoBatch(null);
    setNotice("FIFO 已复位（Bypass）：如需继续采集请重新启用并下发。");
  };

  /** 启动中断/定时推送：先配置芯片数据就绪中断，再订阅并启动固件流式。 */
  const startStreamMode = async () => {
    if (streamingRef.current) {
      setNotice("中断推送已在进行中；如需重启请先切换到其它模式。");
      return;
    }
    if (!connected) {
      setReadMode("stream");
      setNotice(
        "已切换到中断推送模式（未连接）：连接设备后再次点击「中断推送」卡片即可启动（需固件支持 STREAM_START 0x0230）。",
      );
      return;
    }
    // 占位标记：启动中的重入点击提示“已在进行中”，与运行中统一防重入。
    streamingRef.current = true;
    const configured = await onConfigure(address, {
      ...config,
      intRoute: "dataReady",
      fifo: { ...config.fifo, enabled: false, mode: "bypass" },
    });
    if (!configured) {
      streamingRef.current = false;
      return;
    }
    if (!streamingRef.current) return;
    setConfigResult(configured);
    setConfig(configured.config);
    unsubscribeStreamRef.current?.();
    unsubscribeStreamRef.current = onSubscribeStream(
      handleStreamFrame,
      config.fullScale,
    );
    try {
      const info = await onStartStream({
        address,
        register: 0xA8,
        length: 6,
        mode: streamMode,
        periodMs: streamPeriodMs,
        intPin: streamIntPin,
        count: 0,
      });
      if (!info) {
        unsubscribeStreamRef.current?.();
        unsubscribeStreamRef.current = null;
        streamingRef.current = false;
        setNotice("中断推送启动失败：未获得固件应答，请重试。");
        return;
      }
      if (!streamingRef.current) {
        // 启动期间用户已切到其它模式：撤销订阅并停掉刚启动的固件推送。
        unsubscribeStreamRef.current?.();
        unsubscribeStreamRef.current = null;
        void stopStreamRef.current().catch(() => {});
        return;
      }
      streamSeqRef.current = -1;
      setStreamInfo(info);
      setStreamFrames(0);
      setStreamLost(0);
      rateRef.current = { count: 0, since: performance.now() };
      setReadMode("stream");
      setNotice(info.message);
    } catch (error) {
      unsubscribeStreamRef.current?.();
      unsubscribeStreamRef.current = null;
      streamingRef.current = false;
      const reason = error instanceof Error ? error.message : String(error);
      setNotice(
        `中断推送启动失败：${reason}。固件需实现 STREAM_START(0x0230)，协议与接线要求见 docs/LIS3DH_STREAM_PROTOCOL.md。`,
      );
    }
  };

  /** 读取模式选择器入口：按目标模式准备芯片，再由效应统一收口。
   *  重复点击同一卡片不短路：连接后再次点击可重试启动（未连接时用于切换参数展示）。 */
  const selectReadMode = async (mode: Lis3dhReadMode) => {
    if (mode === "report") {
      if (mode !== readMode) setReadMode(mode);
      void startReportMode();
      return;
    }
    // 离开周期上报先等固件停完，否则 STREAM_START 会因互斥被拒绝。
    if (readMode === "report" && reportRunningRef.current) {
      await stopReportMode();
    }
    if (mode !== readMode) setReadMode(mode);
    if (mode === "stream") {
      void startStreamMode();
      return;
    }
    if (mode === "fifo") {
      void startFifoMode();
      return;
    }
    void stopFifoMode();
  };

  const readManualRegister = async () => {
    const register = parseHexByte(registerAddress);
    if (register === null) {
      setNotice("寄存器地址必须为 00–FF 的十六进制字节。");
      return;
    }
    const result = await onReadRegister(address, register);
    if (!result) return;
    setReadResult(result);
    setWriteResult(null);
    setNotice(result.message);
  };

  const writeManualRegister = async () => {
    const register = parseHexByte(registerAddress);
    const value = parseHexByte(registerWriteValue);
    if (register === null || value === null) {
      setNotice("寄存器地址与写入值都必须为 00–FF 的十六进制字节。");
      return;
    }
    const result = await onWriteRegister(address, register, value);
    if (!result) return;
    setWriteResult(result);
    setReadResult({
      address: result.address,
      register: result.register,
      value: result.readBack,
      detail: result.detail,
      noResponse: false,
      message: result.message,
    });
    setNotice(result.message);
  };

  const g = sample?.g ?? { x: 0, y: 0, z: 0 };
  const magnitude = sample?.magnitude ?? 0;
  const lastTime = sample
    ? new Date(sample.at).toLocaleTimeString("zh-CN", { hour12: false })
    : "—";
  const liveActive = readMode === "stream"
    ? streamInfo !== null
    : readMode === "report"
    ? reportRunning
    : autoOn && connected;
  const rateLabel = rateHz >= 10 ? rateHz.toFixed(1) : rateHz.toFixed(2);

  return (
    <section className="ch224-page" aria-label="LIS3DH 三轴加速度计">
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

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>01</span>
          <div>
            <h3>三轴实时读取与立体姿态</h3>
            <p>
              四种读取模式（轮询 / FIFO 批量 / 中断推送 / 周期上报）读取 OUT_X/Y/Z（0x28–0x2D）并换算 g 值与姿态角；
              上方立体视图把三轴矢量与随重力倾斜的器件板画在 X/Y/Z 坐标系里，下方是三轴数值卡。
            </p>
          </div>
        </div>

        <div className="mlx-toolbar">
          <div className="mlx-field">
            <label htmlFor="lis3dh-address">器件地址</label>
            <select
              id="lis3dh-address"
              value={address}
              onChange={(event) => setAddress(Number(event.target.value))}
            >
              {ADDRESS_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mlx-field">
            <label>换算量程 · 当前 {fullScaleLabel(fullScale)}</label>
            <div className="lis3dh-readonly-field">
              <b>{fullScaleLabel(fullScale)}</b>
              <small>在 02 区修改并下发</small>
            </div>
          </div>
          <div className="mlx-field mlx-toggle-field">
            <label>
              {readMode === "stream"
                ? "接收推送（随模式）"
                : `自动读取 · ${readMode === "fifo" ? fifoIntervalMs : pollIntervalMs} ms`}
            </label>
            <button
              type="button"
              className={`mlx-switch ${autoOn && connected ? "on" : ""}`}
              role="switch"
              aria-checked={autoOn && connected}
              disabled={!connected || readMode === "stream"}
              onClick={() => setAutoOn((value) => !value)}
            >
              <i />
            </button>
          </div>
          <button
            className="button secondary"
            disabled={!connected || busy || readMode === "stream"}
            onClick={() => void (readMode === "fifo" ? fifoPoll() : poll())}
          >
            读取一次
          </button>
          <button
            className="button primary"
            disabled={!connected || busy}
            onClick={() => void discover()}
          >
            扫描 0x18 / 0x19
          </button>
        </div>

        <div className="lis3dh-readmodes" role="radiogroup" aria-label="采样读取模式">
          {READ_MODE_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={readMode === item.id}
              className={`lis3dh-readmode ${readMode === item.id ? "active" : ""}`}
              disabled={busy}
              onClick={() => void selectReadMode(item.id)}
            >
              <b>{item.label}</b>
              <span>{item.note}</span>
            </button>
          ))}
        </div>

        <div className="lis3dh-readmode-params">
          {readMode === "poll" && (
            <>
              <div className="mlx-field">
                <label htmlFor="lis3dh-poll-interval">轮询间隔</label>
                <select
                  id="lis3dh-poll-interval"
                  value={pollIntervalMs}
                  onChange={(event) =>
                    setPollIntervalMs(Number(event.target.value))}
                >
                  {POLL_INTERVAL_OPTIONS.map((ms) => (
                    <option key={ms} value={ms}>
                      {ms} ms · 约 {(1000 / ms).toFixed(0)} Hz
                    </option>
                  ))}
                </select>
              </div>
              <p>
                每次发一条 0xA8 连读命令，最简单直接；实测速率受串口/蓝牙往返时间限制，
                ODR ≥ 2× 读取率时读数不会重复，否则需提高 ODR 或缩短间隔。
                {odrNow > 0 && odrNow < 2 * (1000 / pollIntervalMs)
                  ? ` 当前 ODR ${odrNow} Hz 低于读取率，读数会重复。`
                  : ""}
              </p>
            </>
          )}
          {readMode === "fifo" && (
            <>
              <div className="mlx-field">
                <label htmlFor="lis3dh-fifo-interval">批量读取周期</label>
                <select
                  id="lis3dh-fifo-interval"
                  value={fifoIntervalMs}
                  onChange={(event) =>
                    setFifoIntervalMs(Number(event.target.value))}
                >
                  {FIFO_INTERVAL_OPTIONS.map((ms) => (
                    <option key={ms} value={ms}>{ms} ms</option>
                  ))}
                </select>
              </div>
              <p>
                {fifoHint
                  ? `当前 ODR ${fifoHint.odrHz} Hz、阈值 ${config.fifo.threshold} 级：周期建议 ≤ ${fifoHint.maxIntervalMs} ms（${fifoHint.usableDepth} 级可用），一次事务取回整批样本。`
                  : "芯片 32 级 FIFO 缓存样本，一次事务取回整批，大幅降低读写频率；需先启用 Stream FIFO。"}
              </p>
            </>
          )}
          {readMode === "stream" && (
            <>
              <div className="mlx-field">
                <label>触发方式</label>
                <div className="mlx-unit-toggle" role="group">
                  <button
                    type="button"
                    className={streamMode === "int" ? "active" : ""}
                    onClick={() => setStreamMode("int")}
                  >
                    中断触发
                  </button>
                  <button
                    type="button"
                    className={streamMode === "poll" ? "active" : ""}
                    onClick={() => setStreamMode("poll")}
                  >
                    定时推送
                  </button>
                </div>
              </div>
              {streamMode === "int" && (
                <div className="mlx-field">
                  <label htmlFor="lis3dh-stream-pin">INT1 接入引脚</label>
                  {intPinChoices.mode === "select" ? (
                    <select
                      id="lis3dh-stream-pin"
                      value={streamIntPin}
                      onChange={(event) =>
                        setStreamIntPin(Number(event.target.value))}
                    >
                      {intPinChoices.groups.flatMap((group) =>
                        group.label
                          ? [
                            <optgroup key={group.label} label={group.label}>
                              {group.options.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </optgroup>,
                          ]
                          : group.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))
                      )}
                    </select>
                  ) : (
                    <input
                      id="lis3dh-stream-pin"
                      type="number"
                      min={0}
                      max={63}
                      value={streamIntPin}
                      onChange={(event) =>
                        setStreamIntPin(Number(event.target.value))}
                    />
                  )}
                </div>
              )}
              {streamMode === "poll" && (
                <div className="mlx-field">
                  <label htmlFor="lis3dh-stream-period">定时周期 ms</label>
                  <input
                    id="lis3dh-stream-period"
                    type="number"
                    min={0}
                    value={streamPeriodMs}
                    onChange={(event) =>
                      setStreamPeriodMs(Number(event.target.value))}
                  />
                </div>
              )}
              {streamMode === "int" && (
                <p className="lis3dh-pin-hint">
                  {intPinChoices.hint} 当前定义：<b>INT1 →{" "}
                    {formatIntPin(streamIntPin, intPinMachine)}</b>
                  {`（编码 ${formatIntPinCode(streamIntPin)}）`}
                  。INT1 必须是上升沿脉冲输入，固件只消费触发、不代替页面改
                  `CTRL_REG3`。
                </p>
              )}
              <p>
                {streamInfo
                  ? `${streamInfo.message} 本次已推 ${streamFrames} 帧${
                    streamLost > 0 ? `，丢 ${streamLost} 帧` : ""
                  }。`
                  : streamMode === "poll"
                  ? "固件按定时周期读 0xA8 六字节并主动上报；需固件支持 STREAM_* 命令，协议见 docs/LIS3DH_STREAM_PROTOCOL.md。"
                  : "页面不再下发读命令：固件在 INT1 中断时读 0xA8 六字节并主动上报；需固件支持 STREAM_* 命令，接线与协议见 docs/LIS3DH_STREAM_PROTOCOL.md。"}
              </p>
            </>
          )}
          {readMode === "report" && (
            <>
              <div className="mlx-field">
                <label htmlFor="lis3dh-report-slot">上报槽位</label>
                <select
                  id="lis3dh-report-slot"
                  value={reportTaskId}
                  disabled={reportRunning || reportBusy}
                  onChange={(event) =>
                    setReportTaskId(Number(event.target.value))}
                >
                  {REPORT_SLOT_OPTIONS.map((slot) => (
                    <option key={slot} value={slot}>槽位 {slot}</option>
                  ))}
                </select>
              </div>
              <div className="mlx-field">
                <label htmlFor="lis3dh-report-period">上报周期 ms</label>
                <input
                  id="lis3dh-report-period"
                  type="number"
                  min={REPORT_PERIOD_MIN_MS}
                  max={REPORT_PERIOD_MAX_MS}
                  value={reportPeriodMs}
                  onChange={(event) =>
                    setReportPeriodMs(Number(event.target.value))}
                />
              </div>
              <div className="mlx-field">
                <label htmlFor="lis3dh-report-count">帧数上限</label>
                <input
                  id="lis3dh-report-count"
                  type="number"
                  min={0}
                  max={0xffff}
                  value={reportCount}
                  onChange={(event) =>
                    setReportCount(Number(event.target.value))}
                />
              </div>
              <div className="lis3dh-report-actions">
                <button
                  className="button primary"
                  disabled={!connected || busy || reportBusy || reportUnavailable}
                  onClick={() => void startReportMode()}
                >
                  {reportRunning ? "应用新周期并重启" : "下发并启动"}
                </button>
                <button
                  className="button secondary"
                  disabled={reportBusy || !reportRunning}
                  onClick={() => void stopReportMode()}
                >
                  停止上报
                </button>
                <button
                  className="text-button"
                  disabled={!connected || reportBusy}
                  onClick={() => void refreshReport()}
                >
                  刷新任务表
                </button>
              </div>
              <div className="lis3dh-report-presets">
                <span>常用周期</span>
                {REPORT_PERIOD_PRESETS.map((ms) => (
                  <button
                    key={ms}
                    type="button"
                    className={`lis3dh-period-chip ${
                      reportPeriodMs === ms ? "active" : ""
                    }`}
                    disabled={reportBusy}
                    onClick={() => setReportPeriodMs(ms)}
                  >
                    {ms} ms
                  </button>
                ))}
              </div>
              {reportUnavailable && (
                <p className="lis3dh-report-warn">
                  当前固件不支持 REPORT_*（0x0240–0x0245）：按钮已禁用，升级固件后重连即可。
                </p>
              )}
              <p className="lis3dh-report-state">
                {reportInfo ||
                  `槽位 ${reportTaskId} 固定读 0xA8 / 6 字节（地址取上方「器件地址」、量程取 02 区）；设好周期后点「下发并启动」。「帧数上限 0」表示一直推到停止。`}
                {reportSummary
                  ? ` 固件任务表：${reportSummary.stateText}${
                    reportSummary.periodMs > 0
                      ? ` · ${reportSummary.periodMs} ms`
                      : ""
                  }。`
                  : ""}
              </p>
            </>
          )}
        </div>

        <div className="lis3dh-live">
          <VectorScene g={g} magnitude={magnitude} active={Boolean(sample)} />
          <div className="lis3dh-live-main">
            <div className="lis3dh-live-head">
              <span>三轴读数 · {readModeLabel(readMode)}</span>
              <b className={liveActive ? "good" : ""}>
                {liveActive
                  ? readMode === "stream"
                    ? "推送中"
                    : readMode === "report"
                    ? "上报中"
                    : "采集中"
                  : "已暂停"}
                {liveActive && rateHz > 0 ? ` · 实测 ${rateLabel} Hz` : ""}
              </b>
            </div>
            <div className="lis3dh-axis-cards">
              {(["x", "y", "z"] as const).map((axis) => {
                const value = g[axis];
                const width = Math.min(100, Math.abs(value) / 2 * 100);
                return (
                  <div key={axis} className={`lis3dh-axis-card is-${axis}`}>
                    <span>{axis.toUpperCase()} 轴</span>
                    <b>
                      {sample ? formatAxis(value) : "—"}{" "}
                      <em>g</em>
                    </b>
                    <small>
                      原始 {sample ? sample.raw[axis] : "—"}
                    </small>
                    <i>
                      <em style={{ width: `${width}%` }} />
                    </i>
                  </div>
                );
              })}
            </div>
            <div className="lis3dh-live-meta">
              <span>
                |a| <b>{sample ? magnitude.toFixed(3) : "—"} g</b>
              </span>
              <span>
                Pitch <b>{sample ? `${formatAxis(sample.pitch, 1)}°` : "—"}</b>
              </span>
              <span>
                Roll <b>{sample ? `${formatAxis(sample.roll, 1)}°` : "—"}</b>
              </span>
              <span>
                温度 <b>{temperature?.celsius != null ? `${temperature.celsius.toFixed(0)} °C` : "—"}</b>
              </span>
              <span>
                采样 <b>{sampleCount}</b> 次 · {lastTime}
              </span>
              <span>
                速率 <b>{rateHz > 0 ? `${rateLabel} Hz` : "—"}</b>
              </span>
              {readMode === "stream" && (
                <span>
                  推送 <b>{streamFrames}</b> 帧
                  {streamLost > 0 ? ` · 丢 ${streamLost}` : ""}
                </span>
              )}
              {readMode === "fifo" && (
                <span>
                  本批 <b>{fifoBatch?.count ?? 0}</b> 组
                  {fifoBatch?.status.overrun ? " · 曾溢出" : ""}
                </span>
              )}
              {readMode === "report" && (
                <span>
                  上报 <b>{reportFrames}</b> 帧
                  {reportLost > 0 ? ` · 丢 ${reportLost}` : ""}
                  {reportInterval > 0 ? ` · 设备间隔 ${reportInterval} ms` : ""}
                </span>
              )}
              <button
                className="text-button"
                type="button"
                disabled={!connected || busy}
                onClick={() => void readTemperatureNow()}
              >
                读温度
              </button>
            </div>
          </div>
        </div>

        {found && (
          <div className="ch224-notice">
            检测结果：
            {found.devices.length === 0
              ? "0x18 / 0x19 均无应答。"
              : found.devices.map((item) => (
                `${byteHex(item.address)} → WHO_AM_I ${
                  item.whoAmI === null ? "读失败" : byteHex(item.whoAmI)
                }${item.identified ? "（LIS3DH）" : ""}`
              )).join("；")}
          </div>
        )}
        {notice && <div className="ch224-notice" role="status">{notice}</div>}

        <div className="lis3dh-hint">
          连续读取用子地址 0xA8（0x28 | 0x80，地址自增位）一次事务读回 6 字节，数据左对齐 16 位、换算与输出模式无关。
          轮询模式：读取率高于 ODR 时读数会重复，建议 ODR ≥ 2× 读取率。
          FIFO 模式：芯片缓存 32 组样本，一次事务取回，显著降低读写频率。
          中断推送模式：固件在数据就绪后主动上报，页面只处理数据、不再下发读命令。
          周期上报模式：固件按设定周期自读并上报（REPORT_*），可设周期与帧数上限；与中断推送互斥，切走本模式会停掉本页槽位。
          {sample ? `（本次方式：${sample.readMode === "block" ? "块读" : "逐寄存器回退"}）` : ""}
        </div>
      </section>

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>02</span>
          <div>
            <h3>工作模式配置（CTRL_REG1/3/4/5 · TEMP_CFG · FIFO_CTRL）</h3>
            <p>
              输出模式决定分辨率（低功耗 8 位 / 正常 10 位 / 高分辨率 12 位，三选一互斥），量程决定换算系数，
              ODR 决定数据新鲜度；FIFO 与 INT1 路由供批量/中断模式使用，写入后自动回读六个寄存器校验。
            </p>
          </div>
        </div>

        <div className="lis3dh-config-grid">
          <div className="mlx-field">
            <label htmlFor="lis3dh-fs">量程 FS[5:4]</label>
            <select
              id="lis3dh-fs"
              value={config.fullScale}
              onChange={(event) =>
                setConfig({ ...config, fullScale: Number(event.target.value) })}
            >
              {FULL_SCALE_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} · {item.mgPerDigit} mg/digit · 1 g ≈ {item.accRange}
                </option>
              ))}
            </select>
          </div>
          <div className="mlx-field">
            <label htmlFor="lis3dh-odr">输出速率 ODR[7:4]</label>
            <select
              id="lis3dh-odr"
              value={config.odrCode}
              onChange={(event) =>
                setConfig({ ...config, odrCode: Number(event.target.value) })}
            >
              {ODR_OPTIONS.map((item) => (
                <option key={item.code} value={item.code}>
                  {odrLabelFor(item.code, config.outputMode)}
                </option>
              ))}
            </select>
          </div>
          <div className="mlx-field lis3dh-outputmode-field">
            <label>输出模式 · 分辨率</label>
            <div className="mlx-unit-toggle lis3dh-outputmode" role="group">
              {OUTPUT_MODE_OPTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={config.outputMode === item.id ? "active" : ""}
                  title={item.note}
                  onClick={() => setConfig({ ...config, outputMode: item.id })}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mlx-field">
            <label htmlFor="lis3dh-int-route">INT1 路由 CTRL_REG3</label>
            <select
              id="lis3dh-int-route"
              value={config.intRoute}
              onChange={(event) =>
                setConfig({ ...config, intRoute: event.target.value })}
            >
              {INT_ROUTE_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>
          <div className="lis3dh-switch-row">
            <label className="lis3dh-check">
              <input
                type="checkbox"
                checked={config.blockDataUpdate}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    blockDataUpdate: event.target.checked,
                  })}
              />
              <span>BDU · 读数不撕裂</span>
            </label>
            <label className="lis3dh-check">
              <input
                type="checkbox"
                checked={config.tempEnable}
                onChange={(event) =>
                  setConfig({ ...config, tempEnable: event.target.checked })}
              />
              <span>启用温度通道（占用 ADC3）</span>
            </label>
          </div>

          <div className="lis3dh-fifo-row">
            <span>FIFO</span>
            <label className="lis3dh-check">
              <input
                type="checkbox"
                checked={config.fifo.enabled}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    fifo: { ...config.fifo, enabled: event.target.checked },
                  })}
              />
              <span>启用（CTRL_REG5.FIFO_EN）</span>
            </label>
            <select
              value={config.fifo.mode}
              disabled={!config.fifo.enabled}
              aria-label="FIFO 模式"
              onChange={(event) =>
                setConfig({
                  ...config,
                  fifo: { ...config.fifo, mode: event.target.value },
                })}
            >
              {FIFO_MODE_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
            <label className="lis3dh-check">
              阈值
              <input
                type="number"
                min={0}
                max={31}
                disabled={!config.fifo.enabled}
                value={config.fifo.threshold}
                onChange={(event) =>
                  setConfig({
                    ...config,
                    fifo: {
                      ...config.fifo,
                      threshold: Number(event.target.value),
                    },
                  })}
              />
              级
            </label>
            <button
              className="text-button"
              type="button"
              disabled={!connected || busy}
              onClick={() => void resetFifoNow()}
            >
              复位 FIFO
            </button>
          </div>

          <div className="lis3dh-axes-row">
            <span>轴使能</span>
            {(["x", "y", "z"] as const).map((axis) => (
              <label key={axis} className="lis3dh-check">
                <input
                  type="checkbox"
                  checked={config.axes[axis]}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      axes: { ...config.axes, [axis]: event.target.checked },
                    })}
                />
                <span>{axis.toUpperCase()}</span>
              </label>
            ))}
            <button
              className="button primary"
              disabled={!connected || busy}
              onClick={() => void applyConfig()}
            >
              下发并回读
            </button>
          </div>
        </div>

        {configResult && (
          <div className="ch224-metric-grid lis3dh-config-result">
            <div>
              <span>CTRL_REG1 (0x20)</span>
              <b>{byteHex(configResult.readBack.ctrlReg1)}</b>
            </div>
            <div>
              <span>CTRL_REG3 (0x22)</span>
              <b>{byteHex(configResult.readBack.ctrlReg3)}</b>
            </div>
            <div>
              <span>CTRL_REG4 (0x23)</span>
              <b>{byteHex(configResult.readBack.ctrlReg4)}</b>
            </div>
            <div>
              <span>CTRL_REG5 (0x24)</span>
              <b>{byteHex(configResult.readBack.ctrlReg5)}</b>
            </div>
            <div>
              <span>TEMP_CFG (0x1F)</span>
              <b>{byteHex(configResult.readBack.tempCfg)}</b>
            </div>
            <div>
              <span>FIFO_CTRL (0x2E)</span>
              <b>{byteHex(configResult.readBack.fifoCtrl)}</b>
            </div>
            <div>
              <span>实际 ODR</span>
              <b>{configResult.config.odrHz === 0 ? "掉电" : `${configResult.config.odrHz} Hz`}</b>
            </div>
            <div>
              <span>输出模式</span>
              <b>{outputModeLabel(configResult.config.outputMode)}</b>
            </div>
            <div>
              <span>FIFO / INT1</span>
              <b>
                {configResult.config.fifo.enabled
                  ? `${fifoModeLabel(configResult.config.fifo.mode)} · ${configResult.config.fifo.threshold} 级`
                  : "关"}
                {" / "}
                {intRouteLabel(configResult.config.intRoute)}
              </b>
            </div>
            <div>
              <span>回读校验</span>
              <b className={configResult.matches ? "good" : "bad"}>
                {configResult.matches ? "一致" : "不一致"}
              </b>
            </div>
          </div>
        )}

        <div className="lis3dh-hint">
          当前目标值：{fullScaleLabel(config.fullScale)} · {odrLabelFor(config.odrCode, config.outputMode)} ·{" "}
          {outputModeLabel(config.outputMode)} · BDU {config.blockDataUpdate ? "开" : "关"} ·{" "}
          FIFO {config.fifo.enabled
            ? `${fifoModeLabel(config.fifo.mode)}（阈值 ${config.fifo.threshold} 级）`
            : "关"} ·{" "}
          INT1 {intRouteLabel(config.intRoute)}。
          数据 16 位左对齐，各输出模式共用同一换算系数；BLE 字节序固定为小端（0），否则三轴高/低字节顺序会反。
        </div>
      </section>

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>03</span>
          <div>
            <h3>手动寄存器读写与全部地址功能</h3>
            <p>
              单字节读写，写入后自动回读校验。0x07–0x0F、0x27–0x2D 为只读；控制与中断寄存器可写。
            </p>
          </div>
        </div>

        <div className="ch224-manual-grid">
          <div className="form-field">
            <label htmlFor="lis3dh-register-address">寄存器地址</label>
            <div className="hex-field">
              <span>HEX</span>
              <input
                id="lis3dh-register-address"
                value={registerAddress}
                onChange={(event) => setRegisterAddress(event.target.value)}
                placeholder="0F"
              />
            </div>
            <small>00–FF；点击下方地址表可快速填入</small>
          </div>
          <div className="form-field">
            <label htmlFor="lis3dh-register-value">写入数据（8 位）</label>
            <div className="hex-field">
              <span>HEX</span>
              <input
                id="lis3dh-register-value"
                value={registerWriteValue}
                onChange={(event) => setRegisterWriteValue(event.target.value)}
                placeholder="00"
              />
            </div>
            <small>00–FF；写入后立即回读比对</small>
          </div>
          <div className="button-pair ch224-manual-actions">
            <button
              className="button secondary"
              disabled={!connected || busy}
              onClick={() => void readManualRegister()}
            >
              读取寄存器
            </button>
            <button
              className="button primary"
              disabled={!connected || busy}
              onClick={() => void writeManualRegister()}
            >
              写入并回读
            </button>
          </div>
        </div>

        {readResult && (
          <Lis3dhRegisterCard result={readResult} writeResult={writeResult} />
        )}

        <div className="ch224-register-map">
          <div className="ch224-subheading">
            <h4>全部地址功能一览</h4>
            <span>地址 · 类型 · 属性 · 名称 · 功能</span>
          </div>
          <div className="ch224-register-table-wrap">
            <table className="ch224-register-map-table">
              <thead>
                <tr>
                  <th>地址</th>
                  <th>类型</th>
                  <th>属性</th>
                  <th>名称</th>
                  <th>功能</th>
                </tr>
              </thead>
              <tbody>
                {registerMap.map((item) => (
                  <tr
                    key={item.address}
                    className={item.access === "read" ? "" : "write-only"}
                    onClick={() =>
                      setRegisterAddress(
                        item.address.toString(16).toUpperCase().padStart(
                          2,
                          "0",
                        ),
                      )}
                  >
                    <td><code>{byteHex(item.address)}</code></td>
                    <td>{KIND_LABELS[item.kind] ?? item.kind}</td>
                    <td>
                      <span
                        className={item.access === "read"
                          ? "badge-read"
                          : "badge-rw"}
                      >
                        {item.access === "read" ? "只读" : "可读写"}
                      </span>
                    </td>
                    <td>{item.name}</td>
                    <td>{item.function}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {registerMap.length === 0 && (
            <div className="ch224-none">正在载入寄存器表…</div>
          )}
        </div>

        <div className="warning-strip ch224-write-warning">
          <span>!</span>
          <p>
            只读寄存器（0x07–0x0F、0x27–0x2D）写入不会改变数据；改动 CTRL_REG4.BLE 会翻转字节序导致三轴读数异常；
            改动 ODR 为「掉电」后三轴停止更新。写入前请记录原值。
          </p>
        </div>
      </section>

      <section className="panel ch224-section">
        <div className="ch224-section-title">
          <span>04</span>
          <div>
            <h3>性能参数与用法要点</h3>
            <p>选型与调试时最常查的指标与限制，更多细节见数据手册 DS_lis3dh.pdf。</p>
          </div>
        </div>
        <div className="ch224-register-map">
          <div className="ch224-register-table-wrap">
            <table className="ch224-register-map-table lis3dh-perf-table">
              <thead>
                <tr>
                  <th>参数</th>
                  <th>典型值</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {PERFORMANCE_ROWS.map((row) => (
                  <tr key={row.label}>
                    <td><code>{row.label}</code></td>
                    <td>{row.value}</td>
                    <td>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="lis3dh-hint">
          换算公式：加速度 g = int16(OUT_X_H:OUT_X_L) ÷ accRange，
          accRange 为 ±2 g→16000、±4 g→7282、±8 g→3968、±16 g→1280（沿用 Seeed/Adafruit 库）。
          数据 12 位左对齐，低 4 位恒为 0，所以计数比 12 位手册值大 16 倍。
        </div>
      </section>

      <section className="panel ch224-section ch224-flow">
        <div className="ch224-section-title">
          <span>05</span>
          <div>
            <h3>推荐操作流程</h3>
            <p>按顺序确认，避免量程/ODR 与换算不一致导致数值看起来「不对」。</p>
          </div>
        </div>
        <ol>
          <li>
            <b>接线与供电</b>
            <span>
              VDD 3.3 V（1.71–3.6 V）、GND 共地；SDA/SCL 各 4.7 kΩ 上拉。SA0/SDO 接地为
              0x18，接 VDD 为 0x19。
            </span>
          </li>
          <li>
            <b>连接设备</b>
            <span>
              在 I²C 操作台统一连接；先用 100 kHz 标准速率，链路长或干扰大时降到 20 kHz。
            </span>
          </li>
          <li>
            <b>扫描与识别</b>
            <span>
              点击「扫描 0x18 / 0x19」，确认 WHO_AM_I 返回 0x33，并自动同步当前
              FS/ODR/模式。
            </span>
          </li>
          <li>
            <b>确认量程</b>
            <span>
              静止时 |a| 应约等于 1 g；若明显偏离 1 g，多半是量程与换算不匹配，先在 02 重新下发配置。
            </span>
          </li>
          <li>
            <b>开启采集（单次轮询）</b>
            <span>
              选择「自动读取」并设定轮询间隔，观察三轴数值与立体矢量：水平放置时 +Z 约 +1 g，翻转后对应轴变负。
            </span>
          </li>
          <li>
            <b>读取率与 ODR 配合</b>
            <span>
              轮询速率受串口/蓝牙往返时间限制；ODR ≥ 2× 读取率时每次读数都是新样本，否则先在 02 区提高 ODR。
            </span>
          </li>
          <li>
            <b>高频批量（FIFO）</b>
            <span>
              切「FIFO 批量」会自动启用 Stream FIFO；读取周期不超过提示值（≤ 阈值 ÷ ODR），样本不丢且总线压力最小。
            </span>
          </li>
          <li>
            <b>中断推送（需固件配合）</b>
            <span>
              按 docs/LIS3DH_STREAM_PROTOCOL.md 接线（LIS3DH INT1 → ESP32 GPIO）并刷入支持 STREAM_* 的固件；
              启动后页面不再下发读命令，只接收并显示数据。
            </span>
          </li>
          <li>
            <b>按需启用温度</b>
            <span>
              勾选「启用温度通道」并下发，TEMP_EN=1 后 OUT_ADC3 变为温度；精度约 ±1 °C，仅供相对参考。
            </span>
          </li>
        </ol>
      </section>
    </section>
  );
}

/** 等轴测投影参数：+X 右下、+Y 左下、+Z 向上；远端略缩小形成透视。 */
const SCENE = {
  width: 560,
  height: 340,
  scale: 82,
  originX: 280,
  originY: 150,
  floorZ: -1.05,
  extent: 1.2,
  shrink: 0.06,
};
const ISO_X = Math.cos(Math.PI / 6);
const ISO_Y = 0.5;
/** 坐标轴：颜色与卡片/标签保持一致（X 蓝、Y 绿、Z 琥珀）。 */
const SCENE_AXES = [
  { key: "x", label: "+X", color: "var(--accent)", dir: [1, 0, 0] as const },
  { key: "y", label: "+Y", color: "var(--green)", dir: [0, 1, 0] as const },
  { key: "z", label: "+Z", color: "#e5ad5c", dir: [0, 0, 1] as const },
];

function projectPoint(x: number, y: number, z: number) {
  const shrink = 1 / (1 + (x + y) * SCENE.shrink);
  return {
    x: SCENE.originX + (x - y) * ISO_X * SCENE.scale * shrink,
    y: SCENE.originY + ((x + y) * ISO_Y - z) * SCENE.scale * shrink,
  };
}

function clampAxis(value: number): number {
  return Math.max(-1.45, Math.min(1.45, value));
}

/** 两个 3D 向量的叉积（用于构造器件板的平面基）。 */
function cross3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ] as const;
}

function normalize3(v: readonly [number, number, number]) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length] as const;
}

function polygonPoints(points: Array<{ x: number; y: number }>): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
}

/**
 * 立体矢量视图：SVG 等轴测，画出地面网格、三轴箭头、随重力方向倾斜的器件板，
 * 以及从原点指向当前加速度的有发光矢量与落地投影。
 */
function VectorScene({
  g,
  magnitude,
  active,
}: {
  g: Lis3dhAxes;
  magnitude: number;
  active: boolean;
}) {
  const x = clampAxis(g.x);
  const y = clampAxis(g.y);
  const z = clampAxis(g.z);
  const length = Math.hypot(x, y, z);
  const magnitudeLabel = active ? magnitude.toFixed(3) : "—";
  const origin = projectPoint(0, 0, 0);
  const tip = projectPoint(x, y, z);
  const floorPoint = projectPoint(x, y, SCENE.floorZ);

  // 器件板平面：法线跟随重力方向，水平放置时板面平行于 X-Y 平面。
  const normal = length > 1e-6
    ? normalize3([x, y, z])
    : ([0, 0, 1] as const);
  const helper = Math.abs(normal[2]) > 0.92
    ? ([1, 0, 0] as const)
    : ([0, 0, 1] as const);
  const axisU = normalize3(cross3(helper, normal));
  const axisV = normalize3(cross3(normal, axisU));
  const plateCorner = (u: number, v: number) => {
    const point = [
      axisU[0] * u + axisV[0] * v,
      axisU[1] * u + axisV[1] * v,
      axisU[2] * u + axisV[2] * v,
    ] as const;
    return projectPoint(point[0], point[1], point[2]);
  };
  const plateSize = 0.72;
  const chipSize = 0.38;
  const plate = [
    plateCorner(-plateSize, -plateSize),
    plateCorner(plateSize, -plateSize),
    plateCorner(plateSize, plateSize),
    plateCorner(-plateSize, plateSize),
  ];
  const chip = [
    plateCorner(-chipSize, -chipSize),
    plateCorner(chipSize, -chipSize),
    plateCorner(chipSize, chipSize),
    plateCorner(-chipSize, chipSize),
  ];
  const floorCorners = [
    projectPoint(-SCENE.extent, -SCENE.extent, SCENE.floorZ),
    projectPoint(SCENE.extent, -SCENE.extent, SCENE.floorZ),
    projectPoint(SCENE.extent, SCENE.extent, SCENE.floorZ),
    projectPoint(-SCENE.extent, SCENE.extent, SCENE.floorZ),
  ];
  const grid = [-1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.2];
  const sceneTitle = active
    ? `三轴矢量：X ${x.toFixed(2)} g，Y ${y.toFixed(2)} g，Z ${z.toFixed(2)} g`
    : "三轴矢量：暂无数据";

  return (
    <div className="lis3dh-scene" aria-label="三轴加速度立体矢量图">
      <div className="lis3dh-scene-badge">
        <span>|a|</span>
        <b>{magnitudeLabel}</b>
        <em>g</em>
      </div>
      <div className="lis3dh-scene-flag">等轴测 · {active ? "实时" : "待机"}</div>
      <svg
        className="lis3dh-scene-svg"
        viewBox={`0 0 ${SCENE.width} ${SCENE.height}`}
        role="img"
        aria-label={sceneTitle}
      >
        <defs>
          <radialGradient id="lis3dh-floor" cx="50%" cy="50%" r="60%">
            <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.24 }} />
            <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} />
          </radialGradient>
          <linearGradient id="lis3dh-vector" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.25 }} />
            <stop offset="45%" style={{ stopColor: "var(--accent)", stopOpacity: 0.95 }} />
            <stop offset="100%" style={{ stopColor: "#ffffff", stopOpacity: 1 }} />
          </linearGradient>
          <linearGradient id="lis3dh-plate" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--accent)", stopOpacity: 0.3 }} />
            <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0.06 }} />
          </linearGradient>
          <radialGradient id="lis3dh-tip" cx="35%" cy="30%" r="70%">
            <stop offset="0%" style={{ stopColor: "#ffffff", stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: "var(--accent)", stopOpacity: 0.9 }} />
          </radialGradient>
          <filter id="lis3dh-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {SCENE_AXES.map((axis) => (
            <marker
              key={axis.key}
              id={`lis3dh-arrow-${axis.key}`}
              viewBox="0 0 8 8"
              refX="6.4"
              refY="4"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" style={{ fill: axis.color }} />
            </marker>
          ))}
        </defs>

        {/* 地面：渐变底色 + 网格，提供纵深参考 */}
        <polygon
          points={polygonPoints(floorCorners)}
          fill="url(#lis3dh-floor)"
        />
        {grid.map((line) => (
          <g
            key={`floor-${line}`}
            stroke="color-mix(in srgb, var(--accent) 22%, var(--border))"
            strokeWidth="1"
            opacity={line === 0 ? 0.95 : 0.7}
          >
            <line
              x1={projectPoint(line, -SCENE.extent, SCENE.floorZ).x}
              y1={projectPoint(line, -SCENE.extent, SCENE.floorZ).y}
              x2={projectPoint(line, SCENE.extent, SCENE.floorZ).x}
              y2={projectPoint(line, SCENE.extent, SCENE.floorZ).y}
            />
            <line
              x1={projectPoint(-SCENE.extent, line, SCENE.floorZ).x}
              y1={projectPoint(-SCENE.extent, line, SCENE.floorZ).y}
              x2={projectPoint(SCENE.extent, line, SCENE.floorZ).x}
              y2={projectPoint(SCENE.extent, line, SCENE.floorZ).y}
            />
          </g>
        ))}

        {/* 三轴：负方向虚线短桩，正方向带箭头与刻度点 */}
        {SCENE_AXES.map((axis) => {
          const [dx, dy, dz] = axis.dir;
          const back = projectPoint(-dx * 0.5, -dy * 0.5, -dz * 0.5);
          const front = projectPoint(dx * 1.12, dy * 1.12, dz * 1.12);
          const label = projectPoint(dx * 1.3, dy * 1.3, dz * 1.3);
          return (
            <g key={axis.key}>
              <line
                x1={origin.x}
                y1={origin.y}
                x2={back.x}
                y2={back.y}
                stroke={axis.color}
                strokeWidth="1.2"
                strokeDasharray="3 4"
                opacity="0.32"
              />
              <line
                x1={origin.x}
                y1={origin.y}
                x2={front.x}
                y2={front.y}
                stroke={axis.color}
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.92"
                markerEnd={`url(#lis3dh-arrow-${axis.key})`}
              />
              {[0.55, 1.0].map((tick) => {
                const point = projectPoint(dx * tick, dy * tick, dz * tick);
                return (
                  <circle
                    key={tick}
                    cx={point.x}
                    cy={point.y}
                    r="1.6"
                    fill={axis.color}
                    opacity="0.6"
                  />
                );
              })}
              <text
                x={label.x}
                y={label.y}
                fill={axis.color}
                fontSize="10"
                fontFamily="'DM Mono', monospace"
                textAnchor="middle"
                dominantBaseline="middle"
                opacity="0.9"
              >
                {axis.label}
              </text>
            </g>
          );
        })}

        {/* 器件板：板面法线 = 重力方向，直观看出模块是怎么斜的 */}
        <g opacity={active ? 0.95 : 0.4}>
          <polygon
            points={polygonPoints(plate)}
            fill="url(#lis3dh-plate)"
            stroke="var(--accent)"
            strokeWidth="1.2"
            strokeOpacity="0.75"
            strokeLinejoin="round"
          />
          <polygon
            points={polygonPoints(chip)}
            fill="var(--accent)"
            fillOpacity="0.3"
            stroke="var(--accent)"
            strokeWidth="1"
            strokeOpacity="0.85"
            strokeLinejoin="round"
          />
          {[
            [-0.55, -0.55],
            [0.55, -0.55],
            [0.55, 0.55],
            [-0.55, 0.55],
          ].map(([u, v]) => {
            const pad = plateCorner(u, v);
            return (
              <circle
                key={`${u}-${v}`}
                cx={pad.x}
                cy={pad.y}
                r="2.2"
                fill="var(--accent)"
                opacity="0.5"
              />
            );
          })}
        </g>

        {/* 加速度矢量：落地虚线 + 地面投影 + 发光主线与箭头球 */}
        <g opacity={active && length > 0.02 ? 1 : 0.25}>
          <line
            x1={tip.x}
            y1={tip.y}
            x2={floorPoint.x}
            y2={floorPoint.y}
            stroke="var(--accent)"
            strokeWidth="1"
            strokeDasharray="2 4"
            opacity="0.42"
          />
          <ellipse
            cx={floorPoint.x}
            cy={floorPoint.y}
            rx="9"
            ry="4"
            fill="var(--accent)"
            opacity="0.3"
          />
          <line
            x1={origin.x}
            y1={origin.y}
            x2={tip.x}
            y2={tip.y}
            stroke="url(#lis3dh-vector)"
            strokeWidth="3.2"
            strokeLinecap="round"
            filter="url(#lis3dh-glow)"
          />
          {length > 0.02 && (
            <>
              <circle
                cx={tip.x}
                cy={tip.y}
                r="9.5"
                fill="var(--accent)"
                opacity="0.18"
              />
              <circle cx={tip.x} cy={tip.y} r="5.4" fill="url(#lis3dh-tip)" />
            </>
          )}
        </g>
        <circle
          cx={origin.x}
          cy={origin.y}
          r="2.6"
          fill="var(--text-muted)"
        />
      </svg>
      <div className="lis3dh-scene-legend">
        X <b>{active ? formatAxis(g.x, 2) : "—"}</b> · Y{" "}
        <b>{active ? formatAxis(g.y, 2) : "—"}</b> · Z{" "}
        <b>{active ? formatAxis(g.z, 2) : "—"}</b> g · X 右下 · Y 左下 · Z 向上
      </div>
    </div>
  );
}

function Lis3dhRegisterCard({
  result,
  writeResult,
}: {
  result: Lis3dhRegisterReadResult;
  writeResult: Lis3dhRegisterWriteResult | null;
}) {
  const detail = result.detail;
  return (
    <div className="ch224-bit-detail">
      <div className="ch224-bit-heading">
        <div>
          <span>
            寄存器 {byteHex(result.register)} ·{" "}
            {KIND_LABELS[detail.kind] ?? detail.kind}
          </span>
          <h4>{detail.name} · {detail.hex}</h4>
        </div>
        <code>{detail.binary}</code>
      </div>
      <p>{detail.description}</p>
      <div className="ch224-metric-grid">
        <div>
          <span>原始值</span>
          <b>{detail.hex}（dec {detail.raw}）</b>
        </div>
        <div>
          <span>二进制</span>
          <b>{detail.binary}</b>
        </div>
        <div>
          <span>属性</span>
          <b>{detail.access === "read" ? "只读" : "可读写"}</b>
        </div>
      </div>
      {detail.fields && (
        <div className="lis3dh-field-list">
          {detail.fields.map((field) => (
            <div key={field.name} className={field.value ? "set" : ""}>
              <b>bit {field.bits}</b>
              <strong>{field.name}</strong>
              <em>{field.display}</em>
              <span>{field.description}</span>
            </div>
          ))}
        </div>
      )}
      {writeResult && (
        <div className="ch224-request-result" role="status">
          <b>写入结果</b>
          <span>{writeResult.message}</span>
        </div>
      )}
    </div>
  );
}

export default Lis3dhPanel;
