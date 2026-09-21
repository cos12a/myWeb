/**
 * 时间戳单位智能识别工具。
 *
 * 背景：InfluxDB writeApi 使用纳秒精度，但不同厂商的传感器可能发送
 * 秒 / 毫秒 / 微秒 / 纳秒，如果不做识别会导致数据落到 1970 年附近。
 *
 * 判定策略（按数量级）：
 *   - 秒 (s)   ≈ 1.7e9    → 10 位数
 *   - 毫秒 (ms) ≈ 1.7e12   → 13 位数
 *   - 微秒 (μs) ≈ 1.7e15   → 16 位数
 *   - 纳秒 (ns) ≈ 1.7e18   → 19 位数
 *
 * 阈值取 1e11 / 1e14 / 1e17，可覆盖到公元 ~5138 年，绝对安全。
 */

export type TimestampUnit = "s" | "ms" | "us" | "ns" | "invalid";

export interface TimestampNormalizeResult {
  /** 归一化后的纳秒时间戳；无效输入时为 fallback（当前时间纳秒） */
  nanos: number;
  /** 识别到的原始单位 */
  unit: TimestampUnit;
  /** 是否使用了 fallback（原始输入无效） */
  usedFallback: boolean;
}

/** 仅识别单位，不做转换 */
export function detectTimestampUnit(ts: number): TimestampUnit {
  if (!Number.isFinite(ts) || ts <= 0) return "invalid";
  if (ts < 1e11) return "s";
  if (ts < 1e14) return "ms";
  if (ts < 1e17) return "us";
  return "ns";
}

/**
 * 把任意单位的时间戳归一化为纳秒。
 * 无效输入（NaN、负数、非有限数）会返回当前时间纳秒作为兜底。
 */
export function normalizeToNanoseconds(ts: number | undefined | null): TimestampNormalizeResult {
  const fallbackNanos = Date.now() * 1_000_000;

  if (ts === undefined || ts === null) {
    return { nanos: fallbackNanos, unit: "invalid", usedFallback: true };
  }

  const unit = detectTimestampUnit(ts);
  if (unit === "invalid") {
    return { nanos: fallbackNanos, unit: "invalid", usedFallback: true };
  }

  let nanos: number;
  switch (unit) {
    case "s":
      nanos = ts * 1_000_000_000;
      break;
    case "ms":
      nanos = ts * 1_000_000;
      break;
    case "us":
      nanos = ts * 1_000;
      break;
    case "ns":
      nanos = ts;
      break;
  }

  return { nanos, unit, usedFallback: false };
}
