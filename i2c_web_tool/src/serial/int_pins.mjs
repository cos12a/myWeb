/**
 * LIS3DH 中断触发引脚（INT1 → 主控 GPIO）的平台化定义。
 *
 * - ESP32：合法引脚由 CAPS v2 自由引脚表决定；中断是输入，仅输入引脚同样可用。
 * - STM32：引脚没有 AF 复用，固件按 `port*16+pin` 编码接收（PA0=0x00、PB6=0x16）。
 * - 未知平台 / 旧固件：退回数值输入，按 0–63 校验。
 *
 * 纯逻辑（无浏览器 API），供 UI 下拉与后端 STREAM_START 入参校验共用。
 */

/** 固件默认引脚：STREAM_START 的 intPin 传 0xFF 时由固件自行决定。 */
export const INT_PIN_FIRMWARE_DEFAULT = 0xff;
/** 数值输入兜底上限：ESP32 常见 GPIO 范围。 */
export const INT_PIN_MAX_GPIO = 63;

const PORT_LETTERS = "ABCDEFGH";
/** PA13/PA14：SWD 调试口，中断输入不要占用。 */
const STM32_SWD_PINS = new Set([0x0d, 0x0e]);

function hexByte(value) {
  return `0x${(value & 0xff).toString(16).toUpperCase().padStart(2, "0")}`;
}

/**
 * 把引脚编码格式化成人类可读名称。
 * @param {number} code port*16+pin（STM32）或 GPIO 编号（ESP32）；0xFF=固件默认。
 * @param {"esp32"|"stm32"|"unknown"} machine
 */
export function formatIntPin(code, machine = "unknown") {
  if (code === INT_PIN_FIRMWARE_DEFAULT) return "固件默认引脚";
  if (!Number.isInteger(code) || code < 0) return "未设置";
  if (machine === "stm32") {
    const port = code >> 4;
    const pin = code & 0x0f;
    const letter = PORT_LETTERS[port];
    return letter ? `P${letter}${pin}` : `PIN${code}`;
  }
  return `GPIO${code}`;
}

/** 引脚编码的十六进制表示（写进协议时用）。 */
export function formatIntPinCode(code) {
  if (code === INT_PIN_FIRMWARE_DEFAULT) return "0xFF";
  return Number.isInteger(code) && code >= 0 ? hexByte(code) : "—";
}

/** ESP32 引脚表里的附加说明：仅输入引脚特别适合做中断输入。 */
function describePinTags(pin) {
  const tags = [];
  if (pin.inputOnly) tags.push("仅输入 · 适合中断");
  if (pin.strap) tags.push("启动引脚");
  if (!pin.pullup) tags.push("无内部上拉");
  return tags.join(" · ");
}

/**
 * 依据固件能力与当前 I²C 引脚，生成中断引脚候选。
 *
 * 返回 `{ mode, machine, options, groups, preferred, hint }`：
 * - `mode === "select"`：UI 渲染下拉（options 为扁平列表，groups 为分端口分组）；
 * - `mode === "number"`：旧固件/未知平台，UI 渲染数值输入。
 *
 * @param {{
 *   machine?: "esp32"|"stm32"|"unknown",
 *   pins?: Array<{gpio:number, reserved:boolean, inputOnly?:boolean, strap?:boolean, pullup?:boolean}>,
 *   sda?: number|null,
 *   scl?: number|null,
 * }} [capabilities]
 */
export function buildIntPinChoices({ machine = "unknown", pins = [], sda = null, scl = null } = {}) {
  const excluded = [sda, scl].filter((value) => Number.isInteger(value));
  const freePins = Array.isArray(pins) ? pins : [];

  if (machine === "stm32") return buildStm32Choices(excluded);

  if (machine === "esp32" && freePins.length > 0) {
    const options = freePins
      .filter((pin) => !pin.reserved && !excluded.includes(pin.gpio))
      .slice()
      .sort((left, right) => left.gpio - right.gpio)
      .map((pin) => {
        const tags = describePinTags(pin);
        return {
          value: pin.gpio,
          label: `GPIO${pin.gpio}${tags ? ` · ${tags}` : ""}`,
          note: tags,
        };
      });
    if (options.length > 0) {
      const preferred = options.some((item) => item.value === 4)
        ? 4
        : options[0].value;
      const excludedText = excluded.length > 0
        ? `，并排除当前 I²C 引脚 ${excluded.map((value) => `GPIO${value}`).join(" / ")}`
        : "";
      return {
        mode: "select",
        machine,
        options,
        groups: [{ label: "", options }],
        preferred,
        hint: `ESP32 · 自由引脚：下拉只列固件上报可用 GPIO（已过滤保留引脚${excludedText}）。中断是输入信号，仅输入引脚也能用。`,
      };
    }
  }

  return buildNumericChoices(machine, excluded, freePins.length > 0);
}

