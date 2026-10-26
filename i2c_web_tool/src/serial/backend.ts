// 后端共同接口（Web 版）：与具体传输方式解耦，当前支持 Web Serial 与 BLE NUS，
// 未来增加 WebUSB 时只需实现 TransportProvider，不需要改 I2cBackend。
//
// 与桌面版的差异：
//   - connect 接收 TransportManager 的设备 id，而不是 COM 名；
//   - 所有涉及 I/O 的方法返回 Promise（浏览器硬件 API 全是异步）；
//   - 不含 spiTransfer（当前固件不支持 SPI）。
import type {
  TransportDescriptor,
  TransportDevice,
  TransportEvent,
  TransportKind,
} from "../transport/types.ts";

/** 兼容旧命名：后端种类现在与传输种类一致。 */
export type BackendKind = TransportKind;

/** 已授权设备的摘要（Web Serial 没有 COM 名，BLE 没有稳定短地址）。 */
export type SerialPortSummary = TransportDevice;

export interface BackendStatus {
  connected: boolean;
  /** 当前活跃传输；未连接时为 null。 */
  kind: TransportKind | null;
  /** 设备展示名。 */
  port: string | null;
  /** 串口波特率；BLE/USB 为 null。 */
  baud: number | null;
  crcErrors: number;
  frames: number;
}

export interface ScanResult {
  addresses: number[];
  start: number;
  end: number;
}

/** I²C 总线当前配置（CONFIG / BUS_SELECT 回读）。 */
export interface I2cBusConfig {
  sda: number;
  scl: number;
  freqHz: number;
  /** 仅 BUS_SELECT 应答携带：生效的硬件 I²C 实例编号（1=I2C1）。 */
  busId?: number;
  /** 仅 BUS_SELECT 应答携带：生效的引脚方案编号。 */
  schemeId?: number;
}

/** CONFIG 设置补丁：只提交需要修改的字段。 */
export interface I2cBusConfigPatch {
  sda?: number;
  scl?: number;
  freqHz?: number;
}

/** 固件上报的芯片平台。 */
export type I2cBusMachine = "unknown" | "esp32" | "stm32";

/** free=任意 GPIO（ESP32）；fixed=固定复用引脚（STM32）。 */
export type I2cPinMode = "free" | "fixed";

/** 一组可选的固定引脚方案；STM32 同一实例常有默认/重映射多组。 */
export interface I2cPinScheme {
  id: number;
  scl: number;
  sda: number;
  /** STM32 复用功能编号（AF）；ESP32/未知平台为 0。 */
  af: number;
  /** 位标志：1=默认方案，2=重映射，4=板载固定接线。 */
  flags: number;
  label: string;
}

/**
 * CAPS v2 上报的一个自由引脚（ESP32 等可任意映射芯片）。
 * 只有 sda/scl 为 true 的 GPIO 才允许用于对应信号。
 */
export interface I2cPinCapability {
  gpio: number;
  sda: boolean;
  scl: boolean;
  defaultSda: boolean;
  defaultScl: boolean;
  /** 引脚存在但不可用于 I²C；reasonText 说明原因。 */
  reserved: boolean;
  /** 启动配置引脚：可用但上电瞬间电平有限制。 */
  strap: boolean;
  /** 仅输入引脚（GPIO34–39），不能驱动 SDA/SCL。 */
  inputOnly: boolean;
  /** 支持内部上拉。 */
  pullup: boolean;
  /** 固件原因码，见 lwpkt.mjs 的 PIN_REASON。 */
  reason: number;
  reasonText: string;
}

export interface I2cBusCapability {
  /** 硬件实例编号：1=I2C1、2=I2C2…。 */
  id: number;
  schemes: I2cPinScheme[];
}

/** CAPS 应答：固件自报的芯片平台、引脚模式与可用实例/方案。 */
export interface I2cCapabilities {
  version: number;
  machine: I2cBusMachine;
  pinMode: I2cPinMode;
  supportsConfigSet: boolean;
  supportsSwap: boolean;
  supportsRecover: boolean;
  supportsBusSelect: boolean;
  freqMin: number;
  freqMax: number;
  /** 芯片型号或固件自报名称。 */
  name: string;
  buses: I2cBusCapability[];
  /**
   * 自由引脚表（CAPS v2）：空数组表示旧固件或固定引脚芯片未上报可用 GPIO。
   * 前端与后端据此限制可选引脚，而不是盲目接受 0–63。
   */
  pins: I2cPinCapability[];
  /** 固件声明的默认 SDA GPIO；未声明时为 null。 */
  defaultSda: number | null;
  /** 固件声明的默认 SCL GPIO；未声明时为 null。 */
  defaultScl: number | null;
}

