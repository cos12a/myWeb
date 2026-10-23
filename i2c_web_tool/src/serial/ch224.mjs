export const CH224_ADDRESSES = [0x23, 0x22];

// 寄存器地址（依据 CH224Q_Registers.h 参考实现）
export const CH224_REG_STATUS = 0x09; // 协议状态，只读
export const CH224_REG_VOLTAGEMODE_CTRL = 0x0a; // 电压/取电模式控制，只写
export const CH224_REG_CURRENT_CAPABILITY = 0x50; // 当前能力电流，只读（50 mA/bit）
export const CH224_REG_AVX_CTRL1 = 0x51; // AVS 电压控制高字节，只写
export const CH224_REG_AVX_CTRL2 = 0x52; // AVS 电压控制低字节，只写
export const CH224_REG_PPS_VOLTAGE_CTRL = 0x53; // PPS 电压控制（100 mV/bit），只写
export const CH224_REG_SRCCAP_META = 0x60; // Source Capabilities 消息头低字节，只读
export const CH224_REG_SRCCAP_META_HIGH = 0x61; // Source Capabilities 消息头高字节，只读
export const CH224_REG_SRCCAP_START = 0x62; // Source Capabilities PDO 数据起始，只读
export const CH224_REG_SRCCAP_END = 0x8f; // Source Capabilities 数据末尾，只读

// 手动寄存器表：access 为 "read"（可读）或 "write"（只写）
export const CH224_REGISTERS = [
  { address: 0x09, access: "read", name: "协议状态 STATUS", function: "读取已激活的充电协议（BC/QC2/QC3/PD/EPR）及 EPR/AVS 能力位" },
  { address: 0x0a, access: "write", name: "电压/取电模式控制 VOLTAGEMODE_CTRL", function: "写入固定电压档（0–5）或 PPS(6)/AVS(7) 模式；只写，不可读回确认" },
  { address: 0x50, access: "read", name: "当前能力电流 CURRENT_CAPABILITY", function: "读取当前协商档位的最大可用电流（50 mA/bit）" },
  { address: 0x51, access: "write", name: "AVS 控制高字节 AVX_CTRL1", function: "AVS 电压高 7 位 + 最高位使能；只写" },
  { address: 0x52, access: "write", name: "AVS 控制低字节 AVX_CTRL2", function: "AVS 电压低 8 位；只写" },
  { address: 0x53, access: "write", name: "PPS 电压控制 PPS_VOLTAGE_CTRL", function: "PPS 目标电压（100 mV/bit）；只写" },
  { address: 0x60, access: "read", name: "Source Capabilities 消息头低字节 SRCCAP_META", function: "PD 消息头 bit 0–7" },
  { address: 0x61, access: "read", name: "Source Capabilities 消息头高字节 SRCCAP_META+1", function: "PD 消息头 bit 8–15（含 PDO 数量、扩展标志）" },
  { address: 0x62, access: "read", name: "Source Capabilities PDO 数据起始 SRCCAP_START", function: "第 1 个 PDO 的第 1 字节；0x62–0x8F 为 PDO 数据" },
  { address: 0x8f, access: "read", name: "Source Capabilities 数据末尾 SRCCAP_END", function: "Source Capabilities 缓存最后一个字节" },
];

export const CH224_PROTOCOL_FLAGS = [
  { bit: 0, name: "BC_ACTIVATED", description: "BC 1.2 充电协议已激活（D+/D- 握手）" },
  { bit: 1, name: "QC2_ACTIVATED", description: "Quick Charge 2.0 已激活（D+/D- 握手）" },
  { bit: 2, name: "QC3_ACTIVATED", description: "Quick Charge 3.0 已激活（D+/D- 握手）" },
  { bit: 3, name: "PD_ACTIVATED", description: "USB Power Delivery 已激活（CC1/CC2 握手）" },
  { bit: 4, name: "EPR_ACTIVATED", description: "USB-PD 扩展功率范围（EPR）已激活（最高 28 V）" },
  { bit: 5, name: "EPR_CAPABILITY", description: "电源具备 EPR 能力" },
  { bit: 6, name: "AVS_CAPABILITY", description: "电源具备 AVS 能力" },
  { bit: 7, name: "保留", description: "保留位；不要据此推断功能" },
];

