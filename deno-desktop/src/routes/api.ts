import { Hono } from "hono";
import type { Context } from "hono";

const api = new Hono();

// 🆕 IoT 实时数据接口（与 Bun 原版逐字一致，返回随机演示数据）
api.get("/iot-data", (c: Context) => {
  // TODO: 未来替换为真实数据源（MQTT / Redis / DB）
  const now = new Date();
  return c.json({
    temperature: (22 + Math.random() * 5).toFixed(1),
    humidity: Math.floor(55 + Math.random() * 20),
    onlineDevices: Math.floor(5 + Math.random() * 4),
    totalDevices: 8,
    apiCalls: Math.floor(1000 + Math.random() * 500),
    sensorId: "Node-01",
    updatedAt: now.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  });
});

export default api;
