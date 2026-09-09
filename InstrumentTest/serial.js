/**
 * Web Serial 串口通信模块
 *
 * 数据接收：Web Serial 通过 ReadableStream 流式读取，每次 reader.read() 返回
 * 任意长度的 Uint8Array（长度不固定，取决于底层缓冲区）。API 本身不支持配置
 * "每包长度"，分包须在应用层完成。
 *
 * 分包形式：① 任意长度 chunk ② 固定长度 ③ 分隔符 ④ 帧头/帧尾
 * 本模块采用 ③「按 \n 分隔符分包」，与 ble.js 行协议一致：
 *   数据格式为 JSON 行：{"vbus":4.028,"vshunt":-0.02,"ibus":-0.2,"pbus":0.0}\n
 *
 * 释放与清理：主动 disconnect / 读取错误 / 页面关闭 均释放 reader/writer/port。
 *
 * 挪用：const ser = new WebSerial({ onLine, onStatus }); await ser.connect({ baudRate: 921600 });
 */

export class WebSerial {
  constructor({
    baudRate = 921600,
    onStatus = () => {},
    onData = () => {},
    onLine = () => {},
  } = {}) {
    this.baudRate = baudRate;
    this.onStatus = onStatus;
    this.onData = onData;
    this.onLine = onLine;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this._keepReading = false;
    this._rxBuf = "";
    this._decoder = new TextDecoder();
    this._encoder = new TextEncoder();
  }

  get connected() {
    return !!this.port;
  }

  async connect(options = {}) {
    if (!navigator.serial) {
      throw new Error("当前浏览器不支持 Web Serial，请使用 Chrome / Edge");
    }
    const baudRate = options.baudRate || this.baudRate;
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate });
    this.baudRate = baudRate;
    this._keepReading = true;
    this._readLoop().catch((err) => this.onStatus("error", err));
    this.onStatus("connected");
  }

  async _readLoop() {
    try {
      while (this._keepReading) {
        this.reader = this.port.readable.getReader();
        try {
          while (this._keepReading) {
            const { value, done } = await this.reader.read();
            if (done) break;
            const text = this._decoder.decode(value);
            this.onData(text);
            this._rxBuf += text;
            let idx;
            while ((idx = this._rxBuf.indexOf("\n")) >= 0) {
              const line = this._rxBuf.slice(0, idx).trim();
              this._rxBuf = this._rxBuf.slice(idx + 1);
              if (line) this.onLine(line);
            }
          }
        } catch (err) {
          // 读取错误（设备断开等）；主动 cancel 时 _keepReading 已为 false，忽略
          if (this._keepReading) {
            this._keepReading = false;
            this.onStatus("error", err);
          }
        } finally {
          try { this.reader.releaseLock(); } catch (_) {}
          this.reader = null;
        }
      }
    } finally {
      try { if (this.writer) this.writer.releaseLock(); } catch (_) {}
      this.writer = null;
      try { if (this.port) await this.port.close(); } catch (_) {}
      this.port = null;
      this._rxBuf = "";
    }
  }

  async send(data) {
    if (!this.port) throw new Error("未连接");
    if (!this.writer) this.writer = this.port.writable.getWriter();
    const bytes = typeof data === "string" ? this._encoder.encode(data) : data;
    await this.writer.write(bytes);
  }

  async disconnect() {
    if (!this.port) return;
    this._keepReading = false;
    // cancel reader 让 read() 解除，_readLoop 退出并最终 close port
    try { if (this.reader) await this.reader.cancel(); } catch (_) {}
    this.onStatus("disconnected");
  }
}