import type { MqttClient } from "mqtt";
import type { Server } from "bun";
import { config } from "./config";
import { logger } from "./logger";

export interface HealthDeps {
  mqttClient: MqttClient;
}

/**
 * 启动健康检查 HTTP 服务器（基于 Bun 原生 Bun.serve）。
 *
 * 端点：
 *   GET /health  → 200 { status:"ok", ... }     MQTT 已连接
 *                → 503 { status:"degraded", ... } MQTT 未连接（进程仍在跑）
 *   GET /        → 200 简单欢迎信息
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

      if (url.pathname === "/") {
        return Response.json({
          name: "bun-mqtt-backend",
          health: "/health",
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
