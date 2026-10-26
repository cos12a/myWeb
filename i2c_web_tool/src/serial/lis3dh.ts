import {
  FIFO_MAX_BYTES,
  FIFO_MODES,
  FULL_SCALES,
  INT_ROUTES,
  LIS3DH_ADDRESSES,
  LIS3DH_WHO_AM_I_VALUE,
  LIS3DH_REGISTERS,
  OUTPUT_MODES,
  OUT_AUTO_INC,
  REG_CTRL_REG3,
  REG_CTRL_REG5,
  REG_FIFO_CTRL,
  REG_FIFO_SRC,
  REG_OUT_X_L,
  REG_STATUS2,
  REG_TEMP_CFG,
  REG_CTRL_REG1,
  REG_CTRL_REG4,
  REG_WHO_AM_I,
  TEMP_AUTO_INC,
  buildConfigRegisters,
  decodeAcceleration,
  decodeAccelerationBatch,
  decodeConfig,
  decodeFifoSrc,
  decodeStatus2,
  decodeTemperature,
  describeRegister,
  fifoIntervalHint,
  fullScaleById,
  odrHzFor,
  outputModeById,
} from "./lis3dh.mjs";
import { validateAddress, validateByte } from "./protocol.mjs";
import type {
  I2cBackend,
  I2cReportFrame,
  I2cStreamFrame,
  I2cStreamRequest,
} from "./backend.ts";
import type { Lis3dhSample } from "../types.ts";

/** 无响应判定：总线上拉时读“成功”但数据全为 0xFF。 */
const NO_RESPONSE_BYTE = 0xff;

function byteHex(value: number): string {
  return `0x${(value & 0xff).toString(16).toUpperCase().padStart(2, "0")}`;
}

/**
 * LIS3DH 控制器：只负责 I²C 事务编排与错误信息，换算/解码全部委托给 lis3dh.mjs。
 * 构造注入 I2cBackend，因此串口 / 蓝牙 / USB 传输对它完全透明。
 */
export class Lis3dhController {
  #hardware: I2cBackend;

  constructor(hardware: I2cBackend) {
    this.#hardware = hardware;
  }

