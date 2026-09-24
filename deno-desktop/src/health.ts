import type { Hono } from "hono";

// 健康检查路由。
// 说明：Bun 原版另有 /health/db（依赖 bun:sqlite 的数据库检查器），
// 本次移植按约定不包含 SQLite，故仅保留轻量存活检查 /health。
export function createHealthRoutes(app: Hono): void {
  app.get("/health", (c) => c.json({ status: "ok" }));
}
