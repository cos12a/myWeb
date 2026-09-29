// bluetooth-transport.js
export class BluetoothTransport {
  constructor(device, log = () => {}) {
    this.device = device;
    this.log = log;
    this.server = null;
    this.txChar = null;
    this.rxChar = null;
    this.readBuffer = [];
    this.dataListener = null;
    this._keepReading = false;
    this._readingPromise = null;
  }

  async open({ serviceUUID, txUUID, rxUUID } = {}) {
    // 默认 UUID，可根据实际修改
    const SERVICE = serviceUUID || "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
    const TX = txUUID || "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
    const RX = rxUUID || "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

    if (!this.device) throw new Error("未选择蓝牙设备");
    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(SERVICE);
    this.txChar = await service.getCharacteristic(TX);
    this.rxChar = await service.getCharacteristic(RX);

    // 启用通知
    await this.rxChar.startNotifications();
    this.rxChar.addEventListener(
      "characteristicvaluechanged",
      this._onNotification.bind(this),
    );

    this._keepReading = true;
    // 无需背景读取循环，因为通知会触发
    this.log("蓝牙已连接");
  }

  _onNotification(event) {
    const value = event.target.value;
    if (value) {
      const bytes = new Uint8Array(value.buffer);
      this.readBuffer.push(...bytes);
      if (this.dataListener) {
        this.dataListener(bytes);
      }
    }
  }

  async close() {
    this._keepReading = false;
    if (this.rxChar) {
      await this.rxChar.stopNotifications();
      this.rxChar.removeEventListener(
        "characteristicvaluechanged",
        this._onNotification,
      );
    }
    if (this.device && this.device.gatt) {
      await this.device.gatt.disconnect();
    }
    this.server = null;
    this.txChar = null;
    this.rxChar = null;
    this.readBuffer = [];
    this.dataListener = null;
  }

  async write(bytes) {
    if (!this.txChar) throw new Error("蓝牙未打开");
    await this.txChar.writeValue(new Uint8Array(bytes));
  }

  async readExact(length, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (this.readBuffer.length < length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `蓝牙读取超时 (等待 ${length} 字节, 收到 ${this.readBuffer.length} 字节)`,
        );
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    return new Uint8Array(this.readBuffer.splice(0, length));
  }

  async flushReadBuffer() {
    this.readBuffer = [];
  }

  // 蓝牙不支持 setSignals，空方法或抛出错误
  async setSignals() {
    // 忽略
  }

  setDataListener(listener) {
    this.dataListener = typeof listener === "function" ? listener : null;
  }
}
