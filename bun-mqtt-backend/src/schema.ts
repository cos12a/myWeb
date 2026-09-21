import { z } from "zod";

/**
 * MQTT payload 校验 Schema。
 *
 * 设计原则：
 * - 已知字段严格约束类型，防止脏数据写入 InfluxDB
 * - 允许 passthrough：传感器可以扩展任意数值/布尔/字符串字段
 *   （如 temperature、humidity、rssi 等），业务层再按类型落库
 */
export const SensorPayloadSchema = z
  .object({
    /** 毫秒/纳秒时间戳，由业务层决定精度；缺失则用当前时间 */
    timestamp: z.number().int().positive().optional(),
    /** 部署位置，会作为 InfluxDB tag */
    location: z.string().min(1).optional(),
    /** 传感器类型，会作为 InfluxDB tag */
    type: z.string().min(1).optional(),
    /** 可选的 payload 内 deviceId；优先用 topic 上的 deviceId */
    deviceId: z.string().min(1).optional(),
  })
  .passthrough();

export type SensorPayload = z.infer<typeof SensorPayloadSchema>;

/**
 * 从 MQTT topic 中解析 deviceId：sensors/{deviceId}/...
 * 非法 topic 会返回 null，由调用方决定丢弃还是用默认值。
 */
export function parseDeviceIdFromTopic(topic: string): string | null {
  const parts = topic.split("/");
  if (parts.length < 2 || parts[0] !== "sensors") return null;
  const id = parts[1];
  return id && id.length > 0 ? id : null;
}
