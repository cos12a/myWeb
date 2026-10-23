// LWPKT 线格式纯逻辑（与 ESP32-Bus-Pirate docs/05-LWPKT-I2C协议规范.md 严格一致）。
// 帧：0xAA(START) | FROM(1B) | TO(1B) | CMD(varint,2B) | LEN(varint) | DATA | CRC-8 | 0x55(STOP)
// CRC-8 覆盖 FROM..DATA（含 CMD/LEN varint 各字节），反射多项式 0x8C、init 0、无 xorout。
// 本文件不依赖 Deno/浏览器 API，可被 FFI 控制器与单元测试直接复用。

export const START = 0xaa;
export const STOP = 0x55;
export const ADDR_DEVICE = 0x01; // TO=1 → I2C 接口（i2cp_iface_t I2CP_IFACE_I2C）
export const ADDR_HOST = 0x02;
export const MAX_FRAME_DATA = 1024; // LWPKT_CFG_MAX_DATA_LEN
export const MAX_VARINT_VALUE = 0x3fff; // 14-bit（两字节 varint 上限）

// 16-bit 命令码：高字节=功能域，低字节=序号（i2cp_cmd_t）。
export const CMD = {
  ECHO: 0x0101,
  PING: 0x0201,
  SCAN: 0x0202,
  DETECT: 0x0203,
  READ_REG: 0x0204,
  WRITE_REG: 0x0205,
  READ_BLOCK: 0x0206,
  WRITE_BLOCK: 0x0207,
  READ_RAW: 0x0208,
  WRITE_RAW: 0x0209,
  READ_MEM16: 0x020a,
  WRITE_MEM16: 0x020b,
  CONFIG: 0x0210,
  RECOVER: 0x0211,
  SWAP: 0x0212,
  // 扩展命令（占用 0x0214..0x02FF 预留区的高段）：能力协商与实例/引脚方案选择。
  // 旧固件对未知命令返回 ERR_ARG，前端据此降级为 CONFIG 自由引脚模式。
  CAPS: 0x0220,
  BUS_SELECT: 0x0221,
  // 流式采样（设备主动上报）：固件按周期或外部中断读寄存器并主动推帧，
  // 上位机在收到 STREAM_DATA 前不再发读命令。旧固件对 STREAM_START 返回
  // ERR_ARG/超时，前端降级为「单次轮询 / FIFO 批量」。
  STREAM_START: 0x0230,
  STREAM_STOP: 0x0231,
  STREAM_DATA: 0x0232,
  EEPROM_OPEN: 0x0301,
  EEPROM_READ: 0x0302,
  EEPROM_WRITE: 0x0303,
};

export const STATUS = {
  OK: 0,
  ERR_ARG: 1,
  ERR_CRC: 2,
  ERR_BUS: 3,
  ERR_NOACK: 4,
  ERR_NOTREADY: 5,
  ERR_RANGE: 6,
  ERR_UNSUPPORTED: 7,
  ERR_INTERNAL: 8,
};

export const STATUS_TEXT = {
  [STATUS.OK]: "OK",
  [STATUS.ERR_ARG]: "参数非法",
  [STATUS.ERR_CRC]: "帧 CRC 校验失败",
  [STATUS.ERR_BUS]: "I²C 总线错误（SDA/SCL 异常）",
  [STATUS.ERR_NOACK]: "器件无应答",
  [STATUS.ERR_NOTREADY]: "器件未就绪",
  [STATUS.ERR_RANGE]: "范围越界",
  [STATUS.ERR_UNSUPPORTED]: "固件不支持该命令",
  [STATUS.ERR_INTERNAL]: "设备内部错误",
};

// CONFIG 请求 flags：置位表示该字段随请求出现，未置位表示保持固件当前值。
export const CONFIG_FLAG = {
  SDA: 0x01,
  SCL: 0x02,
  FREQ: 0x04,
};

// CAPS 应答 flags：固件声明可用的配置能力。
export const CAPS_FLAG = {
  CONFIG_SET: 0x01,
  SWAP: 0x02,
  RECOVER: 0x04,
  BUS_SELECT: 0x08,
};

