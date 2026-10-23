export type Theme = "dark" | "light";

// 传输相关类型统一从 transport/types.ts 导出，UI 只依赖这一层。
export type {
  ByteTransport,
  TransportDescriptor,
  TransportDevice,
  TransportEvent,
  TransportKind,
} from "./transport/types.ts";

import type {
  TransportDevice,
  TransportKind,
} from "./transport/types.ts";

/** 兼容旧命名：Web 版后端种类现在与传输种类一致。 */
export type BackendKind = TransportKind;

export interface DeviceStatus {
  connected: boolean;
  /** 当前活跃传输（serial/ble/usb）；未连接时为 null。 */
  kind: TransportKind | null;
  /** 设备展示名（串口 VID/PID 或蓝牙设备名）。 */
  port: string | null;
  /** 串口波特率；BLE/USB 为 null。 */
  baud: number | null;
  /** LWPKT 帧 CRC 错误计数（链路质量指示）。 */
  crcErrors: number;
  /** 成功收到的应答帧数。 */
  frames: number;
}

/** 兼容旧命名：已授权设备摘要现在覆盖串口/蓝牙。 */
export type SerialPortSummary = TransportDevice;

export interface ScanResult {
  addresses: number[];
  start: number;
  end: number;
}

export interface TransferResult {
  bytesRead: number;
  hex: string;
  ascii: string;
}

export interface Ch224RegisterValue {
  address: number;
  hex: string;
  binary: string;
  name: string;
  description: string;
  bits: Array<{ bit: number; value: number; description: string }>;
}

export interface Ch224ProfileField {
  start: number;
  end: number;
  name: string;
  kind: "value" | "flag" | "reserved";
  description: string;
  value: number;
  display: string;
  bitRange: string;
}

export interface Ch224Profile {
  index: number;
  type: string;
  name: string;
  supplyTypeCode: number;
  subtypeCode: number | null;
  voltageMv?: number;
  currentMa?: number;
  powerMw?: number;
  minVoltageMv?: number;
  maxVoltageMv?: number;
  maxCurrentMa?: number;
  maxPowerMw?: number;
  peakCurrentCode?: number;
  powerLimited?: boolean;
  pdpWatts?: number;
  requestableByCh224A: boolean;
  raw: number;
  rawHex: string;
  fields: Ch224ProfileField[];
  flags: Array<{
    name: string;
    bit: number;
    supported: boolean;
    description: string;
  }>;
  parameters: Array<{
    name: string;
    bitRange: string;
    display: string;
    value: number;
    unit: string;
  }>;
  offset: number;
}

export interface Ch224HeaderDetail {
  raw: number;
  hex: string;
  binary: string;
  messageTypeCode: number;
  messageType: string;
  numObjects: number;
  messageId: number;
  specRevisionCode: number;
  specRevision: string;
  powerRole: string;
  dataRole: string;
  extended: boolean;
  fields: Array<{
    start: number;
    end: number;
    name: string;
    description: string;
  }>;
}

export interface Ch224CapabilitySummary {
  totalPdos: number;
  messageType: string;
  specRevision: string;
  powerRole: string;
  dataRole: string;
  messageId: number;
  fixedCount: number;
  ppsCount: number;
  avsCount: number;
  batteryCount: number;
  variableCount: number;
  reservedCount: number;
  fixedVoltagesMv: number[];
  maxVoltageMv: number | null;
  maxCurrentMa: number | null;
  maxPowerMw: number | null;
  eprCapable: boolean;
  unconstrainedPower: boolean;
  dualRolePower: boolean;
  ch224aRequestableVoltagesV: number[];
}

export interface Ch224NonPdProtocol {
  pdActive: boolean;
  eprActive: boolean;
  bcActive: boolean;
  qc2Active: boolean;
  qc3Active: boolean;
  kind: "qc" | "qc2" | "qc3" | "bc" | null;
  allowedVoltages: number[];
  label: string | null;
}