export const CH224_VOLTAGE_MODES = [
  { value: 0, name: "5 V 固定档" },
  { value: 1, name: "9 V 固定档" },
  { value: 2, name: "12 V 固定档" },
  { value: 3, name: "15 V 固定档" },
  { value: 4, name: "20 V 固定档" },
  { value: 5, name: "28 V 固定档（EPR）" },
  { value: 6, name: "PPS 模式" },
  { value: 7, name: "AVS 模式" },
];

/**
 * 非 PD 协议（QC/BC）可用固定档白名单。QC/BC 走 D+/D- 握手，PD 的
 * Source_Capabilities PDO 缓存对其无意义，因此取电校验只依据状态位与
 * 该白名单。CH224A/Q 的 0x0A 仅支持固定档，QC3 连续微调不经 I²C 暴露。
 * QC 可请求 5/9/12/15/20 V（对应 0x0A 模式码 0/1/2/3/4）。
 */
export const QC_ALLOWED_VOLTAGES = [5, 9, 12, 15, 20];
export const BC_ALLOWED_VOLTAGES = [5];

/**
 * 无响应/未上电判定：CH224 掉电时总线被上拉，CH341 读操作“成功”但
 * 数据全为 0xFF（DLL 不报错）。状态寄存器正常值不会等于 0xFF（那意味
 * BC/QC2/QC3/PD/EPR 等全部同时激活，物理上不可能），因此 0x09 读回
 * 0xFF 即可判定为模块未上电或 I²C 无应答。
 */
export const NO_RESPONSE_BYTE = 0xff;

/**
 * 依据 0x09 协议状态位判定是否可用非 PD（QC/BC）路径取电。
 * PD 或 EPR 已激活时返回 kind=null（应走 PD 固定/PPS/AVS 路径）。
 */
export function detectNonPdProtocol(status) {
  const pdActive = (status & (1 << 3)) !== 0;
  const eprActive = (status & (1 << 4)) !== 0;
  const bcActive = (status & (1 << 0)) !== 0;
  const qc2Active = (status & (1 << 1)) !== 0;
  const qc3Active = (status & (1 << 2)) !== 0;

  if (pdActive || eprActive) {
    return {
      pdActive,
      eprActive,
      bcActive,
      qc2Active,
      qc3Active,
      kind: null,
      allowedVoltages: [],
      label: null,
    };
  }

  if (qc2Active && qc3Active) {
    return {
      pdActive,
      eprActive,
      bcActive,
      qc2Active,
      qc3Active,
      kind: "qc",
      allowedVoltages: QC_ALLOWED_VOLTAGES,
      label: "QC2/QC3",
    };
  }
  if (qc3Active) {
    return {
      pdActive,
      eprActive,
      bcActive,
      qc2Active,
      qc3Active,
      kind: "qc3",
      allowedVoltages: QC_ALLOWED_VOLTAGES,
      label: "QC3",
    };
  }
  if (qc2Active) {
    return {
      pdActive,
      eprActive,
      bcActive,
      qc2Active,
      qc3Active,
      kind: "qc2",
      allowedVoltages: QC_ALLOWED_VOLTAGES,
      label: "QC2",
    };
  }
  if (bcActive) {
    return {
      pdActive,
      eprActive,
      bcActive,
      qc2Active,
      qc3Active,
      kind: "bc",
      allowedVoltages: BC_ALLOWED_VOLTAGES,
      label: "BC 1.2",
    };
  }

  return {
    pdActive,
    eprActive,
    bcActive,
    qc2Active,
    qc3Active,
    kind: null,
    allowedVoltages: [],
    label: null,
  };
}

