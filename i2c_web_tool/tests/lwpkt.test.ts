import {
  CMD,
  FrameDecoder,
  LwpktError,
  buildFrame,
  crc8,
  decodeBusSelectResp,
  decodeCapsResp,
  decodeConfigResp,
  decodePingResp,
  decodeReadRegResp,
  decodeScanResp,
  decodeStreamData,
  decodeStreamStartResp,
  decodeStreamStopResp,
  decodeSwapResp,
  decodeVarint,
  encodeBusSelect,
  encodeConfigQuery,
  encodeConfigSet,
  encodePing,
  encodeReadReg,
  encodeStreamStart,
  encodeStreamStop,
  encodeVarint,
  toHex,
} from "../src/serial/lwpkt.mjs";

function bytesOf(hexText: string): Uint8Array {
  return Uint8Array.from(
    hexText.trim().split(/\s+/).map((item: string) => Number.parseInt(item, 16)),
  );
}

Deno.test("varint round-trips 16-bit command codes to exactly two bytes", () => {
  assertEquals(toHex(encodeVarint(0x0101)), "81 02");
  assertEquals(toHex(encodeVarint(0x0201)), "81 04");
  assertEquals(toHex(encodeVarint(0x0206)), "86 04");
  assertEquals(toHex(encodeVarint(0x0305)), "85 06");
  assertEquals(decodeVarint(encodeVarint(0x2fff)).value, 0x2fff);
  assertThrows(() => encodeVarint(0x4000), /varint/);
});

Deno.test("frame builder reproduces the golden ECHO request and response frames", () => {
  const frame = buildFrame(CMD.ECHO, Uint8Array.of(0xde, 0xad));
  assertEquals(toHex(frame), "AA 02 01 81 02 02 DE AD D5 55");
  assertEquals(
    toHex(buildFrame(CMD.ECHO, Uint8Array.of(0x00, 0xde, 0xad), { from: 0x01, to: 0x02 })),
    "AA 01 02 81 02 03 00 DE AD 39 55",
  );
});

Deno.test("crc8 matches the golden PING request and response frames", () => {
  // PING addr=0x28(7位) → DATA=[0x50]，CRC 覆盖 FROM..DATA
  const request = buildFrame(CMD.PING, encodePing(0x28));
  assertEquals(toHex(request), "AA 02 01 81 04 01 50 74 55");
  assertEquals(crc8(bytesOf("02 01 81 04 01 50")), 0x74);
  const response = bytesOf("AA 01 02 81 04 06 00 9C 01 00 00 01 85 55");
  const decoder = new FrameDecoder();
  const frames = decoder.push(response);
  assertEquals(frames.length, 1);
  assertEquals(frames[0].cmd, CMD.PING);
  const decoded = decodePingResp(frames[0].data);
  assertEquals(decoded.dtUs, 0x19c);
  assertEquals(decoded.ack, true);
});

Deno.test("READ_REG request and response decode value and timing", () => {
  const request = buildFrame(CMD.READ_REG, encodeReadReg(0x50, 0x00));
  assertEquals(toHex(request), "AA 02 01 84 04 02 50 00 " + toHex([crc8(bytesOf("02 01 84 04 02 50 00"))]) + " 55");
  const response = buildFrame(
    CMD.READ_REG,
    Uint8Array.of(0x00, 0xab, 0x2a, 0x00, 0x00, 0x00),
    { from: 0x01, to: 0x02 },
  );
  const decoder = new FrameDecoder();
  const [frame] = decoder.push(response);
  const { value, dtUs } = decodeReadRegResp(frame.data);
  assertEquals(value, 0xab);
  assertEquals(dtUs, 42);
});

Deno.test("SCAN response yields the acknowledged address list", () => {
  const data = Uint8Array.of(0x00, 0x02, 0x50, 0x5a);
  assertEquals(decodeScanResp(data).addresses, [0x50, 0x5a]);
});

Deno.test("frame decoder resynchronizes over garbage, partial and corrupt frames", () => {
  const good = buildFrame(CMD.ECHO, Uint8Array.of(0xde, 0xad));
  const decoder = new FrameDecoder();
  // 垃圾字节 + 半帧
  let frames = decoder.push(Uint8Array.of(0x00, 0xff, ...good.subarray(0, 4)));
  assertEquals(frames.length, 0);
  // 补全前半帧 + 一个 CRC 损坏帧 + 完整好帧
  const corrupted = Uint8Array.from(good);
  corrupted[corrupted.length - 2] ^= 0xff;
  frames = decoder.push(Uint8Array.from(good.subarray(4)));
  assertEquals(frames.length, 1);
  assertEquals(frames[0].cmd, CMD.ECHO);
  assertEquals([...frames[0].data], [0xde, 0xad]);
  frames = decoder.push(Uint8Array.from(good.subarray(0, 3)));
  assertEquals(frames.length, 0); // START 后数据不足，等待
  frames = decoder.push(Uint8Array.from(corrupted.subarray(3)));
  assertEquals(frames.length, 0);
  assertEquals(decoder.stats.crcErrors, 1);
  assertEquals(decoder.stats.resynced > 0, true);
  frames = decoder.push(good);
  assertEquals(frames.length, 1);
});

