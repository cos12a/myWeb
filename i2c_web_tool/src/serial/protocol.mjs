export const EEPROM_TYPES = [
  { id: 0, name: "24C01", capacity: 128 },
  { id: 1, name: "24C02", capacity: 256 },
  { id: 2, name: "24C04", capacity: 512 },
  { id: 3, name: "24C08", capacity: 1024 },
  { id: 4, name: "24C16", capacity: 2048 },
  { id: 5, name: "24C32", capacity: 4096 },
  { id: 6, name: "24C64", capacity: 8192 },
  { id: 7, name: "24C128", capacity: 16384 },
  { id: 8, name: "24C256", capacity: 32768 },
  { id: 9, name: "24C512", capacity: 65536 },
  { id: 10, name: "24C1024", capacity: 131072 },
  { id: 11, name: "24C2048", capacity: 262144 },
  { id: 12, name: "24C4096", capacity: 524288 },
];

export const I2C_SPEEDS = [0, 1, 2, 3];
export const MAX_DEVICE_INDEX = 15;
export const MAX_TRANSFER_LENGTH = 4096;
export const SPI_CHIP_SELECT_COUNT = 3;

export function parseHex(hex, { maxLength = MAX_TRANSFER_LENGTH } = {}) {
  if (typeof hex !== "string") {
    throw new TypeError("数据必须是十六进制字符串。");
  }
  const normalized = hex.replace(/[\s,;:_-]/g, "");
  if (normalized.length % 2 !== 0 || !/^[\da-f]*$/i.test(normalized)) {
    throw new TypeError("十六进制数据格式无效，请输入完整的字节。");
  }
  if (normalized.length / 2 > maxLength) {
    throw new RangeError(`数据长度不能超过 ${maxLength} 字节。`);
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function toTransferResult(buffer) {
  return {
    bytesRead: buffer.length,
    hex: [...buffer].map((value) => value.toString(16).padStart(2, "0"))
      .join(" ").toUpperCase(),
    ascii: [...buffer].map((value) =>
      value >= 32 && value <= 126 ? String.fromCharCode(value) : "."
    ).join(""),
  };
}

export function validateIndex(index) {
  if (
    !Number.isInteger(index) || index < 0 || index > MAX_DEVICE_INDEX
  ) {
    throw new RangeError(`CH341 设备序号必须在 0–${MAX_DEVICE_INDEX} 之间。`);
  }
}

export function validateSpeed(speed) {
  if (!I2C_SPEEDS.includes(speed)) {
    throw new RangeError("不支持的 I²C 速度档位。");
  }
}

export function validateAddress(address) {
  if (!Number.isInteger(address) || address < 0x08 || address > 0x77) {
    throw new RangeError("I²C 地址必须为 7 位有效地址 0x08–0x77。");
  }
}

export function validateByte(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) {
    throw new RangeError(`${label} 必须为 0–255 之间的整数。`);
  }
}

export function validateSpiChipSelect(chipSelect) {
  if (
    !Number.isInteger(chipSelect) || chipSelect < 0 ||
    chipSelect >= SPI_CHIP_SELECT_COUNT
  ) {
    throw new RangeError(
      `SPI 片选必须为 CS0–CS${SPI_CHIP_SELECT_COUNT - 1}。`,
    );
  }
}

export function validateSpiBitOrder(bitOrder) {
  if (bitOrder !== "msb" && bitOrder !== "lsb") {
    throw new TypeError("SPI 位序必须为 msb 或 lsb。");
  }
}

export function validateSpiTransferLength(writeLength, readLength) {
  if (
    !Number.isInteger(readLength) || readLength < 0 ||
    writeLength + readLength > MAX_TRANSFER_LENGTH
  ) {
    throw new RangeError(
      `SPI 收发总长度必须为 1–${MAX_TRANSFER_LENGTH} 字节。`,
    );
  }
  if (writeLength + readLength === 0) {
    throw new RangeError("SPI 发送或接收长度至少需要一个大于 0 的值。");
  }
}

export function validateCh224Address(address) {
  if (address !== 0x22 && address !== 0x23) {
    throw new RangeError("CH224 I²C 地址仅支持 0x22 或 0x23。");
  }
}

// —— MLX90614（SMBus，16 位寄存器）输入校验 ——

export const MLX90614_ADDRESSES_VALID = [0x5a];
export const MLX90614_EMISSIVITY_MIN = 0.1;
export const MLX90614_EMISSIVITY_MAX = 1.0;

export function validateMlxAddress(address) {
  // MLX90614 出厂默认 0x5A，但可从 EEPROM 修改；此处仍要求为合法的 7 位地址。
  validateAddress(address);
}

export function validateMlxRegister(register) {
  validateByte(register, "寄存器/指令地址");
}

export function validateMlxValue16(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new RangeError("写入值必须为 16 位无符号整数 0x0000–0xFFFF。");
  }
}

export function validateMlxCommand(command) {
  if (command < 0x60 || command > 0x7f) {
    throw new RangeError("MLX90614 命令模式指令地址必须位于 0x60–0x7F。");
  }
}

export function validateEmissivity(value) {
  if (
    typeof value !== "number" || !Number.isFinite(value) ||
    value < MLX90614_EMISSIVITY_MIN || value > MLX90614_EMISSIVITY_MAX
  ) {
    throw new RangeError(
      `发射率必须为 ${MLX90614_EMISSIVITY_MIN}–${MLX90614_EMISSIVITY_MAX} 之间的数值。`,
    );
  }
}

export function validateRegister(register) {
  validateByte(register, "寄存器地址");
}

export function validateCh224Voltage(voltage) {
  if (![5, 9, 12, 15, 20, 28].includes(voltage)) {
    throw new RangeError(
      "CH224A 固定电压请求仅支持 5、9、12、15、20 或 28 V 档位。",
    );
  }
}

export function validateCh224PpsVoltage(voltageMv) {
  if (!Number.isInteger(voltageMv) || voltageMv < 3300 || voltageMv > 25500) {
    throw new RangeError("PPS 请求电压必须在 3300–25500 mV 之间。");
  }
}

export function validateCh224AvsVoltage(voltageMv) {
  if (!Number.isInteger(voltageMv) || voltageMv < 5000 || voltageMv > 20000) {
    throw new RangeError("AVS 请求电压必须在 5000–20000 mV 之间。");
  }
}

export function validateCh224QcVoltage(voltage) {
  if (![5, 9, 12, 15, 20].includes(voltage)) {
    throw new RangeError(
      "QC/其它协议请求电压仅支持 5、9、12、15 或 20 V 固定档；具体可用档位由实际激活协议决定。",
    );
  }
}

export function validateEeprom(type, address, length) {
  const chip = EEPROM_TYPES.find((item) => item.id === type);
  if (!chip) throw new RangeError("未知的 EEPROM 型号。");
  if (!Number.isInteger(address) || address < 0) {
    throw new RangeError("EEPROM 偏移必须为非负整数。");
  }
  if (
    !Number.isInteger(length) || length < 1 ||
    length > MAX_TRANSFER_LENGTH || address + length > chip.capacity
  ) {
    throw new RangeError(
      `读写范围超出 ${chip.name} 容量（${chip.capacity} 字节）。`,
    );
  }
  return chip;
}

export function parseEepromWrite(type, address, hex) {
  const buffer = parseHex(hex);
  if (buffer.length === 0) throw new RangeError("写入数据不能为空。");
  validateEeprom(type, address, buffer.length);
  return buffer;
}
