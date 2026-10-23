import {
  MLX90614_REGISTERS,
  buildCommandStream,
  buildReadStream,
  buildWriteStream,
  celsiusToFahrenheit,
  classifyRegister,
  computePec,
  describeRegister,
  emissivityRawToValue,
  emissivityValueToRaw,
  isTemperatureRawValid,
  rawToCelsius,
  verifyReadPec,
} from "../src/serial/mlx90614.mjs";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("computePec matches the canonical CRC-8 (poly 0x07) check value", () => {
  // ASCII "123456789" 是 CRC-8/poly 0x07/init 0x00 的标准校验向量 → 0xF4。
  const bytes = [..."123456789"].map((char) => char.charCodeAt(0));
  assertEqual(computePec(bytes), 0xf4, "PEC check value");
});

Deno.test("buildReadStream returns plain-mode write phase (device addr + register)", () => {
  const { stream, readLength } = buildReadStream(0x5a, 0x07);
  assertEqual(readLength, 3, "read length should be lo+hi+pec");
  // 普通模式：首字节=器件写地址 0x5A<<1=0xB4，寄存器 0x07；CH341 自动重复起始读 3 字节。
  assertEqual(stream, [0xb4, 0x07], "read write-phase payload");
});

Deno.test("buildWriteStream emits little-endian data + appended PEC", () => {
  const { stream, low, high, pec } = buildWriteStream(0x5a, 0x24, 0xf380);
  assertEqual(low, 0x80, "low byte first");
  assertEqual(high, 0xf3, "high byte second");
  assertEqual(pec, computePec([0xb4, 0x24, 0x80, 0xf3]), "PEC coverage");
  assertEqual(stream, [0xb4, 0x24, 0x80, 0xf3, pec], "write payload");
});

Deno.test("buildCommandStream writes device addr + single instruction byte", () => {
  const { stream, readLength } = buildCommandStream(0x5a, 0x7e);
  assertEqual(readLength, 0, "command is write-only");
  assertEqual(stream, [0xb4, 0x7e], "command payload (addr, cmd)");
});

Deno.test("verifyReadPec accepts a matching read and rejects a corrupted one", () => {
  const good = computePec([0xb4, 0x07, 0xb5, 0x12, 0x34]);
  assert(verifyReadPec(0x5a, 0x07, 0x12, 0x34, good), "valid pec should verify");
  assert(!verifyReadPec(0x5a, 0x07, 0x12, 0x34, good ^ 0x01), "corrupted pec should fail");
});

Deno.test("temperature conversion matches MLX90614 formula", () => {
  // T(°C) = raw * 0.02 - 273.15；raw=15000(0x3A98) → 300K → 26.85°C
  assertEqual(Number(rawToCelsius(0x3a98).toFixed(2)), 26.85, "raw 0x3A98 ≈ 26.85°C");
  assertEqual(Number(celsiusToFahrenheit(25).toFixed(2)), 77, "25°C = 77°F");
  assert(!isTemperatureRawValid(0), "raw 0 is invalid");
  assert(!isTemperatureRawValid(0x8000), "raw 0x8000 is invalid");
  assert(isTemperatureRawValid(0x3a98), "normal raw is valid");
});

Deno.test("emissivity raw <-> coefficient round-trips", () => {
  // raw = round(0xFFFF * ε)；0.95 → 62258 (0xF332)
  assertEqual(emissivityValueToRaw(0.95), 0xf332, "0.95 default raw");
  assertEqual(Number(emissivityRawToValue(0xf332).toFixed(2)), 0.95, "back to 0.95");
  let threw = false;
  try {
    emissivityValueToRaw(1.5);
  } catch {
    threw = true;
  }
  assert(threw, "emissivity above 1.0 must throw");
});

Deno.test("classifyRegister and describeRegister interpret temperature and ranges", () => {
  assertEqual(classifyRegister(0x07), "ram", "TOBJ1 is RAM");
  assertEqual(classifyRegister(0x24), "eeprom", "EMISS is EEPROM");
  assertEqual(classifyRegister(0x7e), "command", "deep sleep is a command");

  const ta = describeRegister(0x06, 0x3a98);
  assert(ta.temperature?.valid === true, "TA detail should be valid temperature");
  assert(Number(ta.temperature?.celsius?.toFixed(2)) === 26.85, "TA celsius");

  const emiss = describeRegister(0x24, 0xf332);
  assertEqual(Number(emiss.emissivity?.toFixed(2)), 0.95, "EMISS detail");

  assert(MLX90614_REGISTERS.length > 0, "register catalog must not be empty");
});
