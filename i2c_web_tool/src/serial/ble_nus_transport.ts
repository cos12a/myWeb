// BLE NUS（Nordic UART Service）传输层。
//
// 固件把 UART 透传映射到标准 NUS 特征：
//   Service 6e400001-b5a3-f393-e0a9-e50e24dcca9e
//   Write   6e400002-...（主机 → 设备，对应固件 RX）
//   Notify  6e400003-...（设备 → 主机，对应固件 TX）
//
// 对上层来说它只是另一个 ByteTransport：write 分片发送，read 从共享
// ByteQueue 取通知数据，因此 LWPKT 后端和器件控制器完全不需要感知 BLE。
import type {
  ByteTransport,
  TransportDevice,
  TransportOpenOptions,
  TransportProvider,
} from "../transport/types.ts";
import { ByteQueue } from "../transport/byte_queue.ts";

export const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
/** 主机写入的特征（固件侧 RX）。 */
export const NUS_WRITE_CHARACTERISTIC =
  "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
/** 设备通知的特征（固件侧 TX）。 */
export const NUS_NOTIFY_CHARACTERISTIC =
  "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

/** 设备名过滤前缀：浏览器选择框只列出名称以该前缀开头的 BLE 设备。 */
export const BLE_DEVICE_NAME_PREFIX = "BUS";

const DEFAULT_CHUNK_SIZE = 20;
const MAX_CHUNK_SIZE = 20;

/** Web Bluetooth 的最小类型声明，避免依赖各浏览器不一致的全局类型。 */
export interface BluetoothGATTCharacteristicLike {
  value?: DataView | null;
  properties?: {
    write?: boolean;
    writeWithoutResponse?: boolean;
    notify?: boolean;
    indicate?: boolean;
  };
  maxWriteValueLength?: number;
  startNotifications?(): Promise<BluetoothGATTCharacteristicLike>;
  stopNotifications?(): Promise<BluetoothGATTCharacteristicLike>;
  writeValue?(value: Uint8Array): Promise<void>;
  writeValueWithResponse?(value: Uint8Array): Promise<void>;
  writeValueWithoutResponse?(value: Uint8Array): Promise<void>;
  addEventListener(
    type: "characteristicvaluechanged",
    listener: (event: Event) => void,
  ): void;
  removeEventListener?(
    type: "characteristicvaluechanged",
    listener: (event: Event) => void,
  ): void;
}

export interface BluetoothGATTServiceLike {
  getCharacteristic(uuid: string): Promise<BluetoothGATTCharacteristicLike>;
}

export interface BluetoothRemoteGATTServerLike {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothGATTServiceLike>;
}

export interface BluetoothDeviceLike {
  id: string;
  name?: string | null;
  gatt?: BluetoothRemoteGATTServerLike | null;
  addEventListener?(
    type: "gattserverdisconnected",
    listener: () => void,
  ): void;
  removeEventListener?(
    type: "gattserverdisconnected",
    listener: () => void,
  ): void;
}

export interface BluetoothLike {
  requestDevice(options: {
    acceptAllDevices?: boolean;
    filters?: Array<{ namePrefix?: string; services?: string[] }>;
    optionalServices?: string[];
  }): Promise<BluetoothDeviceLike>;
  getDevices?(): Promise<BluetoothDeviceLike[]>;
}

/** 当前浏览器是否提供 Web Bluetooth（不抛错，供能力检测使用）。 */
export function hasBluetoothApi(): boolean {
  const bluetooth =
    (globalThis.navigator as unknown as { bluetooth?: BluetoothLike })
      ?.bluetooth;
  return Boolean(bluetooth && typeof bluetooth.requestDevice === "function");
}

/** 取 navigator.bluetooth；缺失时给出可操作提示。 */
export function getBluetoothApi(): BluetoothLike {
  const bluetooth =
    (globalThis.navigator as unknown as { bluetooth?: BluetoothLike })
      ?.bluetooth;
  if (!bluetooth || typeof bluetooth.requestDevice !== "function") {
    throw new Error(
      "当前浏览器不支持 Web Bluetooth API：请使用 Chrome/Edge 等 Chromium 内核浏览器，并通过 https 或 localhost 访问。",
    );
  }
  return bluetooth;
}

function describeDevice(device: BluetoothDeviceLike): TransportDevice {
  return {
    id: device.id,
    label: device.name?.trim() || `BLE 设备 ${device.id.slice(0, 8)}`,
    detail: "NUS 串口",
  };
}

/**
 * 设备名是否符合 BUS 前缀。
 * 名称为空时放行：Chrome 的 getDevices() 有时不返回 name，
 * 若因此丢弃，刷新页面后就无法再看到已授权设备。
 */
