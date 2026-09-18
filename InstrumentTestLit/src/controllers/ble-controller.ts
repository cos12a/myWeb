/** BLE 通信 Controller —— 副作用集中地：Web Bluetooth + NUS 透传 + 行分包。
 *  流程：pickDevice → connectGatt(GATT 连接) → discoverServices(轮询重试等待系统配对完成)。
 *  配对由访问受保护特征（startNotifications）时 OS 隐式触发，可能反复 NetworkError，
 *  因此 discoverServices 用 120s 窗口 + 6s 间隔耐心轮询，等用户在系统弹窗输完 Key。 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ConnStatus } from "../core/types.js";

export const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const NUS_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const NUS_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

const PAIR_WAIT_TOTAL_MS = 120000;     // 等待完成系统配对的最长时间（120s）
const PAIR_POLL_INTERVAL_MS = 6000;    // 配对未完成时的重试间隔（6s）
const PAIR_ATTEMPT_TIMEOUT_MS = 30000; // 单次尝试超时（30s）

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
  private aborting = false;

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
    this.aborting = false;
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
    await new Promise(r => setTimeout(r, 200));
    try {
      this.server = await this.withTimeout(
        this.device.gatt.connect(),
        PAIR_ATTEMPT_TIMEOUT_MS,
        "GATT 连接超时",
      );
    } catch (err) {
      this.set("error", this.describeError(err));
      throw err;
    }
  }

  /** 发现服务并订阅通知 —— 按 ble-key.html 的 establishSession 耐心轮询：
   *  startNotifications 会触发系统配对弹窗，期间可能反复 NetworkError / 链路抖动，
   *  这里用 120s 总窗口 + 6s 间隔重试，等用户在系统弹窗输完 Key 后某次尝试即成功。 */
  async discoverServices(): Promise<void> {
    if (!this.device) throw new Error("未选择设备");
    this.set("pairing");
    const deadline = Date.now() + PAIR_WAIT_TOTAL_MS;
    let attempt = 0;
    while (true) {
      if (this.aborting) throw new DOMException("用户已取消连接", "AbortError");
      try {
        // 1) 确保 GATT 已连接（链路断开后特征会失效，需重新获取）
        if (!this.device.gatt.connected) {
          this.txChar = null;
          this.rxChar = null;
          this.server = await this.withTimeout(
            this.device.gatt.connect(),
            PAIR_ATTEMPT_TIMEOUT_MS,
            "GATT 重连超时",
          );
          await new Promise(r => setTimeout(r, 300));
        } else {
          this.server = this.device.gatt;
        }

        // 2) 获取服务与特征
        if (!this.txChar || !this.rxChar) {
          const service = await this.withTimeout(
            this.server.getPrimaryService(NUS_SERVICE),
            PAIR_ATTEMPT_TIMEOUT_MS,
            "获取服务超时",
          );
          this.txChar = await this.withTimeout(
            service.getCharacteristic(NUS_TX),
            PAIR_ATTEMPT_TIMEOUT_MS,
            "获取 TX 特征超时",
          );
          this.rxChar = await this.withTimeout(
            service.getCharacteristic(NUS_RX),
            PAIR_ATTEMPT_TIMEOUT_MS,
            "获取 RX 特征超时",
          );
          await new Promise(r => setTimeout(r, 200));
        }

        // 3) 订阅通知（这一步会触发系统配对弹窗）
        await this.withTimeout(
          this.rxChar.startNotifications(),
          PAIR_ATTEMPT_TIMEOUT_MS,
          "订阅通知超时",
        );
        this.rxChar.addEventListener("characteristicvaluechanged", (e) => this.onNotify(e));
        this.set("paired");
        return;
      } catch (err) {
        if (this.aborting) throw err;
        if (Date.now() >= deadline) {
          this.set("error", this.describeError(err));
          throw err;
        }
        attempt++;
        await new Promise(r => setTimeout(r, PAIR_POLL_INTERVAL_MS));
      }
    }
  }

  async disconnect(): Promise<void> {
    this.aborting = true;
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
    // 配对中链路抖动属于正常现象，discoverServices 的轮询循环会自动重连
    if (this.status === "pairing") return;
    this.cleanup();
    this.set("disconnected");
  }
}
