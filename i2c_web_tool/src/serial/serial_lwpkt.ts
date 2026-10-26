// 串口 LWPKT 后端（Web 版）：把 I2cBackend 方法面映射为 ESP32-Bus-Pirate 固件命令帧。
// 文件名保留历史名称，实际已与传输方式解耦：Web Serial、BLE NUS（以及未来的
// WebUSB）都通过 TransportManager 注入，本文件只负责 LWPKT 帧与异步请求-应答。
import type {
  BackendStatus,
  ConnectRequest,
  I2cBackend,
  I2cBusConfig,
  I2cBusConfigPatch,
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
  I2cSwapResult,
  SerialPortSummary,
} from "./backend.ts";
import type {
  ByteTransport,
  TransportDescriptor,
  TransportDevice,
  TransportEvent,
  TransportKind,
  TransportOpenOptions,
} from "../transport/types.ts";
import { TransportManager } from "../transport/manager.ts";
import { WebSerialProvider } from "./web_serial_transport.ts";
import { BleNusProvider } from "./ble_nus_transport.ts";
import { DEFAULT_BAUD, validateBaud } from "./serial.mjs";
import {
  ADDR_DEVICE,
  ADDR_HOST,
  CMD,
  FrameDecoder,
  LwpktError,
  REPORT_LIMITS,
  STATUS,
  buildFrame,
  decodeBusSelectResp,
  decodeCapsResp,
  decodeConfigResp,
  decodeEepromOpenResp,
  decodePingResp,
  decodeReadBlockResp,
  decodeReadRegResp,
  decodeReportClearResp,
  decodeReportConfigResp,
  decodeReportData,
  decodeReportStartResp,
  decodeReportStatusResp,
  decodeReportStopResp,
  decodeScanResp,
  decodeStreamData,
  decodeStreamStartResp,
  decodeStreamStopResp,
  decodeSwapResp,
  encodeBusSelect,
  encodeCapsQuery,
  encodeConfigQuery,
  encodeConfigSet,
  encodeEepromOpen,
  encodeEepromRead,
  encodeEepromWrite,
  encodePing,
  encodeReadBlock,
  encodeReadMem16,
  encodeReadRaw,
  encodeReadReg,
  encodeReportClear,
  encodeReportConfig,
  encodeReportStart,
  encodeReportStatus,
  encodeReportStop,
  encodeStreamStart,
  encodeStreamStop,
  encodeWriteRaw,
  encodeWriteReg,
  toHex,
} from "./lwpkt.mjs";
import {
  EEPROM_TYPES,
  parseEepromWrite,
  parseHex,
  toTransferResult,
  validateAddress,
  validateByte,
  validateEeprom,
} from "./protocol.mjs";
import { formatIntPin, validateIntPin } from "./int_pins.mjs";

// 固件载荷上限（docs/05 §7）
const MAX_BLOCK_LEN = 255; // READ_BLOCK/READ_RAW 单次
const MAX_MEM16_LEN = 1000; // READ_MEM16/EEPROM_READ 单次
const DEFAULT_RESPONSE_TIMEOUT_MS = 2000;
// 修改引脚/频率会重建总线：ESP32 固件内部 end() + 1s 延时 + configure()，
// 默认 2s 在 BLE 分片上很可能不够，因此设置类命令单独使用更长的超时。
const BUS_CONFIG_TIMEOUT_MS = 5000;

/** ESP32 控制台 UART0 占用 GPIO43/44，固件同样拒绝这两个引脚。 */
const RESERVED_BUS_PINS = new Set([43, 44]);

/** REPORT_START / REPORT_STOP 的「全部任务」编号。 */
const REPORT_ALL_TASKS = 0xff;
/** 上报周期软上限：AR-1.0 建议 10 ms–60 s，只在发送前拦明显越界值。 */
const REPORT_PERIOD_MAX_MS = 60_000;

/** 流式泵的让位间隔：等待请求-应答完成时短暂休眠。 */
function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateBusPin(
  value: number,
  label: string,
  enforceReserved = true,
): void {
  if (!Number.isInteger(value) || value < 0 || value > 63) {
    throw new RangeError(`${label} 必须为 0–63 的整数引脚号。`);
  }
  if (enforceReserved && RESERVED_BUS_PINS.has(value)) {
    throw new RangeError(`${label} 不能使用 GPIO43/44（UART0 控制台）。`);
  }
}

function validateBusFrequency(value: number): void {
  if (!Number.isInteger(value) || value < 1000 || value > 1_000_000) {
    throw new RangeError(
      "I²C 频率必须为 1,000–1,000,000 Hz（1 kHz–1 MHz）。",
    );
  }
}

/** 校验一个上报任务槽位：越界在发送前就报错，不浪费一次往返。 */
function validateReportTask(task: I2cReportTask): void {
  validateReportTaskId(task.taskId);
  validateAddress(task.address);
  validateByte(task.register, "寄存器地址");
  if (
    !Number.isInteger(task.length) || task.length < 1 ||
    task.length > REPORT_LIMITS.length
  ) {
    throw new RangeError(`上报长度必须为 1–${REPORT_LIMITS.length} 字节。`);
  }
  if (
    !Number.isInteger(task.periodMs) || task.periodMs < 1 ||
    task.periodMs > REPORT_PERIOD_MAX_MS
  ) {
    throw new RangeError(`上报周期必须为 1–${REPORT_PERIOD_MAX_MS} ms。`);
  }
  if (!Number.isInteger(task.count) || task.count < 0 || task.count > 0xffff) {
    throw new RangeError("上报帧数上限必须为 0–65,535 的整数（0 = 连续）。");
  }
  if (!Number.isInteger(task.flags) || task.flags < 0 || task.flags > 0xff) {
    throw new RangeError("上报能力位必须为 0–255 的整数。");
  }
}

