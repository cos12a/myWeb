import mqtt, { type MqttClient } from "mqtt";
import { config } from "./config";
import { logger } from "./logger";
import { parseDeviceIdFromTopic, SensorPayloadSchema } from "./schema";
import { classifyPayload, writeSensorData } from "./services/sensorData";
import { computeDedupKey, MessageDeduplicator } from "./dedup";

/**
 * 全局去重器实例（模块级单例），供 health 端点读取 stats。
 */
export const deduplicator = new MessageDeduplicator({
  enabled: config.dedup.enabled,
  maxSize: config.dedup.maxSize,
  ttlMs: config.dedup.ttlMs,
});

/** 周期性清扫过期条目的定时器句柄，供 shutdown 时清理 */
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动 MQTT 消费者。
 *
 * 关键行为：
 * - clean:false + 固定 clientId：Broker 会保留掉线期间的消息（持久会话）
 * - reconnectPeriod:5000：断线 5s 自动重连
 * - 所有 payload 都经过 Zod 校验，非法消息只记日志、不入库
 * - 应用层去重：LRU + TTL 缓存，防止 QoS≥1 重投或传感器重发导致数据翻倍
 */
export function startConsumer(): MqttClient {
  const { url, username, password, clientId, subscribeTopic, qos } = config.mqtt;

  const client = mqtt.connect(url, {
    username,
    password,
    clientId,
    clean: false,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on("connect", () => {
    logger.info({ clientId, url }, "已连接 MQTT Broker");

    client.subscribe(subscribeTopic, { qos }, (err, granted) => {
      if (err) {
        logger.error({ err, topic: subscribeTopic }, "订阅失败");
        return;
      }
      logger.info(
        {
          grants: (granted ?? []).map((g) => ({ topic: g.topic, qos: g.qos })),
        },
        "已订阅主题",
      );
    });
  });

  client.on("message", async (topic, payload) => {
    const raw = payload.toString();

    // 1) JSON 解析
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      logger.warn(
        { topic, err, raw: raw.slice(0, 200) },
        "payload 不是合法 JSON，已丢弃",
      );
      return;
    }

    // 2) Zod schema 校验
    const parsed = SensorPayloadSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn(
        {
          topic,
          issues: parsed.error.issues,
          raw: raw.slice(0, 200),
        },
        "payload 校验失败，已丢弃",
      );
      return;
    }
    const data = parsed.data;

    // 3) 应用层去重（LRU + TTL）
    const { key: dedupKey, source: dedupSource } = computeDedupKey(topic, raw, data);
    if (!deduplicator.checkAndRecord(dedupKey)) {
      logger.debug(
        { topic, dedupKey, dedupSource },
        "重复消息已丢弃（应用层去重命中）",
      );
      return;
    }

    // 4) 提取 deviceId：topic 优先，其次 payload，最后兜底 unknown
    const deviceId =
      parseDeviceIdFromTopic(topic) ??
      (typeof data.deviceId === "string" ? data.deviceId : null) ??
      "unknown";

    if (deviceId === "unknown") {
      logger.warn({ topic }, "无法确定 deviceId，仍将以 unknown 入库");
    }

    // 5) Debug 模式：打印完整数据日志（payload + 分类预览）
    //    LOG_LEVEL=debug 或 trace 时生效，生产环境 info 级别下不会刷屏
    if (logger.level === "debug" || logger.level === "trace") {
      const preview = classifyPayload(data as Record<string, unknown>).map((c) => ({
        field: c.key,
        kind: c.kind,
        value: c.kind === "skip" ? undefined : c.value,
        ...(c.coerced ? { coercedFrom: c.raw } : {}),
        ...(c.reason ? { reason: c.reason } : {}),
      }));
      logger.debug(
        {
          topic,
          deviceId,
          dedupKey,
          dedupSource,
          payload: data,
          fields: preview,
          rawLength: raw.length,
        },
        "📥 收到 MQTT 消息（debug 数据快照）",
      );
    }

    // 6) 时间戳：payload 有就传下去，sensorData 里会做单位归一化
    const ts = typeof data.timestamp === "number" ? data.timestamp : undefined;

    try {
      await writeSensorData(
        deviceId,
        data as Record<string, unknown>,
        ts,
      );
      logger.debug({ topic, deviceId, dedupSource }, "已入队写入 InfluxDB");
    } catch (err) {
      logger.error({ topic, deviceId, err }, "写入 InfluxDB 失败");
    }
  });

  client.on("reconnect", () => logger.info("MQTT 正在重连…"));
  client.on("close", () => logger.info("MQTT 连接已关闭"));
  client.on("offline", () => logger.warn("MQTT 客户端离线"));
  client.on("error", (err) => logger.error({ err }, "MQTT 错误"));

  // 6) 定时清扫过期去重条目（每 TTL/2 一次，避免 Map 无限增长）
  if (config.dedup.enabled) {
    const sweepIntervalMs = Math.max(30_000, Math.floor(config.dedup.ttlMs / 2));
    sweepTimer = setInterval(() => {
      const removed = deduplicator.sweep();
      if (removed > 0) {
        logger.debug({ removed, stats: deduplicator.getStats() }, "去重缓存清扫完成");
      }
    }, sweepIntervalMs);
    // 不阻塞事件循环退出
    sweepTimer.unref?.();
  }

  return client;
}

/** 停止周期性清扫（优雅关闭时调用） */
export function stopConsumerTimers(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