const RESERVED = {
  start: 0,
  end: 31,
  name: "未定义",
  kind: "reserved",
  description: "未在当前解析表中定义的位；按 USB PD 规范视为保留位。",
};

/**
 * USB PD Source PDO 位域布局。固定电压、电池、可变电源、PPS 与 EPR AVS 字段位置
 * 依据 USB PD 规范；每项 kind 为 value（数值）/ flag（状态位）/ reserved。
 */
const PDO_LAYOUTS = {
  fixed: {
    name: "固定电压 PDO",
    fields: [
      { start: 31, end: 30, name: "PDO 类型", kind: "value", description: "00b = 固定电压供电" },
      { start: 29, end: 29, name: "双角色供电", kind: "flag", description: "电源可作为 Source 与 Sink 双角色工作" },
      { start: 28, end: 28, name: "USB Suspend 支持", kind: "flag", description: "支持 USB 挂起状态（低功耗）" },
      { start: 27, end: 27, name: "不受限电源", kind: "flag", description: "功率不受 USB 默认枚举限制" },
      { start: 26, end: 26, name: "USB 通信能力", kind: "flag", description: "具备 USB 数据通信能力" },
      { start: 25, end: 25, name: "双角色数据", kind: "flag", description: "支持双角色数据（DRD）" },
      { start: 24, end: 24, name: "非分块扩展消息", kind: "flag", description: "支持不分块扩展消息" },
      { start: 23, end: 23, name: "EPR 模式能力", kind: "flag", description: "支持扩展功率范围（EPR）" },
      { start: 22, end: 22, name: "保留", kind: "reserved", description: "保留位，固定为 0" },
      { start: 21, end: 20, name: "峰值电流", kind: "value", description: "峰值电流能力编码（见规范 Table 6-15）" },
      { start: 19, end: 10, name: "输出电压", kind: "value", description: "固定输出电压，单位 50 mV" },
      { start: 9, end: 0, name: "最大电流", kind: "value", description: "最大输出电流，单位 10 mA" },
    ],
  },
  battery: {
    name: "电池 PDO",
    fields: [
      { start: 31, end: 30, name: "PDO 类型", kind: "value", description: "01b = 电池供电" },
      { start: 29, end: 20, name: "最大电压", kind: "value", description: "最大电压，单位 50 mV" },
      { start: 19, end: 10, name: "最小电压", kind: "value", description: "最小电压，单位 50 mV" },
      { start: 9, end: 0, name: "最大功率", kind: "value", description: "最大功率，单位 250 mW" },
    ],
  },
  variable: {
    name: "可变电源 PDO",
    fields: [
      { start: 31, end: 30, name: "PDO 类型", kind: "value", description: "10b = 可变电源" },
      { start: 29, end: 20, name: "最大电压", kind: "value", description: "最大电压，单位 50 mV" },
      { start: 19, end: 10, name: "最小电压", kind: "value", description: "最小电压，单位 50 mV" },
      { start: 9, end: 0, name: "最大电流", kind: "value", description: "最大输出电流，单位 10 mA" },
    ],
  },
  pps: {
    name: "SPR PPS APDO",
    fields: [
      { start: 31, end: 30, name: "APDO 类型", kind: "value", description: "11b = 增强型供电对象" },
      { start: 29, end: 28, name: "APDO 子类型", kind: "value", description: "00b = SPR PPS 可编程电源" },
      { start: 27, end: 27, name: "PPS 功率受限", kind: "flag", description: "PPS 输出功率受限" },
      { start: 26, end: 25, name: "保留", kind: "reserved", description: "保留位" },
      { start: 24, end: 17, name: "最大电压", kind: "value", description: "PPS 最大电压，单位 100 mV" },
      { start: 16, end: 16, name: "保留", kind: "reserved", description: "保留位" },
      { start: 15, end: 8, name: "最小电压", kind: "value", description: "PPS 最小电压，单位 100 mV" },
      { start: 7, end: 7, name: "保留", kind: "reserved", description: "保留位" },
      { start: 6, end: 0, name: "最大电流", kind: "value", description: "最大输出电流，单位 50 mA" },
    ],
  },
  avs: {
    name: "EPR AVS APDO",
    fields: [
      { start: 31, end: 30, name: "APDO 类型", kind: "value", description: "11b = 增强型供电对象" },
      { start: 29, end: 28, name: "APDO 子类型", kind: "value", description: "01b = EPR AVS 可调电压" },
      { start: 27, end: 26, name: "峰值电流", kind: "value", description: "峰值电流能力编码（见规范 Table 6-15）" },
      { start: 25, end: 17, name: "最大电压", kind: "value", description: "AVS 最大电压，单位 100 mV" },
      { start: 16, end: 16, name: "保留", kind: "reserved", description: "保留位" },
      { start: 15, end: 8, name: "最小电压", kind: "value", description: "AVS 最小电压，单位 100 mV" },
      { start: 7, end: 0, name: "PDP", kind: "value", description: "额定功率，单位 1 W" },
    ],
  },
  reserved: {
    name: "保留 APDO 子类型",
    fields: [
      { start: 31, end: 30, name: "APDO 类型", kind: "value", description: "11b = 增强型供电对象" },
      { start: 29, end: 28, name: "APDO 子类型", kind: "value", description: "保留子类型；本工具不做字段解释" },
      { start: 27, end: 0, name: "保留", kind: "reserved", description: "保留位或未公开布局；仅显示原始数据" },
    ],
  },
  unknown: {
    name: "未知 PDO",
    fields: [
      { start: 31, end: 30, name: "PDO 类型", kind: "value", description: "未定义或保留的 PDO 类型" },
      { start: 29, end: 0, name: "保留", kind: "reserved", description: "未公开布局；仅显示原始数据" },
    ],
  },
};

