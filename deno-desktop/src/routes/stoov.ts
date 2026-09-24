import { Hono } from "hono";
import type { Context } from "hono";

const stoov = new Hono();

// MQTT 接入配置：前端页面通过本接口拿到 broker 连接参数。
// ⚠️ 与 Bun 原版一致，默认值内置于此；如需避免硬编码，可用环境变量覆盖：
//   STOOV_MQTT_URL / STOOV_MQTT_USER / STOOV_MQTT_PASS
const mqttConfig = {
  url: Deno.env.get("STOOV_MQTT_URL") ??
    "wss://r61d1d77.ala.cn-shenzhen.emqxsl.cn:8084/mqtt",
  username: Deno.env.get("STOOV_MQTT_USER") ?? "heatingBed",
  password: Deno.env.get("STOOV_MQTT_PASS") ?? "cos8mos7",
  reconnectPeriod: 5000,
  connectTimeout: 10000,
};

// 说明：Bun 原版另有 POST /test-data/download（依赖 bun:sqlite 导出 CSV），
// 本次移植按约定不包含 SQLite 相关能力，故此处仅保留 mqtt-config。
stoov.get("/mqtt-config", (c: Context) => c.json(mqttConfig));

export default stoov;
