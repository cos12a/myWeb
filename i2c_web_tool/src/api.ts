// 本地 API 适配器：Web 版没有 HTTP 后端，控制器直接调用 LWPKT 后端。
// 方法名与桌面版 api 保持一致，UI 层不需要感知具体传输（串口/蓝牙/USB）。
import type {
  Ch224RegisterInfo,
  Ch224RegisterReadResult,
  Ch224RegisterWriteResult,
  Ch224RequestResult,
  Ch224Snapshot,
  DeviceStatus,
  I2cBusConfig,
  I2cBusConfigPatch,
  I2cCapabilities,
  I2cReportConfig,
  I2cReportFrame,
  I2cReportInfo,
  I2cReportStatus,
  I2cReportStopped,
  I2cReportTask,
  I2cSwapResult,
  I2cStreamFrame,
  I2cStreamInfo,
  I2cStreamRequest,
  Lis3dhConfig,
  Lis3dhConfigResult,
  Lis3dhDiscoverResult,
  Lis3dhFifoBatch,
  Lis3dhFifoHint,
  Lis3dhFifoStatus,
  Lis3dhRegisterCatalog,
  Lis3dhRegisterReadResult,
  Lis3dhRegisterWriteResult,
  Lis3dhSample,
  Lis3dhTemperature,
  MlxEmissivityRead,
  MlxRegisterInfo,
  MlxRegisterReadResult,
  MlxRegisterWriteResult,
  MlxTemperatureResult,
  ScanResult,
  TransferResult,
  TransportDescriptor,
  TransportDevice,
  TransportEvent,
  TransportKind,
} from "./types.ts";
import type { ConnectRequest } from "./serial/backend.ts";
import { AutoReportController } from "./serial/auto_report.ts";
import { Ch224Controller } from "./serial/ch224.ts";
import { Lis3dhController } from "./serial/lis3dh.ts";
import { Mlx90614Controller } from "./serial/mlx90614.ts";
import { SerialLwpktBackend } from "./serial/serial_lwpkt.ts";

const backend = new SerialLwpktBackend();
const autoReport = new AutoReportController(backend);
const ch224 = new Ch224Controller(backend);
const mlx = new Mlx90614Controller(backend);
const lis3dh = new Lis3dhController(backend);