export const PD_MESSAGE_TYPES = {
  0: "Reserved",
  1: "Source_Capabilities",
  2: "Request",
  3: "BIST",
  4: "Sink_Capabilities",
  5: "Battery_Status",
  6: "Alert",
  7: "Get_Country_Info",
  8: "Vendor_Defined",
  9: "Reserved",
  10: "Reserved",
  11: "Reserved",
  12: "Reserved",
  13: "Reserved",
  14: "Reserved",
  15: "Reserved",
  16: "Reserved",
  17: "Reserved",
  18: "Reserved",
  19: "Reserved",
  20: "Reserved",
  21: "Reserved",
  22: "Reserved",
  23: "Reserved",
  24: "Reserved",
  25: "Reserved",
  26: "Reserved",
  27: "Reserved",
  28: "Reserved",
  29: "Reserved",
  30: "Reserved",
  31: "Reserved",
};

export function parseMessageHeader(rawHeader) {
  const numObjects = (rawHeader >>> 12) & 0x07;
  const messageTypeCode = rawHeader & 0x1f;
  return {
    raw: rawHeader,
    hex: `0x${rawHeader.toString(16).padStart(4, "0").toUpperCase()}`,
    binary: rawHeader.toString(2).padStart(16, "0"),
    messageTypeCode,
    messageType: PD_MESSAGE_TYPES[messageTypeCode] ?? "Reserved",
    numObjects,
    messageId: (rawHeader >>> 9) & 0x07,
    specRevisionCode: (rawHeader >>> 6) & 0x03,
    specRevision: ["1.0", "2.0", "3.0", "3.1+"][(rawHeader >>> 6) & 0x03],
    powerRole: (rawHeader >>> 8) & 0x01 ? "Source" : "Sink",
    dataRole: (rawHeader >>> 5) & 0x01 ? "DFP" : "UFP",
    extended: ((rawHeader >>> 15) & 0x01) === 1,
    fields: [
      { start: 15, end: 15, name: "扩展消息", description: "1 = 扩展消息（本缓存中通常为 0）" },
      { start: 14, end: 12, name: "数据对象数量", description: "NumDO：后续 PDO 个数（0–7）" },
      { start: 11, end: 9, name: "消息 ID", description: "MessageID：用于消息确认与重试" },
      { start: 8, end: 8, name: "电源角色", description: "当前端口电源角色：0 = Sink，1 = Source" },
      { start: 7, end: 6, name: "PD 规范版本", description: "00 = 1.0，01 = 2.0，10 = 3.0，11 = 3.1 及以后" },
      { start: 5, end: 5, name: "数据角色", description: "0 = UFP，1 = DFP" },
      { start: 4, end: 0, name: "消息类型", description: "Source_Capabilities 为 1" },
    ],
  };
}

