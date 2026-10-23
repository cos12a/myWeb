/**
 * MLX90614 非接触红外测温计的纯逻辑层（不含任何硬件调用）。
 *
 * 职责与 bridge/ch224.mjs 一致：集中维护寄存器功能表、位/字段含义、
 * SMBus PEC(CRC-8) 计算、温度/发射率换算，以及 CH341 I²C 命令流构造。
 * 今后调整寄存器表或换算只改这里，无需触碰硬件层。
 *
 * 依据 Melexis MLX90614 datasheet 与 Adafruit_MLX90614 库的通信约定：
 *   - 所有数据寄存器均为 16 位，低字节在前（little-endian）。
 *   - 读事务：写器件地址(写) + 寄存器地址 -> 重复起始 -> 器件地址(读) -> 读 2 数据字节 + 1 PEC 字节。
 *   - 写事务：写 器件地址(写) + 寄存器地址 + 低字节 + 高字节 + PEC（PEC 覆盖 addr<<1,reg,lo,hi）。
 *   - 命令模式：仅写一个指令字节，无数据、无 PEC。
 */

/** MLX90614 出厂默认 7 位 SMBus 地址。 */
export const MLX90614_DEFAULT_ADDRESS = 0x5a;
/** 扫描时优先尝试的地址集合（默认地址）。 */
export const MLX90614_ADDRESSES = [0x5a];

/** 温度 LSB 分辨率：0.02 K / count。 */
export const TEMP_LSB = 0.02;
/** 绝对零偏移（K）。 */
export const TEMP_OFFSET_K = 273.15;

/** RAM 寄存器上限地址（含）：0x00–0x1F 为易失 RAM，只读。 */
export const RAM_MAX = 0x1f;
/** EEPROM 地址区间：0x20–0x3F，非易失、可写（写后需重新上电完全生效）。 */
export const EEPROM_MIN = 0x20;
export const EEPROM_MAX = 0x3f;
/** 命令模式地址区间：0x60–0x7F，写一个指令字节即触发。 */
export const COMMAND_MIN = 0x60;

/** 关键温度寄存器地址。 */
export const REG_TA = 0x06; // 环境温度（die）
export const REG_TOBJ1 = 0x07; // 物体温度 1
export const REG_TOBJ2 = 0x08; // 物体温度 2（双通道）
export const REG_EMISS = 0x24; // 发射率（EEPROM）
export const REG_CONFIG = 0x25; // 配置字（EEPROM）

/** 温度可选读取来源，供前端下拉与自动读取使用。 */
export const TEMPERATURE_SOURCES = [
  { reg: REG_TOBJ1, label: "物体温度 1（TOBJ1 · 0x07）" },
  { reg: REG_TA, label: "环境温度（TA · 0x06）" },
  { reg: REG_TOBJ2, label: "物体温度 2（TOBJ2 · 0x08，双通道型号）" },
];

/**
 * 寄存器功能表：对应前端“列出所有地址功能”。
 * kind: "ram" 易失只读 / "eeprom" 非易失可读写 / "command" 命令触发（只写）。
 * access: "read" | "write"（command 为 write）。
 */
