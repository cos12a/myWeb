export class NodeSerialTransport {
  constructor(port, log = () => {}) {
    this.port = port;
    this.log = log;
    this.readBuffer = [];
    this.waiters = [];
    this.dataListener = null; // 外部数据监听（如编程前串口监听器）
    this._onData = (chunk) => {
      this.readBuffer.push(...chunk);
      if (this.dataListener) {
        this.dataListener(new Uint8Array(chunk));
      }
      this.resolveWaiters();
    };
  }

  // 注册外部数据监听器：每个收到的数据块都会被转发一份（不影响 readBuffer）
  setDataListener(listener) {
    this.dataListener = typeof listener === "function" ? listener : null;
  }

  async open(options) {
    this.port.on("data", this._onData);
    await new Promise((resolve, reject) => {
      this.port.open((error) => (error ? reject(error) : resolve()));
    });
    if (options?.setSignals) await this.setSignals(options.setSignals);
  }

  async close() {
    this.port.off("data", this._onData);
    this.dataListener = null;
    await new Promise((resolve, reject) => {
      if (!this.port.isOpen) {
        resolve();
        return;
      }
      this.port.close((error) => (error ? reject(error) : resolve()));
    });
    this.readBuffer = [];
    this.waiters.splice(0).forEach(({ reject }) => reject(new Error("Serial port closed")));
  }

  async write(bytes) {
    await new Promise((resolve, reject) => {
      this.port.write(Buffer.from(bytes), (error) => {
        if (error) {
          reject(error);
          return;
        }
        this.port.drain((drainError) => (drainError ? reject(drainError) : resolve()));
      });
    });
  }

  async readExact(length, timeoutMs) {
    if (this.readBuffer.length >= length) {
      return new Uint8Array(this.readBuffer.splice(0, length));
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        length,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new Error(`读取超时 (等待 ${length} 字节, 收到 ${this.readBuffer.length} 字节)`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
      this.resolveWaiters();
    });
  }

  async flushReadBuffer() {
    this.readBuffer = [];
  }

  async setSignals(signals) {
    const nextSignals = {};
    if (signals.dataTerminalReady !== undefined) nextSignals.dtr = !signals.dataTerminalReady;
    if (signals.requestToSend !== undefined) nextSignals.rts = !signals.requestToSend;
    await new Promise((resolve, reject) => {
      this.port.set(nextSignals, (error) => (error ? reject(error) : resolve()));
    });
  }

  resolveWaiters() {
    for (const waiter of [...this.waiters]) {
      if (this.readBuffer.length < waiter.length) continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((item) => item !== waiter);
      waiter.resolve(new Uint8Array(this.readBuffer.splice(0, waiter.length)));
    }
  }
}
