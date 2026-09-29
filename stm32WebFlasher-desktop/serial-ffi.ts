// ---------------------------------------------------------------------------
// Win32 原生串口实现（Deno FFI 直调 kernel32.dll，无第三方原生依赖）。
// 仅支持 Windows；其它平台下 listSerialPorts 返回空、open 抛出明确错误。
// 设计目标：为桌面版提供与 Web Serial 等价的能力——
//   打开/关闭、任意波特率、奇偶校验、读写、DTR/RTS 信号控制、COM 口枚举。
// ---------------------------------------------------------------------------

export type SerialOpenOptions = {
  baudRate: number;
  dataBits?: number; // 默认 8
  stopBits?: number; // 1 | 2，默认 1
  parity?: "none" | "even" | "odd"; // 默认 "none"
};

// Win32 常量
const GENERIC_READ = 0x80000000;
const GENERIC_WRITE = 0x40000000;
const OPEN_EXISTING = 3;
const FILE_ATTRIBUTE_NORMAL = 0x80;
const PURGE_RXCLEAR = 0x0002;
const PURGE_TXCLEAR = 0x0008;

// EscapeCommFunction 指令
const SETRTS = 3;
const CLRRTS = 4;
const SETDTR = 5;
const CLRDTR = 6;

// DCB 结构内存布局（共 28 字节，手动按偏移读写，避免 FFI struct 互操作差异）
const DCB_SIZE = 28;
const DCB_OFF_BAUDRATE = 4;
const DCB_OFF_FLAGS = 8;
const DCB_OFF_BYTESIZE = 18;
const DCB_OFF_PARITY = 19;
const DCB_OFF_STOPBITS = 20;

// DCB flags 位：fBinary=bit0（必须为1），fParity=bit1；其余全部清零，
// 特别是 fNull=0（否则 0x00 字节会被丢弃，STM32 二进制协议致命）、
// fDtrControl/fRtsControl=0（DISABLE，由 EscapeCommFunction 显式控制）。
const F_BINARY = 1 << 0;
const F_PARITY = 1 << 1;

// COMMTIMEOUTS 结构（20 字节）
const COMMTIMEOUTS_SIZE = 20;
const READ_INTERVAL_MAXDWORD = 0xffffffff;

// COMSTAT 结构（12 字节）
const COMSTAT_SIZE = 12;

const PARITY_MAP: Record<string, number> = {
  none: 0,
  odd: 1,
  even: 2,
};

type Kernel32 = ReturnType<typeof openKernel32>;

let kernel32Cache: Kernel32 | null = null;

function openKernel32() {
  return Deno.dlopen(
    new URL("file:///C:/Windows/System32/kernel32.dll"),
    {
      CreateFileW: {
        parameters: [
          "buffer",
          "u32",
          "u32",
          "pointer",
          "u32",
          "u32",
          "pointer",
        ],
        result: "pointer",
      },
      CloseHandle: { parameters: ["pointer"], result: "i32" },
      GetLastError: { parameters: [], result: "u32" },
      GetCommState: { parameters: ["pointer", "buffer"], result: "i32" },
      SetCommState: { parameters: ["pointer", "buffer"], result: "i32" },
      SetCommTimeouts: { parameters: ["pointer", "buffer"], result: "i32" },
      SetupComm: { parameters: ["pointer", "u32", "u32"], result: "i32" },
      PurgeComm: { parameters: ["pointer", "u32"], result: "i32" },
      ClearCommError: {
        parameters: ["pointer", "buffer", "buffer"],
        result: "i32",
      },
      EscapeCommFunction: { parameters: ["pointer", "u32"], result: "i32" },
      ReadFile: {
        parameters: ["pointer", "buffer", "u32", "buffer", "pointer"],
        result: "i32",
      },
      WriteFile: {
        parameters: ["pointer", "buffer", "u32", "buffer", "pointer"],
        result: "i32",
      },
    } as const,
  ).symbols;
}

function kernel32(): Kernel32 {
  if (Deno.build.os !== "windows") {
    throw new Error("原生串口仅支持 Windows 平台");
  }
  if (!kernel32Cache) kernel32Cache = openKernel32();
  return kernel32Cache;
}

// UTF-16LE 编码（CreateFileW 需要宽字符路径，如 \\.\COM3）
function toUtf16(text: string): Uint8Array {
  const buf = new Uint8Array((text.length + 1) * 2);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < text.length; i++) {
    view.setUint16(i * 2, text.charCodeAt(i), true);
  }
  return buf;
}

