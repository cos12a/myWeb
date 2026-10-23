import {
  FIFO_MODES,
  FULL_SCALES,
  INT_ROUTES,
  LIS3DH_REGISTERS,
  OUTPUT_MODES,
  OUT_AUTO_INC,
  buildConfigRegisters,
  buildFifoRegisters,
  computeTilt,
  decodeAcceleration,
  decodeAccelerationBatch,
  decodeConfig,
  decodeFifoConfig,
  decodeFifoSrc,
  decodeStatus2,
  decodeTemperature,
  defaultConfig,
  describeRegister,
  fifoIntervalHint,
  fullScaleById,
  odrHzFor,
  rawToG,
  resolveOutputMode,
  temperatureRawToCelsius,
  toSigned16,
} from "../src/serial/lis3dh.mjs";
import type { Lis3dhRegisterDetail } from "../src/types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

function close(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-6) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

Deno.test("LIS3DH auto-increment read address is 0xA8", () => {
  // I²C 多字节读必须置子地址最高位，否则会重复读同一寄存器。
  assertEqual(OUT_AUTO_INC, 0xa8, "0x28 | 0x80");
});

Deno.test("WHO_AM_I is registered at 0x0F", () => {
  const who = LIS3DH_REGISTERS.find((item) => item.name === "WHO_AM_I");
  assert(who !== undefined, "register table must contain WHO_AM_I");
  assertEqual(who?.address, 0x0f, "WHO_AM_I address");
  assertEqual(who?.access, "read", "WHO_AM_I is read-only");
  assert(LIS3DH_REGISTERS.length >= 30, "register table should cover the map");
});

Deno.test("16-bit little-endian composition is signed", () => {
  assertEqual(toSigned16(0x3e80), 16000, "0x3E80");
  assertEqual(toSigned16(0xc180), -16000, "0xC180");
  assertEqual(toSigned16(0xffff), -1, "0xFFFF");
});

Deno.test("full-scale table maps to the Seeed/Adafruit divisors", () => {
  assertEqual(
    FULL_SCALES.map((item) => item.accRange),
    [16000, 7282, 3968, 1280],
    "accRange per FS",
  );
  assertEqual(fullScaleById(3).label, "±16 g", "id 3");
  assertEqual(fullScaleById(99).id, 0, "invalid id falls back to ±2 g");
  close(rawToG(16000, 0), 1, "16000 counts = 1 g @ ±2 g");
  close(rawToG(7282, 1), 1, "7282 counts = 1 g @ ±4 g");
});

Deno.test("decodeAcceleration converts 6 bytes to g and tilt", () => {
  // X = +1 g (0x3E80), Y = -1 g (0xC180), Z = 0
  const decoded = decodeAcceleration(
    [0x80, 0x3e, 0x80, 0xc1, 0x00, 0x00],
    0,
  );
  assertEqual(decoded.raw, { x: 16000, y: -16000, z: 0 }, "raw axes");
  close(decoded.g.x, 1, "g.x");
  close(decoded.g.y, -1, "g.y");
  close(decoded.g.z, 0, "g.z");
  close(decoded.magnitude, Math.SQRT2, "magnitude");
  close(decoded.pitch, -45, "pitch");
  close(decoded.roll, -45, "roll");
});

Deno.test("decodeAcceleration rejects short buffers", () => {
  let threw = false;
  try {
    decodeAcceleration([0x00, 0x00, 0x00], 0);
  } catch {
    threw = true;
  }
  assert(threw, "short buffer must throw");
});

Deno.test("computeTilt stays finite at every orientation", () => {
  const cases = [
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: -1 },
  ];
  for (const g of cases) {
    const tilt = computeTilt(g);
    assert(Number.isFinite(tilt.pitch), `pitch finite for ${JSON.stringify(g)}`);
    assert(Number.isFinite(tilt.roll), `roll finite for ${JSON.stringify(g)}`);
  }
  close(computeTilt({ x: 0, y: 0, z: 1 }).pitch, 0, "flat pitch");
  close(computeTilt({ x: 0, y: 0, z: 1 }).roll, 0, "flat roll");
});

