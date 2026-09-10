/** core 类型契约 —— 不碰 DOM、不碰请求，纯数据形状。 */

/** 单个指标定义（标签即契约）。 */
export interface Metric {
  /** 数据键名，与设备 JSON 行协议字段对应。 */
  key: string;
  /** 中文显示标签。 */
  label: string;
  /** 单位文本。 */
  unit: string;
  /** 小数位数。 */
  precision: number;
}

/** 一帧采样数据：键 → 数值。 */
export type MetricSample = Record<string, number>;

/** 连接状态机。
 *  BLE：connecting → pairing → paired（配对在访问受保护特征时由 OS 隐式触发）
 *  Serial：connecting → connected（无需配对） */
export type ConnStatus =
  | "idle" // 未连接
  | "selecting" // 选设备中
  | "connecting" // 连接 GATT / 串口中
  | "pairing" // 配对中（OS 弹框，访问受保护特征触发）
  | "connected" // 已连接（Serial 终态 / BLE GATT 已连）
  | "paired" // 已配对（BLE 终态，可通信）
  | "disconnected" // 已断开
  | "error"; // 错误

/** 数据源类型。 */
export type SourceKind = "ble" | "serial";

/** 配对模态结果：6 位密钥或 null（取消/超时）。 */
export type PairResult = string | null;