export interface I2cSwapResult {
  sda: number;
  scl: number;
}

/**
 * 流式采样请求（对应固件 STREAM_START 0x0230 命令）。
 * 固件按 periodMs 定时或在 intPin 触发时读 address/register 开始 length 字节，
 * 用 STREAM_DATA（0x0232）主动上报；上位机不需要再下发读命令。
 */
export interface I2cStreamRequest {
  /** 7 位 I²C 地址。 */
  address: number;
  /** 起始子地址（建议含地址自增位，如 0xA8）。 */
  register: number;
  /** 每次回读字节数（三轴为 6）。 */
  length: number;
  /** poll = 固件定时读；int = 外部中断引脚触发读。 */
  mode: "poll" | "int";
  /** mode=poll 时的读取周期，0 = 尽可能快。 */
  periodMs: number;
  /** mode=int 时的触发 GPIO 编号；0xFF = 固件默认。 */
  intPin: number;
  /** 推送帧数上限；0 = 连续直到手动停止。 */
  count: number;
}

/** STREAM_START 应答：固件实际生效的参数。 */
export interface I2cStreamInfo {
  supported: boolean;
  mode: "poll" | "int";
  periodMs: number;
  message: string;
}

/** 固件主动上报的一帧采样（STREAM_DATA）。 */
export interface I2cStreamFrame {
  address: number;
  /** 固件递增序号；上位机用差值统计丢帧。 */
  seq: number;
  /** 本次回读的原始寄存器字节（长度=length）。 */
  bytes: number[];
  receivedAt: number;
}

/**
 * 周期自动上报的一个任务（REPORT_CONFIG 0x0240 的一个槽位）。
 * 固件保存任务表，按每个任务自己的 periodMs 读 address/register，
 * 再用 REPORT_DATA（0x0245）主动推帧；上位机启动后不再逐次下发读命令。
 */
export interface I2cReportTask {
  /** 任务槽位编号 0–255（须小于固件 REPORT_STATUS.maxTasks）。 */
  taskId: number;
  /** 7 位 I²C 地址。 */
  address: number;
  /** 起始子地址（需要自增时含 0x80，如 LIS3DH 0xA8）。 */
  register: number;
  /** 每次回读字节数 1–192。 */
  length: number;
  /** 读取周期（ms）；固件按 tickMs 钳制并在应答里回显实际值。 */
  periodMs: number;
  /** 推送帧数上限；0 = 连续直到停止。 */
  count: number;
  /** 能力位：bit0 = 仅数据变化时上报（ONLY_CHANGED）。 */
  flags: number;
}

/** REPORT_CONFIG 应答：固件实际生效的周期与支持的能力位。 */
export interface I2cReportConfig {
  taskId: number;
  /** 钳制后的实际周期，优先于请求值用于时间轴。 */
  periodMs: number;
  /** 固件实际支持的能力位（不支持 ONLY_CHANGED 时回 0）。 */
  flags: number;
  onlyChanged: boolean;
}

/** REPORT_START 应答：本次新启动的任务数与调度粒度。 */
export interface I2cReportInfo {
  started: number;
  /** 固件调度 tick；periodMs 小于它时会被钳制。 */
  tickMs: number;
}

/** REPORT_STOP 的单个任务统计。 */
export interface I2cReportStopped {
  taskId: number;
  /** 固件侧本次累计推送帧数。 */
  frames: number;
}

/** REPORT_STATUS 的一个槽位摘要（未配置槽位 state=0、其余字段为 0）。 */
export interface I2cReportSummary {
  taskId: number;
  address: number;
  register: number;
  length: number;
  periodMs: number;
  /** 0=未配置 1=已配置 2=运行中（见 lwpkt.mjs 的 REPORT_STATE）。 */
  state: number;
  stateText: string;
}

/** REPORT_STATUS 应答：固件任务表快照，只回内存、不访问 I²C。 */
export interface I2cReportStatus {
  /** 固件任务表版本，当前为 1。 */
  version: number;
  maxTasks: number;
  activeCount: number;
  tickMs: number;
  tasks: I2cReportSummary[];
}

/** 固件主动上报的一帧（REPORT_DATA）。 */
export interface I2cReportFrame {
  taskId: number;
  address: number;
  seq: number;
  length: number;
  /** 设备端采样时间戳（读取成功那一刻）；u32 回绕约 49.7 天。 */
  atMs: number;
  bytes: number[];
  /** 主机单调时钟，仅用于链路诊断，不能代替 atMs。 */
  receivedAt: number;
}