export interface Ch224Snapshot {
  address: number;
  status: number;
  protocols: Array<{
    bit: number;
    name: string;
    description: string;
    active: boolean;
  }>;
  pdActive: boolean;
  qcActive?: boolean;
  bcActive?: boolean;
  nonPd?: Ch224NonPdProtocol | null;
  /** 所有读数均为 0xFF：模块未上电或 I²C 无应答，数据无效。 */
  noResponse?: boolean;
  voltageConfig: number | null;
  voltageMode?: { value: number; name: string } | null;
  currentCode: number;
  currentMilliAmps: number;
  sourceCapabilities: {
    valid: boolean;
    extended: boolean;
    count: number;
    header: number;
    headerDetail?: Ch224HeaderDetail;
    summary?: Ch224CapabilitySummary | null;
    profiles: Ch224Profile[];
    error?: string;
    objectOffset?: number;
  } | null;
  registers: Ch224RegisterValue[];
  message: string;
}

export interface Ch224RegisterInfo {
  address: number;
  access: "read" | "write";
  name: string;
  function: string;
}

export interface Ch224RegisterReadResult extends Ch224RegisterValue {
  register: number;
  value: number;
  readOnly: boolean;
}

export interface Ch224RegisterWriteResult {
  address: number;
  register: number;
  written: number;
  readBack: number | null;
  matches: boolean | null;
  writeOnly: boolean;
  detail: Ch224RegisterValue;
  message: string;
}

export interface Ch224RequestResult {
  mode: "fixed" | "pps" | "avs" | "qc";
  requestedVoltage?: number;
  requestedVoltageMv?: number;
  modeCode: number;
  protocolKind?: string;
  activeProtocol?: string;
  profile?: Ch224Profile;
  pdActive: boolean;
  eprActive: boolean;
  vbusMeasured: false;
  message: string;
}

export interface HistoryEntry {
  id: string;
  time: string;
  operation: string;
  detail: string;
  result: string;
  ok: boolean;
}

// —— MLX90614 非接触红外测温（SMBus，16 位寄存器）——

export type MlxRegisterKind = "ram" | "eeprom" | "command" | "reserved";

export interface MlxRegisterInfo {
  address: number;
  kind: MlxRegisterKind;
  access: "read" | "write";
  name: string;
  function: string;
}

export interface MlxTemperature {
  celsius: number | null;
  fahrenheit: number | null;
  valid: boolean;
}

export interface MlxConfigBit {
  bit: number;
  name: string;
  description: string;
  value: number;
}

export interface MlxRegisterDetail {
  address: number;
  hex: string;
  binary: string;
  raw: number;
  name: string;
  kind: MlxRegisterKind;
  access: "read" | "write";
  description: string;
  temperature?: MlxTemperature;
  emissivity?: number;
  configBits?: MlxConfigBit[];
}

export interface MlxRegisterReadResult {
  address: number;
  register: number;
  raw: number;
  low: number;
  high: number;
  pec: number;
  pecValid: boolean;
  noResponse: boolean;
  detail: MlxRegisterDetail;
  message: string;
}

export interface MlxRegisterWriteResult {
  address: number;
  register: number;
  kind: MlxRegisterKind;
  written?: number;
  readBack?: number;
  matches?: boolean;
  writeOnly?: boolean;
  commandOnly?: boolean;
  detail?: MlxRegisterDetail;
  message: string;
}

export interface MlxTemperatureResult {
  address: number;
  register: number;
  raw: number;
  pecValid: boolean;
  noResponse: boolean;
  valid: boolean;
  celsius: number | null;
  fahrenheit: number | null;
}

export interface MlxEmissivityRead {
  raw: number;
  value: number;
  pecValid: boolean;
}

export interface MlxTemperatureSource {
  reg: number;
  label: string;
}

// —— LIS3DH 三轴加速度计（I²C，8 位寄存器）——

export type Lis3dhRegisterKind = "id" | "status" | "out" | "ctrl" | "int";

