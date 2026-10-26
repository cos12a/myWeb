import {
  INT_PIN_FIRMWARE_DEFAULT,
  INT_PIN_MAX_GPIO,
  buildIntPinChoices,
  formatIntPin,
  formatIntPinCode,
  validateIntPin,
} from "../src/serial/int_pins.mjs";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label}：期望 ${right}，实际 ${left}`);
}

function pin(gpio: number, extra: Record<string, unknown> = {}) {
  return {
    gpio,
    sda: true,
    scl: true,
    defaultSda: false,
    defaultScl: false,
    reserved: false,
    strap: false,
    inputOnly: false,
    pullup: true,
    reason: 0,
    reasonText: "可用",
    ...extra,
  };
}

Deno.test("formatIntPin uses GPIO for ESP32 and PXn for STM32", () => {
  assertEqual(formatIntPin(4, "esp32"), "GPIO4", "ESP32 引脚名");
  assertEqual(formatIntPin(0x16, "stm32"), "PB6", "STM32 引脚名");
  assertEqual(formatIntPin(0x29, "stm32"), "PC9", "STM32 引脚名");
  assertEqual(
    formatIntPin(INT_PIN_FIRMWARE_DEFAULT, "esp32"),
    "固件默认引脚",
    "0xFF 默认引脚",
  );
  assertEqual(formatIntPinCode(0x16), "0x16", "编码十六进制");
  assertEqual(formatIntPinCode(INT_PIN_FIRMWARE_DEFAULT), "0xFF", "默认编码");
});

Deno.test("ESP32 choices follow the CAPS pin table and skip reserved / bus pins", () => {
  const choices = buildIntPinChoices({
    machine: "esp32",
    pins: [
      pin(12, { scl: true }),
      pin(13),
      pin(4),
      pin(34, { sda: false, scl: false, inputOnly: true }),
      pin(43, { reserved: true, reasonText: "UART0" }),
      pin(0, { strap: true, pullup: false }),
    ],
    sda: 13,
    scl: 12,
  });
  assertEqual(choices.mode, "select", "ESP32 应渲染下拉");
  assertEqual(
    choices.options.map((item) => item.value),
    [0, 4, 34],
    "应排除保留引脚与当前 SDA/SCL",
  );
  assertEqual(choices.preferred, 4, "优先沿用文档默认 GPIO4");
  const inputOnly = choices.options.find((item) => item.value === 34);
  assert(
    inputOnly !== undefined && /仅输入/.test(inputOnly.label),
    `仅输入引脚应标注可用：${inputOnly?.label}`,
  );
  const strap = choices.options.find((item) => item.value === 0);
  assert(
    strap !== undefined && /启动引脚/.test(strap.label) &&
      /无内部上拉/.test(strap.label),
    `strap/无上拉应标注：${strap?.label}`,
  );
  assert(/ESP32/.test(choices.hint), `提示应说明平台：${choices.hint}`);
});

Deno.test("ESP32 without a pin table falls back to a numeric field", () => {
  const choices = buildIntPinChoices({ machine: "esp32", sda: 21, scl: 22 });
  assertEqual(choices.mode, "number", "旧固件应为数值输入");
  assertEqual(choices.preferred, 4, "默认仍为 GPIO4");
  assert(/43\/44/.test(choices.hint), `应提示避开 43/44：${choices.hint}`);
  assert(/GPIO21/.test(choices.hint), `应提示避开当前 I²C 引脚：${choices.hint}`);
});

Deno.test("STM32 choices use port*16+pin encoding and group by port", () => {
  const choices = buildIntPinChoices({
    machine: "stm32",
    sda: 0x16, // PB6
    scl: 0x17, // PB7
  });
  assertEqual(choices.mode, "select", "STM32 应渲染下拉");
  const values = choices.options.map((item) => item.value);
  assert(!values.includes(0x16) && !values.includes(0x17), "应排除当前 I²C 引脚");
  assert(!values.includes(0x0d) && !values.includes(0x0e), "应排除 SWD PA13/PA14");
  assert(values.includes(0x00), "应包含 PA0");
  assert(values.includes(0x7f), "应包含 PH15");
  assertEqual(choices.preferred, 0x00, "默认选第一个可用引脚 PA0");
  assertEqual(choices.groups[0]?.label, "GPIOA", "首组应为 GPIOA");
  const pa4 = choices.options.find((item) => item.value === 0x04);
  assert(
    pa4?.label === "PA4 · 0x04",
    `STM32 选项应带编码：${pa4?.label}`,
  );
  assert(/port\*16\+pin/.test(choices.hint), `提示应说明编码：${choices.hint}`);
  assert(/PA13\/PA14/.test(choices.hint), `提示应说明 SWD 排除：${choices.hint}`);
});

Deno.test("validateIntPin enforces platform rules", () => {
  assertEqual(validateIntPin(INT_PIN_FIRMWARE_DEFAULT, {}), null, "0xFF 永远合法");
  assertEqual(validateIntPin(4, { machine: "esp32" }), null, "无引脚表时 4 合法");
  assert(
    validateIntPin(43, { machine: "esp32" }) !== null,
    "无引脚表时应拒绝 GPIO43",
  );
  const pins = [pin(4), pin(34, { sda: false, scl: false, inputOnly: true }), pin(43, { reserved: true, reasonText: "UART0" })];
  assertEqual(
    validateIntPin(34, { machine: "esp32", pins }),
    null,
    "仅输入引脚可做中断输入",
  );
  assert(
    /不在固件上报/.test(validateIntPin(5, { machine: "esp32", pins }) ?? ""),
    "表外引脚应拒绝",
  );
  assert(
    /UART0/.test(validateIntPin(43, { machine: "esp32", pins }) ?? ""),
    "保留引脚应带原因",
  );
  assertEqual(validateIntPin(0x7f, { machine: "stm32" }), null, "PH15 合法");
  assert(
    /port\*16\+pin/.test(validateIntPin(0x80, { machine: "stm32" }) ?? ""),
    "超出端口范围应拒绝",
  );
  assert(
    /0–254/.test(validateIntPin(0x1ff, { machine: "unknown" }) ?? ""),
    "非整数范围应拒绝",
  );
  assertEqual(
    validateIntPin(INT_PIN_MAX_GPIO, { machine: "unknown" }),
    null,
    "未知平台上限 63",
  );
});
