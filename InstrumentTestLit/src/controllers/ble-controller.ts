/** BLE 通信 Controller —— 副作用集中地：Web Bluetooth + NUS 透传 + 行分包。
 *  流程：pickDevice → connectGatt(GATT 连接) → discoverServices(访问受保护特征时 OS 隐式触发 SMP 配对)。
 *  配对不是 gatt.connect() 触发的，而是访问需要加密的特征值（startNotifications 等）时由 OS 触发。
 *  UI 是 Lit 类，逻辑是纯函数，副作用进 Controller。 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ConnStatus } from "../core/types.js";

export const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const NUS_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const NUS_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

const PAIR_TIMEOUT_MS = 30000;

export interface BleCallbacks {
  onLine?: (line: string) => void;
  onData?: (text: string) => void;
  onStatus?: (status: ConnStatus, error: string | null) => void;
}

export class BleController implements ReactiveController {
  private host: ReactiveControllerHost;
  private cb: BleCallbacks;
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxBuf = "";
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private onDisconnectedBound = (): void => this.onDisconnected();

  status: ConnStatus = "idle";
  errorMessage: string | null = null;

  get connected(): boolean {
    return !!this.device && !!this.device.gatt && this.device.gatt.connected;
  }

  constructor(host: ReactiveControllerHost, cb: BleCallbacks = {}) {
    this.host = host;
    this.cb = cb;
    host.addController(this);
  }

  hostConnected(): void {}
  hostDisconnected(): void { void this.disconnect(); }

  private set(status: ConnStatus, error: string | null = null): void {
    this.status = status;
    this.errorMessage = error;
    this.cb.onStatus?.(status, error);
    this.host.requestUpdate();
  }

  private cleanup(): void {
    this.server = null;
    this.txChar = null;
    this.rxChar = null;
    this.rxBuf = "";
  }

  private describeError(err: unknown): string {
    if (err instanceof DOMException) {
      switch (err.name) {
        case "SecurityError": return "配对失败或被取消，请重新配对";
        case "NetworkError": return "连接中断，请重试";
        case "NotFoundError": return "未找到服务或特征，请检查 UUID";
        case "NotSupportedError": return "设备不支持该操作";
        case "InvalidStateError": return "GATT 未连接";
      }
    }
    return err instanceof Error ? err.message : String(err);
  }

  private withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
    ]);
  }

  async pickDevice(namePrefix?: string): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error("当前浏览器不支持 Web Bluetooth，请使用 Chrome / Edge / Android Chrome");
    }
    this.set("selecting");
    const reqOpts: RequestDeviceOptions = { optionalServices: [NUS_SERVICE] };
    if (namePrefix) reqOpts.filters = [{ namePrefix }];
    else reqOpts.acceptAllDevices = true;
    try {
      this.device = await navigator.bluetooth.requestDevice(reqOpts);
      this.device.removeEventListener("gattserverdisconnected", this.onDisconnectedBound);
      this.device.addEventListener("gattserverdisconnected", this.onDisconnectedBound);
    } catch (err) {
      this.set("idle");
      throw err;
    }
  }

  async connectGatt(): Promise<void> {
    if (!this.device) throw new Error("未选择设备");
    this.set("connecting");
    console.log("[BLE] connectGatt: 延时 1 秒等待信道稳定");
    await new Promise(r => setTimeout(r, 1000));
    console.log("[BLE] connectGatt: 调用 gatt.connect()");
    try {
      this.server = await this.device.gatt.connect();
      console.log("[BLE] connectGatt: resolve，connected=", this.device.gatt?.connected);
    } catch (err) {
      console.log("[BLE] connectGatt: 抛错", err);
      this.set("error", this.describeError(err));
      throw err;
    }
    // GATT 已连接，配对在 discoverServices 访问受保护特征时由 OS 隐式触发
  }

  async discoverServices(): Promise<void> {
    if (!this.server) throw new Error("未连接");
    this.set("pairing");
    console.log("[BLE] discoverServices: 开始，server.connected=", this.server.connected);
    try {
      const service = await this.withTimeout(
        this.server.getPrimaryService(NUS_SERVICE), PAIR_TIMEOUT_MS, "获取服务超时",
      );
      console.log("[BLE] discoverServices: 拿到 service");
      this.txChar = await this.withTimeout(
        service.getCharacteristic(NUS_TX), PAIR_TIMEOUT_MS, "获取 TX 特征超时",
      );
      this.rxChar = await this.withTimeout(
        service.getCharacteristic(NUS_RX), PAIR_TIMEOUT_MS, "获取 RX 特征超时",
      );
      console.log("[BLE] discoverServices: 拿到 txChar/rxChar，准备 startNotifications");
      await this.withTimeout(
        this.rxChar.startNotifications(),
        PAIR_TIMEOUT_MS,
        "订阅通知超时",
      );
      console.log("[BLE] discoverServices: startNotifications 成功");
      this.rxChar.addEventListener("characteristicvaluechanged", (e) => this.onNotify(e));
    } catch (err) {
      console.log("[BLE] discoverServices: 抛错", err);
      this.set("error", this.describeError(err));
      throw err;
    }
    this.set("paired");
    console.log("[BLE] discoverServices: 状态置 paired");
  }


  async disconnect(): Promise<void> {
    console.log("[BLE] disconnect: 调用，connected=", this.connected);
    try {
      this.device?.gatt?.disconnect();
    } finally {
      this.cleanup();
      this.set("disconnected");
    }
  }

  async forgetDevice(): Promise<void> {
    if (this.device && "forget" in this.device) {
      await (this.device as BluetoothDevice & { forget(): Promise<void> }).forget();
    } else {
      console.warn("当前浏览器不支持 forget()，请前往系统蓝牙设置删除该设备后重新连接");
    }
  }

  async send(data: string | Uint8Array): Promise<void> {
    if (!this.txChar) throw new Error("未连接");
    const bytes = typeof data === "string" ? this.encoder.encode(data) : data;
    try {
      if (this.txChar.writeValueWithoutResponse) {
        await this.txChar.writeValueWithoutResponse(bytes);
      } else {
        await this.txChar.writeValue(bytes);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotSupportedError" && this.txChar.writeValue) {
        await this.txChar.writeValue(bytes);
      } else {
        throw err;
      }
    }
  }

  private onNotify(e: Event): void {
    const value = (e.target as BluetoothRemoteGATTCharacteristic).value!;
    const text = this.decoder.decode(value);
    this.cb.onData?.(text);
    this.rxBuf += text;
    let idx: number;
    while ((idx = this.rxBuf.indexOf("\n")) >= 0) {
      const line = this.rxBuf.slice(0, idx).trim();
      this.rxBuf = this.rxBuf.slice(idx + 1);
      if (line) this.cb.onLine?.(line);
    }
  }

  private onDisconnected(): void {
    if (this.status === "disconnected") return;
    const wasPairing = this.status === "pairing";
    console.log(`[BLE] onDisconnected: status=${this.status}, wasPairing=${wasPairing}`);
    this.cleanup();
    if (wasPairing) {
      this.set("error",
        "配对过程中设备断开。请确认：1) ESP32 UART 是否打印了 6 位 passkey；" +
        "2) Windows 是否弹出输入框；3) 先在系统蓝牙设置中手动配对设备。"
      );
    } else {
      this.set("disconnected");
    }
  }
}