Deno.test("temperature follows int8(OUT_ADC3_H) + 25", () => {
  assertEqual(temperatureRawToCelsius(0x00, 0x05), 30, "raw 5 -> 30 °C");
  assertEqual(temperatureRawToCelsius(0x00, 0xff), 24, "raw -1 -> 24 °C");
  const enabled = decodeTemperature(0x00, 0x05);
  assertEqual(enabled.celsius, 30, "celsius");
  assert(enabled.enabled, "non-zero registers mean enabled");
  const disabled = decodeTemperature(0x00, 0x00);
  assertEqual(disabled.celsius, null, "all-zero means disabled");
  assert(!disabled.enabled, "disabled flag");
});

Deno.test("default config encodes to CTRL_REG1/4 + TEMP_CFG", () => {
  const registers = buildConfigRegisters(defaultConfig());
  // 100 Hz (0x5) << 4 | XYZ enable = 0x57；BDU 0x80 | HR 0x08 = 0x88
  assertEqual(registers.ctrlReg1, 0x57, "CTRL_REG1");
  assertEqual(registers.ctrlReg4, 0x88, "CTRL_REG4");
  assertEqual(registers.tempCfg, 0x80, "TEMP_CFG (ADC on, temp off)");
});

Deno.test("temperature and low-power flags land in the right bits", () => {
  const registers = buildConfigRegisters({
    ...defaultConfig(),
    fullScale: 3,
    outputMode: "lowPower",
    tempEnable: true,
    blockDataUpdate: false,
  });
  assertEqual(registers.ctrlReg1, 0x5f, "LPen bit3 set");
  assertEqual(registers.ctrlReg4, 0x30, "FS=±16 g, HR off, BDU off");
  assertEqual(registers.tempCfg, 0xc0, "ADC on + TEMP_EN");
});

Deno.test("output mode three-way covers 8/10/12-bit without LPen+HR combo", () => {
  const lowPower = buildConfigRegisters({ outputMode: "lowPower" });
  assertEqual(lowPower.ctrlReg1 & 0x08, 0x08, "LPen=1");
  assertEqual(lowPower.ctrlReg4 & 0x08, 0x00, "HR=0");
  const normal = buildConfigRegisters({ outputMode: "normal" });
  assertEqual(normal.ctrlReg1 & 0x08, 0x00, "LPen=0");
  assertEqual(normal.ctrlReg4 & 0x08, 0x00, "HR=0");
  const hr = buildConfigRegisters({ outputMode: "highResolution" });
  assertEqual(hr.ctrlReg1 & 0x08, 0x00, "LPen=0");
  assertEqual(hr.ctrlReg4 & 0x08, 0x08, "HR=1");
  assertEqual(
    OUTPUT_MODES.map((item) => item.resolutionBits),
    [8, 10, 12],
    "resolution bits per mode",
  );
  // 禁止组合 LPen=1 + HR=1 不应出现在模式表中；解码时低功耗优先。
  assertEqual(
    OUTPUT_MODES.filter((item) => item.lpen === 1 && item.hr === 1).length,
    0,
    "no LPen+HR entry",
  );
  assertEqual(
    resolveOutputMode({ lowPower: true, highResolution: true }).id,
    "lowPower",
    "forbidden combo resolves to lowPower",
  );
});

Deno.test("legacy lowPower/highResolution flags still resolve when outputMode absent", () => {
  const legacy = buildConfigRegisters({
    odrCode: 0x5,
    fullScale: 0,
    lowPower: true,
    blockDataUpdate: true,
    axes: { x: true, y: true, z: true },
  });
  assertEqual(legacy.ctrlReg1, 0x5f, "LPen set via legacy flag");
  assertEqual(legacy.ctrlReg4, 0x80, "BDU only, HR off");
  const legacyNormal = buildConfigRegisters({
    odrCode: 0x5,
    fullScale: 0,
    highResolution: false,
    blockDataUpdate: true,
    axes: { x: true, y: true, z: true },
  });
  assertEqual(legacyNormal.ctrlReg1, 0x57, "no LPen");
  assertEqual(legacyNormal.ctrlReg4, 0x80, "10-bit normal, HR off");
});