/** CAPS.machine：芯片平台。 */
export const MACHINE = {
  UNKNOWN: 0x00,
  ESP32: 0x01,
  STM32: 0x02,
};

/** CAPS.pin_mode：引脚是否可自由映射。 */
export const PIN_MODE = {
  FREE: 0x00,
  FIXED: 0x01,
};

/** CAPS 引脚方案 flags。 */
export const SCHEME_FLAG = {
  DEFAULT: 0x01,
  REMAP: 0x02,
  BOARD_WIRED: 0x04,
};

/**
 * CAPS v2 自由引脚表 roles 位（ESP32 等可任意映射芯片使用）：
 * 只有置了 SDA/SCL 位的 GPIO 才允许被上位机选中；
 * RESERVED 表示该引脚存在但不可用于 I²C，原因见 reason 码。
 */
export const PIN_ROLE = {
  SDA: 0x01,
  SCL: 0x02,
  DEFAULT_SDA: 0x04,
  DEFAULT_SCL: 0x08,
  RESERVED: 0x10,
  STRAP: 0x20,
  INPUT_ONLY: 0x40,
  PULLUP: 0x80,
};

/** 引脚不可用原因码（PIN_ROLE.RESERVED 时解释）。 */
export const PIN_REASON = {
  NONE: 0,
  UART0: 1,
  FLASH_PSRAM: 2,
  USB_JTAG: 3,
  STRAP: 4,
  BOARD: 5,
  NOT_EXPOSED: 6,
  INPUT_ONLY: 7,
  OTHER: 8,
};

export const PIN_REASON_TEXT = {
  [PIN_REASON.NONE]: "无",
  [PIN_REASON.UART0]: "UART0 控制台占用",
  [PIN_REASON.FLASH_PSRAM]: "Flash/PSRAM 占用",
  [PIN_REASON.USB_JTAG]: "USB/JTAG 占用",
  [PIN_REASON.STRAP]: "启动配置引脚",
  [PIN_REASON.BOARD]: "板载外设占用",
  [PIN_REASON.NOT_EXPOSED]: "模组未引出",
  [PIN_REASON.INPUT_ONLY]: "仅输入，不能作 I²C",
  [PIN_REASON.OTHER]: "其他原因",
};

// CAPS 载荷上限：防止异常固件用超长字符串/列表撑爆前端。
export const CAPS_LIMITS = {
  name: 64,
  buses: 8,
  schemes: 16,
  label: 48,
  pins: 64,
};

export class LwpktError extends Error {
  /**
   * @param {string} message 面向用户的中文错误说明
   * @param {object} [detail] {status: 固件状态码|undefined, kind: "status"|"timeout"|"frame"|"crc"}
   */
  constructor(message, detail = {}) {
    super(message);
    this.name = "LwpktError";
    this.status = detail.status;
    this.kind = detail.kind ?? "status";
  }
}

export function encodeVarint(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_VARINT_VALUE) {
    throw new RangeError(`varint 值必须为 0–${MAX_VARINT_VALUE} 之间的整数。`);
  }
  const bytes = [value & 0x7f];
  let rest = value >>> 7;
  while (rest > 0) {
    bytes[bytes.length - 1] |= 0x80;
    bytes.push(rest & 0x7f);
    rest >>>= 7;
  }
  return Uint8Array.from(bytes);
}

/**
 * 从 bytes[offset] 起解码 varint。
 * @returns {{value: number, size: number}}
 */
export function decodeVarint(bytes, offset = 0) {
  let value = 0;
  let size = 0;
  while (true) {
    if (offset + size >= bytes.length) {
      throw new LwpktError("varint 数据不完整。", { kind: "frame" });
    }
    const byte = bytes[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size += 1;
    if ((byte & 0x80) === 0) break;
    if (size > 2) {
      throw new LwpktError("varint 超过两字节上限。", { kind: "frame" });
    }
  }
  return { value, size };
}

export function crc8(bytes) {
  let crc = 0;
  for (let index = 0; index < bytes.length; index++) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0x8c : crc >>> 1;
    }
  }
  return crc & 0xff;
}

