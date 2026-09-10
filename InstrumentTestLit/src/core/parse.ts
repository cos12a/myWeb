/** 纯函数：JSON 行解析。失败返回 null，不抛异常。 */
import type { MetricSample } from "./types.js";

export function parseJsonLine(line: string): MetricSample | null {
  try {
    const obj = JSON.parse(line);
    if (typeof obj !== "object" || obj === null) return null;
    return obj as MetricSample;
  } catch {
    return null;
  }
}

/** 从一帧数据中提取某指标的数值，缺失返回 null。 */
export function pickMetric(sample: MetricSample, key: string): number | null {
  const v = sample[key];
  return typeof v === "number" ? v : null;
}