function buildStm32Choices(excluded) {
  const groups = [];
  const options = [];
  for (let port = 0; port < PORT_LETTERS.length; port++) {
    const letter = PORT_LETTERS[port];
    const group = { label: `GPIO${letter}`, options: [] };
    for (let pin = 0; pin < 16; pin++) {
      const code = port * 16 + pin;
      if (STM32_SWD_PINS.has(code) || excluded.includes(code)) continue;
      const item = {
        value: code,
        label: `P${letter}${pin} · ${hexByte(code)}`,
        note: `EXTI${pin}`,
      };
      group.options.push(item);
      options.push(item);
    }
    if (group.options.length > 0) groups.push(group);
  }
  const excludedNames = excluded
    .map((code) => formatIntPin(code, "stm32"))
    .filter((name) => name.startsWith("P"));
  const excludedText = excludedNames.length > 0
    ? `已排除当前 I²C 引脚 ${excludedNames.join(" / ")} 与 SWD（PA13/PA14）。`
    : "已排除 SWD 调试口（PA13/PA14）。";
  return {
    mode: "select",
    machine: "stm32",
    options,
    groups,
    preferred: options[0]?.value ?? 0,
    hint: `STM32 · 固定端口：引脚按 port*16+pin 编码（PA0=0x00、PB6=0x16、PC9=0x29）；${excludedText}固件需按同一编码解析 STREAM_START.intPin。`,
  };
}

function buildNumericChoices(machine, excluded, reported) {
  if (machine === "stm32") {
    return {
      mode: "number",
      machine,
      options: [],
      groups: [],
      preferred: 0,
      hint: "STM32 · 数值输入：引脚按 port*16+pin 编码（PA0=0、PB6=0x16、PC9=0x29）。",
    };
  }
  const excludedText = excluded.length > 0
    ? `避开当前 I²C 引脚 ${excluded.map((value) => `GPIO${value}`).join(" / ")}`
    : "避开保留引脚";
  return {
    mode: "number",
    machine,
    options: [],
    groups: [],
    preferred: 4,
    hint: reported
      ? "固件上报的引脚表里没有可用的中断 GPIO（保留或已被 I²C 占用）：请手动输入，或调整接线后重新连接。"
      : `ESP32 · 旧固件未上报引脚表：输入 0–${INT_PIN_MAX_GPIO} 的 GPIO 编号，${excludedText}与 GPIO43/44（UART0 控制台）。`,
  };
}

/**
 * 校验 STREAM_START 的 intPin 入参；返回错误文案，合法时返回 null。
 * 有 CAPS v2 引脚表时以固件表为准，否则退回通用范围。
 *
 * @param {number} code
 * @param {{ machine?: "esp32"|"stm32"|"unknown", pins?: Array<{gpio:number,reserved:boolean,reasonText?:string}> }} [capabilities]
 */
export function validateIntPin(code, { machine = "unknown", pins = [] } = {}) {
  if (code === INT_PIN_FIRMWARE_DEFAULT) return null;
  if (!Number.isInteger(code) || code < 0 || code >= INT_PIN_FIRMWARE_DEFAULT) {
    return "中断引脚必须是 0–254 的整数（0xFF 表示使用固件默认引脚）。";
  }
  if (machine === "stm32") {
    return (code >> 4) < PORT_LETTERS.length
      ? null
      : "STM32 中断引脚必须使用 port*16+pin 编码（PA0–PH15）。";
  }
  if (machine === "esp32" && pins.length > 0) {
    const pin = pins.find((item) => item.gpio === code);
    if (!pin) return `中断引脚 GPIO${code} 不在固件上报的可用引脚表中。`;
    if (pin.reserved) {
      return `中断引脚 GPIO${code} 不可用：${pin.reasonText || "固件标记为保留"}。`;
    }
    return null;
  }
  if (machine === "esp32" && (code === 43 || code === 44)) {
    return "中断引脚不能使用 GPIO43/44（UART0 控制台）。";
  }
  return code <= INT_PIN_MAX_GPIO
    ? null
    : `中断引脚必须是 0–${INT_PIN_MAX_GPIO} 的整数。`;
}
