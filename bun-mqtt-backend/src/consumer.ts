import mqtt from "mqtt";
import { config } from "./config";
import { shutdownInflux } from "./influx";
import { writeSensorData } from "./services/sensorData";

const { url, username, password, clientId, subscribeTopic, qos } = config.mqtt;

const client = mqtt.connect(url, {
  username,
  password,
  clientId,
  clean: false, // 持久会话，断连期间 Broker 暂存消息
  reconnectPeriod: 5000, // 断线后 5 秒重连
  connectTimeout: 10000,
});

client.on("connect", () => {
  console.log(`✅ 已连接 Mosquitto (clientId: ${clientId})`);

  client.subscribe(subscribeTopic, { qos }, (err, granted) => {
    if (err) {
      console.error("❌ 订阅失败:", err);
      return;
    }

    const grants = granted ?? [];
    console.log(
      "📡 已订阅:",
      grants.map((g) => `${g.topic} (QoS ${g.qos})`).join(", "),
    );
  });
});

client.on("message", async (topic, payload) => {
  const raw = payload.toString();

  try {
    const data = JSON.parse(raw);

    // 从主题中提取设备 ID：sensors/{deviceId}/...
    const parts = topic.split("/");
    const deviceId = parts[1] || "unknown";

    // 如果 payload 里带了 timestamp，优先使用
    const ts = typeof data.timestamp === "number" ? data.timestamp : undefined;

    await writeSensorData(deviceId, data, ts);

    console.log(`📥 ${topic} → device=${deviceId}`);
  } catch (err) {
    console.error(`❌ 处理消息失败 (topic: ${topic})`);
    console.error("   原始内容:", raw.slice(0, 200));
    console.error("   错误:", err instanceof Error ? err.message : err);
  }
});

client.on("reconnect", () => console.log("🔄 正在重连..."));
client.on("close", () => console.log("🔌 连接已关闭"));
client.on("offline", () => console.log("📴 客户端离线"));
client.on("error", (err) => console.error("❌ MQTT 错误:", err.message));

// 优雅关闭：先断开 MQTT，再刷出 InfluxDB 缓冲
async function shutdown(signal: string) {
  console.log(`\n收到 ${signal}，正在关闭...`);

  client.end(true, async () => {
    await shutdownInflux();
    console.log("👋 已安全退出");
    process.exit(0);
  });

  // 兜底：5 秒内没关完就强制退出
  setTimeout(() => {
    console.error("⚠️ 关闭超时，强制退出");
    process.exit(1);
  }, 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// 捕获未处理异常，避免进程静默崩溃
process.on("unhandledRejection", (reason) => {
  console.error("未处理的 Promise 拒绝:", reason);
});