Deno.test("non-zero status raises LwpktError carrying the firmware status code", () => {
  assertThrows(
    () => decodeScanResp(Uint8Array.of(0x04)),
    (error) =>
      error instanceof LwpktError && error.status === 4 &&
      /无应答/.test(error.message),
  );
});

Deno.test("CONFIG set encodes only the flagged fields in wire order", () => {
  assertEquals(toHex(encodeConfigQuery()), "00");
  assertEquals(toHex(encodeConfigSet({ sda: 8 })), "01 08");
  assertEquals(toHex(encodeConfigSet({ scl: 9 })), "02 09");
  assertEquals(toHex(encodeConfigSet({ freqHz: 100000 })), "04 A0 86 01 00");
  assertEquals(
    toHex(encodeConfigSet({ sda: 8, scl: 9, freqHz: 400000 })),
    "07 08 09 80 1A 06 00",
  );
});

Deno.test("CONFIG response decodes the pin and frequency readback", () => {
  const config = decodeConfigResp(
    Uint8Array.of(0x00, 8, 9, 0x80, 0x1a, 0x06, 0x00),
  );
  assertEquals(config, { sda: 8, scl: 9, freqHz: 400000 });
});

Deno.test("SWAP response decodes the exchanged pins", () => {
  assertEquals(decodeSwapResp(Uint8Array.of(0x00, 9, 8)), { sda: 9, scl: 8 });
});

Deno.test("CAPS response decodes platform, ranges and fixed pin schemes", () => {
  const caps = decodeCapsResp(bytesOf(`
    00 01 02 01 0F E8 03 00 00 40 42 0F 00 0B
    53 54 4D 33 32 46 34 30 37 56 47 02
    01 02
    01 16 17 04 01 07 50 42 36 2F 50 42 37
    02 18 19 04 02 07 50 42 38 2F 50 42 39
    02 01
    01 10 11 04 01 09 50 42 31 30 2F 50 42 31 31
  `));
  assertEquals(caps.version, 1);
  assertEquals(caps.machine, "stm32");
  assertEquals(caps.pinMode, "fixed");
  assertEquals(
    [
      caps.supportsConfigSet,
      caps.supportsSwap,
      caps.supportsRecover,
      caps.supportsBusSelect,
    ],
    [true, true, true, true],
  );
  assertEquals(caps.freqMin, 1000);
  assertEquals(caps.freqMax, 1000000);
  assertEquals(caps.name, "STM32F407VG");
  assertEquals(caps.buses.length, 2);
  assertEquals(caps.buses[0].id, 1);
  assertEquals(caps.buses[0].schemes.length, 2);
  assertEquals(caps.buses[0].schemes[0], {
    id: 1,
    scl: 22,
    sda: 23,
    af: 4,
    flags: 1,
    label: "PB6/PB7",
  });
  assertEquals(caps.buses[0].schemes[1].flags, 2);
  assertEquals(caps.buses[1].schemes[0].label, "PB10/PB11");
  assertEquals(caps.pins.length, 0);
});

Deno.test("CAPS decoder rejects oversized strings and instance lists", () => {
  assertThrows(
    () =>
      decodeCapsResp(
        bytesOf("00 01 02 01 0F E8 03 00 00 40 42 0F 00 41"),
      ),
    /芯片名称长度/,
  );
  assertThrows(
    () =>
      decodeCapsResp(
        bytesOf("00 01 02 01 0F E8 03 00 00 40 42 0F 00 00 09"),
      ),
    /实例数量/,
  );
});

