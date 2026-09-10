/** 默认指标定义：与 ESP32 INA219 JSON 行协议对齐。 */
import type { Metric } from "./types.js";

export const DEFAULT_METRICS: readonly Metric[] = [
  { key: "vbus", label: "总线电压", unit: "V", precision: 4 },
  { key: "vshunt", label: "分流电压", unit: "mV", precision: 4 },
  { key: "ibus", label: "电流", unit: "mA", precision: 4 },
  { key: "pbus", label: "功率", unit: "mW", precision: 4 },
] as const;