function validateReportTaskId(taskId: number): void {
  if (!Number.isInteger(taskId) || taskId < 0 || taskId > 0xff) {
    throw new RangeError("上报任务编号必须为 0–255 的整数（0xFF = 全部）。");
  }
}

/**
 * 用固件上报的自由引脚表校验 CONFIG 目标引脚。
 * 只有明确声明 SDA/SCL 能力的 GPIO 才放行；保留引脚按固件原因报错。
 */
function validatePinAgainstCaps(
  caps: I2cCapabilities | null,
  gpio: number,
  signal: "SDA" | "SCL",
): void {
  if (!caps || caps.pins.length === 0) return;
  const pin = caps.pins.find((item) => item.gpio === gpio);
  if (!pin) {
    throw new RangeError(
      `GPIO${gpio} 不在固件上报的可用引脚表中（${caps.name || "未知芯片"}）。`,
    );
  }
  if (pin.reserved) {
    throw new RangeError(
      `GPIO${gpio} 不能用于 I²C：${pin.reasonText}。`,
    );
  }
  const usable = signal === "SDA" ? pin.sda : pin.scl;
  if (!usable) {
    throw new RangeError(
      `GPIO${gpio} 未被固件声明为可用的 ${signal} 引脚。`,
    );
  }
}

/** 频率必须落在固件上报范围内；未上报能力时退回通用范围。 */
function validateFrequencyAgainstCaps(
  caps: I2cCapabilities | null,
  freqHz: number,
): void {
  if (!caps) return;
  if (freqHz < caps.freqMin || freqHz > caps.freqMax) {
    throw new RangeError(
      `I²C 频率必须为 ${caps.freqMin}–${caps.freqMax} Hz（固件上报范围）。`,
    );
  }
}

/** CH341 EEPROM type(0..12) → 固件 model(1..14，Console -m 编号) 假设线性 +1。 */
function eepromModel(type: number): number {
  return type + 1;
}

export interface SerialBackendOptions {
  responseTimeoutMs?: number;
  /** 修改引脚/频率的超时；固件重建总线约 1 秒，默认 5000ms。 */
  busConfigTimeoutMs?: number;
  /** 通用传输管理器；默认注册 Web Serial Provider。 */
  manager?: TransportManager;
  /** 测试注入：返回已打开的传输层，替代真实 Provider。 */
  transportFactory?: (
    deviceId: string,
    options: TransportOpenOptions,
  ) => Promise<ByteTransport>;
  /** 测试注入：替代浏览器授权端口枚举。 */
  listPorts?: () => Promise<TransportDevice[]>;
}

/** 兼容旧命名。 */
export type LwpktBackendOptions = SerialBackendOptions;

function createManager(options: SerialBackendOptions): TransportManager {
  if (options.manager) return options.manager;
  const manager = new TransportManager();
  if (options.transportFactory) {
    const factory = options.transportFactory;
    manager.register({
      kind: "serial",
      label: "串口",
      supportsBaudRate: true,
      isAvailable: () => true,
      listDevices: options.listPorts ?? (() => Promise.resolve([])),
      requestDevice: () =>
        Promise.reject(new Error("测试环境不支持设备授权。")),
      open: (deviceId, openOptions) => factory(deviceId, openOptions),
    });
  } else {
    manager.register(new WebSerialProvider());
    manager.register(new BleNusProvider());
  }
  return manager;
}

export class LwpktBackend implements I2cBackend {
  #options: SerialBackendOptions;
  #manager: TransportManager;
  #transport: ByteTransport | null = null;
  #decoder = new FrameDecoder();
  #kind: TransportKind | null = null;
  #port: string | null = null;
  #baud: number | null = null;
  #busy = false;
  #frames = 0;
  #unsubscribeClosed: (() => void) | null = null;
  /** CAPS 缓存：连接后读取一次，用于校验 CONFIG 上报的引脚与频率范围。 */
  #capabilities: I2cCapabilities | null = null;
  /** 流式状态：设备主动上报（STREAM_*）是否进行中。 */
  #streaming = false;
  #streamFrames = 0;
  #streamListeners = new Set<(frame: I2cStreamFrame) => void>();
  /** 周期自动上报（REPORT_*）是否进行中；与 #streaming 互斥。 */
  #reporting = false;
  #reportFrames = 0;
  #reportListeners = new Set<(frame: I2cReportFrame) => void>();
  /** 已单独启动的任务槽位：与 #reportAllStarted 一起决定接收泵何时退出。 */
  #reportRunning = new Set<number>();
  #reportAllStarted = false;
  /** 接收泵代号：STREAM 与 REPORT 共用同一个泵，递增即让旧循环退出。 */
  #receivePumpId = 0;
  /** 帧读写互斥链：请求-应答与接收泵共用，避免争抢字节流。 */
  #lockChain: Promise<unknown> = Promise.resolve();