export const MLX90614_REGISTERS = [
  { address: 0x04, kind: "ram", access: "read", name: "RAWIR1", function: "物体通道 1 原始红外 ADC 值（未补偿，校准/调试用）" },
  { address: 0x05, kind: "ram", access: "read", name: "RAWIR2", function: "物体通道 2 原始红外 ADC 值" },
  { address: 0x06, kind: "ram", access: "read", name: "TA", function: "环境温度（die 温度），换算 °C = raw×0.02 − 273.15" },
  { address: 0x07, kind: "ram", access: "read", name: "TOBJ1", function: "物体温度 1（DSP 处理后），主测温通道" },
  { address: 0x08, kind: "ram", access: "read", name: "TOBJ2", function: "物体温度 2（双通道型号 DCC/DCI 等）" },
  { address: 0x09, kind: "ram", access: "read", name: "IR1", function: "通道 1 补偿计算数据 V_thermopile/V_vdd" },
  { address: 0x0a, kind: "ram", access: "read", name: "IR2", function: "通道 2 补偿计算数据" },
  { address: 0x0c, kind: "ram", access: "read", name: "MAXIR1", function: "校准期间 IR1 的最大值" },
  { address: 0x0d, kind: "ram", access: "read", name: "MAXIR2", function: "校准期间 IR2 的最大值" },
  { address: 0x0e, kind: "ram", access: "read", name: "MINIR1", function: "校准期间 IR1 的最小值" },
  { address: 0x0f, kind: "ram", access: "read", name: "MINIR2", function: "校准期间 IR2 的最小值" },
  { address: 0x10, kind: "ram", access: "read", name: "TACALC", function: "环境温度计算数据（校准辅助）" },
  { address: 0x20, kind: "eeprom", access: "write", name: "TOMAX", function: "PWM/报警高温阈值 PTOR（物体温度上限）" },
  { address: 0x21, kind: "eeprom", access: "write", name: "TOMIN", function: "PWM/报警低温阈值 PTFR（物体温度下限）" },
  { address: 0x22, kind: "eeprom", access: "write", name: "PWMCTRL", function: "PWM 频率 / 步进响应配置 PWMREG" },
  { address: 0x23, kind: "eeprom", access: "write", name: "TARANGE", function: "环境温度量程 / 计算系数 EEAMCAL" },
  { address: 0x24, kind: "eeprom", access: "write", name: "EMISS", function: "发射率系数，raw = round(0xFFFF × ε)，默认 0.95 → 62258(0xF332)" },
  { address: 0x25, kind: "eeprom", access: "write", name: "CONFIG", function: "配置字：SMBus 超时/滤波选择(bit3)/刷新率(bit11:8) 等" },
  { address: 0x2e, kind: "eeprom", access: "write", name: "ADDR", function: "SMBus 从机地址（低 7 位），写后需重新上电生效" },
  { address: 0x3c, kind: "eeprom", access: "read", name: "ID1", function: "器件唯一 ID 字 1（只读，出厂固化）" },
  { address: 0x3d, kind: "eeprom", access: "read", name: "ID2", function: "器件唯一 ID 字 2" },
  { address: 0x3e, kind: "eeprom", access: "read", name: "ID3", function: "器件唯一 ID 字 3" },
  { address: 0x3f, kind: "eeprom", access: "read", name: "ID4", function: "器件唯一 ID 字 4" },
  { address: 0x60, kind: "command", access: "write", name: "SLEEP 1s", function: "命令：进入 1 秒休眠（无数据/无 PEC）" },
  { address: 0x61, kind: "command", access: "write", name: "READ_EEPROM_UL", function: "命令：读取 EEPROM 上限边界" },
  { address: 0x62, kind: "command", access: "write", name: "READ_EEPROM_LL", function: "命令：读取 EEPROM 下限边界" },
  { address: 0x6c, kind: "command", access: "write", name: "READ_UNIQUE_ID", function: "命令：读取唯一 ID（命令模式）" },
  { address: 0x71, kind: "command", access: "write", name: "ENTER_PWM", function: "命令：临时进入 PWM 输出模式" },
  { address: 0x72, kind: "command", access: "write", name: "EXIT_PWM", function: "命令：退出 PWM 模式回到 SMBus" },
  { address: 0x73, kind: "command", access: "write", name: "EXIT_DEEP_SLEEP", function: "命令：退出深度休眠" },
  { address: 0x7e, kind: "command", access: "write", name: "ENTER_DEEP_SLEEP", function: "命令：进入深度休眠（唤醒后需重新建立通信）" },
];

/** CONFIG (0x25) 关键位定义。 */
export const CONFIG_BITS = [
  { bit: 0, name: "DIS_SMBUS_TO", description: "1 = 禁用 SMBus 超时看门狗" },
  { bit: 3, name: "FIR/IIR", description: "1 = 使用 IIR 8bit 低噪声滤波；0 = FIR" },
  { bit: 8, name: "CeDS[3:0]", description: "bit11:8 覆盖刷新率选择（0.5/1/2/4/8/16 Hz 等）" },
];

/** 按地址分类判定。 */
export function classifyRegister(address) {
  if (address >= COMMAND_MIN && address <= 0x7f) return "command";
  if (address >= EEPROM_MIN && address <= EEPROM_MAX) return "eeprom";
  if (address <= RAM_MAX) return "ram";
  return "reserved";
}

/** SMBus PEC：CRC-8，多项式 0x07（X^8+X^2+X+1），初值 0。 */
export function computePec(bytes) {
  let crc = 0;
  for (const inByte of bytes) {
    let b = inByte & 0xff;
    for (let i = 0; i < 8; i++) {
      const carry = (crc ^ b) & 0x80;
      crc = (crc << 1) & 0xff;
      if (carry) crc ^= 0x07;
      b = (b << 1) & 0xff;
    }
  }
  return crc & 0xff;
}

/** 16 位原始值 → 摄氏度。 */
export function rawToCelsius(raw) {
  return raw * TEMP_LSB - TEMP_OFFSET_K;
}

/** 摄氏度 → 华氏度。 */
export function celsiusToFahrenheit(celsius) {
  return celsius * 9 / 5 + 32;
}

/**
 * 温度有效性判定：全 0（未测量）与 0x8000（MLX 约定的错误/欠量程标志）视为无效。
 */
export function isTemperatureRawValid(raw) {
  return raw !== 0 && raw !== 0x8000;
}

/** 发射率：寄存器原始值（0..65535） ↔ 系数（约 0.1..1.0）。 */
export function emissivityRawToValue(raw) {
  return raw / 0xffff;
}

export function emissivityValueToRaw(value) {
  if (value < 0.1 || value > 1.0) {
    throw new RangeError("发射率必须在 0.1–1.0 之间。");
  }
  return Math.round(0xffff * value);
}

