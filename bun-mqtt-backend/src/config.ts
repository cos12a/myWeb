import { z } from "zod";

/**
 * 环境变量 Schema：启动时一次性校验，任何缺失/非法都会立刻退出，
 * 避免运行时才暴露配置问题。
 */
const EnvSchema = z.object({
  // MQTT
  MQTT_URL: z.string().min(1, "MQTT_URL 不能为空"),
  MQTT_USER: z.string().min(1, "MQTT_USER 不能为空"),
  MQTT_PASS: z.string().min(1, "MQTT_PASS 不能为空"),
  MQTT_CLIENT_ID: z.string().min(1).default("bun-mqtt-consumer"),
  MQTT_SUBSCRIBE_TOPIC: z.string().min(1).default("sensors/#"),

  // InfluxDB
  INFLUX_URL: z.string().min(1, "INFLUX_URL 不能为空"),
  INFLUX_TOKEN: z.string().min(1, "INFLUX_TOKEN 不能为空"),
  INFLUX_ORG: z.string().min(1, "INFLUX_ORG 不能为空"),
  INFLUX_BUCKET: z.string().min(1, "INFLUX_BUCKET 不能为空"),

  // 运行时
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(9000),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  // Bun.env 是 process.env 的别名，但类型更友好
  const result = EnvSchema.safeParse(Bun.env);
  if (!result.success) {
    // 这里刻意用 console，因为 logger 依赖 config，还未初始化
    console.error("❌ 环境变量校验失败:");
    for (const issue of result.error.issues) {
      console.error(`   - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

const env = loadEnv();

export const config = {
  mqtt: {
    url: env.MQTT_URL,
    username: env.MQTT_USER,
    password: env.MQTT_PASS,
    clientId: env.MQTT_CLIENT_ID,
    subscribeTopic: env.MQTT_SUBSCRIBE_TOPIC,
    qos: 1 as const,
  },
  influx: {
    url: env.INFLUX_URL,
    token: env.INFLUX_TOKEN,
    org: env.INFLUX_ORG,
    bucket: env.INFLUX_BUCKET,
  },
  log: {
    level: env.LOG_LEVEL,
  },
  health: {
    port: env.HEALTH_PORT,
  },
} as const;

/** 脱敏后的配置快照，可安全写入日志 */
export function configSnapshot() {
  return {
    mqtt: {
      url: config.mqtt.url,
      username: config.mqtt.username,
      clientId: config.mqtt.clientId,
      subscribeTopic: config.mqtt.subscribeTopic,
      qos: config.mqtt.qos,
    },
    influx: {
      url: config.influx.url,
      org: config.influx.org,
      bucket: config.influx.bucket,
    },
    log: { level: config.log.level },
    health: { port: config.health.port },
  };
}
