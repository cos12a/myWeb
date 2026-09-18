import { Point } from "@influxdata/influxdb-client";
import { writeApi } from "../influx";

// 哪些字段作为 Tag（会被索引，适合查询过滤）
const TAG_FIELDS = new Set(["deviceId", "location", "type"]);

// 哪些字段作为 Field（数值、状态等）
// 其余未列出的字段按类型自动判断

export async function writeSensorData(
  deviceId: string,
  data: Record<string, unknown>,
  timestamp?: number,
) {
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
    }
    // 嵌套对象暂不处理，需要时再扩展
  }

  // 时间戳：传感器没传就用当前时间
  point.timestamp(timestamp ?? Date.now() * 1_000_000);

  writeApi.writePoint(point);
}
