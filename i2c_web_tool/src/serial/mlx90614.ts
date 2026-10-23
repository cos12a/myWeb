import {
  MLX90614_ADDRESSES,
  MLX90614_REGISTERS,
  buildCommandStream,
  buildReadStream,
  buildWriteStream,
  classifyRegister,
  celsiusToFahrenheit,
  describeRegister,
  emissivityRawToValue,
  emissivityValueToRaw,
  isTemperatureRawValid,
  rawToCelsius,
  verifyReadPec,
} from "./mlx90614.mjs";
import {
  validateEmissivity,
  validateMlxAddress,
  validateMlxCommand,
  validateMlxRegister,
  validateMlxValue16,
} from "./protocol.mjs";
import type { I2cBackend } from "./backend.ts";

/** 无响应/未上电判定：总线上拉时 CH341 读“成功”但数据全为 0xFF。 */
const NO_RESPONSE_BYTE = 0xff;
/** EEPROM 擦写之间的等待（毫秒），对齐 Melexis 应用笔记时序。 */
const EEPROM_WRITE_DELAY_MS = 10;

interface MlxRawRead {
  raw: number;
  low: number;
  high: number;
  pec: number;
  pecValid: boolean;
  noResponse: boolean;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Mlx90614Controller {
  #hardware: I2cBackend;

  constructor(hardware: I2cBackend) {
    this.#hardware = hardware;
  }

  /** 扫描默认地址 0x5A 是否应答。 */
  async discover() {
    const { addresses } = await this.#hardware.scan(0x5a, 0x5a);
    return {
      addresses: addresses.filter((address) =>
        MLX90614_ADDRESSES.includes(address)
      ),
    };
  }

  listRegisters() {
    return { registers: MLX90614_REGISTERS };
  }

  /** 读取 16 位寄存器原始值（组合命令流 + PEC 校验）。 */
  async readRegister16(
    address: number,
    register: number,
  ): Promise<MlxRawRead> {
    validateMlxAddress(address);
    validateMlxRegister(register);
    const { stream, readLength } = buildReadStream(address, register);
    const bytes = await this.#hardware.streamI2C(
      Uint8Array.from(stream),
      readLength,
    );
    if (bytes.length < 3) {
      throw new Error("MLX90614 读事务返回字节不足，请检查接线与地址。");
    }
    const [low, high, pec] = bytes;
    const noResponse = low === NO_RESPONSE_BYTE && high === NO_RESPONSE_BYTE;
    return {
      raw: (low | (high << 8)) & 0xffff,
      low,
      high,
      pec,
      pecValid: verifyReadPec(address, register, low, high, pec),
      noResponse,
    };
  }

  /** 通用寄存器读取：返回原始值 + 语义解读（温度/发射率等）。 */
  async readRegister(address: number, register: number) {
    const read = await this.readRegister16(address, register);
    const detail = describeRegister(register, read.raw);
    return {
      address,
      register,
      ...read,
      detail,
      message: read.noResponse
        ? "读数全为 0xFF：器件疑似未上电或 I²C 无应答，请检查 VDD/GND、上拉电阻与地址。"
        : read.pecValid
        ? "读取成功，PEC 校验通过。"
        : "读取完成，但 PEC 校验不通过：可能受总线干扰，建议重试或降低 I²C 速度。",
    };
  }

  /**
   * 写 16 位寄存器。按地址区间自动选择安全流程：
   *   - RAM（0x00–0x1F）只读，拒绝写入。
   *   - EEPROM（0x20–0x3F）：擦除(写0) -> 写值 -> 回读校验（Melexis 四步法，不含重新上电）。
   *   - 命令（0x60–0x7F）：写单指令字节，无数据/PEC。
   */
  async writeRegister(address: number, register: number, value: number) {
    validateMlxAddress(address);
    validateMlxRegister(register);
    const kind = classifyRegister(register);

    if (kind === "ram") {
      throw new RangeError(
        "RAM 寄存器（0x00–0x1F）为只读，MLX90614 不支持写入，已取消操作。",
      );
    }

    if (kind === "command") {
      validateMlxCommand(register);
      const { stream } = buildCommandStream(address, register);
      await this.#hardware.streamI2C(Uint8Array.from(stream), 0);
      return {
        address,
        register,
        kind,
        commandOnly: true,
        message: `已发送命令 0x${
          register.toString(16).padStart(2, "0").toUpperCase()
        }（命令模式，无数据/PEC）。`,
      };
    }

    // EEPROM 安全写：擦 -> 写 -> 回读校验
    validateMlxValue16(value);
    const erase = buildWriteStream(address, register, 0x0000);
    await this.#hardware.streamI2C(Uint8Array.from(erase.stream), 0);
    await delay(EEPROM_WRITE_DELAY_MS);
    const write = buildWriteStream(address, register, value);
    await this.#hardware.streamI2C(Uint8Array.from(write.stream), 0);
    await delay(EEPROM_WRITE_DELAY_MS);
    const readback = await this.readRegister16(address, register);
    const matches = readback.raw === value;
    const hex = (value & 0xffff).toString(16).toUpperCase().padStart(4, "0");
    return {
      address,
      register,
      kind,
      written: value,
      readBack: readback.raw,
      matches,
      writeOnly: false,
      detail: describeRegister(register, readback.raw),
      message: matches
        ? `EEPROM 写入并回读一致：0x${hex}。注意：部分参数（发射率/地址/配置）需重新上电后完全生效。`
        : `EEPROM 写入 0x${hex} 但回读 0x${
          readback.raw.toString(16).toUpperCase().padStart(4, "0")
        }，不一致，请重试或检查供电。`,
    };
  }

  /** 读取温度（供手动单次与自动轮询共用）。 */
  async readTemperature(address: number, register: number) {
    validateMlxRegister(register);
    const read = await this.readRegister16(address, register);
    const valid = isTemperatureRawValid(read.raw) && !read.noResponse;
    const celsius = valid ? rawToCelsius(read.raw) : null;
    return {
      address,
      register,
      raw: read.raw,
      pecValid: read.pecValid,
      noResponse: read.noResponse,
      valid,
      celsius,
      fahrenheit: celsius === null ? null : celsiusToFahrenheit(celsius),
    };
  }

  /** 读取发射率（EEPROM 0x24）。 */
  async readEmissivity(address: number) {
    const read = await this.readRegister16(address, 0x24);
    return {
      raw: read.raw,
      value: emissivityRawToValue(read.raw),
      pecValid: read.pecValid,
    };
  }

  /** 写入发射率（0.1–1.0，EEPROM 安全写）。 */
  async writeEmissivity(address: number, value: number) {
    validateEmissivity(value);
    return this.writeRegister(address, 0x24, emissivityValueToRaw(value));
  }
}