function u32View(bytes: number): { buf: Uint8Array; view: DataView } {
  const buf = new Uint8Array(bytes);
  return { buf, view: new DataView(buf.buffer) };
}

// FFI 函数参数统一使用 Deno.PointerValue；CreateFileW 返回的 UnsafePointer
// 接口与 PointerObject 品牌不同，仅在句柄创建处做一次收敛转换。
type Handle = Deno.PointerValue;

function isInvalidHandle(handle: unknown): boolean {
  if (handle === null) return true;
  try {
    // 本地放宽签名：dlopen 返回的指针实例与 value() 参数的品牌类型不同源，
    // 但运行时语义相同（读取指针数值以判定 INVALID_HANDLE_VALUE）。
    const readValue = Deno.UnsafePointer.value as (p: unknown) => number | bigint;
    const value = BigInt(readValue(handle));
    // INVALID_HANDLE_VALUE = (HANDLE)-1：Deno 指针数值可能为有符号 -1n
    // 或无符号 0xFFFFFFFFFFFFFFFFn，两者都要判定。
    return value === -1n || value === 0xffffffffffffffffn;
  } catch {
    return true;
  }
}

function lastError(): number {
  return kernel32().GetLastError();
}

function win32Error(message: string): Error {
  return new Error(`${message} (Win32 错误码 ${lastError()})`);
}

