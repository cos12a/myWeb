import { Point } from "@influxdata/influxdb-client";
import { writeApi } from "../influx";
import { logger } from "../logger";

// 哪些字段作为 Tag（会被索引，适合查询过滤）
const TAG_FIELDS = new Set(["location", "type"]);

/**
 * 把传感器 payload 转换成 InfluxDB Point 并入队写入。
 *
 * 落库规则（保持原有语义）：
 * - deviceId 来自 topic，永远作为 tag `device_id`
 * - location / type 作为 tag（低基数、常用作过滤）
 * - 其余字段按 JS 类型自动落到 float/boolean/string field
 * - 嵌套对象暂不处理
 *
 * 注意：writeApi 内部有批量缓冲，本函数不是"立即落库"。
 */
export async function writeSensorData(
  deviceId: string,
  data: Record<string, unknown>,
  timestamp?: number,
): Promise<void> {
  const point = new Point("sensor_reading").tag("device_id", deviceId);

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;

    if (TAG_FIELDS.has(key) && typeof value === "string") {
      point.tag(key, value);
    } else if (typeof value === "number") {
      point.floatField(key, value);
    } else if (typeof value === "boolean") {
      point.booleanField(key, value);
    } else if (typeof value === "string") {
      point.stringField(key, value);
    } else {
      logger.debug({ key, type: typeof value }, "跳过不支持的字段类型");
    }
  }

  // 时间戳：传感器没传就用当前时间（纳秒精度）
  point.timestamp(timestamp ?? Date.now() * 1_000_000);

  writeApi.writePoint(point);
}
