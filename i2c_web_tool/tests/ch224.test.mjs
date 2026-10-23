import {
  describeRegister,
  parseMessageHeader,
  parseSourceCapabilities,
} from "../src/serial/ch224.mjs";

Deno.test("CH224 decodes the protocol status register bit by bit", () => {
  const result = describeRegister(0x09, 0x89);
  assertEquals(result.hex, "0x89");
  assertEquals(result.binary, "10001001");
  assertEquals(result.bits.find((bit) => bit.bit === 3), {
    bit: 3,
    value: 1,
    description: "PD_ACTIVATED：USB Power Delivery 已激活（CC1/CC2 握手）",
  });
  assertEquals(result.bits.find((bit) => bit.bit === 7)?.value, 1);
});

Deno.test("CH224 parses fixed PDO voltage, current, and requestability", () => {
  const pdo = (100 << 10) | 300;
  const capabilities = parseSourceCapabilities(Uint8Array.of(
    0x00,
    0x10,
    pdo & 0xff,
    (pdo >>> 8) & 0xff,
    (pdo >>> 16) & 0xff,
    (pdo >>> 24) & 0xff,
  ));
  assertEquals(capabilities.valid, true);
  assertEquals(capabilities.count, 1);
  assertEquals(capabilities.profiles[0].voltageMv, 5000);
  assertEquals(capabilities.profiles[0].currentMa, 3000);
  assertEquals(capabilities.profiles[0].powerMw, 15000);
  assertEquals(capabilities.profiles[0].requestableByCh224A, true);
});

Deno.test("CH224 reports incomplete or empty Source Capabilities", () => {
  assertEquals(
    parseSourceCapabilities(Uint8Array.of(0x00, 0x00)).error,
    "Source Capabilities 消息头中的 PDO 数量为 0。",
  );
  assertEquals(
    parseSourceCapabilities(Uint8Array.of(0x00, 0x20)).valid,
    false,
  );
});

Deno.test("PD message header decodes every field", () => {
  const header = parseMessageHeader(
    (2 << 12) | (3 << 9) | (1 << 8) | (1 << 6) | (1 << 5) | 1,
  );
  assertEquals(header.numObjects, 2);
  assertEquals(header.messageType, "Source_Capabilities");
  assertEquals(header.specRevision, "2.0");
  assertEquals(header.powerRole, "Source");
  assertEquals(header.dataRole, "DFP");
  assertEquals(header.messageId, 3);
  assertEquals(header.extended, false);
  assertEquals(header.fields.length, 7);
});

Deno.test("fixed PDO exposes every capability flag and value parameter", () => {
  const pdo = (1 << 29) | (1 << 27) | (1 << 23) | (1 << 21) | (100 << 10) | 300;
  const profile = parseSourceCapabilities(capabilityBytes([pdo])).profiles[0];

  const flag = (name) => profile.flags.find((item) => item.name === name);
  assertEquals(flag("双角色供电").supported, true);
  assertEquals(flag("不受限电源").supported, true);
  assertEquals(flag("EPR 模式能力").supported, true);
  assertEquals(flag("USB Suspend 支持").supported, false);

  const parameter = (name) =>
    profile.parameters.find((item) => item.name === name);
  assertEquals(parameter("输出电压").display, "5000 mV");
  assertEquals(parameter("输出电压").bitRange, "bit 19:10");
  assertEquals(parameter("最大电流").display, "3000 mA");
  assertEquals(parameter("峰值电流").display, "2");
  assertEquals(profile.rawHex, `0x${pdo.toString(16).padStart(8, "0").toUpperCase()}`);
});

Deno.test("PPS and EPR AVS PDOs decode range and power parameters", () => {
  const pps = (3 << 30) | (20 << 17) | (33 << 8) | 60;
  const ppsProfile = parseSourceCapabilities(capabilityBytes([pps])).profiles[0];
  assertEquals(ppsProfile.type, "pps");
  assertEquals(ppsProfile.maxVoltageMv, 2000);
  assertEquals(ppsProfile.minVoltageMv, 3300);
  assertEquals(ppsProfile.maxCurrentMa, 3000);

  const avs = (3 << 30) | (1 << 28) | (200 << 17) | (90 << 8) | 140;
  const avsProfile = parseSourceCapabilities(capabilityBytes([avs])).profiles[0];
  assertEquals(avsProfile.type, "avs");
  assertEquals(avsProfile.maxVoltageMv, 20000);
  assertEquals(avsProfile.minVoltageMv, 9000);
  assertEquals(avsProfile.pdpWatts, 140);
  assertEquals(avsProfile.powerMw, 140000);
});

Deno.test("capability summary lists all aggregate supply parameters", () => {
  const fixed5 = (100 << 10) | 300;
  const fixed9 = (180 << 10) | 300;
  const pps = (3 << 30) | (20 << 17) | (33 << 8) | 60;
  const capabilities = parseSourceCapabilities(
    capabilityBytes([fixed5, fixed9, pps]),
  );
  const summary = capabilities.summary;

  assertEquals(summary.totalPdos, 3);
  assertEquals(summary.fixedCount, 2);
  assertEquals(summary.ppsCount, 1);
  assertEquals(summary.avsCount, 0);
  assertEquals(summary.fixedVoltagesMv, [5000, 9000]);
  assertEquals(summary.maxVoltageMv, 9000);
  assertEquals(summary.maxCurrentMa, 3000);
  assertEquals(summary.maxPowerMw, 27000);
  assertEquals(summary.ch224aRequestableVoltagesV, [5, 9]);
  assertEquals(summary.powerRole, "Sink");
});

function capabilityBytes(pdos) {
  const bytes = [0, pdos.length << 4];
  for (const pdo of pdos) {
    bytes.push(pdo & 0xff, (pdo >>> 8) & 0xff, (pdo >>> 16) & 0xff, (pdo >>> 24) & 0xff);
  }
  return Uint8Array.from(bytes);
}

function assertEquals(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