function layoutFor(type) {
  return PDO_LAYOUTS[type] ?? PDO_LAYOUTS.unknown;
}

/** 字段以 start=高位、end=低位描述，这里统一取出低位/高位范围。 */
export function bitBounds(field) {
  return {
    low: Math.min(field.start, field.end),
    high: Math.max(field.start, field.end),
  };
}

function mask(start, end) {
  const { low, high } = bitBounds({ start, end });
  return (2 ** (high - low + 1)) - 1;
}

function extractBits(raw, field) {
  const { low } = bitBounds(field);
  return (raw >>> low) & mask(field.start, field.end);
}

function formatFieldValue(field, value) {
  if (field.kind === "flag") return value ? "支持" : "不支持";
  const unit = /单位\s*([\d.]+)\s*(mV|mA|mW|W)/.exec(field.description);
  if (!unit) return String(value);
  return `${value * Number(unit[1])} ${unit[2]}`;
}

function describeLayout(raw, type) {
  const layout = layoutFor(type);
  const fields = layout.fields.map((field) => {
    const value = extractBits(raw, field);
    const { low, high } = bitBounds(field);
    return {
      start: field.start,
      end: field.end,
      low,
      high,
      name: field.name,
      kind: field.kind,
      description: field.description,
      value,
      display: formatFieldValue(field, value),
      bitRange: low === high ? `bit ${low}` : `bit ${high}:${low}`,
    };
  });
  const covered = new Set();
  for (const field of layout.fields) {
    const { low, high } = bitBounds(field);
    for (let bit = low; bit <= high; bit++) covered.add(bit);
  }
  const uncovered = [];
  for (let bit = 31; bit >= 0; bit--) {
    if (!covered.has(bit)) uncovered.push(bit);
  }
  if (uncovered.length > 0) {
    fields.push({
      start: Math.max(...uncovered),
      end: Math.min(...uncovered),
      low: Math.min(...uncovered),
      high: Math.max(...uncovered),
      name: "未覆盖位",
      kind: "reserved",
      description: "解析表未覆盖的位",
      value: 0,
      display: "—",
      bitRange: `bit ${Math.max(...uncovered)}:${Math.min(...uncovered)}`,
    });
  }
  return fields;
}