/**
 * 构造一帧请求（host → device）。
 * @param {number} cmd 16-bit 命令码
 * @param {Uint8Array} [data] 载荷
 * @param {{from?: number, to?: number}} [route]
 */
export function buildFrame(cmd, data = new Uint8Array(0), route = {}) {
  const from = route.from ?? ADDR_HOST;
  const to = route.to ?? ADDR_DEVICE;
  if (!(data instanceof Uint8Array)) {
    throw new TypeError("载荷必须是 Uint8Array。");
  }
  if (data.length > MAX_FRAME_DATA) {
    throw new RangeError(`载荷不能超过 ${MAX_FRAME_DATA} 字节。`);
  }
  const cmdBytes = encodeVarint(cmd);
  const lenBytes = encodeVarint(data.length);
  const covered = new Uint8Array(2 + cmdBytes.length + lenBytes.length + data.length);
  covered[0] = from;
  covered[1] = to;
  covered.set(cmdBytes, 2);
  covered.set(lenBytes, 2 + cmdBytes.length);
  covered.set(data, 2 + cmdBytes.length + lenBytes.length);
  const frame = new Uint8Array(covered.length + 3); // + START 已写入 index 0 → 实际 + CRC + STOP 两字节
  frame[0] = START;
  frame.set(covered, 1);
  frame[frame.length - 2] = crc8(covered);
  frame[frame.length - 1] = STOP;
  return frame;
}

export function toHex(bytes) {
  return [...bytes].map((value) => value.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");
}

/**
 * 字节流帧解码器：容忍粘包/半包/垃圾字节，按 START..STOP + CRC 再同步。
 */
export class FrameDecoder {
  #buffer = [];
  stats = { frames: 0, crcErrors: 0, resynced: 0 };

  /**
   * @param {Uint8Array} bytes 新收到的原始字节
   * @returns {Array<{from:number,to:number,cmd:number,data:Uint8Array}>}
   */
  push(bytes) {
    for (let index = 0; index < bytes.length; index++) {
      this.#buffer.push(bytes[index]);
    }
    const frames = [];
    let frame;
    while ((frame = this.#takeFrame()) !== undefined) {
      if (frame !== null) frames.push(frame);
    }
    this.stats.frames += frames.length;
    return frames;
  }

  reset() {
    this.#buffer = [];
  }

  #takeFrame() {
    const buffer = this.#buffer;
    // 丢弃 START 之前的垃圾字节
    let start = buffer.indexOf(START);
    if (start < 0) {
      if (buffer.length > 0) this.#buffer = [];
      return undefined;
    }
    if (start > 0) {
      this.stats.resynced += start;
      buffer.splice(0, start);
    }
    // 至少 START FROM TO CMD(1) LEN(1) CRC STOP
    if (buffer.length < 7) return undefined; // 等待更多字节
    let cmdInfo;
    try {
      cmdInfo = decodeVarint(new Uint8Array(buffer), 3);
    } catch {
      cmdInfo = null;
    }
    if (cmdInfo === null) {
      // CMD varint 不完整或非法：跳过当前 START 再同步
      this.stats.resynced += 1;
      buffer.splice(0, 1);
      return this.#takeFrame();
    }
    if (cmdInfo.size > 2) return undefined;
    let lenInfo;
    try {
      lenInfo = decodeVarint(new Uint8Array(buffer), 3 + cmdInfo.size);
    } catch {
      lenInfo = null;
    }
    if (lenInfo === null) {
      this.stats.resynced += 1;
      buffer.splice(0, 1);
      return this.#takeFrame();
    }
    if (lenInfo.value > MAX_FRAME_DATA) {
      this.stats.resynced += 1;
      buffer.splice(0, 1);
      return this.#takeFrame();
    }
    const dataOffset = 3 + cmdInfo.size + lenInfo.size;
    const total = dataOffset + lenInfo.value + 2; // + CRC + STOP
    if (buffer.length < total) return undefined; // 等待更多字节
    if (buffer[total - 1] !== STOP) {
      this.stats.resynced += 1;
      buffer.splice(0, 1);
      return this.#takeFrame();
    }
    const covered = new Uint8Array(buffer.slice(1, total - 2));
    const expected = buffer[total - 2];
    if (crc8(covered) !== expected) {
      this.stats.crcErrors += 1;
      buffer.splice(0, 1);
      return this.#takeFrame();
    }
    const data = new Uint8Array(buffer.slice(dataOffset, dataOffset + lenInfo.value));
    buffer.splice(0, total);
    return {
      from: covered[0],
      to: covered[1],
      cmd: cmdInfo.value,
      data,
    };
  }
}

// —— 小端读写游标 ——

export class WriteCursor {
  #bytes = [];

  u8(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new RangeError("u8 字段必须为 0–255。");
    }
    this.#bytes.push(value);
    return this;
  }

  u16(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new RangeError("u16 字段必须为 0–65535。");
    }
    this.#bytes.push(value & 0xff, value >>> 8);
    return this;
  }

  u32(value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new RangeError("u32 字段必须为 0–4294967295。");
    }
    this.#bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
    return this;
  }

  bytes(values) {
    for (const value of values) this.u8(value);
    return this;
  }

  toUint8Array() {
    return Uint8Array.from(this.#bytes);
  }
}