Deno.test("ODR code 8/9 rate depends on the output mode", () => {
  assertEqual(odrHzFor(0x8, "lowPower"), 1600, "code 8 low-power");
  assertEqual(odrHzFor(0x8, "highResolution"), 1344, "code 8 HR");
  assertEqual(odrHzFor(0x8, "normal"), 1344, "code 8 normal");
  assertEqual(odrHzFor(0x9, "lowPower"), 5376, "code 9 low-power");
  assertEqual(odrHzFor(0x9, "highResolution"), 1344, "code 9 HR");
  assertEqual(odrHzFor(0x5, "lowPower"), 100, "code 5 unaffected");
  assertEqual(odrHzFor(0x0, "lowPower"), 0, "code 0 power-down");
});

Deno.test("int route bits land in CTRL_REG3", () => {
  assertEqual(
    buildConfigRegisters({ intRoute: "dataReady" }).ctrlReg3,
    0x10,
    "ZYXDA bit",
  );
  assertEqual(
    buildConfigRegisters({ intRoute: "fifoWatermark" }).ctrlReg3,
    0x04,
    "WTM bit",
  );
  assertEqual(buildConfigRegisters({ intRoute: "none" }).ctrlReg3, 0x00, "none");
  assertEqual(INT_ROUTES.length, 3, "three routes");
});

Deno.test("FIFO registers honor enable, mode and threshold clamp", () => {
  const off = buildFifoRegisters({ enabled: false, mode: "stream", threshold: 16 });
  assertEqual(off.ctrlReg5, 0x00, "FIFO_EN off");
  assertEqual(off.fifoCtrl, 0x00, "bypass reset");
  const stream = buildFifoRegisters({ enabled: true, mode: "stream", threshold: 16 });
  assertEqual(stream.ctrlReg5, 0x40, "FIFO_EN on");
  assertEqual(stream.fifoCtrl, 0x90, "Stream bits | FTH 16");
  const fifo = buildFifoRegisters({ enabled: true, mode: "fifo", threshold: 31 });
  assertEqual(fifo.fifoCtrl, 0x5f, "FIFO bits | FTH 31");
  const clamped = buildFifoRegisters({ enabled: true, mode: "streamToFifo", threshold: 99 });
  assertEqual(clamped.fifoCtrl, 0xdf, "threshold clamped to 31");
  assertEqual(FIFO_MODES.length, 4, "four FIFO modes");
});

Deno.test("decodeFifoConfig round-trips buildFifoRegisters", () => {
  const target = buildFifoRegisters({ enabled: true, mode: "stream", threshold: 16 });
  const decoded = decodeFifoConfig(target.ctrlReg5, target.fifoCtrl);
  assertEqual(decoded.enabled, true, "enabled");
  assertEqual(decoded.mode, "stream", "mode id");
  assertEqual(decoded.threshold, 16, "threshold");
  assertEqual(decoded.raw, 0x90, "raw fifoCtrl");
});

Deno.test("decodeFifoSrc splits watermark/overrun/empty/level", () => {
  const empty = decodeFifoSrc(0x20);
  assertEqual(empty.empty, true, "EMPTY bit");
  assertEqual(empty.pending, 0, "empty pending");
  const full = decodeFifoSrc(0x9f);
  assertEqual(full.watermark, true, "WTM bit");
  assertEqual(full.empty, false, "not empty");
  assertEqual(full.level, 31, "FSS level");
  assertEqual(full.pending, 31, "full is conservatively 31");
  const overrun = decodeFifoSrc(0x42);
  assertEqual(overrun.overrun, true, "OVRN bit");
  assertEqual(overrun.pending, 2, "two pending");
});

Deno.test("fifoIntervalHint keeps reads ahead of overrun", () => {
  assertEqual(fifoIntervalHint(100, 16), { maxIntervalMs: 160, usableDepth: 16 }, "100 Hz / 16");
  assertEqual(fifoIntervalHint(1344, 32), { maxIntervalMs: 23, usableDepth: 32 }, "1.344 kHz full depth");
  assertEqual(fifoIntervalHint(0, 16), { maxIntervalMs: 1000, usableDepth: 16 }, "power-down fallback");
  assertEqual(fifoIntervalHint(100, 99).usableDepth, 32, "threshold clamp to depth");
});

Deno.test("decodeAccelerationBatch decodes 6×N bytes in order", () => {
  // 两组：X=+1g/Y=-1g/Z=0，然后 X=0/Y=0/Z=+1g
  const batch = decodeAccelerationBatch([
    0x80, 0x3e, 0x80, 0xc1, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x80, 0x3e,
  ], 0);
  assertEqual(batch.length, 2, "two samples");
  assertEqual(batch[0].raw, { x: 16000, y: -16000, z: 0 }, "first raw");
  assertEqual(batch[1].raw, { x: 0, y: 0, z: 16000 }, "second raw");
  close(batch[1].g.z, 1, "second g.z");
  let threw = false;
  try {
    decodeAccelerationBatch([0x00], 0);
  } catch {
    threw = true;
  }
  assert(threw, "short batch must throw");
});