/** 一次连接请求：kind 决定走哪个 TransportProvider。 */
export interface ConnectRequest {
  kind: TransportKind;
  deviceId: string;
  baudRate?: number;
  /** BLE 写分片大小；串口忽略。 */
  chunkSize?: number;
  /** BLE 分片间隔；串口忽略。 */
  writeDelayMs?: number;
}

export interface I2cBackend {
  /** 当前活跃传输；未连接时为 null。 */
  readonly kind: TransportKind | null;
  status(): BackendStatus;
  /** 可用的传输能力（串口/蓝牙/…），UI 据此渲染切换按钮。 */
  transports(): TransportDescriptor[];
  /** 返回指定传输已授权的设备列表。 */
  listDevices(kind?: TransportKind): Promise<TransportDevice[]>;
  /** 弹出指定传输的浏览器授权框（必须在用户手势中调用）。 */
  requestDevice(kind?: TransportKind): Promise<TransportDevice>;
  /** 订阅设备插拔与被动断开事件；返回取消订阅函数。 */
  subscribe(listener: (event: TransportEvent) => void): () => void;
  connect(request: ConnectRequest): Promise<BackendStatus>;
  disconnect(): Promise<BackendStatus>;
  scan(start: number, end: number): Promise<ScanResult>;
  /** 读取当前 SDA/SCL 与频率（CONFIG flags=0）。 */
  readBusConfig(): Promise<I2cBusConfig>;
  /** 修改 SDA/SCL/频率；只提交显式字段。ESP32 可任意映射 GPIO。 */
  configureBus(patch: I2cBusConfigPatch): Promise<I2cBusConfig>;
  /** 查询芯片能力；旧固件不支持时返回 null，调用方降级为自由引脚模式。 */
  readBusCapabilities(): Promise<I2cCapabilities | null>;
  /** 选择硬件 I²C 实例与固定引脚方案（STM32）；freqHz=0 表示保持当前频率。 */
  selectBus(
    busId: number,
    schemeId: number,
    freqHz?: number,
  ): Promise<I2cBusConfig>;
  /** 交换 SDA/SCL（接线纠错）。 */
  swapBusPins(): Promise<I2cSwapResult>;
  /** 总线恢复：释放引脚并发送 9 个时钟脉冲。 */
  recoverBus(): Promise<void>;
  read(address: number, register: number): Promise<{ value: number }>;
  write(
    address: number,
    register: number,
    value: number,
  ): Promise<{ written: boolean }>;
  transfer(writeHex: string, readLength: number): Promise<unknown>;
  streamI2C(writeBytes: Uint8Array, readLength: number): Promise<number[]>;
  readRegisters(
    address: number,
    start: number,
    length: number,
  ): Promise<number[]>;
  /**
   * 启动设备主动上报（需固件实现 STREAM_START）；旧固件会报错，调用方降级。
   * 可选方法：仅支持流式的传输（当前为 LWPKT 后端）实现。
   */
  startStream?(request: I2cStreamRequest): Promise<I2cStreamInfo>;
  /** 停止主动上报，返回本次累计接收帧数。 */
  stopStream?(): Promise<{ frames: number }>;
  /** 订阅主动上报帧；返回取消订阅函数。 */
  subscribeStream?(listener: (frame: I2cStreamFrame) => void): () => void;
  /**
   * 周期自动上报（AR-1.0）：写入/改写一个任务槽位。
   * 固件对运行中的槽位回 ERR_ARG，调用方须先 `stopReport(taskId)`。
   */
  configureReport?(task: I2cReportTask): Promise<I2cReportConfig>;
  /** 启动任务（默认 0xFF = 全部已配置任务）；与 STREAM 互斥。 */
  startReport?(taskId?: number): Promise<I2cReportInfo>;
  /** 停止任务并返回固件侧帧数统计；默认停止全部。 */
  stopReport?(taskId?: number): Promise<I2cReportStopped[]>;
  /** 查询任务表快照（固件只回内存，不访问 I²C）。 */
  queryReport?(): Promise<I2cReportStatus>;
  /** 停止全部并清空任务表，返回被清空的槽位数。 */
  clearReport?(): Promise<number>;
  /** 订阅 REPORT_DATA 帧；返回取消订阅函数。 */
  subscribeReport?(listener: (frame: I2cReportFrame) => void): () => void;
  eepromRead(type: number, address: number, length: number): Promise<unknown>;
  eepromWrite(
    type: number,
    address: number,
    writeHex: string,
  ): Promise<unknown>;
  close(): Promise<void>;
}