export function parseSourceCapabilities(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 2) {
    throw new TypeError("PD 能力数据至少需要包含 2 字节消息头。");
  }
  const header = bytes[0] | (bytes[1] << 8);
  const headerDetail = parseMessageHeader(header);
  const extended = headerDetail.extended;
  const count = headerDetail.numObjects;
  const objectOffset = extended ? 4 : 2;
  if (count === 0) {
    return {
      valid: false,
      extended,
      count,
      header,
      headerDetail,
      profiles: [],
      summary: null,
      error: "Source Capabilities 消息头中的 PDO 数量为 0。",
    };
  }
  if (objectOffset + count * 4 > bytes.length) {
    return {
      valid: false,
      extended,
      count,
      header,
      headerDetail,
      profiles: [],
      summary: null,
      error: `PDO 数量为 ${count}，但读取的能力缓存长度不足。`,
    };
  }

  const profiles = [];
  for (let index = 0; index < count; index++) {
    const offset = objectOffset + index * 4;
    const raw = (
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)
    ) >>> 0;
    const supplyType = (raw >>> 30) & 0x03;
    const subtype = (raw >>> 28) & 0x03;
    let type;

    if (supplyType === 0) type = "fixed";
    else if (supplyType === 1) type = "battery";
    else if (supplyType === 2) type = "variable";
    else if (subtype === 0) type = "pps";
    else if (subtype === 1) type = "avs";
    else type = "reserved";

    const layout = layoutFor(type);
    const fields = describeLayout(raw, type);
    const profile = {
      index: index + 1,
      offset,
      type,
      name: layout.name,
      supplyTypeCode: supplyType,
      subtypeCode: supplyType === 3 ? subtype : null,
      raw,
      rawHex: `0x${raw.toString(16).padStart(8, "0").toUpperCase()}`,
      fields,
      flags: fields
        .filter((field) => field.kind === "flag")
        .map((field) => ({
          name: field.name,
          bit: field.start,
          supported: field.value === 1,
          description: field.description,
        })),
      parameters: fields
        .filter((field) => field.kind === "value" && field.name !== "PDO 类型" &&
          field.name !== "APDO 类型" && field.name !== "APDO 子类型")
        .map((field) => ({
          name: field.name,
          bitRange: field.bitRange,
          display: field.display,
          value: field.value,
          unit: field.description,
        })),
      requestableByCh224A: false,
    };

    if (type === "fixed") {
      const voltageMv = ((raw >>> 10) & 0x3ff) * 50;
      const currentMa = (raw & 0x3ff) * 10;
      profile.voltageMv = voltageMv;
      profile.currentMa = currentMa;
      profile.powerMw = Math.floor((voltageMv * currentMa) / 1000);
      profile.requestableByCh224A = [5000, 9000, 12000, 15000, 20000, 28000]
        .includes(voltageMv);
      profile.peakCurrentCode = (raw >>> 20) & 0x03;
    } else if (type === "battery") {
      profile.maxVoltageMv = ((raw >>> 20) & 0x3ff) * 50;
      profile.minVoltageMv = ((raw >>> 10) & 0x3ff) * 50;
      profile.maxPowerMw = (raw & 0x3ff) * 250;
    } else if (type === "variable") {
      profile.maxVoltageMv = ((raw >>> 20) & 0x3ff) * 50;
      profile.minVoltageMv = ((raw >>> 10) & 0x3ff) * 50;
      profile.maxCurrentMa = (raw & 0x3ff) * 10;
    } else if (type === "pps") {
      profile.minVoltageMv = ((raw >>> 8) & 0xff) * 100;
      profile.maxVoltageMv = ((raw >>> 17) & 0xff) * 100;
      profile.maxCurrentMa = (raw & 0x7f) * 50;
      profile.powerLimited = ((raw >>> 27) & 0x01) === 1;
      profile.powerMw = Math.floor(
        (profile.maxVoltageMv * profile.maxCurrentMa) / 1000,
      );
    } else if (type === "avs") {
      profile.minVoltageMv = ((raw >>> 8) & 0xff) * 100;
      profile.maxVoltageMv = ((raw >>> 17) & 0x1ff) * 100;
      profile.pdpWatts = raw & 0xff;
      profile.peakCurrentCode = (raw >>> 26) & 0x03;
      profile.powerMw = profile.pdpWatts * 1000;
    }

    profiles.push(profile);
  }

  return {
    valid: true,
    extended,
    count,
    header,
    headerDetail,
    profiles,
    objectOffset,
    summary: summarizeProfiles(profiles, headerDetail),
  };
}

