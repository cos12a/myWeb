export class SerialTransport {
  // constructor(port, log = () => {}) {
  //   this.port = port;
  //   this.log = log;
  //   this.reader = null;
  //   this.writer = null;
  //   this.readBuffer = [];
  //   this._readingPromise = null;
  //   this._keepReading = false;
  // }

  // 修改构造函数，增加 getDebugRaw 回调
  constructor(port, log = () => {}, getDebugRaw = () => false) {
    this.port = port;
    this.log = log;
    this.getDebugRaw = getDebugRaw; // 保存回调
    this.dataListener = null; // 外部数据监听（如编程前串口监听器）
    this.onDisconnect = null; // 异常断开回调（设备拔出/读错误）
    this.reader = null;
    this.writer = null;
    this.readBuffer = [];
    this._readingPromise = null;
    this._keepReading = false;
  }

  // 注册外部数据监听器：每个收到的数据块都会被转发一份（不影响 readBuffer）
  setDataListener(listener) {
    this.dataListener = typeof listener === "function" ? listener : null;
  }

  async open(options) {
    await this.port.open({ bufferSize: 8192, ...options });
    this.writer = this.port.writable.getWriter();
    // Use a background reading loop to keep buffer flowing
    this._keepReading = true;
    this._readingPromise = this._readLoop();
  }

  async _readLoop() {
    while (this.port.readable && this._keepReading) {
      this.reader = this.port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) {
            // 流被远端关闭但并非我们主动断开，按异常断开处理
            if (this._keepReading) this._scheduleDisconnect();
            break;
          }
          if (value) {
            // 【核心改动】通过回调实时判断开关状态
            if (this.getDebugRaw()) {
              const hexStr = Array.from(value)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join(" ");
              this.log(`RX RAW (${value.length}B): ${hexStr}`, "warn"); // 用 warn 颜色区分
            }
            this.readBuffer.push(...value);
            // 转发一份给外部监听器（复制，避免复用缓冲被覆盖）
            if (this.dataListener) {
              this.dataListener(new Uint8Array(value));
            }
          }
        }
      } catch (error) {
        if (this._keepReading) {
          this.log(`Serial read error: ${error.message}`);
          this._scheduleDisconnect();
        }
      } finally {
        try {
          this.reader.releaseLock();
        } catch (_) {}
        this.reader = null;
      }
      break; // 单次连接读取循环结束，异常断开由 onDisconnect 统一收尾
    }
  }

  // 延迟到当前读取循环退出后触发断开回调，避免 close() 等待自身造成死锁
  _scheduleDisconnect() {
    if (!this.onDisconnect) return;
    const callback = this.onDisconnect;
    queueMicrotask(() => callback());
  }

  async close() {
    this._keepReading = false;

    // Stop the reader
    try {
      if (this.reader) {
        await this.reader.cancel();
      }
    } catch (_) {}

    if (this._readingPromise) {
      await this._readingPromise.catch(() => {});
    }

    try {
      if (this.writer) {
        await this.writer.close();
        this.writer.releaseLock();
      }
    } catch (error) {
      this.log(`Writer close warning: ${error.message}`);
    }

    if (this.port?.readable || this.port?.writable) {
      await this.port.close();
    }

    this.reader = null;
    this.writer = null;
    this.readBuffer = [];
    this.dataListener = null;
    this.onDisconnect = null;
  }

  async write(bytes) {
    if (!this.writer) throw new Error("串口未打开");
    await this.writer.write(new Uint8Array(bytes));
  }

  async readExact(length, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (this.readBuffer.length < length) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `读取超时 (等待 ${length} 字节, 收到 ${this.readBuffer.length} 字节)`,
        );
      }
      // wait a tiny bit to let the background reader push data
      await new Promise((r) => setTimeout(r, 10));
    }
    return new Uint8Array(this.readBuffer.splice(0, length));
  }

  async flushReadBuffer() {
    this.readBuffer = [];
  }

  async setSignals(signals) {
    await this.port.setSignals(signals);
  }
}

function invertChoice(choice) {
  return choice
    .replace("true", "TMP")
    .replace("false", "true")
    .replace("TMP", "false");
}

function applyChoice(signals, choice) {
  const [name, rawValue] = choice.split("-");
  const value = rawValue === "true";
  if (name === "dtr") signals.dataTerminalReady = value;
  if (name === "rts") signals.requestToSend = value;
}

function signalsForChoice(choice) {
  const signals = {};
  applyChoice(signals, choice);
  return signals;
}

function isCh340xMode(modeOrConfig) {
  return modeOrConfig === "ch340x";
}