Deno.test("CAPS v2 decodes the reported free-pin table for ESP32", () => {
  const caps = decodeCapsResp(bytesOf(`
    00 02 01 00 07 E8 03 00 00 40 42 0F 00 08
    45 53 50 33 32 2D 53 33 00 05
    08 87 00
    09 8B 00
    0A 83 00
    0B A3 04
    13 50 03
  `));
  assertEquals(caps.version, 2);
  assertEquals(caps.machine, "esp32");
  assertEquals(caps.pinMode, "free");
  assertEquals(caps.pins.length, 5);
  assertEquals(caps.defaultSda, 8);
  assertEquals(caps.defaultScl, 9);
  assertEquals(caps.pins[0].gpio, 8);
  assertEquals(
    [caps.pins[0].sda, caps.pins[0].scl, caps.pins[0].defaultSda],
    [true, true, true],
  );
  assertEquals(caps.pins[3].strap, true);
  assertEquals(caps.pins[3].reasonText, "启动配置引脚");
  assertEquals(caps.pins[4].reserved, true);
  assertEquals(caps.pins[4].inputOnly, true);
  assertEquals(caps.pins[4].reasonText, "USB/JTAG 占用");
});

Deno.test("CAPS v2 rejects an oversized free-pin table", () => {
  assertThrows(
    () =>
      decodeCapsResp(
        bytesOf(
          "00 02 01 00 07 E8 03 00 00 40 42 0F 00 00 00 41",
        ),
      ),
    /可用引脚数量/,
  );
});

Deno.test("BUS_SELECT request and response round-trip instance and scheme ids", () => {
  assertEquals(toHex(encodeBusSelect(2, 1, 400000)), "02 01 80 1A 06 00");
  assertEquals(
    decodeBusSelectResp(
      Uint8Array.of(0x00, 23, 22, 0x80, 0x1a, 0x06, 0x00, 2, 1),
    ),
    { sda: 23, scl: 22, freqHz: 400000, busId: 2, schemeId: 1 },
  );
});

Deno.test("STREAM command codes keep the varint mapping stable", () => {
  assertEquals(CMD.STREAM_START, 0x0230);
  assertEquals(CMD.STREAM_STOP, 0x0231);
  assertEquals(CMD.STREAM_DATA, 0x0232);
  assertEquals(toHex(encodeVarint(CMD.STREAM_START)), "B0 04");
  assertEquals(toHex(encodeVarint(CMD.STREAM_STOP)), "B1 04");
  assertEquals(toHex(encodeVarint(CMD.STREAM_DATA)), "B2 04");
});

Deno.test("STREAM_START encodes the read plan and decodes the firmware reply", () => {
  const payload = encodeStreamStart({
    address: 0x18,
    register: 0xa8,
    length: 6,
    mode: "int",
    periodMs: 0,
    intPin: 4,
    count: 0,
  });
  assertEquals(toHex(payload), "18 A8 06 01 00 00 04 00 00");
  const reply = decodeStreamStartResp(
    Uint8Array.of(0x00, 0x01, 0x0a, 0x00, 0x01),
  );
  assertEquals(reply, {
    mode: "int",
    periodMs: 10,
    flags: 1,
    intSupported: true,
  });
  const poll = encodeStreamStart({
    address: 0x19,
    register: 0xa8,
    length: 6,
    mode: "poll",
    periodMs: 5,
    intPin: 0xff,
    count: 100,
  });
  assertEquals(toHex(poll), "19 A8 06 00 05 00 FF 64 00");
  assertThrows(() => decodeStreamStartResp(Uint8Array.of(0x02)), /STREAM_START/);
});

Deno.test("STREAM_STOP and STREAM_DATA round-trip", () => {
  assertEquals(toHex(encodeStreamStop()), "");
  assertEquals(
    decodeStreamStopResp(Uint8Array.of(0x00, 0x88, 0x13, 0x00, 0x00)),
    { frames: 5000 },
  );
  // 1 帧：地址 0x18、seq 7、6 字节三轴原始值。
  const frame = decodeStreamData(
    Uint8Array.of(0x18, 0x07, 0x00, 0x06, 0x80, 0x3e, 0x80, 0xc1, 0x00, 0x00),
  );
  assertEquals(frame.address, 0x18);
  assertEquals(frame.seq, 7);
  assertEquals([...frame.bytes], [0x80, 0x3e, 0x80, 0xc1, 0x00, 0x00]);
  // 一帧也能携带多组样本（固件合并上报）。
  const multi = decodeStreamData(
    Uint8Array.of(0x18, 0x08, 0x00, 0x0c, ...new Array(12).fill(0x11)),
  );
  assertEquals(multi.bytes.length, 12);
});

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual instanceof Uint8Array ? [...actual] : actual);
  const b = JSON.stringify(expected instanceof Uint8Array ? [...expected] : expected);
  if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
}

function assertThrows(operation: () => unknown, expected: RegExp | ((error: unknown) => boolean)): void {
  try {
    operation();
  } catch (error) {
    if (typeof expected === "function" ? expected(error) : error instanceof Error && expected.test(error.message)) {
      return;
    }
    throw error;
  }
  throw new Error("Expected error to be thrown");
}
