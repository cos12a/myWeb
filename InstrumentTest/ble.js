/**
 * BLE 串口通信模块（Web Bluetooth + Nordic UART Service）
 *
 * 采用 NUS（Nordic UART Service）作为 BLE 透传事实标准：
 *   Service: 6e400001-b5a3-f393-e0a9-e50e24dcca9e
 *   TX (host→device, write): 6e400002-...
 *   RX (device→host, notify): 6e400003-...
 *
 * 数据帧以 \n 结尾，接收时按行重组后通过 onLine 回调。
 * 可独立挪用：const ble = new BleSerial({ onLine, onStatus }); await ble.connect();
 */

export const NUS_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const NUS_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const NUS_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export class BleSerial {
  constructor({
    serviceUuid = NUS_SERVICE,
    txUuid = NUS_TX,
    rxUuid = NUS_RX,
    onStatus = () => {},
    onData = () => {},
    onLine = () => {},
  } = {}) {
    this.serviceUuid = serviceUuid;
    this.txUuid = txUuid;
    this.rxUuid = rxUuid;
    this.onStatus = onStatus;
    this.onData = onData;
    this.onLine = onLine;
    this.device = null;
    this.server = null;
    this.txChar = null;
    this.rxChar = null;
    this._rxBuf = "";
    this._decoder = new TextDecoder();
    this._encoder = new TextEncoder();
  }

  get connected() {
    return !!this.device && !!this.device.gatt && this.device.gatt.connected;
  }

  async connect(options = {}) {
    if (!navigator.bluetooth) {
      throw new Error("当前浏览器不支持 Web Bluetooth，请使用 Chrome / Edge / Android Chrome");
    }
    const { namePrefix } = options;
    const reqOpts = { optionalServices: [this.serviceUuid] };
    if (namePrefix) reqOpts.filters = [{ namePrefix }];
    else reqOpts.acceptAllDevices = true;

    this.device = await navigator.bluetooth.requestDevice(reqOpts);
    this.device.addEventListener("gattserverdisconnected", () => this._onDisconnected());

    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(this.serviceUuid);
    this.txChar = await service.getCharacteristic(this.txUuid);
    this.rxChar = await service.getCharacteristic(this.rxUuid);
    await this.rxChar.startNotifications();
    this.rxChar.addEventListener("characteristicvaluechanged", (e) => this._onNotify(e));
    this.onStatus("connected");
  }

  async disconnect() {
    if (this.connected) this.device.gatt.disconnect();
  }

  async send(data) {
    if (!this.txChar) throw new Error("未连接");
    const bytes = typeof data === "string" ? this._encoder.encode(data) : data;
    if (this.txChar.writeValueWithoutResponse) {
      await this.txChar.writeValueWithoutResponse(bytes);
    } else {
      await this.txChar.writeValue(bytes);
    }
  }

  _onNotify(e) {
    const text = this._decoder.decode(e.target.value);
    this.onData(text);
    this._rxBuf += text;
    let idx;
    while ((idx = this._rxBuf.indexOf("\n")) >= 0) {
      const line = this._rxBuf.slice(0, idx).trim();
      this._rxBuf = this._rxBuf.slice(idx + 1);
      if (line) this.onLine(line);
    }
  }

  _onDisconnected() {
    this.server = null;
    this.txChar = null;
    this.rxChar = null;
    this._rxBuf = "";
    this.onStatus("disconnected");
  }
}