export class ReadCursor {
  #data;
  #offset = 0;

  constructor(data) {
    this.#data = data instanceof Uint8Array ? data : Uint8Array.from(data);
  }

  get remaining() {
    return this.#data.length - this.#offset;
  }

  /** @returns {number} */
  u8() {
    if (this.remaining < 1) throw new LwpktError("应答数据不足（u8）。", { kind: "frame" });
    return this.#data[this.#offset++];
  }

  u16() {
    if (this.remaining < 2) throw new LwpktError("应答数据不足（u16）。", { kind: "frame" });
    const value = this.#data[this.#offset] | (this.#data[this.#offset + 1] << 8);
    this.#offset += 2;
    return value;
  }

  u32() {
    if (this.remaining < 4) throw new LwpktError("应答数据不足（u32）。", { kind: "frame" });
    const value = (this.#data[this.#offset] |
      (this.#data[this.#offset + 1] << 8) |
      (this.#data[this.#offset + 2] << 16) |
      (this.#data[this.#offset + 3] << 24)) >>> 0;
    this.#offset += 4;
    return value;
  }

  bytes(count) {
    if (this.remaining < count) {
      throw new LwpktError("应答数据不足（字节串）。", { kind: "frame" });
    }
    const slice = this.#data.subarray(this.#offset, this.#offset + count);
    this.#offset += count;
    return slice;
  }
}

/** 校验应答首字节状态码，非 OK 抛 LwpktError（携带固件状态码）。 */
export function takeStatus(data, label = "命令") {
  const cursor = new ReadCursor(data);
  const status = cursor.u8();
  if (status !== STATUS.OK) {
    const text = STATUS_TEXT[status] ?? `未知状态 ${status}`;
    throw new LwpktError(`${label}失败：${text}。`, { status, kind: "status" });
  }
  return cursor;
}

// —— 各命令载荷编解码（docs/05 §7）——

export function encodePing(address) {
  return new WriteCursor().u8((address << 1) & 0xfe).toUint8Array();
}

export function decodePingResp(data) {
  const cursor = takeStatus(data, "PING");
  const dtUs = cursor.u32();
  const ack = cursor.u8();
  return { dtUs, ack: ack === 1 };
}

export function decodeScanResp(data) {
  const cursor = takeStatus(data, "SCAN");
  const count = cursor.u8();
  const addresses = [];
  for (let index = 0; index < count; index++) addresses.push(cursor.u8());
  return { addresses };
}

export function encodeReadReg(address, register) {
  return new WriteCursor().u8(address).u8(register).toUint8Array();
}

export function decodeReadRegResp(data) {
  const cursor = takeStatus(data, "读取寄存器");
  const value = cursor.u8();
  const dtUs = cursor.u32();
  return { value, dtUs };
}

export function encodeWriteReg(address, register, value) {
  return new WriteCursor().u8(address).u8(register).u8(value).toUint8Array();
}

export function encodeReadBlock(address, register, length) {
  return new WriteCursor().u8(address).u8(register).u16(length).toUint8Array();
}

export function decodeReadBlockResp(data, label = "块读取") {
  const cursor = takeStatus(data, label);
  const length = cursor.u16();
  return { bytes: cursor.bytes(length) };
}

export function encodeWriteBlock(address, register, bytes) {
  return new WriteCursor().u8(address).u8(register).u16(bytes.length).bytes(bytes)
    .toUint8Array();
}

export function encodeReadRaw(address, length) {
  return new WriteCursor().u8(address).u16(length).toUint8Array();
}

export function encodeWriteRaw(address, bytes) {
  return new WriteCursor().u8(address).u16(bytes.length).bytes(bytes).toUint8Array();
}

export function encodeReadMem16(address, register16, length) {
  return new WriteCursor().u8(address).u16(register16).u16(length).toUint8Array();
}

// —— 流式采样（STREAM_*，设备主动上报）——

/**
 * STREAM_START 请求：
 * address u8 | register u8 | length u8 | mode u8 | periodMs u16 | intPin u8 | count u16
 * mode：0=固件定时读（periodMs，0 为尽快）、1=外部中断触发读（intPin，0xFF 默认）。
 * count：0=连续推送直到 STREAM_STOP。
 */
export function encodeStreamStart(request = {}) {
  return new WriteCursor()
    .u8(request.address)
    .u8(request.register)
    .u8(request.length)
    .u8(request.mode === "int" ? 1 : 0)
    .u16(request.periodMs ?? 0)
    .u8(request.intPin ?? 0xff)
    .u16(request.count ?? 0)
    .toUint8Array();
}

/** STREAM_START 应答：status | mode u8 | periodMs u16 | flags u8（bit0=支持中断触发）。 */
export function decodeStreamStartResp(data) {
  const cursor = takeStatus(data, "STREAM_START");
  const mode = cursor.u8() === 1 ? "int" : "poll";
  const periodMs = cursor.u16();
  const flags = cursor.u8();
  return { mode, periodMs, flags, intSupported: (flags & 0x01) !== 0 };
}

/** STREAM_STOP 请求：无载荷。 */
export function encodeStreamStop() {
  return new Uint8Array(0);
}

/** STREAM_STOP 应答：status | frames u32（本次累计推送帧数）。 */
export function decodeStreamStopResp(data) {
  const cursor = takeStatus(data, "STREAM_STOP");
  return { frames: cursor.u32() };
}

/**
 * STREAM_DATA（设备→主机主动上报）：address u8 | seq u16 | length u8 | data[length]。
 * seq 由固件递增，上位机用相邻差值统计丢帧。
 */
export function decodeStreamData(data) {
  const cursor = new ReadCursor(data);
  const address = cursor.u8();
  const seq = cursor.u16();
  const length = cursor.u8();
  return { address, seq, bytes: cursor.bytes(length) };
}

export function encodeEepromOpen(address, model) {
  return new WriteCursor().u8(address).u8(model).toUint8Array();
}

export function decodeEepromOpenResp(data) {
  const cursor = takeStatus(data, "EEPROM 打开");
  const capacity = cursor.u32();
  const pageSize = cursor.u16();
  const addressBytes = cursor.u8();
  const ack = cursor.u8();
  return { capacity, pageSize, addressBytes, ack: ack === 1 };
}

export function encodeEepromRead(offset, length) {
  return new WriteCursor().u32(offset).u16(length).toUint8Array();
}

export function encodeEepromWrite(offset, bytes) {
  return new WriteCursor().u32(offset).u16(bytes.length).bytes(bytes).toUint8Array();
}

export function encodeConfigQuery() {
  return new Uint8Array([0]); // flags = 0 → 纯查询
}

export function decodeConfigResp(data) {
  const cursor = takeStatus(data, "CONFIG");
  const sda = cursor.u8();
  const scl = cursor.u8();
  const freqHz = cursor.u32();
  return { sda, scl, freqHz };
}

/**
 * CONFIG 设置请求：只把显式提供的字段放进请求，其余保持固件当前值。
 * 字段顺序固定为 flags, [sda], [scl], [freq:u32]，与 docs/05 §7.10 一致。
 * @param {{sda?: number, scl?: number, freqHz?: number}} patch
 */
export function encodeConfigSet(patch = {}) {
  const { sda, scl, freqHz } = patch;
  let flags = 0;
  if (sda !== undefined) flags |= CONFIG_FLAG.SDA;
  if (scl !== undefined) flags |= CONFIG_FLAG.SCL;
  if (freqHz !== undefined) flags |= CONFIG_FLAG.FREQ;
  const cursor = new WriteCursor().u8(flags);
  if (sda !== undefined) cursor.u8(sda);
  if (scl !== undefined) cursor.u8(scl);
  if (freqHz !== undefined) cursor.u32(freqHz);
  return cursor.toUint8Array();
}

/** SWAP 应答：交换后的 SDA/SCL。 */
export function decodeSwapResp(data) {
  const cursor = takeStatus(data, "SWAP");
  const sda = cursor.u8();
  const scl = cursor.u8();
  return { sda, scl };
}

/** CAPS 查询：无载荷。 */
export function encodeCapsQuery() {
  return new Uint8Array(0);
}

function readText(cursor, label, maxLength) {
  const length = cursor.u8();
  if (length > maxLength) {
    throw new LwpktError(
      `${label}长度 ${length} 超过上限 ${maxLength}。`,
      { kind: "frame" },
    );
  }
  return new TextDecoder().decode(cursor.bytes(length));
}

/**
 * CAPS 应答：能力版本、芯片平台、引脚模式、能力 flags、频率范围、芯片名、
 * 以及 bus_count × { bus_id, scheme_count × { scheme_id, scl, sda, af, flags, label } }。
 * @returns {{
 *   version: number,
 *   machine: "unknown"|"esp32"|"stm32",
 *   pinMode: "free"|"fixed",
 *   supportsConfigSet: boolean,
 *   supportsSwap: boolean,
 *   supportsRecover: boolean,
 *   supportsBusSelect: boolean,
 *   freqMin: number,
 *   freqMax: number,
 *   name: string,
 *   buses: Array<{id: number, schemes: Array<{id: number, scl: number, sda: number, af: number, flags: number, label: string}>}>,
 *   pins: Array<{gpio: number, sda: boolean, scl: boolean, defaultSda: boolean, defaultScl: boolean, reserved: boolean, strap: boolean, inputOnly: boolean, pullup: boolean, reason: number, reasonText: string}>,
 *   defaultSda: number|null,
 *   defaultScl: number|null
 * }}
 */
export function decodeCapsResp(data) {
  const cursor = takeStatus(data, "能力查询");
  const version = cursor.u8();
  const machineCode = cursor.u8();
  const pinModeCode = cursor.u8();
  const flags = cursor.u8();
  const freqMin = cursor.u32();
  const freqMax = cursor.u32();
  const name = readText(cursor, "芯片名称", CAPS_LIMITS.name);
  const busCount = cursor.u8();
  if (busCount > CAPS_LIMITS.buses) {
    throw new LwpktError(
      `I²C 实例数量 ${busCount} 超过上限 ${CAPS_LIMITS.buses}。`,
      { kind: "frame" },
    );
  }
  const buses = [];
  for (let busIndex = 0; busIndex < busCount; busIndex++) {
    const id = cursor.u8();
    const schemeCount = cursor.u8();
    if (schemeCount > CAPS_LIMITS.schemes) {
      throw new LwpktError(
        `I2C${id} 引脚方案数量 ${schemeCount} 超过上限 ${CAPS_LIMITS.schemes}。`,
        { kind: "frame" },
      );
    }
    const schemes = [];
    for (let schemeIndex = 0; schemeIndex < schemeCount; schemeIndex++) {
      const schemeId = cursor.u8();
      const scl = cursor.u8();
      const sda = cursor.u8();
      const af = cursor.u8();
      const schemeFlags = cursor.u8();
      const label = readText(cursor, "引脚方案标签", CAPS_LIMITS.label);
      schemes.push({ id: schemeId, scl, sda, af, flags: schemeFlags, label });
    }
    buses.push({ id, schemes });
  }
  // v1 固件到这里就结束；v2 追加自由引脚表（pin_count=0 等同于不提供）。
  const pins = [];
  if (cursor.remaining > 0) {
    const pinCount = cursor.u8();
    if (pinCount > CAPS_LIMITS.pins) {
      throw new LwpktError(
        `可用引脚数量 ${pinCount} 超过上限 ${CAPS_LIMITS.pins}。`,
        { kind: "frame" },
      );
    }
    for (let index = 0; index < pinCount; index++) {
      const gpio = cursor.u8();
      const roles = cursor.u8();
      const reason = cursor.u8();
      pins.push({
        gpio,
        sda: (roles & PIN_ROLE.SDA) !== 0,
        scl: (roles & PIN_ROLE.SCL) !== 0,
        defaultSda: (roles & PIN_ROLE.DEFAULT_SDA) !== 0,
        defaultScl: (roles & PIN_ROLE.DEFAULT_SCL) !== 0,
        reserved: (roles & PIN_ROLE.RESERVED) !== 0,
        strap: (roles & PIN_ROLE.STRAP) !== 0,
        inputOnly: (roles & PIN_ROLE.INPUT_ONLY) !== 0,
        pullup: (roles & PIN_ROLE.PULLUP) !== 0,
        reason,
        reasonText: PIN_REASON_TEXT[reason] ?? `未知原因 ${reason}`,
      });
    }
  }
  const defaultSda = pins.find((pin) => pin.defaultSda && pin.sda)?.gpio ?? null;
  const defaultScl = pins.find((pin) => pin.defaultScl && pin.scl)?.gpio ?? null;
  return {
    version,
    machine: machineCode === MACHINE.ESP32
      ? "esp32"
      : machineCode === MACHINE.STM32
      ? "stm32"
      : "unknown",
    pinMode: pinModeCode === PIN_MODE.FIXED ? "fixed" : "free",
    supportsConfigSet: (flags & CAPS_FLAG.CONFIG_SET) !== 0,
    supportsSwap: (flags & CAPS_FLAG.SWAP) !== 0,
    supportsRecover: (flags & CAPS_FLAG.RECOVER) !== 0,
    supportsBusSelect: (flags & CAPS_FLAG.BUS_SELECT) !== 0,
    freqMin,
    freqMax,
    name,
    buses,
    pins,
    defaultSda,
    defaultScl,
  };
}

/**
 * BUS_SELECT 请求：bus_id(u8), scheme_id(u8), freq(u32)。freq=0 表示保持当前频率。
 */
export function encodeBusSelect(busId, schemeId, freqHz = 0) {
  return new WriteCursor().u8(busId).u8(schemeId).u32(freqHz).toUint8Array();
}

/** BUS_SELECT 应答：设置后的引脚/频率与生效的实例/方案编号。 */
export function decodeBusSelectResp(data) {
  const cursor = takeStatus(data, "切换 I²C 实例");
  const sda = cursor.u8();
  const scl = cursor.u8();
  const freqHz = cursor.u32();
  const busId = cursor.u8();
  const schemeId = cursor.u8();
  return { sda, scl, freqHz, busId, schemeId };
}

export function encodeEcho(payload) {
  return payload;
}

export function decodeEchoResp(data) {
  const cursor = takeStatus(data, "ECHO");
  return { echo: cursor.bytes(cursor.remaining) };
}