  /** 扫描 0x18/0x19，并读取 WHO_AM_I 与配置寄存器。 */
  async discover() {
    const { addresses } = await this.#hardware.scan(0x18, 0x19);
    const devices = [];
    for (const address of addresses) {
      try {
        const whoAmI = (await this.#hardware.read(address, REG_WHO_AM_I)).value;
        const ctrlReg1 = (await this.#hardware.read(address, REG_CTRL_REG1)).value;
        const ctrlReg3 = (await this.#hardware.read(address, REG_CTRL_REG3)).value;
        const ctrlReg4 = (await this.#hardware.read(address, REG_CTRL_REG4)).value;
        const ctrlReg5 = (await this.#hardware.read(address, REG_CTRL_REG5)).value;
        const tempCfg = (await this.#hardware.read(address, REG_TEMP_CFG)).value;
        const fifoCtrl = (await this.#hardware.read(address, REG_FIFO_CTRL)).value;
        devices.push({
          address,
          whoAmI,
          identified: whoAmI === LIS3DH_WHO_AM_I_VALUE,
          ctrlReg1,
          ctrlReg3,
          ctrlReg4,
          ctrlReg5,
          tempCfg,
          fifoCtrl,
          config: decodeConfig(
            ctrlReg1,
            ctrlReg4,
            tempCfg,
            ctrlReg3,
            ctrlReg5,
            fifoCtrl,
          ),
        });
      } catch {
        devices.push({
          address,
          whoAmI: null,
          identified: false,
          ctrlReg1: null,
          ctrlReg3: null,
          ctrlReg4: null,
          ctrlReg5: null,
          tempCfg: null,
          fifoCtrl: null,
          config: null,
        });
      }
    }
    return {
      addresses,
      devices,
      message: devices.length === 0
        ? "0x18/0x19 均无应答：请检查 VDD/GND、SDA/SCL 上拉与 SA0 引脚电平。"
        : devices.some((item) => item.identified)
        ? "已检测到 LIS3DH（WHO_AM_I = 0x33）。"
        : "地址有应答但 WHO_AM_I 不是 0x33，可能是同类兼容芯片或被其它器件占用。",
    };
  }

  listRegisters() {
    return {
      registers: LIS3DH_REGISTERS,
      fullScales: FULL_SCALES,
      outputModes: OUTPUT_MODES,
      fifoModes: FIFO_MODES,
      intRoutes: INT_ROUTES,
    };
  }

  async readWhoAmI(address: number) {
    validateAddress(address);
    const value = (await this.#hardware.read(address, REG_WHO_AM_I)).value;
    return { address, value, identified: value === LIS3DH_WHO_AM_I_VALUE };
  }

  /**
   * 读取一次三轴数据。
   * 主路径：READ_BLOCK 从 0xA8（0x28 | 0x80，地址自增位）连读 6 字节；
   * 若固件只返回不足 6 字节，退化为 6 次单寄存器读，保证老固件可用。
   */
  async readSample(address: number, fullScale = 0) {
    validateAddress(address);
    const scale = fullScaleById(fullScale);
    let bytes: number[] = [];
    let readMode: "block" | "single" = "block";

    try {
      bytes = await this.#hardware.readRegisters(address, OUT_AUTO_INC, 6);
    } catch {
      bytes = [];
    }

    if (bytes.length < 6) {
      readMode = "single";
      bytes = [];
      for (let offset = 0; offset < 6; offset++) {
        const { value } = await this.#hardware.read(address, REG_OUT_X_L + offset);
        bytes.push(value);
      }
    }

    const noResponse = bytes.length > 0 &&
      bytes.every((value) => value === NO_RESPONSE_BYTE);
    const decoded = decodeAcceleration(bytes, scale.id);
    return {
      address,
      at: Date.now(),
      raw: decoded.raw,
      g: decoded.g,
      magnitude: decoded.magnitude,
      pitch: decoded.pitch,
      roll: decoded.roll,
      fullScale: scale.id,
      fullScaleLabel: scale.label,
      accRange: scale.accRange,
      readMode,
      noResponse,
      message: noResponse
        ? "读数全为 0xFF：器件疑似未上电或 I²C 无应答，请检查接线与地址。"
        : "",
    };
  }

  /** 读取 STATUS_REG2（DRDY / 溢出）。 */
  async readStatus(address: number) {
    validateAddress(address);
    const value = (await this.#hardware.read(address, REG_STATUS2)).value;
    return { address, value, ...decodeStatus2(value) };
  }

  /** 读取温度通道（OUT_ADC3，0x0C/0x0D）。需先置 TEMP_CFG.TEMP_EN。 */
  async readTemperature(address: number) {
    validateAddress(address);
    let low = 0;
    let high = 0;
    try {
      const bytes = await this.#hardware.readRegisters(address, TEMP_AUTO_INC, 2);
      if (bytes.length >= 2) {
        low = bytes[0] ?? 0;
        high = bytes[1] ?? 0;
      } else {
        throw new RangeError("温度块读字节不足");
      }
    } catch {
      low = (await this.#hardware.read(address, 0x0c)).value;
      high = (await this.#hardware.read(address, 0x0d)).value;
    }
    const decoded = decodeTemperature(low, high);
    return {
      address,
      low,
      high,
      raw: decoded.raw,
      celsius: decoded.celsius,
      enabled: decoded.enabled,
      message: decoded.enabled
        ? `温度约 ${decoded.celsius?.toFixed(0)} °C（精度有限，仅供相对参考）。`
        : "温度通道未启用：请把 TEMP_CFG_REG(0x1F) 的 TEMP_EN 置 1 后重新读取。",
    };
  }

  /** 写入工作模式：CTRL_REG1/3/4/5、TEMP_CFG 与 FIFO_CTRL，并回读校验。 */
  async configure(address: number, config: object = {}) {
    validateAddress(address);
    // 直接传原始配置：buildConfigRegisters 内部合并默认值，
    // 保留显式 outputMode 优先、旧 lowPower/highResolution 兼容的解析顺序。
    const target = buildConfigRegisters(config);
    await this.#hardware.write(address, REG_CTRL_REG1, target.ctrlReg1);
    await this.#hardware.write(address, REG_CTRL_REG3, target.ctrlReg3);
    await this.#hardware.write(address, REG_CTRL_REG4, target.ctrlReg4);
    await this.#hardware.write(address, REG_CTRL_REG5, target.ctrlReg5);
    await this.#hardware.write(address, REG_TEMP_CFG, target.tempCfg);
    await this.#hardware.write(address, REG_FIFO_CTRL, target.fifoCtrl);

    const readBack = {
      ctrlReg1: (await this.#hardware.read(address, REG_CTRL_REG1)).value,
      ctrlReg3: (await this.#hardware.read(address, REG_CTRL_REG3)).value,
      ctrlReg4: (await this.#hardware.read(address, REG_CTRL_REG4)).value,
      ctrlReg5: (await this.#hardware.read(address, REG_CTRL_REG5)).value,
      tempCfg: (await this.#hardware.read(address, REG_TEMP_CFG)).value,
      fifoCtrl: (await this.#hardware.read(address, REG_FIFO_CTRL)).value,
    };
    const matches = readBack.ctrlReg1 === target.ctrlReg1 &&
      readBack.ctrlReg3 === target.ctrlReg3 &&
      readBack.ctrlReg4 === target.ctrlReg4 &&
      readBack.ctrlReg5 === target.ctrlReg5 &&
      readBack.tempCfg === target.tempCfg &&
      readBack.fifoCtrl === target.fifoCtrl;
    const decoded = decodeConfig(
      readBack.ctrlReg1,
      readBack.ctrlReg4,
      readBack.tempCfg,
      readBack.ctrlReg3,
      readBack.ctrlReg5,
      readBack.fifoCtrl,
    );
    const mode = outputModeById(decoded.outputMode);
    const odrHz = odrHzFor(decoded.odrCode, decoded.outputMode);
    const extras = [
      decoded.blockDataUpdate ? "BDU" : "",
      decoded.fifo.enabled ? `FIFO ${decoded.fifo.modeLabel}` : "",
      decoded.intRoute !== "none" ? "INT1 已路由" : "",
      decoded.tempEnable ? "温度通道已开" : "",
    ].filter((item) => item !== "");
    return {
      address,
      target,
      readBack,
      matches,
      config: decoded,
      message: matches
        ? `配置已生效：${fullScaleById(decoded.fullScale).label} · ${mode.label} · ${
          odrHz === 0 ? "掉电" : `${odrHz} Hz`
        }${extras.length > 0 ? ` · ${extras.join(" · ")}` : ""}。`
        : `回读不一致（CTRL_REG1 0x${readBack.ctrlReg1.toString(16)}、CTRL_REG4 0x${
          readBack.ctrlReg4.toString(16)
        }），请重试或检查供电。`,
    };
  }

  /** 读取 FIFO_SRC_REG：可批量读出的样本数、水印与溢出标志。 */
  async readFifoStatus(address: number) {
    validateAddress(address);
    const value = (await this.#hardware.read(address, REG_FIFO_SRC)).value;
    const decoded = decodeFifoSrc(value);
    return {
      address,
      value,
      ...decoded,
      message: decoded.empty
        ? "FIFO 为空：刚开启时需等一个 ODR 周期（100 Hz 约 10 ms）后重试。"
        : `FIFO 中有 ${decoded.pending} 组样本${
          decoded.watermark ? "（已达水印）" : ""
        }${decoded.overrun ? "；发生过溢出，最旧样本已被覆盖" : ""}。`,
    };
  }

  /**
   * FIFO 批量读取：先读 FIFO_SRC 得可用样本数，再用一次事务连读 6×N 字节。
   * 每读完一组 OUT_X_L..OUT_Z_H 即弹出一级，样本顺序 = 采集顺序。
   * odrHz 用于反推各样本的采集时间戳（无法获取时传 0）。
   */
  async readFifoBatch(
    address: number,
    fullScale = 0,
    maxSamples = FIFO_MAX_BYTES / 6,
    odrHz = 0,
  ) {
    validateAddress(address);
    const scale = fullScaleById(fullScale);
    const status = await this.readFifoStatus(address);
    const depthLimit = FIFO_MAX_BYTES / 6;
    const rawLimit = Number.isFinite(maxSamples) ? Math.round(maxSamples) : depthLimit;
    const limit = Math.max(1, Math.min(depthLimit, rawLimit));
    const count = Math.min(status.pending, limit);
    if (count === 0) {
      return {
        address,
        at: Date.now(),
        status,
        count: 0,
        samples: [],
        message: "FIFO 中没有可读样本（读取过快）：请加大读取间隔或提高 ODR。",
      };
    }
    const bytes = await this.#hardware.readRegisters(address, OUT_AUTO_INC, count * 6);
    const decoded = decodeAccelerationBatch(bytes, scale.id);
    const now = Date.now();
    const step = Number.isFinite(odrHz) && odrHz > 0 ? 1000 / odrHz : 0;
    const samples = decoded.map((item, index) => ({
      address,
      at: Math.round(now - (decoded.length - 1 - index) * step),
      raw: item.raw,
      g: item.g,
      magnitude: item.magnitude,
      pitch: item.pitch,
      roll: item.roll,
      fullScale: scale.id,
      fullScaleLabel: scale.label,
      accRange: scale.accRange,
      readMode: "block" as const,
      noResponse: false,
      message: "",
    }));
    const remaining = Math.max(0, status.pending - decoded.length);
    return {
      address,
      at: now,
      status,
      count: decoded.length,
      samples,
      message: `批量读回 ${decoded.length} 组样本${
        remaining > 0 ? `（FIFO 尚余 ${remaining} 组）` : ""
      }${status.overrun ? "；期间发生过溢出，部分最旧样本已被覆盖" : ""}。`,
    };
  }

  /** 清空 FIFO：写 Bypass 复位，下次读取从空开始。 */
  async resetFifo(address: number) {
    validateAddress(address);
    await this.#hardware.write(address, REG_FIFO_CTRL, 0x00);
    return { address, message: "FIFO 已复位（Bypass）。如需继续采集请重新下发配置。" };
  }

  /** 当前传输是否支持设备主动上报（固件需实现 STREAM_START/STOP/DATA）。 */
  supportsStream(): boolean {
    return typeof this.#hardware.startStream === "function";
  }

  /** 启动主动上报：固件在数据就绪时直接推帧，上位机不再逐次发读命令。 */
  async startStream(request: I2cStreamRequest) {
    validateAddress(request.address);
    validateByte(request.register, "起始寄存器");
    const start = this.#hardware.startStream;
    if (typeof start !== "function") {
      throw new Error("当前传输不支持设备主动上报。");
    }
    return start.call(this.#hardware, request);
  }

  /** 停止主动上报，返回本次累计推送帧数。 */
  async stopStream() {
    const stop = this.#hardware.stopStream;
    if (typeof stop !== "function") return { frames: 0 };
    return stop.call(this.#hardware);
  }

  /**
   * 订阅主动上报帧并解码为三轴样本：固件每帧带 6×N 字节原始寄存器数据，
   * 逐组回调与轮询模式同构的 Lis3dhSample；fullScale 与轮询读数保持一致。
   * 返回取消订阅函数（仅退订回调，停止推送需调用 stopStream）。
   */
  subscribeStream(
    listener: (sample: Lis3dhSample, frame: I2cStreamFrame) => void,
    fullScale = 0,
  ): () => void {
    const subscribe = this.#hardware.subscribeStream;
    if (typeof subscribe !== "function") return () => {};
    const scale = fullScaleById(fullScale);
    return subscribe.call(this.#hardware, (frame) => {
      let decoded: unknown[] = [];
      try {
        decoded = decodeAccelerationBatch(frame.bytes, scale.id);
      } catch {
        return;
      }
      const noResponse = frame.bytes.length > 0 &&
        frame.bytes.every((value) => value === NO_RESPONSE_BYTE);
      for (const item of decoded as Array<{
        raw: Lis3dhSample["raw"];
        g: Lis3dhSample["g"];
        magnitude: number;
        pitch: number;
        roll: number;
      }>) {
        listener({
          address: frame.address,
          at: frame.receivedAt,
          raw: item.raw,
          g: item.g,
          magnitude: item.magnitude,
          pitch: item.pitch,
          roll: item.roll,
          fullScale: scale.id,
          fullScaleLabel: scale.label,
          accRange: scale.accRange,
          readMode: "block",
          noResponse,
          message: noResponse ? "推送数据全为 0xFF：器件疑似未上电或无应答。" : "",
        }, frame);
      }
    });
  }

  /**
   * 订阅 REPORT_DATA 帧并按槽位过滤：LIS3DH 页面的「周期上报」模式用。
   * 与 subscribeStream 同构（6×N 字节原始数据解码成样本），只是每帧多了
   * taskId 与设备端采样时间 atMs；停止上报需调用 AutoReport.stop，这里只退订。
   */
  subscribeReport(
    taskId: number,
    listener: (sample: Lis3dhSample, frame: I2cReportFrame) => void,
    fullScale = 0,
  ): () => void {
    const subscribe = this.#hardware.subscribeReport;
    if (typeof subscribe !== "function") return () => {};
    const scale = fullScaleById(fullScale);
    return subscribe.call(this.#hardware, (frame) => {
      if (frame.taskId !== taskId) return;
      let decoded: unknown[] = [];
      try {
        decoded = decodeAccelerationBatch(frame.bytes, scale.id);
      } catch {
        return;
      }
      const noResponse = frame.bytes.length > 0 &&
        frame.bytes.every((value) => value === NO_RESPONSE_BYTE);
      for (const item of decoded as Array<{
        raw: Lis3dhSample["raw"];
        g: Lis3dhSample["g"];
        magnitude: number;
        pitch: number;
        roll: number;
      }>) {
        listener({
          address: frame.address,
          at: frame.receivedAt,
          raw: item.raw,
          g: item.g,
          magnitude: item.magnitude,
          pitch: item.pitch,
          roll: item.roll,
          fullScale: scale.id,
          fullScaleLabel: scale.label,
          accRange: scale.accRange,
          readMode: "block",
          noResponse,
          message: noResponse ? "上报数据全为 0xFF：器件疑似未上电或无应答。" : "",
        }, frame);
      }
    });
  }

  /** FIFO 读取周期建议：按当前 ODR 与阈值算不溢出的最大读取间隔。 */
  fifoHint(odrCode: number, outputMode: string, threshold?: number) {
    const odrHz = odrHzFor(odrCode, outputMode);
    return { odrHz, ...fifoIntervalHint(odrHz, threshold) };
  }

  /** 单字节寄存器读取 + 语义解读。 */
  async readRegister(address: number, register: number) {
    validateAddress(address);
    validateByte(register, "寄存器地址");
    const { value } = await this.#hardware.read(address, register);
    const detail = describeRegister(register, value);
    return {
      address,
      register,
      value,
      detail,
      noResponse: value === NO_RESPONSE_BYTE,
      message: value === NO_RESPONSE_BYTE
        ? `${byteHex(register)} 读回 0xFF：器件可能未上电或无应答。`
        : `读取成功：${detail.name} = ${detail.hex}（${detail.binary}）。`,
    };
  }

  /** 单字节寄存器写入 + 回读校验。 */
  async writeRegister(address: number, register: number, value: number) {
    validateAddress(address);
    validateByte(register, "寄存器地址");
    validateByte(value, "写入值");
    await this.#hardware.write(address, register, value);
    const readBack = (await this.#hardware.read(address, register)).value;
    const detail = describeRegister(register, readBack);
    const matches = readBack === value;
    return {
      address,
      register,
      written: value,
      readBack,
      matches,
      detail,
      message: matches
        ? `${detail.name} 写入 ${byteHex(value)} 并回读一致。`
        : `写入 ${byteHex(value)} 但回读 ${byteHex(readBack)}，不一致，请重试。`,
    };
  }
}
