import type { MqttClient } from "mqtt";
import type { Server } from "bun";
import { config } from "./config";
import { logger } from "./logger";
import type { DedupStats } from "./dedup";

export interface HealthDeps {
  mqttClient: MqttClient;
  /** 可选：注入去重器 stats getter，方便测试与解耦 */
  getDedupStats?: () => DedupStats;
}

/**
 * 启动健康检查 HTTP 服务器（基于 Bun 原生 Bun.serve）。
 *
 * 端点：
 *   GET /         → 200 服务自我介绍
 *   GET /health   → 200 { status:"ok", ... }      MQTT 已连接
 *                 → 503 { status:"degraded", ... } MQTT 未连接（进程仍在跑）
 *   GET /stats    → 200 详细运行时统计（去重命中率、uptime 等）
 *
 * 供 systemd / Docker HEALTHCHECK / Prometheus blackbox 探测使用。
 */
export function startHealthServer(deps: HealthDeps): Server<undefined> {
  const startedAt = Date.now();

  const server = Bun.serve({
    port: config.health.port,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/health") {
        const mqttConnected = deps.mqttClient.connected;
        const body = {
          status: mqttConnected ? "ok" : "degraded",
          mqtt: { connected: mqttConnected },
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          timestamp: new Date().toISOString(),
        };
        return Response.json(body, { status: mqttConnected ? 200 : 503 });
      }

      if (url.pathname === "/stats") {
        const stats = {
          uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          mqtt: {
            connected: deps.mqttClient.connected,
            clientId: config.mqtt.clientId,
            subscribeTopic: config.mqtt.subscribeTopic,
          },
          influx: {
            url: config.influx.url,
            org: config.influx.org,
            bucket: config.influx.bucket,
          },
          dedup: deps.getDedupStats ? deps.getDedupStats() : { enabled: false },
        };
        return Response.json(stats);
      }

      if (url.pathname === "/") {
        return Response.json({
          name: "bun-mqtt-backend",
          endpoints: ["/health", "/stats"],
        });
      }

      return new Response("Not Found", { status: 404 });
    },
    error(err) {
      logger.error({ err }, "健康检查端点内部错误");
      return Response.json({ status: "error", message: err.message }, { status: 500 });
    },
  });

  logger.info({ port: server.port, hostname: server.hostname }, "健康检查端点已启动");
  return server;
}