// ---------------------------------------------------------------------------
// COM 口枚举：读取注册表 HARDWARE\DEVICEMAP\SERIALCOMM（驱动加载即写入，
// 覆盖 CH340/CP210x/FTDI 等所有虚拟串口），按 COM 编号排序。
// ---------------------------------------------------------------------------
export async function listSerialPorts(): Promise<string[]> {
  if (Deno.build.os !== "windows") return [];
  try {
    const command = new Deno.Command("reg", {
      args: ["query", "HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM"],
      stdout: "piped",
      stderr: "null",
    });
    const { stdout } = await command.output();
    const text = new TextDecoder().decode(stdout);
    const ports = new Set<string>();
    for (const match of text.matchAll(/REG_SZ\s+(COM\d+)/gi)) {
      const port = match[1];
      if (port) ports.add(port.toUpperCase());
    }
    return [...ports].sort(
      (a, b) => Number(a.slice(3)) - Number(b.slice(3)),
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 原生串口会话：同步 Win32 调用 + 定时器轮询读取。
// 读超时配置为「立即返回」（ReadIntervalTimeout=MAXDWORD），因此轮询不会
// 阻塞事件循环；轮询间隔 3ms，兼顾时延与 CPU 占用。
// ---------------------------------------------------------------------------
export class NativeSerialPort {
  #handle: Handle = null;
  #readTimer: ReturnType<typeof setInterval> | null = null;
  #readBuf = new Uint8Array(4096);
  #bytesRead = u32View(4);
  #commErrors = u32View(4);
  #commStat = u32View(COMSTAT_SIZE);
  #closedByUser = false;

  /** 收到数据时回调 */
  onData: ((chunk: Uint8Array) => void) | null = null;
  /** 设备拔出/读写失败时回调（仅触发一次） */
  onError: ((error: Error) => void) | null = null;

  readonly path: string;

  constructor(path: string) {
    // 规范化：COM3 -> \\.\COM3（COM10 及以上必须使用设备路径前缀）
    this.path = /^COM\d+$/i.test(path) ? `\\\\.\\${path.toUpperCase()}` : path;
  }

  get isOpen(): boolean {
    return this.#handle !== null;
  }

  open(options: SerialOpenOptions): void {
    if (this.#handle) throw new Error("串口已打开");
    const k32 = kernel32();

    const rawHandle = k32.CreateFileW(
      toUtf16(this.path),
      (GENERIC_READ | GENERIC_WRITE) >>> 0,
      0, // 独占访问
      null,
      OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL,
      null,
    );
    if (isInvalidHandle(rawHandle)) {
      throw win32Error(`无法打开串口 ${this.path}`);
    }
    const handle = rawHandle as unknown as Handle;
    this.#handle = handle;
    this.#closedByUser = false;

    try {
      k32.SetupComm(handle, 8192, 8192);

      // 先取当前 DCB 再改字段，保证保留驱动默认值
      const dcb = u32View(DCB_SIZE);
      dcb.view.setUint32(0, DCB_SIZE, true);
      if (!k32.GetCommState(handle, dcb.buf)) {
        throw win32Error("GetCommState 失败");
      }
      dcb.view.setUint32(DCB_OFF_BAUDRATE, options.baudRate >>> 0, true);
      let flags = F_BINARY;
      const parity = options.parity ?? "none";
      if (parity !== "none") flags |= F_PARITY;
      dcb.view.setUint32(DCB_OFF_FLAGS, flags, true);
      dcb.view.setUint8(DCB_OFF_BYTESIZE, options.dataBits ?? 8);
      dcb.view.setUint8(DCB_OFF_PARITY, PARITY_MAP[parity] ?? 0);
      dcb.view.setUint8(DCB_OFF_STOPBITS, (options.stopBits ?? 1) === 2 ? 2 : 0);
      if (!k32.SetCommState(handle, dcb.buf)) {
        throw win32Error(`SetCommState 失败（波特率 ${options.baudRate}）`);
      }

      // 非阻塞读：ReadFile 立即返回已收到的字节（可能为 0）
      const timeouts = u32View(COMMTIMEOUTS_SIZE);
      timeouts.view.setUint32(0, READ_INTERVAL_MAXDWORD, true);
      timeouts.view.setUint32(4, 0, true);
      timeouts.view.setUint32(8, 0, true);
      timeouts.view.setUint32(12, 0, true);
      timeouts.view.setUint32(16, 0, true);
      if (!k32.SetCommTimeouts(handle, timeouts.buf)) {
        throw win32Error("SetCommTimeouts 失败");
      }

      // 打开时清空收发缓冲，保证新会话从干净状态开始
      k32.PurgeComm(handle, PURGE_RXCLEAR | PURGE_TXCLEAR);
    } catch (error) {
      this.close();
      throw error;
    }

    this.#readTimer = setInterval(() => this.#pollRead(), 3);
  }

  #pollRead(): void {
    const handle = this.#handle;
    if (!handle || this.#closedByUser) return;
    const k32 = kernel32();

    // 必须先 ClearCommError：出现通信错误后读写会被挂起，直到调用它复位
    if (!k32.ClearCommError(handle, this.#commErrors.buf, this.#commStat.buf)) {
      this.#fail(new Error(`串口通信异常 (Win32 错误码 ${lastError()})`));
      return;
    }

    const ok = k32.ReadFile(
      handle,
      this.#readBuf,
      this.#readBuf.length,
      this.#bytesRead.buf,
      null,
    );
    if (!ok) {
      // 设备拔出典型错误码：5(拒绝访问) 22(设备不存在) 1167(设备已断开)
      this.#fail(new Error(`串口读取失败 (Win32 错误码 ${lastError()})`));
      return;
    }
    const count = this.#bytesRead.view.getUint32(0, true);
    if (count > 0 && this.onData) {
      this.onData(this.#readBuf.slice(0, count));
    }
  }

  #fail(error: Error): void {
    if (this.#closedByUser) return;
    this.close();
    this.onError?.(error);
  }

  write(bytes: Uint8Array): void {
    const handle = this.#handle;
    if (!handle) throw new Error("串口未打开");
    const written = u32View(4);
    const ok = kernel32().WriteFile(handle, bytes, bytes.length, written.buf, null);
    if (!ok) {
      this.#fail(new Error(`串口写入失败 (Win32 错误码 ${lastError()})`));
      throw new Error("串口写入失败（设备可能已拔出）");
    }
  }

  /** Web Serial 语义：dataTerminalReady/requestToSend 为 true 表示置位信号线 */
  setSignals(signals: {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
  }): void {
    const handle = this.#handle;
    if (!handle) throw new Error("串口未打开");
    const k32 = kernel32();
    if (signals.dataTerminalReady !== undefined) {
      if (!k32.EscapeCommFunction(handle, signals.dataTerminalReady ? SETDTR : CLRDTR)) {
        throw win32Error("DTR 信号设置失败");
      }
    }
    if (signals.requestToSend !== undefined) {
      if (!k32.EscapeCommFunction(handle, signals.requestToSend ? SETRTS : CLRRTS)) {
        throw win32Error("RTS 信号设置失败");
      }
    }
  }

  close(): void {
    this.#closedByUser = true;
    if (this.#readTimer !== null) {
      clearInterval(this.#readTimer);
      this.#readTimer = null;
    }
    const handle = this.#handle;
    if (handle) {
      this.#handle = null;
      try {
        kernel32().PurgeComm(handle, PURGE_RXCLEAR | PURGE_TXCLEAR);
        kernel32().CloseHandle(handle);
      } catch {
        // 关闭失败无需上报，句柄可能已随设备拔出失效
      }
    }
  }
}
