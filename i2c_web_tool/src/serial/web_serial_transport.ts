// Web Serial 传输层：把浏览器的 SerialPort 异步流包装为通用 ByteTransport。
//
// 与桌面版的关键差异：
//   - 浏览器 reader.read() 会一直挂起，无法同步阻塞等待；
//     因此启动后台读泵把数据搬进 ByteQueue，read(deadlineMs) 只查队列，超时返回空数组；
//   - 没有 PurgeComm 等 OS 缓冲清理能力，purgeInput 只能丢弃本地队列，
//     迟到的旧应答由 serial_lwpkt 的"命令不匹配则跳过"兜底；
//   - 端口没有 COM 名，只能用 VID/PID 生成展示名。
//
// 本文件同时实现 WebSerialProvider，使 TransportManager 可以用统一接口
// 管理串口、BLE 以及未来的 WebUSB。
import type {
  ByteTransport,
  TransportDevice,
  TransportOpenOptions,
  TransportProvider,
} from "../transport/types.ts";
import { ByteQueue } from "../transport/byte_queue.ts";

/** 兼容旧命名：传输层只要求一个异步字节流，不关心具体硬件。 */
export type SerialTransport = ByteTransport;

/** Web Serial 的最小类型声明（lib.dom 未包含该 API，避免引入额外依赖）。 */
export interface SerialPortInfoLike {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface WebSerialPortLike {
  open(options: {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: "none" | "even" | "odd";
    flowControl?: "none" | "hardware";
    bufferSize?: number;
  }): Promise<void>;
  close(): Promise<void>;
  getInfo?(): SerialPortInfoLike;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
}

export interface WebSerialLike {
  getPorts(): Promise<WebSerialPortLike[]>;
  requestPort(options?: { filters?: unknown[] }): Promise<WebSerialPortLike>;
  addEventListener?(type: "connect" | "disconnect", listener: () => void): void;
  removeEventListener?(
    type: "connect" | "disconnect",
    listener: () => void,
  ): void;
}

/** 已授权端口的注册项：id 稳定，port 用于真正打开。 */
export interface PortEntry {
  id: string;
  label: string;
  port: WebSerialPortLike;
}

const registry = new Map<string, PortEntry>();
let nextId = 1;

/** 当前浏览器是否提供 Web Serial API（不抛错，供能力检测使用）。 */
export function hasSerialApi(): boolean {
  const serial = (globalThis.navigator as unknown as { serial?: WebSerialLike })
    ?.serial;
  return Boolean(serial && typeof serial.getPorts === "function");
}

/** 取 navigator.serial；缺失时给出可操作的提示（需 https 或 localhost + Chromium）。 */
export function getSerialApi(): WebSerialLike {
  const serial = (globalThis.navigator as unknown as { serial?: WebSerialLike })
    ?.serial;
  if (!serial || typeof serial.getPorts !== "function") {
    throw new Error(
      "当前浏览器不支持 Web Serial API：请使用 Chrome/Edge 等 Chromium 内核浏览器，并通过 https 或 localhost 访问。",
    );
  }
  return serial;
}

function describe(port: WebSerialPortLike, index: number): string {
  const info = port.getInfo?.() ?? {};
  const vid = info.usbVendorId?.toString(16).toUpperCase().padStart(4, "0");
  const pid = info.usbProductId?.toString(16).toUpperCase().padStart(4, "0");
  if (vid && pid) return `USB 串口 (VID:${vid} PID:${pid})`;
  return `串口设备 #${index + 1}`;
}

function toDevice(entry: PortEntry): TransportDevice {
  return {
    id: entry.id,
    label: entry.label,
    detail: entry.port.getInfo?.().usbVendorId !== undefined
      ? "Web Serial"
      : undefined,
  };
}

function register(port: WebSerialPortLike, index: number): PortEntry {
  for (const entry of registry.values()) {
    if (entry.port === port) return entry;
  }
  const entry = { id: `port-${nextId++}`, label: describe(port, index), port };
  registry.set(entry.id, entry);
  return entry;
}

/** 刷新浏览器已授权的端口列表（navigator.serial.getPorts）。 */
export async function refreshPorts(): Promise<PortEntry[]> {
  const ports = await getSerialApi().getPorts();
  return ports.map((port, index) => register(port, index));
}

/** 弹出浏览器端口选择框（必须在用户手势中调用）。 */
export async function requestPort(): Promise<PortEntry> {
  const port = await getSerialApi().requestPort();
  return register(port, registry.size);
}

export function getPortEntry(id: string): PortEntry | undefined {
  return registry.get(id);
}

/** 监听浏览器串口热插拔事件，返回取消监听的函数。 */
export function watchPortEvents(
  onChange: (type: "connect" | "disconnect") => void,
): () => void {
  let serial: WebSerialLike;
  try {
    serial = getSerialApi();
  } catch {
    return () => {};
  }
  const onConnect = () => onChange("connect");
  const onDisconnect = () => onChange("disconnect");
  serial.addEventListener?.("connect", onConnect);
  serial.addEventListener?.("disconnect", onDisconnect);
  return () => {
    serial.removeEventListener?.("connect", onConnect);
    serial.removeEventListener?.("disconnect", onDisconnect);
  };
}

/** 基于 Web Serial 的传输实现。 */
export class WebSerialTransport implements ByteTransport {
  #port: WebSerialPortLike;
  #baudRate: number;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  #queue = new ByteQueue();
  #closed = false;
  #pump: Promise<void> | null = null;
  #closedListeners = new Set<() => void>();