export interface Lis3dhRegisterInfo {
  address: number;
  kind: Lis3dhRegisterKind;
  access: "read" | "rw";
  name: string;
  function: string;
}

export interface Lis3dhFieldDetail {
  low: number;
  high: number;
  /** 位号区间文本，单 bit 为 "3"，多 bit 为 "5:4"。 */
  bits: string;
  name: string;
  value: number;
  display: string;
  description: string;
}

export interface Lis3dhRegisterDetail {
  address: number;
  hex: string;
  binary: string;
  raw: number;
  name: string;
  kind: Lis3dhRegisterKind;
  access: "read" | "rw";
  description: string;
  fields?: Lis3dhFieldDetail[];
}

export interface Lis3dhRegisterReadResult {
  address: number;
  register: number;
  value: number;
  detail: Lis3dhRegisterDetail;
  noResponse: boolean;
  message: string;
}

export interface Lis3dhRegisterWriteResult {
  address: number;
  register: number;
  written: number;
  readBack: number;
  matches: boolean;
  detail: Lis3dhRegisterDetail;
  message: string;
}

/** 三轴原始计数（16 位有符号，已按小端合成）。 */
export interface Lis3dhRawAxes {
  x: number;
  y: number;
  z: number;
}

/** 三轴重力加速度（单位 g）。 */
export interface Lis3dhAxes {
  x: number;
  y: number;
  z: number;
}

export interface Lis3dhSample {
  address: number;
  /** 采样时间戳（毫秒）。 */
  at: number;
  raw: Lis3dhRawAxes;
  g: Lis3dhAxes;
  magnitude: number;
  /** 姿态角（度）：绕 Y 轴俯仰。 */
  pitch: number;
  /** 姿态角（度）：绕 X 轴横滚。 */
  roll: number;
  fullScale: number;
  fullScaleLabel: string;
  accRange: number;
  /** block = 一次 READ_BLOCK 连读；single = 逐寄存器回退读取。 */
  readMode: "block" | "single";
  noResponse: boolean;
  message: string;
}

export interface Lis3dhStatus {
  address: number;
  value: number;
  dataReady: boolean;
  overrun: boolean;
}

export interface Lis3dhTemperature {
  address: number;
  low: number;
  high: number;
  raw: number;
  celsius: number | null;
  enabled: boolean;
  message: string;
}

export interface Lis3dhAxesEnable {
  x: boolean;
  y: boolean;
  z: boolean;
}

/** FIFO 配置：模式为 bypass / fifo / stream / streamToFifo，阈值为 0–31 级。 */
export interface Lis3dhFifoConfig {
  enabled: boolean;
  mode: string;
  threshold: number;
}

/** FIFO_SRC_REG 解码结果。 */
export interface Lis3dhFifoStatus {
  address: number;
  value: number;
  raw: number;
  watermark: boolean;
  overrun: boolean;
  empty: boolean;
  /** FSS 原始值（0–31）。 */
  level: number;
  /** 可批量读出的样本数（满级时保守取 31）。 */
  pending: number;
  message: string;
}

/** FIFO 批量读取结果：一次事务带回的多组样本。 */
export interface Lis3dhFifoBatch {
  address: number;
  at: number;
  status: Lis3dhFifoStatus;
  count: number;
  samples: Lis3dhSample[];
  message: string;
}

/** FIFO 读取周期建议。 */
export interface Lis3dhFifoHint {
  odrHz: number;
  maxIntervalMs: number;
  usableDepth: number;
}

/** 输出模式三档定义（低功耗 8 位 / 正常 10 位 / 高分辨率 12 位）。 */
export interface Lis3dhOutputModeInfo {
  id: string;
  label: string;
  lpen: number;
  hr: number;
  resolutionBits: number;
  mgPerDigitAt2g: number;
  maxOdrHz: number;
  note: string;
}

/** FIFO 模式定义。 */
export interface Lis3dhFifoModeInfo {
  id: string;
  bits: number;
  label: string;
  note: string;
}