export const api = {
  status: (): Promise<DeviceStatus> => Promise.resolve(backend.status()),
  /** 可用传输能力（串口/蓝牙），已按注册顺序返回。 */
  transports: (): TransportDescriptor[] => backend.transports(),
  /** 枚举某类传输已授权的设备；不会弹授权框。 */
  devices: (kind: TransportKind): Promise<TransportDevice[]> =>
    backend.listDevices(kind),
  /** 弹出浏览器设备授权框；必须在用户点击事件中调用。 */
  requestDevice: (kind: TransportKind): Promise<TransportDevice> =>
    backend.requestDevice(kind),
  /** 连接指定传输；TransportManager 保证同一时刻只有一个活跃连接。 */
  connect: (request: ConnectRequest): Promise<DeviceStatus> =>
    backend.connect(request),
  /** 订阅设备插拔/被动断开事件，返回取消订阅函数。 */
  watchTransportEvents: (
    listener: (event: TransportEvent) => void,
  ): (() => void) => backend.subscribe(listener),
  disconnect: (): Promise<DeviceStatus> => backend.disconnect(),
  scan: (start: number, end: number): Promise<ScanResult> =>
    backend.scan(start, end),
  /** 读取当前 SDA/SCL 与频率。 */
  readBusConfig: (): Promise<I2cBusConfig> => backend.readBusConfig(),
  /** 修改 SDA/SCL/频率（ESP32 可任意 GPIO；重建总线约 1 秒）。 */
  configureBus: (patch: I2cBusConfigPatch): Promise<I2cBusConfig> =>
    backend.configureBus(patch),
  /** 能力协商；旧固件不支持时返回 null。 */
  readBusCapabilities: (): Promise<I2cCapabilities | null> =>
    backend.readBusCapabilities(),
  /** 选择硬件 I²C 实例与固定引脚方案（STM32）。 */
  selectBus: (
    busId: number,
    schemeId: number,
    freqHz?: number,
  ): Promise<I2cBusConfig> => backend.selectBus(busId, schemeId, freqHz),
  /** 交换 SDA/SCL（接线纠错）。 */
  swapBusPins: (): Promise<I2cSwapResult> => backend.swapBusPins(),
  /** 总线恢复：释放引脚并发送 9 个时钟脉冲。 */
  recoverBus: (): Promise<void> => backend.recoverBus(),
  read: (address: number, register: number) =>
    backend.read(address, register),
  write: (address: number, register: number, value: number) =>
    backend.write(address, register, value),
  transfer: (writeHex: string, readLength: number): Promise<TransferResult> =>
    backend.transfer(writeHex, readLength) as Promise<TransferResult>,
  eepromRead: (
    type: number,
    address: number,
    length: number,
  ): Promise<TransferResult> =>
    backend.eepromRead(type, address, length) as Promise<TransferResult>,
  eepromWrite: (type: number, address: number, writeHex: string) =>
    backend.eepromWrite(type, address, writeHex),

  // —— 周期自动上报（REPORT_*，AR-1.0）——
  // 旧固件对 REPORT_* 返回 ERR_UNSUPPORTED，调用方转成“固件不支持”提示。
  autoReportSupports: (): Promise<boolean> =>
    Promise.resolve(autoReport.supportsReport()),
  autoReportConfigure: (task: I2cReportTask): Promise<I2cReportConfig> =>
    autoReport.configure(task),
  autoReportStart: (taskId?: number): Promise<I2cReportInfo> =>
    autoReport.start(taskId),
  autoReportStop: (taskId?: number): Promise<I2cReportStopped[]> =>
    autoReport.stop(taskId),
  autoReportStatus: (): Promise<I2cReportStatus> => autoReport.status(),
  autoReportClear: (): Promise<number> => autoReport.clear(),
  /** 订阅 REPORT_DATA 帧（已含 taskId/seq/atMs）；返回取消订阅函数。 */
  autoReportSubscribe: (
    listener: (frame: I2cReportFrame) => void,
  ): (() => void) => autoReport.subscribe(listener),

  ch224Discover: () => ch224.discover(),
  // .mjs 纯逻辑层没有 JSDoc 类型，返回值按 types.ts 契约收口。
  ch224Registers: (): Promise<{ registers: Ch224RegisterInfo[] }> =>
    Promise.resolve(ch224.listRegisters()) as unknown as Promise<
      { registers: Ch224RegisterInfo[] }
    >,
  ch224Capabilities: (address: number): Promise<Ch224Snapshot> =>
    ch224.readCapabilities(address) as unknown as Promise<Ch224Snapshot>,
  ch224ReadRegister: (
    address: number,
    register: number,
  ): Promise<Ch224RegisterReadResult> =>
    ch224.readRegister(address, register) as unknown as Promise<
      Ch224RegisterReadResult
    >,
  ch224WriteRegister: (
    address: number,
    register: number,
    value: number,
  ): Promise<Ch224RegisterWriteResult> =>
    ch224.writeRegister(address, register, value) as unknown as Promise<
      Ch224RegisterWriteResult
    >,
  ch224RequestPower: (
    address: number,
    mode: "fixed" | "pps" | "avs" | "qc",
    voltage: number,
  ): Promise<Ch224RequestResult> =>
    ch224.requestPower(address, mode, voltage) as unknown as Promise<
      Ch224RequestResult
    >,

  mlxDiscover: () => mlx.discover(),
  mlxRegisters: (): Promise<{ registers: MlxRegisterInfo[] }> =>
    Promise.resolve(mlx.listRegisters()) as unknown as Promise<
      { registers: MlxRegisterInfo[] }
    >,
  mlxReadRegister: (
    address: number,
    register: number,
  ): Promise<MlxRegisterReadResult> =>
    mlx.readRegister(address, register) as unknown as Promise<
      MlxRegisterReadResult
    >,
  mlxWriteRegister: (
    address: number,
    register: number,
    value: number,
  ): Promise<MlxRegisterWriteResult> =>
    mlx.writeRegister(address, register, value) as unknown as Promise<
      MlxRegisterWriteResult
    >,
  mlxReadTemperature: (
    address: number,
    register: number,
  ): Promise<MlxTemperatureResult> =>
    mlx.readTemperature(address, register) as unknown as Promise<
      MlxTemperatureResult
    >,
  mlxReadEmissivity: (address: number): Promise<MlxEmissivityRead> =>
    mlx.readEmissivity(address) as unknown as Promise<MlxEmissivityRead>,
  mlxWriteEmissivity: (address: number, value: number) =>
    mlx.writeEmissivity(address, value),

  lis3dhDiscover: (): Promise<Lis3dhDiscoverResult> =>
    lis3dh.discover() as unknown as Promise<Lis3dhDiscoverResult>,
  lis3dhRegisters: (): Promise<Lis3dhRegisterCatalog> =>
    Promise.resolve(lis3dh.listRegisters()) as unknown as Promise<
      Lis3dhRegisterCatalog
    >,
  lis3dhReadSample: (
    address: number,
    fullScale: number,
  ): Promise<Lis3dhSample> =>
    lis3dh.readSample(address, fullScale) as unknown as Promise<Lis3dhSample>,
  lis3dhReadTemperature: (address: number): Promise<Lis3dhTemperature> =>
    lis3dh.readTemperature(address) as unknown as Promise<Lis3dhTemperature>,
  lis3dhFifoStatus: (address: number): Promise<Lis3dhFifoStatus> =>
    lis3dh.readFifoStatus(address) as unknown as Promise<Lis3dhFifoStatus>,
  /** FIFO 批量读取：一次事务带回多组三轴样本（FIFO_EN + Stream 模式生效）。 */
  lis3dhFifoBatch: (
    address: number,
    fullScale: number,
    maxSamples: number,
    odrHz: number,
  ): Promise<Lis3dhFifoBatch> =>
    lis3dh.readFifoBatch(address, fullScale, maxSamples, odrHz) as unknown as Promise<
      Lis3dhFifoBatch
    >,
  lis3dhResetFifo: (address: number) => lis3dh.resetFifo(address),
  /** FIFO 读取周期建议（不溢出的最大间隔）。 */
  lis3dhFifoHint: (
    odrCode: number,
    outputMode: string,
    threshold?: number,
  ): Promise<Lis3dhFifoHint> =>
    Promise.resolve(lis3dh.fifoHint(odrCode, outputMode, threshold)) as Promise<
      Lis3dhFifoHint
    >,
  /** 当前传输是否支持设备主动上报（固件需实现 STREAM_* 命令）。 */
  lis3dhSupportsStream: (): Promise<boolean> =>
    Promise.resolve(lis3dh.supportsStream()),
  /** 启动设备主动推送（中断/定时），页面只需订阅数据帧。 */
  lis3dhStartStream: (
    request: I2cStreamRequest,
  ): Promise<I2cStreamInfo> => lis3dh.startStream(request),
  lis3dhStopStream: (): Promise<{ frames: number }> => lis3dh.stopStream(),
  /** 订阅设备主动上报样本（控制器已解码为三轴 g 值）；返回取消订阅函数。 */
  lis3dhSubscribeStream: (
    listener: (sample: Lis3dhSample, frame: I2cStreamFrame) => void,
    fullScale: number,
  ): (() => void) => lis3dh.subscribeStream(listener, fullScale),
  /** 订阅指定上报槽位的 REPORT_DATA 帧（LIS3DH 页「周期上报」模式）。 */
  lis3dhSubscribeReport: (
    taskId: number,
    listener: (sample: Lis3dhSample, frame: I2cReportFrame) => void,
    fullScale: number,
  ): (() => void) => lis3dh.subscribeReport(taskId, listener, fullScale),
  lis3dhConfigure: (
    address: number,
    config: Lis3dhConfig,
  ): Promise<Lis3dhConfigResult> =>
    lis3dh.configure(address, config) as unknown as Promise<Lis3dhConfigResult>,
  lis3dhReadRegister: (
    address: number,
    register: number,
  ): Promise<Lis3dhRegisterReadResult> =>
    lis3dh.readRegister(address, register) as unknown as Promise<
      Lis3dhRegisterReadResult
    >,
  lis3dhWriteRegister: (
    address: number,
    register: number,
    value: number,
  ): Promise<Lis3dhRegisterWriteResult> =>
    lis3dh.writeRegister(address, register, value) as unknown as Promise<
      Lis3dhRegisterWriteResult
    >,
};
