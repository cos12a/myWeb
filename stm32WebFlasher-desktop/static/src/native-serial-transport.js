// ---------------------------------------------------------------------------
// 桌面版原生串口传输层（覆盖进 static/src/，原项目不使用此文件）。
//
// 通过本地 Deno 服务的 WebSocket 桥（/ws/serial）操作 Win32 原生串口，
// 完全取代浏览器 Web Serial API：不再弹浏览器授权框、可选任意 COM 口、
// DTR/RTS 拉线在后端生效后回执，时序更确定。
//
// 对外接口与原 SerialTransport 保持一致（app.js 无需感知差异）：
//   constructor(port, log, getDebugRaw)  port 为 pickNativeSerialPort() 返回的描述对象
//   setDataListener / onDisconnect / open / close / write / readExact / flushReadBuffer / setSignals
// ---------------------------------------------------------------------------

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ---- 原生串口选择（替代 navigator.serial.requestPort） ----

function makePortDescriptor(path) {
  // getInfo 返回空对象：兼容 app.js 原有 VID/PID 读取逻辑
  return { path, getInfo: () => ({}) };
}

function showPortDialog(paths) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "circuit-dialog";
    const items = paths
      .map(
        (path) =>
          `<button type="button" class="small-btn native-port-item" data-path="${path}" style="display:block;width:100%;margin:6px 0;text-align:left;">${path}</button>`,
      )
      .join("");
    dialog.innerHTML =
      `<div class="dialog-header"><h3>选择串口（本机原生）</h3></div>` +
      `<div class="dialog-body">${items}` +
      `<button type="button" class="small-btn text-muted native-port-cancel" style="display:block;width:100%;margin:6px 0;">取消</button>` +
      `</div>`;
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(dialog.returnValue === "ok" ? dialog.__chosen ?? null : null);
    });
    dialog.addEventListener("click", (event) => {
      const item = event.target.closest(".native-port-item");
      if (item) {
        dialog.__chosen = item.dataset.path;
        dialog.returnValue = "ok";
        dialog.close();
        return;
      }
      if (event.target.closest(".native-port-cancel")) {
        dialog.close();
        return;
      }
      if (event.target === dialog) dialog.close();
    });
    document.body.appendChild(dialog);
    dialog.showModal();
  });
}

export async function pickNativeSerialPort() {
  const response = await fetch("/api/serial/ports");
  if (!response.ok) throw new Error(`串口枚举失败 HTTP ${response.status}`);
  const { ports } = await response.json();
  if (!ports || ports.length === 0) {
    throw new Error("未检测到可用串口，请确认 USB 串口线已连接后重试");
  }
  if (ports.length === 1) return makePortDescriptor(ports[0].path);
  const path = await showPortDialog(ports.map((p) => p.path));
  if (!path) {
    // 与 Web Serial 取消语义一致，app.js 的 catch 会静默处理该消息
    throw new Error("No port selected by the user");
  }
  return makePortDescriptor(path);
}

// ---- WS 桥传输层 ----

export class NativeSerialTransport {
  constructor(port, log = () => {}, getDebugRaw = () => false) {
    this.path = typeof port === "string" ? port : port?.path ?? "";
    this.log = log;
    this.getDebugRaw = getDebugRaw;
    this.dataListener = null;
    this.onDisconnect = null;
    this.readBuffer = [];
    this.waiters = [];
    this._ws = null;
    this._intentionalClose = false;
    this._openAck = null; // {resolve, reject}
    this._signalAck = null;
  }

  setDataListener(listener) {
    this.dataListener = typeof listener === "function" ? listener : null;
  }