  constructor(port: WebSerialPortLike, baudRate: number) {
    this.#port = port;
    this.#baudRate = baudRate;
  }

  /** 打开端口并启动后台读泵。 */
  async open(): Promise<void> {
    await this.#port.open({
      baudRate: this.#baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
      bufferSize: 4096,
    });
    try {
      const readable = this.#port.readable;
      const writable = this.#port.writable;
      if (!readable || !writable) {
        throw new Error("串口已打开但读写流不可用，请重新插拔设备后重试。");
      }
      this.#reader = readable.getReader();
      this.#writer = writable.getWriter();
      this.#pump = this.#readLoop();
    } catch (error) {
      // port.open() 已成功时，后续取流失败也必须关闭端口，避免半开占用。
      await this.close();
      throw error;
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    const writer = this.#writer;
    if (!writer) throw new Error("串口尚未打开。");
    await writer.write(bytes);
  }

  async read(deadlineMs: number): Promise<Uint8Array> {
    return await this.#queue.read(deadlineMs);
  }

  async purgeInput(): Promise<void> {
    this.#queue.clear();
  }

  onClosed(listener: () => void): () => void {
    if (this.#closed) {
      queueMicrotask(listener);
      return () => {};
    }
    this.#closedListeners.add(listener);
    return () => {
      this.#closedListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#queue.close();
    this.#closedListeners.clear();
    try {
      await this.#reader?.cancel();
    } catch {
      // 端口已断开时 cancel 可能抛错，忽略
    }
    try {
      await this.#pump;
    } catch {
      // 读泵结束异常不影响关闭流程
    }
    try {
      this.#reader?.releaseLock();
    } catch {
      // 已释放
    }
    this.#reader = null;
    try {
      await this.#writer?.close();
    } catch {
      // 写入端可能已因断开而报错
    }
    try {
      this.#writer?.releaseLock();
    } catch {
      // 已释放
    }
    this.#writer = null;
    try {
      await this.#port.close();
    } catch {
      // 设备已拔出时 close 会抛错
    }
  }

  /** 后台读泵：持续消费 readable，把字节放入队列并唤醒等待者。 */
  async #readLoop(): Promise<void> {
    const reader = this.#reader;
    if (!reader) return;
    try {
      while (!this.#closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) this.#queue.push(value);
      }
    } catch {
      // 端口关闭 / 拔出 / cancel：读泵退出
    } finally {
      this.#queue.close();
      if (!this.#closed) this.#emitClosed();
    }
  }

  #emitClosed(): void {
    const listeners = [...this.#closedListeners];
    this.#closedListeners.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // 订阅者异常不影响传输层清理。
      }
    }
  }
}

/** 串口 Provider：把端口注册表、授权与打开流程收口为统一接口。 */
export class WebSerialProvider implements TransportProvider {
  readonly kind = "serial" as const;
  readonly label = "串口";
  readonly supportsBaudRate = true;

  isAvailable(): boolean {
    return hasSerialApi();
  }

  async listDevices(): Promise<TransportDevice[]> {
    const entries = await refreshPorts();
    return entries.map(toDevice);
  }

  async requestDevice(): Promise<TransportDevice> {
    return toDevice(await requestPort());
  }

  async open(
    deviceId: string,
    options: TransportOpenOptions,
  ): Promise<ByteTransport> {
    const entry = getPortEntry(deviceId);
    if (!entry) {
      throw new RangeError("端口不存在或尚未授权，请重新选择串口。");
    }
    const transport = new WebSerialTransport(
      entry.port,
      options.baudRate ?? 115200,
    );
    await transport.open();
    return transport;
  }

  watch(
    onChange: (change: "connect" | "disconnect") => void,
  ): () => void {
    return watchPortEvents(onChange);
  }
}
