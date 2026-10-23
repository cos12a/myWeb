import {
  CH224_ADDRESSES,
  CH224_PROTOCOL_FLAGS,
  CH224_REGISTERS,
  NO_RESPONSE_BYTE,
  describeRegister,
  detectNonPdProtocol,
  parseSourceCapabilities,
} from "./ch224.mjs";
import {
  validateByte,
  validateCh224Address,
  validateCh224AvsVoltage,
  validateCh224PpsVoltage,
  validateCh224QcVoltage,
  validateCh224Voltage,
  validateRegister,
} from "./protocol.mjs";
import type { I2cBackend } from "./backend.ts";

const STATUS_REGISTER = 0x09;
const VOLTAGEMODE_CTRL = 0x0a;
const CURRENT_CAPABILITY = 0x50;
const AVX_CTRL1 = 0x51;
const AVX_CTRL2 = 0x52;
const PPS_VOLTAGE_CTRL = 0x53;
const SRCCAP_START = 0x60; // 0x60–0x8F，其中 0x60/0x61 为消息头
const SRCCAP_END = 0x8f;

const MODE_5V = 0;
const MODE_9V = 1;
const MODE_12V = 2;
const MODE_15V = 3;
const MODE_20V = 4;
const MODE_28V = 5;
const MODE_PPS = 6;
const MODE_AVS = 7;

const FIXED_VOLTAGE_CODES = new Map([
  [5, MODE_5V],
  [9, MODE_9V],
  [12, MODE_12V],
  [15, MODE_15V],
  [20, MODE_20V],
  [28, MODE_28V],
]);

// 只写寄存器：写入后无法读回确认
const WRITE_ONLY_REGISTERS = new Set([
  VOLTAGEMODE_CTRL,
  AVX_CTRL1,
  AVX_CTRL2,
  PPS_VOLTAGE_CTRL,
]);

export class Ch224Controller {
  #hardware: I2cBackend;

  constructor(hardware: I2cBackend) {
    this.#hardware = hardware;
  }

  async discover() {
    const { addresses } = await this.#hardware.scan(0x22, 0x23);
    return {
      addresses: addresses.filter((address) =>
        CH224_ADDRESSES.includes(address)
      ),
    };
  }