/** INT1 路由定义（不输出 / 数据就绪 / FIFO 水印）。 */
export interface Lis3dhIntRouteInfo {
  id: string;
  bits: number;
  label: string;
  note: string;
}

/** ODR 档位定义；hzLowPower 仅低功耗模式使用。 */
export interface Lis3dhOdrInfo {
  code: number;
  hz: number;
  hzLowPower?: number;
  label: string;
}

export interface Lis3dhConfig {
  odrCode: number;
  fullScale: number;
  /** 输出模式：lowPower（8 位）/ normal（10 位）/ highResolution（12 位）。 */
  outputMode: string;
  blockDataUpdate: boolean;
  axes: Lis3dhAxesEnable;
  tempEnable: boolean;
  /** INT1 引脚路由：none / dataReady（ZYXDA）/ fifoWatermark（WTM）。 */
  intRoute: string;
  fifo: Lis3dhFifoConfig;
  /** 派生位（兼容展示）：outputMode === "lowPower"。 */
  lowPower?: boolean;
  /** 派生位（兼容展示）：outputMode === "highResolution"。 */
  highResolution?: boolean;
}

/** 从寄存器解出的实际配置（含 ODR 速率与大端标志）。 */
export interface Lis3dhDecodedConfig extends Lis3dhConfig {
  odrHz: number;
  outputModeLabel: string;
  resolutionBits: number;
  bigEndian: boolean;
  adcPowered: boolean;
  /** CTRL_REG3 原始字节（中断路由位）。 */
  intRouteBits: number;
}

/** 一次配置下发的六个寄存器目标值。 */
export interface Lis3dhRegisterSet {
  ctrlReg1: number;
  ctrlReg3: number;
  ctrlReg4: number;
  ctrlReg5: number;
  tempCfg: number;
  fifoCtrl: number;
}

/** 采样读取方式：单次轮询 / FIFO 批量 / 设备主动推送。 */
export type Lis3dhReadMode = "poll" | "fifo" | "stream";

/** 寄存器目录（含输出模式/FIFO/中断路由选项，供 UI 下拉渲染）。 */
export interface Lis3dhRegisterCatalog {
  registers: Lis3dhRegisterInfo[];
  fullScales: Lis3dhFullScaleInfo[];
  outputModes: Lis3dhOutputModeInfo[];
  fifoModes: Lis3dhFifoModeInfo[];
  intRoutes: Lis3dhIntRouteInfo[];
}

export interface Lis3dhConfigResult {
  address: number;
  target: Lis3dhRegisterSet;
  readBack: Lis3dhRegisterSet;
  matches: boolean;
  config: Lis3dhDecodedConfig;
  message: string;
}

export interface Lis3dhDeviceInfo {
  address: number;
  whoAmI: number | null;
  identified: boolean;
  ctrlReg1: number | null;
  ctrlReg3: number | null;
  ctrlReg4: number | null;
  ctrlReg5: number | null;
  tempCfg: number | null;
  fifoCtrl: number | null;
  config: Lis3dhDecodedConfig | null;
}

export interface Lis3dhDiscoverResult {
  addresses: number[];
  devices: Lis3dhDeviceInfo[];
  message: string;
}

export interface Lis3dhFullScaleInfo {
  id: number;
  label: string;
  fsBits: number;
  accRange: number;
  mgPerDigit: number;
}

// —— I²C 总线参数（CONFIG / CAPS / BUS_SELECT）——
// UI 只需要这一层类型；具体实现位于 serial/backend.ts。
export type {
  I2cBusCapability,
  I2cBusConfig,
  I2cBusConfigPatch,
  I2cBusMachine,
  I2cCapabilities,
  I2cPinCapability,
  I2cPinMode,
  I2cPinScheme,
  I2cStreamFrame,
  I2cStreamInfo,
  I2cStreamRequest,
  I2cSwapResult,
} from "./serial/backend.ts";
