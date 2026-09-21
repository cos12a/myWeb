import { Point } from "@influxdata/influxdb-client";
import { writeApi } from "../influx";
import { logger } from "../logger";
import { normalizeToNanoseconds } from "../utils/timestamp";
import {
  classifyPayload,
  type ClassifiedField,
  type FieldKind,
} from "./fieldClassifier";

// 重新导出，保持向后兼容的公开 API
export {
  classifyField,
  classifyPayload,
  tryParseNumericString,
  TAG_FIELDS,
  NUMERIC_FIELD_HINTS,
  type ClassifiedField,
  type FieldKind,
} from "./fieldClassifier";

/**
 * 把传感器 payload 转换成 InfluxDB Point 并入队写入。
 *
 * 落库规则：
 * - deviceId 来自 topic，永远作为 tag `device_id`
 * - location / type 作为 tag（低基数、常用作过滤）
 * - 数字 → floatField；布尔 → booleanField；字符串 → stringField
 * - 白名单里的数值字段如果被误传成字符串，会自动强转 + warn 日志
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

  const classified: ClassifiedField[] = classifyPayload(data);

  for (const c of classified) {
    switch (c.kind) {
      case "tag":
        point.tag(c.key, c.value as string);
        break;
      case "float":
        point.floatField(c.key, c.value as number);
        if (c.coerced) {
          logger.warn(
            {
              deviceId,
              field: c.key,
              raw: c.raw,
              coercedTo: c.value,
            },
            "字段本应是数值但收到字符串，已自动转为 float（建议修传感器固件）",
          );
        }
        break;
      case "boolean":
        point.booleanField(c.key, c.value as boolean);
        break;
      case "string":
        point.stringField(c.key, c.value as string);
        if (c.reason === "numeric-hint but not parseable") {
          logger.warn(
            { deviceId, field: c.key, value: c.value },
            "字段在数值白名单里但无法解析成数字，已按字符串写入",
          );
        }
        break;
      case "skip":
        logger.debug({ deviceId, field: c.key, reason: c.reason }, "跳过字段");
        break;
    }
  }

  // 时间戳：智能识别单位（s/ms/us/ns）并归一化为纳秒；缺失则用当前时间
  const { nanos, unit, usedFallback } = normalizeToNanoseconds(timestamp);
  if (usedFallback) {
    logger.debug({ deviceId }, "payload 未提供 timestamp，使用服务器当前时间");
  } else if (unit !== "ns") {
    logger.debug({ deviceId, unit }, "已自动将时间戳转换为纳秒");
  }
  point.timestamp(nanos);

  writeApi.writePoint(point);
}