  async readCapabilities(address: number) {
    validateCh224Address(address);
    const status = (await this.#hardware.read(address, STATUS_REGISTER)).value;

    // 未上电/无应答：CH341 读“成功”但数据全为 0xFF。若不拦截，0xFF 会被
    // 误判为“所有协议激活（含 PD）”，存在放行错误写入的风险。
    if (status === NO_RESPONSE_BYTE) {
      return {
        address,
        status,
        protocols: CH224_PROTOCOL_FLAGS.map((flag) => ({
          ...flag,
          active: false,
        })),
        noResponse: true,
        pdActive: false,
        qcActive: false,
        bcActive: false,
        nonPd: detectNonPdProtocol(0),
        voltageConfig: null,
        voltageMode: null,
        currentCode: 0,
        currentMilliAmps: 0,
        sourceCapabilities: null,
        registers: [describeRegister(STATUS_REGISTER, status)],
        message:
          "CH224 读写异常：状态寄存器 0x09 读回 0xFF，所有读数均为 0xFF，通常表示模块未上电或 I²C 总线无应答。数据未更新，请检查模块 VCC/GND、上电与接线后重新读取。",
      };
    }

    const current = (await this.#hardware.read(address, CURRENT_CAPABILITY))
      .value;
    const protocols = CH224_PROTOCOL_FLAGS.map((flag) => ({
      ...flag,
      active: (status & (1 << flag.bit)) !== 0,
    }));

    const pdActive = (status & (1 << 3)) !== 0 ||
      (status & (1 << 4)) !== 0;

    const nonPd = detectNonPdProtocol(status);
    const qcActive = nonPd.qc2Active || nonPd.qc3Active;
    const bcActive = nonPd.bcActive;

    // 逐字节读取 0x60–0x8F（CH224Q 参考实现逐寄存器读取，不使用突发读）
    const raw: number[] = [];
    for (let register = SRCCAP_START; register <= SRCCAP_END; register++) {
      raw.push((await this.#hardware.read(address, register)).value);
    }
    const sourceCapabilities = parseSourceCapabilities(Uint8Array.from(raw));
    const registers = [
      describeRegister(STATUS_REGISTER, status),
      describeRegister(CURRENT_CAPABILITY, current),
      ...raw.map((value, index) =>
        describeRegister(
          SRCCAP_START + index,
          value,
          sourceCapabilities,
        )
      ),
    ];

    if (!pdActive) {
      return {
        address,
        status,
        protocols,
        noResponse: false,
        pdActive: false,
        qcActive,
        bcActive,
        nonPd,
        voltageConfig: null,
        voltageMode: null,
        currentCode: current,
        currentMilliAmps: current * 50,
        sourceCapabilities,
        registers,
        message: qcActive || bcActive
          ? `PD/EPR 未激活，但检测到 ${nonPd.label} 协议；PD PDO 能力不可用，可改用“QC/其它协议取电”按固定档请求。`
          : "PD/EPR 均未激活，且未检测到 QC/BC 协议；请检查电源、CC/D+/D- 接口和连接状态。",
      };
    }

    return {
      address,
      status,
      protocols,
      noResponse: false,
      pdActive: true,
      qcActive,
      bcActive,
      nonPd,
      voltageConfig: null,
      voltageMode: null,
      currentCode: current,
      currentMilliAmps: current * 50,
      sourceCapabilities,
      registers,
      message: sourceCapabilities.valid
        ? `已读取 ${sourceCapabilities.profiles.length} 个电源能力对象。`
        : sourceCapabilities.error,
    };
  }

  listRegisters() {
    return { registers: CH224_REGISTERS };
  }

  async readRegister(address: number, register: number) {
    validateCh224Address(address);
    validateRegister(register);
    const value = (await this.#hardware.read(address, register)).value;
    const detail = describeRegister(register, value);
    return {
      ...detail,
      register,
      value,
      readOnly: register === VOLTAGEMODE_CTRL || WRITE_ONLY_REGISTERS.has(register),
    };
  }

  async writeRegister(address: number, register: number, value: number) {
    validateCh224Address(address);
    validateRegister(register);
    validateByte(value, "寄存器数据");
    await this.#hardware.write(address, register, value);

    if (WRITE_ONLY_REGISTERS.has(register)) {
      return {
        address,
        register,
        written: value,
        readBack: null,
        matches: null,
        writeOnly: true,
        detail: describeRegister(register, value),
        message: `已写入只写寄存器 0x${register.toString(16).padStart(2, "0").toUpperCase()}；该寄存器无法读回确认，请通过 0x09 状态位判断握手结果。`,
      };
    }

    const readBack = (await this.#hardware.read(address, register)).value;
    return {
      address,
      register,
      written: value,
      readBack,
      matches: value === readBack,
      writeOnly: false,
      detail: describeRegister(register, readBack),
      message: value === readBack
        ? `写入并回读一致：0x${readBack.toString(16).padStart(2, "0").toUpperCase()}。`
        : `写入 ${value} 但回读 ${readBack}，二者不一致，请核对寄存器属性。`,
    };
  }

  async requestPower(address: number, mode: string, voltage: number) {
    if (mode === "fixed") return this.requestFixedVoltage(address, voltage);
    if (mode === "pps") return this.requestPpsVoltage(address, voltage);
    if (mode === "avs") return this.requestAvsVoltage(address, voltage);
    if (mode === "qc") return this.requestNonPdPower(address, voltage);
    throw new RangeError("取电模式必须为 fixed、pps、avs 或 qc。");
  }

  // PD 不支持但 QC/BC 激活时的取电路径：不做 PDO 校验，仅依据状态位与
  // 协议固定档白名单，复用与 PD 相同的 0x0A 模式寄存器写入。
  async requestNonPdPower(address: number, voltage: number) {
    validateCh224Address(address);
    validateCh224QcVoltage(voltage);

    const status = (await this.#hardware.read(address, STATUS_REGISTER)).value;
    if (status === NO_RESPONSE_BYTE) {
      throw new RangeError(
        `未请求 QC/其它协议 ${voltage} V：CH224 读写异常，0x09 读回 0xFF（疑似模块未上电或 I²C 无应答），未写入取电配置。请检查模块供电后重试。`,
      );
    }
    const nonPd = detectNonPdProtocol(status);
    if (nonPd.pdActive || nonPd.eprActive) {
      throw new RangeError(
        `未请求 QC/其它协议 ${voltage} V：PD/EPR 已激活，应使用“固定 PDO/PPS/AVS”PD 模式取电。未写入取电配置。`,
      );
    }
    if (nonPd.kind === null) {
      throw new RangeError(
        `未请求 QC/其它协议 ${voltage} V：未检测到 QC2/QC3/BC 协议（状态 0x${status.toString(
          16,
        ).padStart(2, "0").toUpperCase()}）。请确认电源为 A 口 QC/BC 适配器且 D+/D- 连接正常，未写入取电配置。`,
      );
    }
    if (!nonPd.allowedVoltages.includes(voltage)) {
      throw new RangeError(
        `未请求 ${voltage} V：当前 ${nonPd.label} 协议不支持此固定档。可用档位：${
          nonPd.allowedVoltages.map((item) => `${item} V`).join("、") || "无"
        }。没有写入取电配置，输出保持现状。`,
      );
    }

    const modeCode = FIXED_VOLTAGE_CODES.get(voltage);
    if (modeCode === undefined) {
      throw new RangeError("未请求取电：没有适用于 CH224 的固定电压编码。");
    }

    await this.#writeMode(address, modeCode);
    const afterStatus = (await this.#hardware.read(address, STATUS_REGISTER))
      .value;
    return {
      requestedVoltage: voltage,
      mode: "qc",
      modeCode,
      protocolKind: nonPd.kind,
      activeProtocol: nonPd.label,
      pdActive: false,
      eprActive: (afterStatus & (1 << 4)) !== 0,
      vbusMeasured: false,
      message: `已按 ${nonPd.label}（D+/D- 握手）写入固定电压模式 ${modeCode}（${voltage} V），协议状态 0x${afterStatus.toString(
        16,
      ).padStart(2, "0").toUpperCase()}。QC/BC 不广播 PD PDO，未做 PDO 校验；I²C 状态位不等同于 VBUS 电压测量，请用万用表确认实际输出。`,
    };
  }

  async requestFixedVoltage(address: number, voltage: number) {
    validateCh224Address(address);
    validateCh224Voltage(voltage);

    const snapshot = await this.readCapabilities(address);
    if (!snapshot.pdActive || !snapshot.sourceCapabilities?.valid) {
      throw new RangeError(
        `未请求 ${voltage} V：当前无法读取有效的 PD 能力，未写入取电配置。${snapshot.message}`,
      );
    }
    if (voltage > 20 && (snapshot.status & (1 << 4)) === 0) {
      throw new RangeError(
        `未请求 ${voltage} V：EPR_ACTIVATED 未置位，无法确认已进入扩展功率范围。未写入取电配置。`,
      );
    }

    const profile = snapshot.sourceCapabilities.profiles.find((item) =>
      item.type === "fixed" && "voltageMv" in item &&
      item.voltageMv === voltage * 1000
    );
    if (!profile) {
      const available = snapshot.sourceCapabilities.profiles
        .filter((item) => item.type === "fixed")
        .map((item) => {
          const millivolts = "voltageMv" in item ? Number(item.voltageMv) : 0;
          return `${(millivolts / 1000).toFixed(2)} V`;
        })
        .join("、") || "没有可识别的固定电压 PDO";
      throw new RangeError(
        `未请求 ${voltage} V：电源未广播此固定 PDO。当前固定档：${available}。没有写入取电配置，输出保持现状。`,
      );
    }

    const modeCode = FIXED_VOLTAGE_CODES.get(voltage);
    if (modeCode === undefined) {
      throw new RangeError("未请求取电：没有适用于 CH224 的固定电压编码。");
    }

    await this.#writeMode(address, modeCode);
    const status = (await this.#hardware.read(address, STATUS_REGISTER)).value;
    return {
      requestedVoltage: voltage,
      mode: "fixed",
      modeCode,
      pdActive: (status & (1 << 3)) !== 0,
      eprActive: (status & (1 << 4)) !== 0,
      profile,
      vbusMeasured: false,
      message: `已写入固定电压模式 ${modeCode}（${voltage} V），协议状态 0x${status.toString(16).padStart(2, "0")}。I²C 状态位不等同于 VBUS 电压测量，请用万用表确认实际输出。`,
    };
  }

  async requestPpsVoltage(address: number, voltageMv: number) {
    validateCh224Address(address);
    validateCh224PpsVoltage(voltageMv);

    const snapshot = await this.readCapabilities(address);
    if (!snapshot.pdActive || !snapshot.sourceCapabilities?.valid) {
      throw new RangeError(
        `未请求 PPS ${voltageMv} mV：当前无法读取有效的 PD 能力，未写入取电配置。`,
      );
    }
    const profile = snapshot.sourceCapabilities.profiles.find((item) =>
      item.type === "pps" && "minVoltageMv" in item &&
      "maxVoltageMv" in item &&
      voltageMv >= Number(item.minVoltageMv) &&
      voltageMv <= Number(item.maxVoltageMv)
    );
    if (!profile) {
      const ranges = snapshot.sourceCapabilities.profiles
        .filter((item) => item.type === "pps")
        .map((item) => {
          const min = "minVoltageMv" in item ? Number(item.minVoltageMv) : 0;
          const max = "maxVoltageMv" in item ? Number(item.maxVoltageMv) : 0;
          return `${(min / 1000).toFixed(2)}–${(max / 1000).toFixed(2)} V`;
        })
        .join("、") || "没有可识别的 PPS APDO";
      throw new RangeError(
        `未请求 PPS ${(voltageMv / 1000).toFixed(2)} V：电源未广播包含此电压的 PPS APDO。当前 PPS 范围：${ranges}。没有写入取电配置。`,
      );
    }

    const rawValue = Math.floor(voltageMv / 100);
    await this.#hardware.write(address, PPS_VOLTAGE_CTRL, rawValue);
    await this.#writeMode(address, MODE_PPS);
    const status = (await this.#hardware.read(address, STATUS_REGISTER)).value;
    return {
      requestedVoltageMv: voltageMv,
      mode: "pps",
      modeCode: MODE_PPS,
      pdActive: (status & (1 << 3)) !== 0,
      eprActive: (status & (1 << 4)) !== 0,
      profile,
      vbusMeasured: false,
      message: `已写入 PPS 目标 ${(voltageMv / 1000).toFixed(2)} V（寄存器 0x53 = ${rawValue}）并切换 PPS 模式。I²C 状态位不等同于 VBUS 电压测量，请用万用表确认实际输出。`,
    };
  }

  async requestAvsVoltage(address: number, voltageMv: number) {
    validateCh224Address(address);
    validateCh224AvsVoltage(voltageMv);

    const snapshot = await this.readCapabilities(address);
    if (!snapshot.pdActive || !snapshot.sourceCapabilities?.valid) {
      throw new RangeError(
        `未请求 AVS ${voltageMv} mV：当前无法读取有效的 PD 能力，未写入取电配置。`,
      );
    }
    if ((snapshot.status & (1 << 6)) === 0) {
      throw new RangeError(
        "未请求 AVS：AVS_CAPABILITY 未置位，电源不具备 AVS 能力。未写入取电配置。",
      );
    }
    const profile = snapshot.sourceCapabilities.profiles.find((item) =>
      item.type === "avs" && "minVoltageMv" in item &&
      "maxVoltageMv" in item &&
      voltageMv >= Number(item.minVoltageMv) &&
      voltageMv <= Number(item.maxVoltageMv)
    );
    if (!profile) {
      const ranges = snapshot.sourceCapabilities.profiles
        .filter((item) => item.type === "avs")
        .map((item) => {
          const min = "minVoltageMv" in item ? Number(item.minVoltageMv) : 0;
          const max = "maxVoltageMv" in item ? Number(item.maxVoltageMv) : 0;
          return `${(min / 1000).toFixed(2)}–${(max / 1000).toFixed(2)} V`;
        })
        .join("、") || "没有可识别的 AVS APDO";
      throw new RangeError(
        `未请求 AVS ${(voltageMv / 1000).toFixed(2)} V：电源未广播包含此电压的 AVS APDO。当前 AVS 范围：${ranges}。没有写入取电配置。`,
      );
    }

    const rawValue = Math.floor(voltageMv / 10);
    const highByte = ((rawValue >> 8) & 0x7f) | 0x80;
    const lowByte = rawValue & 0xff;
    await this.#hardware.write(address, AVX_CTRL1, highByte);
    await this.#hardware.write(address, AVX_CTRL2, lowByte);
    await this.#writeMode(address, MODE_AVS);
    const status = (await this.#hardware.read(address, STATUS_REGISTER)).value;
    return {
      requestedVoltageMv: voltageMv,
      mode: "avs",
      modeCode: MODE_AVS,
      pdActive: (status & (1 << 3)) !== 0,
      eprActive: (status & (1 << 4)) !== 0,
      profile,
      vbusMeasured: false,
      message: `已写入 AVS 目标 ${(voltageMv / 1000).toFixed(2)} V（0x51/0x52 = ${highByte.toString(16).padStart(2, "0")}/${lowByte.toString(16).padStart(2, "0")}）并切换 AVS 模式。I²C 状态位不等同于 VBUS 电压测量，请用万用表确认实际输出。`,
    };
  }

  async #writeMode(address: number, mode: number) {
    await this.#hardware.write(address, VOLTAGEMODE_CTRL, mode);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const status = (await this.#hardware.read(address, STATUS_REGISTER)).value;
    // 写模式后读回 0xFF：模块在操作过程中掉电或总线异常，不能视为握手成功
    if (status === NO_RESPONSE_BYTE) {
      throw new Error(
        `写入模式 ${mode} 后 0x09 读回 0xFF，CH224 读写异常（疑似运行中掉电或总线故障）。请立即用万用表确认输出，勿接负载。`,
      );
    }
    // 参考实现：写模式后读状态，0 表示无任何协议激活
    if (status === 0) {
      throw new Error(
        `写入模式 ${mode} 后协议状态为 0，握手未成功。请检查 PD 电源、CC 连接与目标档位支持。`,
      );
    }
    return status;
  }
}
