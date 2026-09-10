/** Web Serial 通信 Controller —— 副作用：requestPort + readLoop + 按 \n 分包。
 *  与 BleController 行协议一致，可互换作为数据源。 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ConnStatus } from "../core/types.js";

export interface SerialCallbacks {
  onLine?: (line: string) => void;
  onData?: (text: string) => void;
  onError?: (err: unknown) => void;
  onStatus?: (status: ConnStatus, error: string | null) => void;
}

export class SerialController implements ReactiveController {
  private host: ReactiveControllerHost;
  private cb: SerialCallbacks;
  baudRate: number;
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private keepReading = false;
  private rxBuf = "";
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  status: ConnStatus = "idle";
  errorMessage: string | null = null;

  get connected(): boolean {
    return !!this.port;
  }

  constructor(host: ReactiveControllerHost, baudRate = 921600, cb: SerialCallbacks = {}) {
    this.host = host;
    this.baudRate = baudRate;
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

  async connect(baudRate?: number): Promise<void> {
    if (!navigator.serial) throw new Error("当前浏览器不支持 Web Serial，请使用 Chrome / Edge");
    const rate = baudRate ?? this.baudRate;
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: rate });
    this.baudRate = rate;
    this.keepReading = true;
    this.set("connected");
    this.readLoop().catch((err) => this.onError(err));
  }

  private async readLoop(): Promise<void> {
    try {
      while (this.keepReading) {
        const port = this.port;
        if (!port) break;
        const reader = port.readable.getReader();
        this.reader = reader;
        try {
          while (this.keepReading) {
            const { value, done } = await reader.read();
            if (done) break;
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
        } catch (err) {
          if (this.keepReading) this.onError(err);
        } finally {
          try { reader.releaseLock(); } catch { /* ignore */ }
          this.reader = null;
        }
      }
    } finally {
      try { if (this.writer) this.writer.releaseLock(); } catch { /* ignore */ }
      this.writer = null;
      try { if (this.port) await this.port.close(); } catch { /* ignore */ }
      this.port = null;
      this.rxBuf = "";
    }
  }

  private onError(err: unknown): void {
    this.keepReading = false;
    const msg = err instanceof Error ? err.message : String(err);
    this.set("error", msg);
    this.cb.onError?.(err);
  }

  async send(data: string | Uint8Array): Promise<void> {
    const port = this.port;
    if (!port) throw new Error("未连接");
    if (!this.writer) this.writer = port.writable.getWriter();
    const bytes = typeof data === "string" ? this.encoder.encode(data) : data;
    await this.writer.write(bytes);
  }

  async disconnect(): Promise<void> {
    if (!this.port) return;
    this.keepReading = false;
    try { if (this.reader) await this.reader.cancel(); } catch { /* ignore */ }
    this.set("disconnected");
  }
}