function summarizeProfiles(profiles, headerDetail) {
  const fixed = profiles.filter((profile) => profile.type === "fixed");
  const pps = profiles.filter((profile) => profile.type === "pps");
  const avs = profiles.filter((profile) => profile.type === "avs");
  const battery = profiles.filter((profile) => profile.type === "battery");
  const variable = profiles.filter((profile) => profile.type === "variable");
  const maxOf = (values) => values.length === 0 ? null : Math.max(...values);
  const fixedVoltages = fixed.map((profile) => profile.voltageMv);
  const maxVoltageCandidates = [
    ...fixedVoltages,
    ...pps.flatMap((profile) => [profile.maxVoltageMv]),
    ...avs.flatMap((profile) => [profile.maxVoltageMv]),
    ...battery.flatMap((profile) => [profile.maxVoltageMv]),
    ...variable.flatMap((profile) => [profile.maxVoltageMv]),
  ].filter((value) => Number.isFinite(value));
  const maxCurrentCandidates = [
    ...fixed.map((profile) => profile.currentMa),
    ...pps.map((profile) => profile.maxCurrentMa),
    ...variable.map((profile) => profile.maxCurrentMa),
  ].filter((value) => Number.isFinite(value));
  const maxPowerCandidates = [
    ...fixed.map((profile) => profile.powerMw),
    ...pps.map((profile) => profile.powerMw),
    ...avs.map((profile) => profile.powerMw),
    ...battery.map((profile) => profile.maxPowerMw),
  ].filter((value) => Number.isFinite(value));

  return {
    totalPdos: profiles.length,
    messageType: headerDetail.messageType,
    specRevision: headerDetail.specRevision,
    powerRole: headerDetail.powerRole,
    dataRole: headerDetail.dataRole,
    messageId: headerDetail.messageId,
    fixedCount: fixed.length,
    ppsCount: pps.length,
    avsCount: avs.length,
    batteryCount: battery.length,
    variableCount: variable.length,
    reservedCount: profiles.length - fixed.length - pps.length - avs.length -
      battery.length - variable.length,
    fixedVoltagesMv: fixedVoltages,
    maxVoltageMv: maxOf(maxVoltageCandidates),
    maxCurrentMa: maxOf(maxCurrentCandidates),
    maxPowerMw: maxOf(maxPowerCandidates),
    eprCapable: fixed.some((profile) =>
      profile.flags.find((flag) => flag.name === "EPR 模式能力")?.supported
    ),
    unconstrainedPower: fixed.some((profile) =>
      profile.flags.find((flag) => flag.name === "不受限电源")?.supported
    ),
    dualRolePower: fixed.some((profile) =>
      profile.flags.find((flag) => flag.name === "双角色供电")?.supported
    ),
    ch224aRequestableVoltagesV: fixed
      .filter((profile) => profile.requestableByCh224A)
      .map((profile) => profile.voltageMv / 1000),
  };
}