function matchesDeviceNamePrefix(device: BluetoothDeviceLike): boolean {
  const name = device.name ?? "";
  return name.length === 0 || name.startsWith(BLE_DEVICE_NAME_PREFIX);
}

function decorateBleError(error: unknown): Error {
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotFoundError":
        return new Error(
          "未找到 NUS 服务或特征（6e400001/2/3），请确认固件启用了 BLE 串口透传。",
        );
      case "NetworkError":
        return new Error("蓝牙连接中断，请靠近设备后重试。");
      case "SecurityError":
        return new Error("蓝牙访问被拒绝，请检查系统蓝牙权限与配对状态。");
      case "NotAllowedError":
        return new Error("浏览器未允许访问蓝牙设备。");
      case "InvalidStateError":
        return new Error("蓝牙 GATT 未连接，请重新选择设备。");
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * BLE NUS 字节传输。
 *
 * 写入策略：
 * - 优先 writeValueWithoutResponse（低延迟，NUS 常用）；
 * - 不支持时退回 writeValueWithResponse；
 * - 按 ATT 默认 MTU 23 的可用载荷 20 字节分片，避免长帧被截断。
 */
export class BleNusTransport implements ByteTransport {
  #device: BluetoothDeviceLike;
  #server: BluetoothRemoteGATTServerLike;
  #writeCharacteristic: BluetoothGATTCharacteristicLike;
  #notifyCharacteristic: BluetoothGATTCharacteristicLike;
  #queue = new ByteQueue();
  #chunkSize: number;
  #writeDelayMs: number;
  #canWriteWithoutResponse: boolean;
  #closed = false;
  #closedListeners = new Set<() => void>();

  private constructor(
    device: BluetoothDeviceLike,
    server: BluetoothRemoteGATTServerLike,
    writeCharacteristic: BluetoothGATTCharacteristicLike,
    notifyCharacteristic: BluetoothGATTCharacteristicLike,
    options: TransportOpenOptions,
  ) {
    this.#device = device;
    this.#server = server;
    this.#writeCharacteristic = writeCharacteristic;
    this.#notifyCharacteristic = notifyCharacteristic;
    const reported = Number(writeCharacteristic.maxWriteValueLength);
    const preferred = Number.isFinite(reported) && reported > 0
      ? Math.min(reported, MAX_CHUNK_SIZE)
      : DEFAULT_CHUNK_SIZE;
    this.#chunkSize = Math.max(
      1,
      Math.floor(options.chunkSize ?? preferred) || DEFAULT_CHUNK_SIZE,
    );
    this.#writeDelayMs = Math.max(0, options.writeDelayMs ?? 0);
    this.#canWriteWithoutResponse =
      typeof writeCharacteristic.writeValueWithoutResponse === "function" &&
      writeCharacteristic.properties?.writeWithoutResponse !== false;
    notifyCharacteristic.addEventListener(
      "characteristicvaluechanged",
      this.#onNotification,
    );
    device.addEventListener?.("gattserverdisconnected", this.#onDisconnected);
  }

  /** 连接 GATT、发现 NUS 特征并订阅通知。 */
  static async open(
    device: BluetoothDeviceLike,
    options: TransportOpenOptions = {},
  ): Promise<BleNusTransport> {
    const gatt = device.gatt;
    if (!gatt) throw new Error("该蓝牙设备不支持 GATT 连接。");
    let server: BluetoothRemoteGATTServerLike;
    try {
      server = await gatt.connect();
    } catch (error) {
      throw decorateBleError(error);
    }
    try {
      const service = await server.getPrimaryService(NUS_SERVICE);
      const writeCharacteristic = await service.getCharacteristic(
        NUS_WRITE_CHARACTERISTIC,
      );
      const notifyCharacteristic = await service.getCharacteristic(
        NUS_NOTIFY_CHARACTERISTIC,
      );
      await notifyCharacteristic.startNotifications?.();
      return new BleNusTransport(
        device,
        server,
        writeCharacteristic,
        notifyCharacteristic,
        options,
      );
    } catch (error) {
      try {
        if (server.connected) server.disconnect();
      } catch {
        // 已断开
      }
      throw decorateBleError(error);
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error("蓝牙连接已断开。");
    if (bytes.length === 0) return;
    for (let offset = 0; offset < bytes.length; offset += this.#chunkSize) {
      const chunk = bytes.subarray(offset, offset + this.#chunkSize);
      await this.#writeChunk(chunk);
      if (this.#writeDelayMs > 0) await delay(this.#writeDelayMs);
    }
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
    this.#detachListeners();
    try {
      if (this.#server.connected) {
        await this.#notifyCharacteristic.stopNotifications?.();
      }
    } catch {
      // 链路已断开时 stopNotifications 会抛 NetworkError
    }
    try {
      if (this.#server.connected) this.#server.disconnect();
    } catch {
      // 已断开
    }
    this.#closedListeners.clear();
  }

  /** 移除 GATT/通知监听，避免重连后旧传输继续持有设备引用。 */
  #detachListeners(): void {
    this.#notifyCharacteristic.removeEventListener?.(
      "characteristicvaluechanged",
      this.#onNotification,
    );
    this.#device.removeEventListener?.(
      "gattserverdisconnected",
      this.#onDisconnected,
    );
  }

  async #writeChunk(chunk: Uint8Array): Promise<void> {
    if (
      this.#canWriteWithoutResponse &&
      this.#writeCharacteristic.writeValueWithoutResponse
    ) {
      try {
        await this.#writeCharacteristic.writeValueWithoutResponse(chunk);
        return;
      } catch (error) {
        if (
          !(error instanceof DOMException) ||
          error.name !== "NotSupportedError"
        ) {
          throw error;
        }
        this.#canWriteWithoutResponse = false;
      }
    }
    if (this.#writeCharacteristic.writeValueWithResponse) {
      await this.#writeCharacteristic.writeValueWithResponse(chunk);
      return;
    }
    if (this.#writeCharacteristic.writeValue) {
      await this.#writeCharacteristic.writeValue(chunk);
      return;
    }
    throw new Error("蓝牙 NUS 写特征不支持写入。");
  }

  #onNotification = (event: Event): void => {
    if (this.#closed) return;
    const target = event.target as BluetoothGATTCharacteristicLike | null;
    const value = target?.value;
    if (!value || value.byteLength === 0) return;
    // 浏览器可能复用底层 DataView，必须复制后再入队。
    this.#queue.push(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice(),
    );
  };

  #onDisconnected = (): void => {
    if (this.#closed) return;
    this.#closed = true;
    this.#detachListeners();
    this.#queue.close();
    this.#emitClosed();
  };

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

/** BLE NUS Provider：设备选择、GATT 连接与 NUS 特征发现。 */
export class BleNusProvider implements TransportProvider {
  readonly kind = "ble" as const;
  readonly label = "蓝牙";
  readonly supportsBaudRate = false;
  #bluetooth: BluetoothLike | null;
  #devices = new Map<string, BluetoothDeviceLike>();

  constructor(bluetooth?: BluetoothLike) {
    this.#bluetooth = bluetooth ?? null;
  }

  isAvailable(): boolean {
    if (this.#bluetooth) return true;
    return hasBluetoothApi();
  }

  async listDevices(): Promise<TransportDevice[]> {
    // Chrome 的 getDevices() 能返回本页曾获授权的设备，便于刷新后重连；
    // 其他浏览器没有该 API 时退回当前会话缓存。
    const api = this.#api();
    if (api.getDevices) {
      try {
        for (const device of await api.getDevices()) {
          this.#devices.set(device.id, device);
        }
      } catch {
        // 权限状态变化时忽略，仍展示当前会话缓存。
      }
    }
    return [...this.#devices.values()]
      .filter(matchesDeviceNamePrefix)
      .map(describeDevice);
  }

  async requestDevice(): Promise<TransportDevice> {
    // 只显示名称以 BUS 开头的设备，避免把附近所有 BLE 设备都列出来。
    // 名称过滤不依赖广播 Service UUID，因此仍兼容不在广播包带 NUS UUID 的固件。
    const device = await this.#api().requestDevice({
      filters: [{ namePrefix: BLE_DEVICE_NAME_PREFIX }],
      optionalServices: [NUS_SERVICE],
    });
    this.#devices.set(device.id, device);
    return describeDevice(device);
  }

  async open(
    deviceId: string,
    options: TransportOpenOptions,
  ): Promise<ByteTransport> {
    const device = this.#devices.get(deviceId);
    if (!device) {
      throw new RangeError("蓝牙设备未授权，请先点击「选择蓝牙设备」。");
    }
    const name = device.name ?? "";
    if (name.length > 0 && !name.startsWith(BLE_DEVICE_NAME_PREFIX)) {
      throw new RangeError(
        `蓝牙设备名需以 ${BLE_DEVICE_NAME_PREFIX} 开头，当前为“${name}”。`,
      );
    }
    if (device.gatt?.connected) {
      try {
        device.gatt.disconnect();
      } catch {
        // 已断开
      }
    }
    return await BleNusTransport.open(device, options);
  }

  #api(): BluetoothLike {
    return this.#bluetooth ?? getBluetoothApi();
  }
}
