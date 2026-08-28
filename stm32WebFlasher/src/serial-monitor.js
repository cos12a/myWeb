// =====================================================
// SerialMonitor — 编程前串口监听
// 连接串口后、开始编程前，把设备主动发送的数据输出到日志。
// 数据按"累积数量"批量显示：缓冲字符数超过 flushSize（默认 5）时输出一次，
// 不按 \r\n 换行拆分。打开新串口时会先清空上一次会话的残留缓冲；开始编程时从
// 传输层摘除监听器，把串口数据流完整交还给编程接口（Stm32Bootloader），结束后恢复。
// 与传输层解耦：仅依赖 transport.setDataListener()，可在浏览器（Web Serial）
// 与 Node（serialport）下复用（使用全局 TextDecoder）。
// =====================================================

const DEFAULT_FLUSH_SIZE = 5; // 默认批量阈值：缓冲字符数超过该值时输出一次
const BINARY_THRESHOLD = 0.3; // 非可打印字节占比超过此值视为二进制

function formatText(text) {
  return text.replace(/[\x00-\x1f\x7f]/g, (ch) => {
    return `<${ch.codePointAt(0).toString(16).padStart(2, "0")}>`;
  });
}

// 格式化字节为十六进制字符串（如 "A0 B1 C2"）
function formatHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
}

export class SerialMonitor {
  constructor({
    transport = null,
    log = () => {},
    enabled = false,
    flushSize = DEFAULT_FLUSH_SIZE,
    mode = "hex",
    onData = null,
  } = {}) {
    // ← 新增 onData 参数
    this.transport = null;
    this.log = log;
    this.enabled = Boolean(enabled);
    this.programming = false;
    this._pending = "";
    this._pendingHex = "";
    this._decoder = new TextDecoder("utf-8");
    this._handleChunk = (chunk) => this._onChunk(chunk);
    this.setFlushSize(flushSize);
    this.setMode(mode);
    this.onData = typeof onData === "function" ? onData : null; // ← 保存回调
    if (transport) this.attach(transport);
  }

  // 设置输出模式：'text'（总是文本）, 'hex'（总是十六进制）, 'auto'（自动检测）
  setMode(mode) {
    this.mode = mode === "hex" || mode === "auto" ? mode : "text";
    return this;
  }

  attach(transport) {
    this.detach(); // 摘除旧监听并清空上次会话残留
    this.transport = transport;
    this._syncTransportListener();
    return this;
  }

  detach() {
    if (this.transport?.setDataListener) {
      this.transport.setDataListener(null);
    }
    this.transport = null;
    this.reset(); // 丢弃缓冲，避免上次会话数据泄漏到下一次连接
    return this;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    this._syncTransportListener();
    return this;
  }

  // 设置批量阈值：缓冲字符数超过该值即输出一次
  setFlushSize(value) {
    const parsed = Number.parseInt(value, 10);
    this.flushSize =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FLUSH_SIZE;
    return this;
  }

  // 编程开始：先输出残片，再从传输层摘除监听器，把数据流交给编程接口；
  // 编程结束：若监听仍开启，则重新挂接监听器。
  setProgramming(value) {
    const next = Boolean(value);
    if (this.programming === next) return this;
    this.programming = next;
    if (this.programming) this.flush();
    this._syncTransportListener();
    return this;
  }

  // 当前是否应输出：已开启监听、未在编程、已连接传输层
  get listening() {
    return this.enabled && !this.programming && this.transport != null;
  }

  // 检测一个字节块是否应视为二进制（hex）
  _isBinaryChunk(bytes) {
    if (bytes.length === 0) return false;
    let nonPrintable = 0;
    for (const b of bytes) {
      // 可打印 ASCII（含空格）和常用换行符视为文本
      if ((b < 0x20 || b > 0x7e) && b !== 0x0a && b !== 0x0d && b !== 0x09) {
        nonPrintable++;
      }
    }
    return nonPrintable / bytes.length >= BINARY_THRESHOLD;
  }

  _onChunk(chunk) {
    if (!this.listening) return;
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (bytes.length === 0) return;

    // ★ 新增：如果有 onData 回调，传递原始字节（即使正在编程，但 listening 已过滤）
    if (this.onData) {
      this.onData(bytes);
    }
    // 根据模式决定如何处理
    let useHex = false;
    if (this.mode === "hex") {
      useHex = true;
    } else if (this.mode === "auto") {
      useHex = this._isBinaryChunk(bytes);
    }

    if (useHex) {
      // 若当前有文本缓冲未输出，先 flush
      if (this._pending) {
        this._emitPending();
        this._decoder = new TextDecoder("utf-8"); // 重置解码器，避免状态干扰
      }
      // 将字节转为十六进制字符串并追加到十六进制缓冲
      const hexStr = formatHex(bytes);
      if (this._pendingHex) this._pendingHex += " ";
      this._pendingHex += hexStr;
      if (this._pendingHex.length > this.flushSize * 3) {
        // 粗略按字符数计算
        this._emitPendingHex();
      }
    } else {
      // 文本模式：如果有十六进制缓冲未输出，先 flush
      if (this._pendingHex) {
        this._emitPendingHex();
      }
      const text = this._decoder.decode(bytes, { stream: true });
      if (!text) return;
      this._pending += text;
      if (this._pending.length > this.flushSize) {
        this._emitPending();
      }
    }
  }

  // 输出当前缓冲（不清空 UTF-8 解码器，保留跨块多字节字符状态）
  _emitPending() {
    if (this._pending) {
      this.log(formatText(this._pending));
      this._pending = "";
    }
  }

  _emitPendingHex() {
    if (this._pendingHex) {
      this.log(`[HEX] ${this._pendingHex}`);
      this._pendingHex = "";
    }
  }

  // 重写 flush() 以同时清空两种缓冲
  // 输出当前缓冲并重置 UTF-8 解码器（编程开始 / 会话结束时使用）
  flush() {
    this._emitPending();
    this._emitPendingHex();
    this._decoder = new TextDecoder("utf-8");
    return this;
  }
  // 丢弃缓冲并重置 UTF-8 解码器（不输出任何日志）
  reset() {
    this._pending = "";
    this._pendingHex = "";
    this._decoder = new TextDecoder("utf-8");
    return this;
  }

  // 按当前状态决定是否在传输层上挂接监听器
  _syncTransportListener() {
    if (!this.transport?.setDataListener) return;
    if (this.listening) {
      this.transport.setDataListener(this._handleChunk);
    } else {
      this.transport.setDataListener(null);
    }
  }
}

export default SerialMonitor;
