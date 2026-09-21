/**
 * 传感器 payload 字段分类器（纯函数模块，无副作用，可独立测试）。
 *
 * 从 sensorData.ts 抽出来，让 classifyField / classifyPayload 可以
 * 在不触发 InfluxDB / Pino 副作用的情况下做单元测试。
 */

/**
 * 会被识别为 Tag（索引字段）的 payload 键名。
 * Tag 必须低基数（少量唯一值），否则会导致 InfluxDB series 爆炸。
 */
export const TAG_FIELDS = new Set(["location", "type"]);

/**
 * 数值字段白名单：当 payload 里这些字段被误传成字符串（如 "25.6"）时，
 * 自动强转为 float，避免在 InfluxDB 里被锁死为 string 类型，
 * 后续 mean() / max() / min() 等聚合才能正常使用。
 *
 * ⚠️ 只列**明确应该是数值**的字段。像 status / firmware 这种天然字符串
 * 的字段不能加进来，否则会被误转成 NaN。
 */
export const NUMERIC_FIELD_HINTS = new Set([
  // 温湿度气压
  "temperature", "humidity", "pressure", "dewPoint",
  // 电量
  "battery", "voltage", "current", "power", "energy",
  // 无线信号
  "rssi", "snr",
  // 环境
  "lux", "co2", "tvoc", "pm25", "pm10", "pm1",
  "altitude", "windSpeed", "windDirection", "rainfall",
  "soilMoisture", "soilTemperature", "waterLevel",
  // 通用数值
  "value", "count", "duration", "weight", "distance",
]);

/** 尝试把字符串解析成有限数字；失败返回 null */
export function tryParseNumericString(v: string): number | null {
  const trimmed = v.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export type FieldKind = "tag" | "float" | "boolean" | "string" | "skip";

export interface ClassifiedField {
  kind: FieldKind;
  key: string;
  /** kind=skip 时无意义；kind=float 时是 number；其他情况是原值 */
  value: string | number | boolean;
  /** 是否从字符串强转而来（用于日志与调试） */
  coerced?: boolean;
  /** 强转前的原始字符串 */
  raw?: string;
  /** kind=skip / 特殊 string 的原因说明 */
  reason?: string;
}

/**
 * 把一个 (key, value) 分类成 InfluxDB 里应该走的路径。
 *
 * 分类规则（按优先级）：
 *   1. null / undefined                              → skip
 *   2. key ∈ TAG_FIELDS 且是字符串                    → tag
 *   3. number（有限）                                 → float
 *   4. number（NaN / ±Infinity）                     → skip
 *   5. boolean                                       → boolean
 *   6. string:
 *      6a. key ∈ NUMERIC_FIELD_HINTS 且能解析成数字  → float（coerced=true）
 *      6b. key ∈ NUMERIC_FIELD_HINTS 但无法解析      → string（reason 标注）
 *      6c. 其他                                      → string
 *   7. object / array / function / symbol / bigint   → skip
 */
export function classifyField(key: string, value: unknown): ClassifiedField {
  if (value === null || value === undefined) {
    return { kind: "skip", key, value: "", reason: "null/undefined" };
  }

  if (TAG_FIELDS.has(key) && typeof value === "string") {
    return { kind: "tag", key, value };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { kind: "skip", key, value: "", reason: "non-finite number" };
    }
    return { kind: "float", key, value };
  }

  if (typeof value === "boolean") {
    return { kind: "boolean", key, value };
  }

  if (typeof value === "string") {
    if (NUMERIC_FIELD_HINTS.has(key)) {
      const n = tryParseNumericString(value);
      if (n !== null) {
        return { kind: "float", key, value: n, coerced: true, raw: value };
      }
      return { kind: "string", key, value, reason: "numeric-hint but not parseable" };
    }
    return { kind: "string", key, value };
  }

  return { kind: "skip", key, value: "", reason: `unsupported type: ${typeof value}` };
}

/** 对整份 payload 做分类预览 */
export function classifyPayload(data: Record<string, unknown>): ClassifiedField[] {
  return Object.entries(data).map(([k, v]) => classifyField(k, v));
}
