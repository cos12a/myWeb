import {
  MAX_TRANSFER_LENGTH,
  parseEepromWrite,
  parseHex,
  toTransferResult,
  validateAddress,
  validateByte,
  validateEeprom,
  validateIndex,
  validateSpiBitOrder,
  validateSpiChipSelect,
  validateSpiTransferLength,
  validateSpeed,
} from "../src/serial/protocol.mjs";

Deno.test("parseHex accepts separated bytes and rejects malformed input", () => {
  assertEquals([...parseHex("AA bb, CC")], [0xaa, 0xbb, 0xcc]);
  assertThrows(() => parseHex("A"), /十六进制/);
  assertThrows(() => parseHex("GG"), /十六进制/);
});

Deno.test("parseHex enforces the transfer size limit", () => {
  assertEquals(parseHex("00".repeat(MAX_TRANSFER_LENGTH)).length, MAX_TRANSFER_LENGTH);
  assertThrows(() => parseHex("00".repeat(MAX_TRANSFER_LENGTH + 1)), /不能超过/);
});

Deno.test("I2C address, speed, index, and byte validators enforce ranges", () => {
  validateAddress(0x50);
  assertThrows(() => validateAddress(0x80), /7 位/);
  validateSpeed(2);
  assertThrows(() => validateSpeed(4), /速度/);
  validateIndex(0);
  validateIndex(15);
  assertThrows(() => validateIndex(-1), /序号/);
  assertThrows(() => validateIndex(16), /序号/);
  validateByte(255, "数据");
  assertThrows(() => validateByte(256, "数据"), /数据/);
});

Deno.test("SPI validation enforces chip select, bit order, and combined transfer size", () => {
  validateSpiChipSelect(0);
  validateSpiChipSelect(2);
  assertThrows(() => validateSpiChipSelect(-1), /片选/);
  assertThrows(() => validateSpiChipSelect(3), /片选/);
  validateSpiBitOrder("msb");
  validateSpiBitOrder("lsb");
  assertThrows(() => validateSpiBitOrder("middle"), /位序/);
  validateSpiTransferLength(2, 3);
  validateSpiTransferLength(MAX_TRANSFER_LENGTH, 0);
  assertThrows(() => validateSpiTransferLength(0, 0), /至少/);
  assertThrows(
    () => validateSpiTransferLength(MAX_TRANSFER_LENGTH, 1),
    /总长度/,
  );
  assertThrows(() => validateSpiTransferLength(0, -1), /总长度/);
});

Deno.test("EEPROM validation prevents reads and writes beyond device capacity", () => {
  assertEquals(validateEeprom(1, 240, 16), {
    id: 1,
    name: "24C02",
    capacity: 256,
  });
  assertThrows(() => validateEeprom(1, 250, 16), /容量/);
  assertThrows(() => parseEepromWrite(1, 255, "AA BB"), /容量/);
});

Deno.test("transfer results include stable hex and printable ASCII", () => {
  assertEquals(toTransferResult(Uint8Array.of(0x41, 0x00, 0xff)), {
    bytesRead: 3,
    hex: "41 00 FF",
    ascii: "A..",
  });
});

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(
  operation: () => unknown,
  expected: RegExp,
): void {
  try {
    operation();
  } catch (error) {
    if (error instanceof Error && expected.test(error.message)) return;
    throw error;
  }
  throw new Error(`Expected error matching ${expected}`);
}