  constructor(options: SerialBackendOptions = {}) {
    this.#options = options;
    this.#manager = createManager(options);
  }

  get kind(): TransportKind | null {
    return this.#kind;
  }

  status(): BackendStatus {
    return {
      connected: this.#transport !== null,
      kind: this.#kind,
      port: this.#port,
      baud: this.#baud,
      crcErrors: this.#decoder.stats.crcErrors,
      frames: this.#frames,
    };
  }

  async listDevices(
    kind: TransportKind = "serial",
  ): Promise<SerialPortSummary[]> {
    return await this.#manager.listDevices(kind);
  }

  transports(): TransportDescriptor[] {
    return this.#manager.descriptors();
  }

  subscribe(listener: (event: TransportEvent) => void): () => void {
    return this.#manager.subscribe(listener);
  }

  async requestDevice(
    kind: TransportKind = "serial",
  ): Promise<SerialPortSummary> {
    return await this.#manager.requestDevice(kind);
  }

  async connect(request: ConnectRequest): Promise<BackendStatus>;
  /** 兼容旧调用：默认按串口连接。 */
  async connect(portId: string, baud: number): Promise<BackendStatus>;
  async connect(
    requestOrPort: ConnectRequest | string,
    baud?: number,
  ): Promise<BackendStatus> {
    const request: ConnectRequest = typeof requestOrPort === "string"
      ? { kind: "serial", deviceId: requestOrPort, baudRate: baud }
      : requestOrPort;

    if (this.#transport !== null) await this.disconnect();

    const kind = request.kind;
    const label = kind === "serial" ? "串口" : kind === "ble" ? "蓝牙" : "USB";
    const baudRate = kind === "serial"
      ? validateBaud(request.baudRate ?? DEFAULT_BAUD)
      : null;

    let active;
    try {
      active = await this.#manager.open(kind, request.deviceId, {
        baudRate: baudRate ?? undefined,
        chunkSize: request.chunkSize,
        writeDelayMs: request.writeDelayMs,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`无法连接${label}设备：${detail}`);
    }

    this.#transport = active.transport;
    this.#kind = active.kind;
    this.#port = active.device.label;
    this.#baud = baudRate;
    this.#decoder.reset();
    this.#unsubscribeClosed = active.transport.onClosed?.(() => {
      this.#clearConnection();
    }) ?? null;

    try {
      // ECHO 握手：验证分帧与 CRC（docs/05 §9 推荐流程第 1 步）
      await this.#request(CMD.ECHO, Uint8Array.of(0xde, 0xad), "链路握手");
    } catch (error) {
      this.#clearConnection();
      await this.#manager.close();
      if (error instanceof LwpktError) {
        throw new Error(`${label}已连接但握手失败：${error.message}`);
      }
      throw error;
    }
    return this.status();
  }

  async disconnect(): Promise<BackendStatus> {
    if (this.#streaming) {
      try {
        await this.stopStream();
      } catch {
        // 断开流程不因停止失败而中断，本地状态由 #clearConnection 收口。
      }
    }
    if (this.#reporting) {
      try {
        await this.stopReport(REPORT_ALL_TASKS);
      } catch {
        // 同上：固件不应答也不阻塞断开。
      }
    }
    this.#clearConnection();
    await this.#manager.close();
    return this.status();
  }

  async close(): Promise<void> {
    await this.disconnect();
  }

  #clearConnection(): void {
    this.#unsubscribeClosed?.();
    this.#unsubscribeClosed = null;
    this.#transport = null;
    this.#kind = null;
    this.#port = null;
    this.#baud = null;
    this.#capabilities = null;
    this.#streaming = false;
    this.#streamFrames = 0;
    this.#reporting = false;
    this.#reportFrames = 0;
    this.#reportRunning.clear();
    this.#reportAllStarted = false;
    this.#reportListeners.clear();
    this.#receivePumpId += 1;
  }

  async scan(start = 0x08, end = 0x77) {
    if (
      !Number.isInteger(start) || !Number.isInteger(end) ||
      start < 0x08 || end > 0x77 || start > end
    ) {
      throw new RangeError("扫描范围必须满足 0x08 ≤ 起始地址 ≤ 结束地址 ≤ 0x77。");
    }
    const data = await this.#request(CMD.SCAN, new Uint8Array(0), "总线扫描");
    const { addresses } = decodeScanResp(data);
    return {
      addresses: addresses.filter((item): item is number =>
        typeof item === "number" && item >= start && item <= end
      ),
      start,
      end,
    };
  }

  async readBusConfig(): Promise<I2cBusConfig> {
    const data = await this.#request(
      CMD.CONFIG,
      encodeConfigQuery(),
      "读取 I²C 配置",
    );
    return decodeConfigResp(data);
  }

  async configureBus(patch: I2cBusConfigPatch): Promise<I2cBusConfig> {
    const normalized: I2cBusConfigPatch = {};
    // 固件上报了引脚表时以表为准（各 ESP32 型号的 UART/USB 引脚不同）；
    // 旧固件没有能力表，才退回 43/44 的硬编码保护。
    const enforceReserved = !this.#capabilities ||
      this.#capabilities.pins.length === 0;
    if (patch.sda !== undefined) {
      validateBusPin(patch.sda, "SDA", enforceReserved);
      validatePinAgainstCaps(this.#capabilities, patch.sda, "SDA");
      normalized.sda = patch.sda;
    }
    if (patch.scl !== undefined) {
      validateBusPin(patch.scl, "SCL", enforceReserved);
      validatePinAgainstCaps(this.#capabilities, patch.scl, "SCL");
      normalized.scl = patch.scl;
    }
    if (patch.freqHz !== undefined) {
      validateBusFrequency(patch.freqHz);
      validateFrequencyAgainstCaps(this.#capabilities, patch.freqHz);
      normalized.freqHz = patch.freqHz;
    }
    if (
      normalized.sda !== undefined && normalized.scl !== undefined &&
      normalized.sda === normalized.scl
    ) {
      throw new RangeError("SDA 与 SCL 不能使用同一个引脚。");
    }
    if (Object.keys(normalized).length === 0) {
      throw new RangeError("至少需要提供 SDA、SCL 或频率中的一项。");
    }
    const data = await this.#request(
      CMD.CONFIG,
      encodeConfigSet(normalized),
      "设置 I²C 参数",
      this.#busConfigTimeout(),
    );
    return decodeConfigResp(data);
  }

  /**
   * 读取固件自报能力。旧固件对未知命令返回 ERR_ARG（或静默丢弃导致超时），
   * 两种情况都返回 null，让 UI 降级为 CONFIG 自由引脚模式。
   */
  async readBusCapabilities(): Promise<I2cCapabilities | null> {
    try {
      const data = await this.#request(
        CMD.CAPS,
        encodeCapsQuery(),
        "读取芯片能力",
      );
      const capabilities = decodeCapsResp(data);
      this.#capabilities = capabilities;
      return capabilities;
    } catch (error) {
      if (error instanceof LwpktError) {
        if (
          error.status === STATUS.ERR_ARG ||
          error.status === STATUS.ERR_UNSUPPORTED ||
          error.kind === "timeout"
        ) {
          this.#capabilities = null;
          return null;
        }
      }
      throw error;
    }
  }

  async selectBus(
    busId: number,
    schemeId: number,
    freqHz = 0,
  ): Promise<I2cBusConfig> {
    if (!Number.isInteger(busId) || busId < 1 || busId > 255) {
      throw new RangeError("I²C 实例编号必须为 1–255（1=I2C1）。");
    }
    if (!Number.isInteger(schemeId) || schemeId < 1 || schemeId > 255) {
      throw new RangeError("引脚方案编号必须为 1–255。");
    }
    if (freqHz !== 0) {
      validateBusFrequency(freqHz);
      validateFrequencyAgainstCaps(this.#capabilities, freqHz);
    }
    const data = await this.#request(
      CMD.BUS_SELECT,
      encodeBusSelect(busId, schemeId, freqHz),
      "切换 I²C 实例",
      this.#busConfigTimeout(),
    );
    return decodeBusSelectResp(data);
  }

  async swapBusPins(): Promise<I2cSwapResult> {
    const data = await this.#request(
      CMD.SWAP,
      new Uint8Array(0),
      "交换 SDA/SCL",
      this.#busConfigTimeout(),
    );
    return decodeSwapResp(data);
  }

  async recoverBus(): Promise<void> {
    await this.#request(
      CMD.RECOVER,
      new Uint8Array(0),
      "总线恢复",
      this.#busConfigTimeout(),
    );
  }

  async read(address: number, register: number): Promise<{ value: number }> {
    validateAddress(address);
    validateByte(register, "寄存器地址");
    const data = await this.#request(
      CMD.READ_REG,
      encodeReadReg(address, register),
      "读取寄存器",
    );
    const decoded = decodeReadRegResp(data);
    if (typeof decoded.value !== "number") {
      throw new LwpktError("READ_REG 应答缺少数据字节。", { kind: "frame" });
    }
    return { value: decoded.value };
  }

  async write(
    address: number,
    register: number,
    value: number,
  ): Promise<{ written: boolean }> {
    validateAddress(address);
    validateByte(register, "寄存器地址");
    validateByte(value, "写入值");
    await this.#request(
      CMD.WRITE_REG,
      encodeWriteReg(address, register, value),
      "写入寄存器",
    );
    return { written: true };
  }

  async readRegisters(
    address: number,
    start: number,
    length: number,
  ): Promise<number[]> {
    validateAddress(address);
    validateByte(start, "起始寄存器");
    if (
      !Number.isInteger(length) || length < 1 || start + length > 0x100
    ) {
      throw new RangeError("I²C 连续读取范围必须位于 0x00–0xFF。");
    }
    const values: number[] = [];
    let register = start;
    let remaining = length;
    while (remaining > 0) {
      const chunk = Math.min(remaining, MAX_BLOCK_LEN);
      const data = await this.#request(
        CMD.READ_BLOCK,
        encodeReadBlock(address, register, chunk),
        "连续读取",
      );
      values.push(...decodeReadBlockResp(data, "连续读取").bytes);
      register += chunk;
      remaining -= chunk;
    }
    return values;
  }

  /**
   * 与 CH341 transfer 对齐：writeHex 首字节为 8 位写地址（addr<<1），其余为寄存器前缀。
   * 前缀 0 字节→READ_RAW、1 字节→READ_BLOCK、≥2 字节→READ_MEM16；纯写走 WRITE_RAW。
   */
  async transfer(writeHex: string, readLength: number) {
    const writeBuffer = parseHex(writeHex);
    if (
      !Number.isInteger(readLength) || readLength < 0 ||
      readLength > 4096
    ) {
      throw new RangeError("读取长度必须为 0–4096 字节。");
    }
    if (writeBuffer.length === 0) {
      throw new RangeError("串口后端要求发送数据首字节为 8 位器件写地址。");
    }
    if (writeBuffer.length === 1 && readLength === 0) {
      throw new RangeError("发送或读取长度至少需要一个大于 0 的值。");
    }
    const firstWriteByte = writeBuffer[0];
    if (firstWriteByte === undefined) {
      throw new RangeError("串口后端要求发送数据首字节为 8 位器件写地址。");
    }
    const address = firstWriteByte >> 1;
    validateAddress(address);
    const prefix = writeBuffer.subarray(1);
    if (readLength === 0) {
      await this.#request(CMD.WRITE_RAW, encodeWriteRaw(address, prefix), "原始写入");
      return toTransferResult(new Uint8Array(0));
    }
    const bytes = await this.#readBurst(address, prefix, readLength, "原始传输");
    return toTransferResult(bytes);
  }

  /**
   * 与 CH341 streamI2C 对齐（MLX90614 控制器使用）：入参首字节是 8 位写地址，
   * 其后为寄存器/数据段；读回走 READ_BLOCK/READ_RAW，纯写走 WRITE_RAW。
   */
  async streamI2C(writeBytes: Uint8Array, readLength: number): Promise<number[]> {
    if (!(writeBytes instanceof Uint8Array) || writeBytes.length === 0) {
      throw new TypeError("命令流必须是非空的字节数组。");
    }
    if (!Number.isInteger(readLength) || readLength < 0 || readLength > 4096) {
      throw new RangeError("读取长度必须为 0–4096 字节。");
    }
    const firstWriteByte = writeBytes[0];
    if (firstWriteByte === undefined) {
      throw new TypeError("命令流必须是非空的字节数组。");
    }
    const address = firstWriteByte >> 1;
    validateAddress(address);
    const payload = writeBytes.subarray(1);
    if (readLength === 0) {
      if (payload.length === 0) {
        // 仅地址相位（探测）：用 PING 检查应答
        await this.#request(CMD.PING, encodePing(address), "地址探测");
        return [];
      }
      await this.#request(
        CMD.WRITE_RAW,
        encodeWriteRaw(address, payload),
        "命令流写入",
      );
      return [];
    }
    const bytes = await this.#readBurst(address, payload, readLength, "命令流读取");
    return [...bytes];
  }

  async eepromRead(type: number, address: number, length: number) {
    const chip = validateEeprom(type, address, length);
    await this.#openEeprom(chip.id, address, length);
    const buffer = new Uint8Array(length);
    let offset = address;
    let written = 0;
    while (written < length) {
      const chunk = Math.min(length - written, MAX_MEM16_LEN);
      const data = await this.#request(
        CMD.EEPROM_READ,
        encodeEepromRead(offset, chunk),
        "EEPROM 读取",
      );
      const bytes = decodeReadBlockResp(data, "EEPROM 读取").bytes;
      if (bytes.length !== chunk) {
        throw new LwpktError("EEPROM 应答长度与请求不符。", { kind: "frame" });
      }
      buffer.set(bytes, written);
      offset += chunk;
      written += chunk;
    }
    return toTransferResult(buffer);
  }

  async eepromWrite(type: number, address: number, writeHex: string) {
    const buffer = parseEepromWrite(type, address, writeHex);
    await this.#openEeprom(type, address, buffer.length);
    let offset = address;
    let sent = 0;
    while (sent < buffer.length) {
      const chunk = Math.min(buffer.length - sent, MAX_MEM16_LEN);
      await this.#request(
        CMD.EEPROM_WRITE,
        encodeEepromWrite(offset, buffer.subarray(sent, sent + chunk)),
        "EEPROM 写入",
      );
      offset += chunk;
      sent += chunk;
    }
    return { written: true };
  }

  /** 读突发：prefix 0→READ_RAW、1→READ_BLOCK（寄存器自增分片）、≥2→READ_MEM16。 */
  async #readBurst(
    address: number,
    prefix: Uint8Array,
    readLength: number,
    label: string,
  ): Promise<Uint8Array> {
    const out = new Uint8Array(readLength);
    let done = 0;
    if (prefix.length === 0) {
      while (done < readLength) {
        const chunk = Math.min(readLength - done, MAX_BLOCK_LEN);
        const data = await this.#request(
          CMD.READ_RAW,
          encodeReadRaw(address, chunk),
          label,
        );
        const bytes = decodeReadBlockResp(data, label).bytes;
        out.set(bytes.subarray(0, Math.min(bytes.length, chunk)), done);
        done += chunk;
      }
      return out;
    }
    if (prefix.length === 1) {
      const firstPrefix = prefix[0];
      if (firstPrefix === undefined) {
        throw new LwpktError("命令流缺少寄存器前缀。", { kind: "frame" });
      }
      let register = firstPrefix;
      while (done < readLength) {
        const chunk = Math.min(readLength - done, MAX_BLOCK_LEN);
        const data = await this.#request(
          CMD.READ_BLOCK,
          encodeReadBlock(address, register, chunk),
          label,
        );
        const bytes = decodeReadBlockResp(data, label).bytes;
        out.set(bytes.subarray(0, Math.min(bytes.length, chunk)), done);
        register = (register + chunk) & 0xff;
        done += chunk;
      }
      return out;
    }
    const high = prefix[0];
    const low = prefix[1];
    if (high === undefined || low === undefined) {
      throw new LwpktError("命令流缺少 16 位地址前缀。", { kind: "frame" });
    }
    let register16 = (high << 8) | low;
    while (done < readLength) {
      const chunk = Math.min(readLength - done, MAX_MEM16_LEN);
      const data = await this.#request(
        CMD.READ_MEM16,
        encodeReadMem16(address, register16, chunk),
        label,
      );
      const bytes = decodeReadBlockResp(data, label).bytes;
      out.set(bytes.subarray(0, Math.min(bytes.length, chunk)), done);
      register16 = (register16 + chunk) & 0xffff;
      done += chunk;
    }
    return out;
  }

  async #openEeprom(type: number, address: number, length: number): Promise<void> {
    const model = eepromModel(type);
    const deviceAddress = 0x50; // 24Cxx 默认器件地址（A2/A1/A0=0）
    const data = await this.#request(
      CMD.EEPROM_OPEN,
      encodeEepromOpen(deviceAddress, model),
      "EEPROM 打开",
    );
    const geometry = decodeEepromOpenResp(data);
    if (!geometry.ack) {
      const chip = EEPROM_TYPES.find((item) => item.id === type);
      throw new LwpktError(
        `${chip?.name ?? "EEPROM"} 在 0x${deviceAddress.toString(16)} 无应答。`,
        { status: STATUS.ERR_NOACK, kind: "status" },
      );
    }
    if (address + length > geometry.capacity) {
      throw new RangeError(
        `读写范围超出固件报告的容量（${geometry.capacity} 字节）。`,
      );
    }
  }

  /** 当前传输在提示文案中的称呼；未连接时沿用旧串口措辞。 */
  #transportLabel(): string {
    if (this.#kind === "ble") return "蓝牙";
    if (this.#kind === "usb") return "USB";
    return "串口";
  }

  /** 修改引脚/频率的应答超时：固件结束并重建总线需要约 1 秒。 */
  #busConfigTimeout(): number {
    return this.#options.busConfigTimeoutMs ?? BUS_CONFIG_TIMEOUT_MS;
  }

  /**
   * 异步请求-应答：发送一帧并等待同 CMD 应答；#busy 保证串行互斥。
   * 浏览器传输无法清 OS 缓冲，收到非期望 CMD 的帧时跳过而非报错；
   * 流式运行期间收到的 STREAM_DATA 帧在此处就地分发，不打断等待。
   * waitBusy=true 时（stopStream 收口用）不拒绝在途请求，而是等闸门释放后再发。
   */
  async #request(
    cmd: number,
    payload: Uint8Array,
    label: string,
    timeoutMs?: number,
    waitBusy = false,
  ): Promise<Uint8Array> {
    const transport = this.#transport;
    if (transport === null) {
      throw new Error(`请先连接${this.#transportLabel()}后端。`);
    }
    if (this.#busy) {
      if (!waitBusy) {
        throw new Error(`${this.#transportLabel()}已有请求在进行中，请稍候。`);
      }
      await this.#waitBusyReleased();
    }
    this.#busy = true;
    try {
      return await this.#withLock(async () => {
        await transport.purgeInput();
        this.#decoder.reset();
        const request = buildFrame(cmd, payload);
        await transport.write(request);
        const timeout = timeoutMs ?? this.#options.responseTimeoutMs ??
          DEFAULT_RESPONSE_TIMEOUT_MS;
        const deadline = Date.now() + timeout;
        while (Date.now() <= deadline) {
          const frames = this.#decoder.push(await transport.read(10));
          for (const frame of frames) {
            if (frame.from !== ADDR_DEVICE || frame.to !== ADDR_HOST) continue;
            if (frame.cmd === CMD.STREAM_DATA) {
              this.#dispatchStreamFrame(frame.data);
              continue;
            }
            if (frame.cmd === CMD.REPORT_DATA) {
              this.#dispatchReportFrame(frame.data);
              continue;
            }
            if (frame.cmd !== cmd) continue;
            this.#frames += 1;
            return frame.data;
          }
        }
        throw new LwpktError(
          `${label}超时：${this.#transportLabel()}在 ${timeout}ms 内未收到应答帧（最后发送 ${toHex(request)}）。`,
          { kind: "timeout" },
        );
      });
    } finally {
      this.#busy = false;
    }
  }

  /**
   * 等待在途请求释放 #busy 闸门；最长约 3 s，超时抛错由调用侧吞掉。
   * 切模式时 configure 与 stopStream 几乎必然相撞：STOP 必须等 configure 完成后发出，
   * 否则固件收不到 STOP 会持续推送，下次 STREAM_START 将被固件以“已在推送中”拒绝。
   */
  async #waitBusyReleased(): Promise<void> {
    const deadline = Date.now() + 3000;
    while (this.#busy) {
      if (Date.now() > deadline) {
        throw new Error(`${this.#transportLabel()}总线持续忙碌，未能发出停止请求。`);
      }
      await sleepMs(20);
    }
  }

  /**
   * 帧读写互斥链：请求-应答与流式泵共用一把锁，避免两者争抢同一字节流。
   * 先到先得，后到者排队；出错不阻断后续等待者。
   */
  #withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#lockChain.then(fn, fn);
    this.#lockChain = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * 启动设备主动上报：下发 STREAM_START 后开启接收泵，
   * 固件按周期/中断读寄存器并以 STREAM_DATA 主动推帧，上位机不再逐次发读命令。
   */
  async startStream(request: I2cStreamRequest): Promise<I2cStreamInfo> {
    if (this.#streaming) {
      throw new Error("流式采集已在进行中，请先停止。");
    }
    if (this.#reporting) {
      throw new Error("周期自动上报运行中，请先停止 REPORT 再启动流式采集。");
    }
    const pinError = validateIntPin(request.intPin, {
      machine: this.#capabilities?.machine ?? "unknown",
      pins: this.#capabilities?.pins ?? [],
    });
    if (pinError) throw new Error(pinError);
    const data = await this.#request(
      CMD.STREAM_START,
      encodeStreamStart(request),
      "流式启动",
    );
    const info = decodeStreamStartResp(data);
    const mode: "poll" | "int" = info.mode === "int" ? "int" : "poll";
    this.#streaming = true;
    this.#streamFrames = 0;
    void this.#runReceivePump();
    const pinText = formatIntPin(
      request.intPin,
      this.#capabilities?.machine ?? "unknown",
    );
    const modeText = mode === "int"
      ? info.intSupported === false
        ? `固件回退为定时推送（未声明中断支持），引脚 ${pinText} 仅供参考`
        : `中断触发推送已生效（${pinText}）：页面无需再下发读命令`
      : `定时推送已生效（${info.periodMs === 0 ? "尽可能快" : `${info.periodMs} ms`}）`;
    return {
      supported: true,
      mode,
      periodMs: info.periodMs,
      message: `${modeText}。`,
    };
  }

  /** 停止主动上报，返回固件侧本次累计推送帧数。 */
  async stopStream(): Promise<{ frames: number }> {
    if (!this.#streaming) return { frames: 0 };
    this.#streaming = false;
    const data = await this.#request(
      CMD.STREAM_STOP,
      encodeStreamStop(),
      "流式停止",
      undefined,
      true,
    );
    const { frames } = decodeStreamStopResp(data);
    this.#streamFrames = 0;
    // REPORT 仍在运行时不能杀泵，否则自动上报帧会无人收取。
    if (!this.#reporting) this.#receivePumpId += 1;
    return { frames };
  }

  /** 订阅主动上报帧；返回取消订阅函数。 */
  subscribeStream(listener: (frame: I2cStreamFrame) => void): () => void {
    this.#streamListeners.add(listener);
    return () => {
      this.#streamListeners.delete(listener);
    };
  }

  /**
   * 周期自动上报（AR-1.0）：写入一个任务槽位。
   * 固件对运行中的槽位回 ERR_ARG，调用方需先 `stopReport(taskId)`；
   * 应答里的 `periodMs` 是钳制后的实际值，后续时间轴以它为准。
   */
  async configureReport(task: I2cReportTask): Promise<I2cReportConfig> {
    validateReportTask(task);
    const data = await this.#request(
      CMD.REPORT_CONFIG,
      encodeReportConfig({
        ...task,
        count: task.count ?? 0,
        flags: task.flags ?? 0,
      }),
      "自动上报配置",
    );
    return decodeReportConfigResp(data) as I2cReportConfig;
  }

  /**
   * 启动任务表（默认 0xFF = 全部已配置任务）。
   * 与 `STREAM_*` 互斥：固件也应对同时开启回 ERR_ARG。
   */
  async startReport(taskId: number = REPORT_ALL_TASKS): Promise<I2cReportInfo> {
    if (this.#streaming) {
      throw new Error("中断推送运行中，请先停止 STREAM 再启动自动上报。");
    }
    validateReportTaskId(taskId);
    const data = await this.#request(
      CMD.REPORT_START,
      encodeReportStart(taskId),
      "自动上报启动",
    );
    const info = decodeReportStartResp(data) as I2cReportInfo;
    this.#reporting = true;
    if (taskId === REPORT_ALL_TASKS) {
      this.#reportAllStarted = true;
    } else {
      this.#reportRunning.add(taskId);
    }
    void this.#runReceivePump();
    return info;
  }

  /**
   * 停止任务表（默认全部）并返回固件侧帧数统计。
   * 与 `stopStream` 同理使用 waitBusy：允许等完在途的读/写请求再发。
   */
  async stopReport(
    taskId: number = REPORT_ALL_TASKS,
  ): Promise<I2cReportStopped[]> {
    if (!this.#reporting) return [];
    validateReportTaskId(taskId);
    const data = await this.#request(
      CMD.REPORT_STOP,
      encodeReportStop(taskId),
      "自动上报停止",
      undefined,
      true,
    );
    const { tasks } = decodeReportStopResp(data) as {
      tasks: I2cReportStopped[];
    };
    for (const item of tasks) this.#reportRunning.delete(item.taskId);
    const allStopped = taskId === REPORT_ALL_TASKS ||
      (this.#reportRunning.size === 0 && !this.#reportAllStarted);
    if (allStopped) this.#stopReportPump();
    return tasks;
  }

  /** 查询任务表快照（固件只回内存，不访问 I²C）。 */
  async queryReport(): Promise<I2cReportStatus> {
    const data = await this.#request(
      CMD.REPORT_STATUS,
      encodeReportStatus(),
      "自动上报状态",
    );
    return decodeReportStatusResp(data) as I2cReportStatus;
  }

  /** 停止全部并清空任务表，返回被清空的槽位数。 */
  async clearReport(): Promise<number> {
    const data = await this.#request(
      CMD.REPORT_CLEAR,
      encodeReportClear(),
      "自动上报清空",
      undefined,
      true,
    );
    const { cleared } = decodeReportClearResp(data);
    this.#stopReportPump();
    this.#reportRunning.clear();
    this.#reportAllStarted = false;
    return cleared;
  }

  /** 订阅 REPORT_DATA 帧；返回取消订阅函数。 */
  subscribeReport(listener: (frame: I2cReportFrame) => void): () => void {
    this.#reportListeners.add(listener);
    return () => {
      this.#reportListeners.delete(listener);
    };
  }

  /** 让接收泵退出（仅当 STREAM 也不在运行时），并清空本地统计。 */
  #stopReportPump(): void {
    this.#reporting = false;
    this.#reportFrames = 0;
    if (!this.#streaming) this.#receivePumpId += 1;
  }

  /** 解析 STREAM_DATA 并广播给订阅者；仅在流式运行中生效。 */
  #dispatchStreamFrame(data: Uint8Array): void {
    if (!this.#streaming) return;
    let decoded: { address: number; seq: number; bytes: Uint8Array };
    try {
      decoded = decodeStreamData(data);
    } catch {
      return;
    }
    this.#streamFrames += 1;
    const frame: I2cStreamFrame = {
      address: decoded.address,
      seq: decoded.seq,
      bytes: [...decoded.bytes],
      receivedAt: Date.now(),
    };
    for (const listener of this.#streamListeners) {
      try {
        listener(frame);
      } catch {
        // 监听器异常不影响接收泵。
      }
    }
  }

  /** 解析 REPORT_DATA 并广播给订阅者；仅在自动上报运行中生效。 */
  #dispatchReportFrame(data: Uint8Array): void {
    if (!this.#reporting) return;
    let decoded: ReturnType<typeof decodeReportData>;
    try {
      decoded = decodeReportData(data);
    } catch {
      return;
    }
    this.#reportFrames += 1;
    const frame: I2cReportFrame = {
      taskId: decoded.taskId,
      address: decoded.address,
      seq: decoded.seq,
      length: decoded.length,
      atMs: decoded.atMs,
      bytes: [...decoded.bytes],
      receivedAt: Date.now(),
    };
    for (const listener of this.#reportListeners) {
      try {
        listener(frame);
      } catch {
        // 监听器异常不影响接收泵。
      }
    }
  }

  /**
   * 接收泵：在没有请求-应答时每轮读一次传输（≤10ms，不长时间占锁），
   * 把 STREAM_DATA / REPORT_DATA 帧分发出去；请求-应答优先（#busy 时让位）。
   * STREAM 与 REPORT 共用同一个泵与同一把锁，不新开第二个泵。
   */
  async #runReceivePump(): Promise<void> {
    this.#receivePumpId += 1;
    const pumpId = this.#receivePumpId;
    while (
      (this.#streaming || this.#reporting) && pumpId === this.#receivePumpId
    ) {
      const transport = this.#transport;
      if (transport === null) {
        this.#streaming = false;
        this.#reporting = false;
        break;
      }
      if (this.#busy) {
        await sleepMs(3);
        continue;
      }
      try {
        await this.#withLock(async () => {
          if (
            !(this.#streaming || this.#reporting) ||
            pumpId !== this.#receivePumpId
          ) {
            return;
          }
          if (this.#busy) return;
          const frames = this.#decoder.push(await transport.read(10));
          for (const frame of frames) {
            if (frame.from !== ADDR_DEVICE || frame.to !== ADDR_HOST) continue;
            if (frame.cmd === CMD.STREAM_DATA) {
              this.#dispatchStreamFrame(frame.data);
            } else if (frame.cmd === CMD.REPORT_DATA) {
              this.#dispatchReportFrame(frame.data);
            }
          }
        });
      } catch {
        // 传输异常（拔出/断开）时短暂退避，由外部断开事件收口。
        await sleepMs(10);
      }
    }
  }
}

/** 供 UI 解析 PING 应答（保留导出，避免 lwpkt 解码器被 tree-shake 误删）。 */
export { decodePingResp };

/** 兼容旧命名：实现已与传输方式解耦，内部类型为 LwpktBackend。 */
export { LwpktBackend as SerialLwpktBackend };