const RESET_PRESETS = {
  "dtr-high-rts-low": {
    boot0High: "rts-true",
    boot0Low: "rts-false",
    resetAssert: "dtr-false",
  },
  "dtr-low-rts-high": {
    boot0High: "rts-true",
    boot0Low: "rts-false",
    resetAssert: "dtr-true",
  },
  "boot-rts-low-reset-dtr-low": {
    boot0High: "rts-true",
    boot0Low: "rts-false",
    resetAssert: "dtr-true",
  },
  "boot-rts-low-reset-dtr-high": {
    boot0High: "rts-true",
    boot0Low: "rts-false",
    resetAssert: "dtr-false",
  },
  "boot-rts-high-reset-dtr-low": {
    boot0High: "rts-false",
    boot0Low: "rts-true",
    resetAssert: "dtr-true",
  },
  "boot-rts-high-reset-dtr-high": {
    boot0High: "rts-false",
    boot0Low: "rts-true",
    resetAssert: "dtr-false",
  },
  "boot-dtr-low-reset-rts-low": {
    boot0High: "dtr-true",
    boot0Low: "dtr-false",
    resetAssert: "rts-true",
  },
  "boot-dtr-low-reset-rts-high": {
    boot0High: "dtr-true",
    boot0Low: "dtr-false",
    resetAssert: "rts-false",
  },
  "boot-dtr-high-reset-rts-low": {
    boot0High: "dtr-false",
    boot0Low: "dtr-true",
    resetAssert: "rts-true",
  },
  "boot-dtr-high-reset-rts-high": {
    boot0High: "dtr-false",
    boot0Low: "dtr-true",
    resetAssert: "rts-false",
  },
};

function normalizeResetConfig(modeOrConfig) {
  if (!modeOrConfig) {
    return RESET_PRESETS["dtr-high-rts-low"];
  }
  if (isCh340xMode(modeOrConfig)) {
    return null;
  }
  if (modeOrConfig === "none") return null;
  if (RESET_PRESETS[modeOrConfig]) {
    return RESET_PRESETS[modeOrConfig];
  }
  if (typeof modeOrConfig === "object") {
    const boot0High = modeOrConfig.boot0High ?? "dtr-false";
    return {
      boot0High,
      boot0Low: modeOrConfig.boot0Low ?? invertChoice(boot0High),
      resetAssert: modeOrConfig.resetAssert ?? "rts-true",
    };
  }
  return {
    boot0High: "dtr-false",
    boot0Low: "dtr-true",
    resetAssert: "rts-true",
  };
}

export function bootloaderEntryStages(modeOrConfig) {
  if (isCh340xMode(modeOrConfig)) {
    return [
      {
        name: "CH340X 直连电路",
        config: "ch340x",
      },
    ];
  }
  return [{ name: "default", config: modeOrConfig }];
}

// STM32 进入 Bootloader 物理时序（兼容 CH340C 经典三极管和 CH340X 直连，并允许自定义映射）
export async function enterBootloader(transport, delay, modeOrConfig) {
  if (isCh340xMode(modeOrConfig)) {
    // CH340X 直连实测时序：先释放 RESET 并保持 BOOT0 运行态，再建立 BOOT 条件、脉冲 RESET。
    await transport.setSignals({
      requestToSend: false,
      dataTerminalReady: true,
    });
    await delay(150);

    await transport.setSignals({
      requestToSend: true,
      dataTerminalReady: true,
    });
    await delay(150);

    await transport.setSignals({
      requestToSend: true,
      dataTerminalReady: false,
    });
    await delay(150);

    await transport.setSignals({
      requestToSend: true,
      dataTerminalReady: true,
    });
    await delay(1000);
    return;
  }

  const config = normalizeResetConfig(modeOrConfig);
  if (!config) return;

  await transport.setSignals(signalsForChoice(config.boot0High));
  await delay(100);

  await transport.setSignals(signalsForChoice(config.resetAssert));
  await delay(100);

  await transport.setSignals(
    signalsForChoice(invertChoice(config.resetAssert)),
  );
  await delay(800);
}

// 物理复位并运行用户程序
export async function resetToRun(transport, delay, modeOrConfig) {
  if (isCh340xMode(modeOrConfig)) {
    // CH340X 直连：退出 BOOT 条件后脉冲 RESET，运行用户程序。
    await transport.setSignals({
      requestToSend: false,
      dataTerminalReady: false,
    });
    await delay(250);

    await transport.setSignals({
      requestToSend: false,
      dataTerminalReady: true,
    });
    await delay(250);

    await transport.setSignals({
      requestToSend: false,
      dataTerminalReady: false,
    });
    await delay(1000);
    return;
  }

  const config = normalizeResetConfig(modeOrConfig);
  if (!config) return;

  await transport.setSignals(signalsForChoice(config.boot0Low));
  await delay(100);

  await transport.setSignals(signalsForChoice(config.resetAssert));
  await delay(100);

  await transport.setSignals(
    signalsForChoice(invertChoice(config.resetAssert)),
  );
  await delay(200);

  await transport.setSignals({
    dataTerminalReady: false,
    requestToSend: false,
  });
  await delay(800);
}