export function describeRegister(address, value, sourceCapabilities) {
  let name = `未定义/器件专用寄存器 0x${address.toString(16).padStart(2, "0").toUpperCase()}`;
  let fieldByBit = [];
  let description = "CH224A 文档未在本工具寄存器表中定义；读值仅作原始数据展示。写入前必须核对具体芯片版本的数据手册。";

  if (address === 0x09) {
    name = "协议状态";
    description = "只读状态位；1 表示相应协议/能力状态有效。";
    fieldByBit = CH224_PROTOCOL_FLAGS.map((flag) => ({
      start: flag.bit,
      end: flag.bit,
      description: `${flag.name}：${flag.description}`,
    }));
  } else if (address === 0x0a) {
    name = "电压/取电模式控制（只写）";
    const mode = CH224_VOLTAGE_MODES.find((item) => item.value === (value & 7));
    description = mode
      ? `写入模式 ${value & 7}：${mode.name}。该寄存器只写，写入后应通过 0x09 状态位判断握手是否成功，读回不用于确认。`
      : `未知模式值 ${value & 7}；不要继续请求取电。`;
    fieldByBit = [
      { start: 0, end: 2, description: "模式/电压档位编码：0=5V…5=28V，6=PPS，7=AVS" },
      { start: 3, end: 7, description: "保留位；写入时应保留芯片要求的值" },
    ];
  } else if (address === 0x50) {
    name = "当前能力电流（只读）";
    description = `原始电流码 ${value}；按 50 mA/bit 换算约 ${value * 50} mA。该值不是独立的每位状态标志。`;
    fieldByBit = [
      { start: 0, end: 7, description: "电流码数值（换算单位 50 mA/bit）" },
    ];
  } else if (address === 0x51 || address === 0x52) {
    name = address === 0x51 ? "AVS 电压控制高字节（只写）" : "AVS 电压控制低字节（只写）";
    description = address === 0x51
      ? "AVS 电压值高 7 位 + 最高位使能位；与 0x52 组成 16 位电压值（10 mV/bit）。只写，读回无意义。"
      : "AVS 电压值低 8 位；与 0x51 组成 16 位电压值（10 mV/bit）。只写，读回无意义。";
    fieldByBit = [{ start: 0, end: 7, description: "AVS 电压编码的一部分（10 mV/bit，需与另一字节合并）" }];
  } else if (address === 0x53) {
    name = "PPS 电压控制（只写）";
    description = "PPS 目标电压（100 mV/bit）。写入后需将模式置为 6（PPS）。只写，读回无意义。";
    fieldByBit = [{ start: 0, end: 7, description: "PPS 目标电压编码（单位 100 mV/bit）" }];
  } else if (address >= 0x60 && address <= 0x8f) {
    name = "PD Source Capabilities 缓存";
    const index = address - 0x60;
    if (index < 2) {
      const fields = index === 0
        ? [
          [0, 4, "消息类型"],
          [5, 5, "数据角色"],
          [6, 7, "PD 规范版本"],
        ]
        : [
          [0, 0, "电源角色（header bit 8）"],
          [1, 3, "消息 ID（header bit 9–11）"],
          [4, 6, "PDO 数量（header bit 12–14）"],
          [7, 7, "Extended 消息标志（header bit 15）"],
        ];
      fieldByBit = fields.map(([start, end, label]) => ({
        start,
        end,
        description: label,
      }));
      description = sourceCapabilities?.headerDetail
        ? `消息头 ${sourceCapabilities.headerDetail.hex}：类型 ${sourceCapabilities.headerDetail.messageType}、PDO 数量 ${sourceCapabilities.headerDetail.numObjects}、PD 版本 ${sourceCapabilities.headerDetail.specRevision}、电源角色 ${sourceCapabilities.headerDetail.powerRole}、数据角色 ${sourceCapabilities.headerDetail.dataRole}、消息 ID ${sourceCapabilities.headerDetail.messageId}。`
        : "PD Source Capabilities 消息头字节，需与相邻字节组合解码。";
    } else {
      const pdo = sourceCapabilities?.profiles?.find((item) =>
        index >= item.offset && index < item.offset + 4
      );
      if (pdo) {
        name = `PDO #${pdo.index}：${pdo.name}`;
        description = `${pdo.name}（${pdo.rawHex}）的组成字节；字段明细见上方参数总览。`;
        const byteOffset = index - pdo.offset;
        const byteLow = byteOffset * 8;
        const byteHigh = byteLow + 7;
        fieldByBit = pdo.fields
          .map((field) => {
            const { low, high } = bitBounds(field);
            return {
              start: Math.max(low, byteLow) - byteLow,
              end: Math.min(high, byteHigh) - byteLow,
              description:
                `${field.name}：${field.description}（PDO ${field.bitRange}，当前值 ${field.display}）`,
            };
          })
          .filter((field) => field.start <= field.end);
      } else {
        description = "Source Capabilities 缓存中的 PDO/扩展数据字节；有效字段取决于消息头。";
      }
    }
  }

  const bits = Array.from({ length: 8 }, (_, index) => {
    const bit = 7 - index;
    const field = fieldByBit.find((item) =>
      bit >= item.start && bit <= item.end
    );
    return {
      bit,
      value: (value >>> bit) & 1,
      description: field?.description ?? "保留或未定义位",
    };
  });

  return {
    address,
    hex: `0x${value.toString(16).padStart(2, "0").toUpperCase()}`,
    binary: value.toString(2).padStart(8, "0"),
    name,
    description,
    bits,
  };
}
