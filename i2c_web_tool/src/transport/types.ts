// 浏览器字节传输抽象层：Web Serial、BLE NUS 以及未来的 WebUSB 都实现同一组接口。
// 上层（LWPKT 后端、器件控制器、UI）只依赖这些类型，不感知具体浏览器硬件 API。

/** 当前支持的传输种类；新增 WebUSB 时在这里扩展并注册对应 Provider。 */
export type TransportKind = "serial" | "ble" | "usb";

/** 可被连接的一台设备（串口或 BLE），id 只在当前页面会话内稳定。 */
export interface TransportDevice {
  id: string;
  label: string;
  /** 补充信息，如 VID/PID 或 BLE 设备 id。 */
  detail?: string;
}

/** 传输能力描述，UI 据此渲染连接方式切换。 */
export interface TransportDescriptor {
  kind: TransportKind;
  label: string;
  available: boolean;
  supportsBaudRate: boolean;
}

/** 打开传输时的可选参数；不同传输只使用自己关心的字段。 */
export interface TransportOpenOptions {
  /** 串口波特率；BLE/USB 忽略。 */
  baudRate?: number;
  /** BLE 单包写入上限，默认 20（ATT MTU 23 的可用载荷）。 */
  chunkSize?: number;
  /** BLE 分片之间的额外延迟，默认 0；链路丢包时可调大。 */
  writeDelayMs?: number;
}

/** TransportManager 当前持有的唯一活跃连接。 */
export interface ActiveTransport {
  kind: TransportKind;
  device: TransportDevice;
  transport: ByteTransport;
}

/** 传输层向上层发出的事件。 */
export type TransportEvent =
  | {
    type: "devices-changed";
    kind: TransportKind;
    change: "connect" | "disconnect";
  }
  | {
    type: "disconnected";
    kind: TransportKind;
    device: TransportDevice;
  };

/**
 * 已打开的双向字节流。语义与桌面版 SerialTransport 对齐：
 * - read 最多等待 deadlineMs，返回当前可读字节（可能为空）；
 * - purgeInput 尽力丢弃未消费的输入；
 * - close 必须幂等，设备已拔出时也不能抛错。
 */
export interface ByteTransport {
  write(bytes: Uint8Array): Promise<void>;
  read(deadlineMs: number): Promise<Uint8Array>;
  purgeInput(): Promise<void>;
  close(): Promise<void>;
  /** 链路被设备/浏览器被动断开时触发；返回取消订阅函数。 */
  onClosed?(listener: () => void): () => void;
}

/**
 * 某一种传输的提供者。TransportManager 只依赖本接口，
 * 因此新增 WebUSB 不需要改后端、控制器或页面。
 */
export interface TransportProvider {
  readonly kind: TransportKind;
  readonly label: string;
  readonly supportsBaudRate: boolean;
  /** 当前浏览器是否具备该硬件 API（而不是设备是否已连接）。 */
  isAvailable(): boolean;
  /** 已授权/当前会话可用的设备；不得弹出选择框。 */
  listDevices(): Promise<TransportDevice[]>;
  /** 弹出浏览器授权框，必须在用户手势中调用。 */
  requestDevice(): Promise<TransportDevice>;
  /** 打开指定设备；失败时抛出的错误应包含可操作的中文提示。 */
  open(
    deviceId: string,
    options: TransportOpenOptions,
  ): Promise<ByteTransport>;
  /** 可选：监听设备插拔；BLE 无全局插拔事件时可以不实现。 */
  watch?(
    onChange: (change: "connect" | "disconnect") => void,
  ): () => void;
}