/**
 * CH341 StreamI2C 采用“普通模式”（非 0xAA 透明命令流）：
 *   iWriteBuffer 首字节 = I2C 器件地址 + 读写方向位，其后为数据字节；
 *   当 iReadLength > 0 时，CH341 自动完成“重复起始 + 读地址翻转 + 读 N 字节 + NAK”。
 *   （见 ch341/CH341PAR/VC/CH341DLL.H 中 CH341StreamI2C 的说明：“首字节通常是 I2C 设备地址及读写方向位”。）
 * 因此只需把 SMBus 的写阶段字节直接交给硬件层，无需手工拼 0xAA/0x74/0x80/0xC0 token。
 */

/**
 * 构造 MLX90614 SMBus 16 位读的“写阶段”字节：[器件写地址, 寄存器]。
 * 交给 hardware.streamI2C(stream, 3)：CH341 自动重复起始并读回 lo,hi,pec 三字节。
 */
export function buildReadStream(address, register) {
  const writeAddr = (address << 1) & 0xfe;
  return { stream: [writeAddr, register & 0xff], readLength: 3 };
}

/**
 * 构造 MLX90614 16 位写的完整字节（自动生成并附加 PEC）：
 *   [器件写地址, reg, lo, hi, pec]；PEC 覆盖 [addr<<1, reg, lo, hi]。
 * 低字节在前（little-endian）。
 */
export function buildWriteStream(address, register, value) {
  const writeAddr = (address << 1) & 0xfe;
  const low = value & 0xff;
  const high = (value >> 8) & 0xff;
  const pec = computePec([writeAddr, register & 0xff, low, high]);
  return {
    stream: [writeAddr, register & 0xff, low, high, pec],
    readLength: 0,
    pec,
    low,
    high,
  };
}

/**
 * 构造命令模式字节（仅写器件地址 + 一个指令字节，无数据/无 PEC）：
 *   [器件写地址, cmd]
 */
export function buildCommandStream(address, command) {
  const writeAddr = (address << 1) & 0xfe;
  return { stream: [writeAddr, command & 0xff], readLength: 0 };
}

/** 读事务的 PEC 校验：覆盖 [addr<<1(写), reg, addr<<1|1(读), lo, hi]。 */
export function verifyReadPec(address, register, low, high, pec) {
  const expected = computePec([
    (address << 1) & 0xfe,
    register & 0xff,
    ((address << 1) | 1) & 0xff,
    low,
    high,
  ]);
  return expected === pec;
}

function findRegister(address) {
  return MLX90614_REGISTERS.find((item) => item.address === address) ?? null;
}

/**
 * @typedef {Object} MlxTemperatureDetail
 * @property {number | null} celsius
 * @property {number | null} fahrenheit
 * @property {boolean} valid
 */

/**
 * @typedef {Object} MlxConfigBitDetail
 * @property {number} bit
 * @property {string} name
 * @property {string} description
 * @property {number} value
 */

/**
 * @typedef {Object} MlxRegisterDetailObj
 * @property {number} address
 * @property {string} hex
 * @property {string} binary
 * @property {number} raw
 * @property {string} name
 * @property {string} kind
 * @property {string} access
 * @property {string} description
 * @property {MlxTemperatureDetail | undefined} temperature
 * @property {number | undefined} emissivity
 * @property {MlxConfigBitDetail[] | undefined} configBits
 */

/**
 * 生成 16 位寄存器的可读解读（供前端展示），形如：
 *   { address, hex, binary, name, kind, access, description, temperature?, emissivity? }
 * value 为 16 位原始值（lo | hi<<8）。
 * @param {number} address
 * @param {number} value
 * @returns {MlxRegisterDetailObj}
 */
export function describeRegister(address, value) {
  const meta = findRegister(address);
  const kind = classifyRegister(address);
  const raw = value & 0xffff;
  /** @type {MlxRegisterDetailObj} */
  const detail = {
    address,
    hex: `0x${raw.toString(16).toUpperCase().padStart(4, "0")}`,
    binary: raw.toString(2).padStart(16, "0"),
    raw,
    name: meta?.name ??
      `未定义寄存器 0x${address.toString(16).padStart(2, "0").toUpperCase()}`,
    kind,
    access: meta?.access ??
      (kind === "eeprom" ? "write" : kind === "command" ? "write" : "read"),
    description: meta?.function ??
      "MLX90614 未在本工具寄存器表中定义此地址，读值仅作原始数据展示，写入前请核对数据手册。",
    temperature: undefined,
    emissivity: undefined,
    configBits: undefined,
  };

  // 温度寄存器附带换算
  if (address === REG_TA || address === REG_TOBJ1 || address === REG_TOBJ2) {
    if (isTemperatureRawValid(raw)) {
      const celsius = rawToCelsius(raw);
      detail.temperature = {
        celsius,
        fahrenheit: celsiusToFahrenheit(celsius),
        valid: true,
      };
    } else {
      detail.temperature = { celsius: null, fahrenheit: null, valid: false };
      detail.description +=
        "（原始值为 0 或 0x8000，通常表示尚未完成测量或超出量程）";
    }
  }

  if (address === REG_EMISS) {
    detail.emissivity = emissivityRawToValue(raw);
  }

  if (address === REG_CONFIG) {
    detail.configBits = CONFIG_BITS.map((item) => ({
      ...item,
      value: (raw >> item.bit) & 1,
    }));
  }

  return detail;
}