Deno.test("decodeConfig round-trips six registers with FIFO and int route", () => {
  const target = buildConfigRegisters({
    ...defaultConfig(),
    outputMode: "normal",
    intRoute: "fifoWatermark",
    fifo: { enabled: true, mode: "stream", threshold: 24 },
  });
  const decoded = decodeConfig(
    target.ctrlReg1,
    target.ctrlReg4,
    target.tempCfg,
    target.ctrlReg3,
    target.ctrlReg5,
    target.fifoCtrl,
  );
  assertEqual(decoded.outputMode, "normal", "outputMode");
  assertEqual(decoded.resolutionBits, 10, "resolutionBits");
  assertEqual(decoded.intRoute, "fifoWatermark", "intRoute");
  assertEqual(decoded.intRouteBits, 0x04, "intRouteBits");
  assertEqual(decoded.fifo.enabled, true, "fifo enabled");
  assertEqual(decoded.fifo.mode, "stream", "fifo mode");
  assertEqual(decoded.fifo.threshold, 24, "fifo threshold");
});

Deno.test("decodeConfig round-trips the encoder", () => {
  const target = buildConfigRegisters({
    ...defaultConfig(),
    fullScale: 2,
    odrCode: 0x6,
    tempEnable: true,
  });
  const decoded = decodeConfig(
    target.ctrlReg1,
    target.ctrlReg4,
    target.tempCfg,
  );
  assertEqual(decoded.odrCode, 0x6, "odrCode");
  assertEqual(decoded.odrHz, 200, "odrHz");
  assertEqual(decoded.fullScale, 2, "fullScale");
  assertEqual(decoded.highResolution, true, "HR");
  assertEqual(decoded.blockDataUpdate, true, "BDU");
  assertEqual(decoded.tempEnable, true, "TEMP_EN");
  assertEqual(decoded.axes, { x: true, y: true, z: true }, "axes");
});

Deno.test("decodeStatus2 splits DRDY and overrun", () => {
  assertEqual(decodeStatus2(0x08), { dataReady: true, overrun: false }, "DRDY");
  assertEqual(decodeStatus2(0x88), { dataReady: true, overrun: true }, "OVR");
  assertEqual(decodeStatus2(0x00), { dataReady: false, overrun: false }, "idle");
});

Deno.test("describeRegister decodes CTRL_REG4 fields", () => {
  // .mjs 纯逻辑层没有字面量类型，按 types.ts 契约收口。
  const detail = describeRegister(0x23, 0x88) as unknown as Lis3dhRegisterDetail;
  assertEqual(detail.name, "CTRL_REG4", "name");
  assertEqual(detail.binary, "10001000", "binary");
  const fs = detail.fields?.find((field) => field.name === "FS");
  assertEqual(fs?.display, "±2 g", "FS display");
  const hr = detail.fields?.find((field) => field.name === "HR");
  assertEqual(hr?.value, 1, "HR value");
  const bdu = detail.fields?.find((field) => field.name === "BDU");
  assertEqual(bdu?.value, 1, "BDU value");
});

Deno.test("describeRegister decodes CTRL_REG1 ODR enum", () => {
  const detail = describeRegister(0x20, 0x57) as unknown as Lis3dhRegisterDetail;
  const odr = detail.fields?.find((field) => field.name === "ODR");
  assertEqual(odr?.value, 5, "ODR code");
  assertEqual(odr?.display, "100 Hz", "ODR display");
  assertEqual(
    detail.fields?.filter((field) => field.value === 1).map((field) =>
      field.name
    ),
    ["Zen", "Yen", "Xen"],
    "axes enabled",
  );
});

Deno.test("unknown registers fall back to raw description", () => {
  const detail = describeRegister(0x00, 0x00) as unknown as Lis3dhRegisterDetail;
  assert(detail.name.startsWith("未定义寄存器"), "fallback name");
  assertEqual(detail.fields, undefined, "no field decode");
});