  async open(options) {
    if (!this.path) throw new Error("未选择串口");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this._ws = new WebSocket(`${proto}//${location.host}/ws/serial`);
    this._ws.binaryType = "arraybuffer";
    this._intentionalClose = false;

    await new Promise((resolve, reject) => {
      this._ws.onopen = () => {
        this._ws.send(
          JSON.stringify({
            op: "open",
            path: this.path,
            baudRate: options.baudRate,
            dataBits: options.dataBits ?? 8,
            stopBits: options.stopBits ?? 1,
            parity: options.parity ?? "none",
          }),
        );
      };
      this._ws.onerror = () => reject(new Error("无法连接本地串口桥服务"));
      this._ws.onclose = () => reject(new Error("串口桥连接已断开"));
      // 后端 {ev:"opened"} / {ev:"error"} 到达后才算打开成功
      this._ws.onmessage = (event) => this._handleMessage(event);
      this._openAck = {
        resolve: () => {
          this._ws.onopen = null;
          this._ws.onerror = null;
          this._ws.onclose = () => this._handleBridgeLost();
          resolve();
        },
        reject,
      };
    });
  }

  _handleMessage(event) {
    // 二进制帧 = 串口原始数据
    if (event.data instanceof ArrayBuffer) {
      const value = new Uint8Array(event.data);
      if (this.getDebugRaw()) {
        const hexStr = Array.from(value)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ");
        this.log(`RX RAW (${value.length}B): ${hexStr}`, "warn");
      }
      this.readBuffer.push(...value);
      if (this.dataListener) {
        this.dataListener(new Uint8Array(value));
      }
      this._resolveWaiters();
      return;
    }

    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    switch (message.ev) {
      case "opened":
        if (this._openAck) {
          const ack = this._openAck;
          this._openAck = null;
          ack.resolve();
        }
        break;
      case "signals":
        if (this._signalAck) {
          const ack = this._signalAck;
          this._signalAck = null;
          ack.resolve();
        }
        break;
      case "error": {
        const error = new Error(message.message || "串口操作失败");
        if (this._openAck) {
          const ack = this._openAck;
          this._openAck = null;
          ack.reject(error);
        } else if (this._signalAck) {
          const ack = this._signalAck;
          this._signalAck = null;
          ack.reject(error);
        } else {
          this._handleBridgeLost(error.message);
        }
        break;
      }
      case "closed":
        if (!this._openAck) this._handleBridgeLost();
        break;
    }
  }

  _handleBridgeLost(reason = "串口连接已断开（设备拔出或桥服务关闭）") {
    if (this._intentionalClose) return;
    this._intentionalClose = true;
    this.waiters.splice(0).forEach(({ reject }) => reject(new Error(reason)));
    this.dataListener = null;
    try {
      this._ws?.close();
    } catch { /* 忽略 */ }
    this._ws = null;
    if (this.onDisconnect) {
      // 与原实现一致：延迟到微任务，避免 close() 等待自身造成死锁
      queueMicrotask(() => this.onDisconnect?.());
    }
  }

  _send(payload) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error("串口未打开");
    }
    this._ws.send(JSON.stringify(payload));
  }

  async write(bytes) {
    this._send({ op: "write", data: toBase64(bytes) });
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
          reject(
            new Error(
              `读取超时 (等待 ${length} 字节, 收到 ${this.readBuffer.length} 字节)`,
            ),
          );
        }, timeoutMs),
      };
      this.waiters.push(waiter);
      this._resolveWaiters();
    });
  }

  _resolveWaiters() {
    for (const waiter of [...this.waiters]) {
      if (this.readBuffer.length < waiter.length) continue;
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((item) => item !== waiter);
      waiter.resolve(new Uint8Array(this.readBuffer.splice(0, waiter.length)));
    }
  }

  async flushReadBuffer() {
    this.readBuffer = [];
  }

  async setSignals(signals) {
    return new Promise((resolve, reject) => {
      try {
        this._send({ op: "signals", ...signals });
      } catch (error) {
        reject(error);
        return;
      }
      // 等后端真正拉线后的回执，保证复位/bootloader 入口时序以拉线成功为起点
      this._signalAck = { resolve, reject };
    });
  }

  async close() {
    this._intentionalClose = true;
    try {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ op: "close" }));
      }
    } catch { /* 忽略 */ }
    try {
      this._ws?.close();
    } catch { /* 忽略 */ }
    this._ws = null;
    this.readBuffer = [];
    this.dataListener = null;
    this.onDisconnect = null;
    this.waiters.splice(0).forEach(({ reject }) => reject(new Error("Serial port closed")));
  }
}
