import mqtt, { type MqttClient } from "mqtt";
import { config } from "./config";
import { logger } from "./logger";
import { parseDeviceIdFromTopic, SensorPayloadSchema } from "./schema";
import { writeSensorData } from "./services/sensorData";

/**
 * 启动 MQTT 消费者。
 *
 * 关键行为：
 * - clean:false + 固定 clientId：Broker 会保留掉线期间的消息（持久会话）
 * - reconnectPeriod:5000：断线 5s 自动重连
 * - 所有 payload 都经过 Zod 校验，非法消息只记日志、不入库
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

    // 3) 提取 deviceId：topic 优先，其次 payload，最后兜底 unknown
    const deviceId =
      parseDeviceIdFromTopic(topic) ??
      (typeof data.deviceId === "string" ? data.deviceId : null) ??
      "unknown";

    if (deviceId === "unknown") {
      logger.warn({ topic }, "无法确定 deviceId，仍将以 unknown 入库");
    }

    // 4) 时间戳：payload 有就用，没有走 InfluxDB 端当前时间
    const ts = typeof data.timestamp === "number" ? data.timestamp : undefined;

    try {
      await writeSensorData(
        deviceId,
        data as Record<string, unknown>,
        ts,
      );
      logger.debug({ topic, deviceId }, "已入队写入 InfluxDB");
    } catch (err) {
      logger.error({ topic, deviceId, err }, "写入 InfluxDB 失败");
    }
  });

  client.on("reconnect", () => logger.info("MQTT 正在重连…"));
  client.on("close", () => logger.info("MQTT 连接已关闭"));
  client.on("offline", () => logger.warn("MQTT 客户端离线"));
  client.on("error", (err) => logger.error({ err }, "MQTT 错误"));

  return client;
}
