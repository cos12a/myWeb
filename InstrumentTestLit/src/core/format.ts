/** 纯函数：数值与时间格式化。 */

/** 按精度格式化数值，null 返回占位。 */
export function formatMetricValue(value: number | null, precision: number): string {
  return value === null ? "--" : value.toFixed(precision);
}

/** 把毫秒时间戳格式化为 HH:MM:SS.mmm。 */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** 校验 6 位数字配对密钥。 */
export function isValidPasskey(v: string): boolean {
  return /^\d{6}$/.test(v);
}