import { Hono } from "hono";
import { registerChecker, runAllChecks, overallStatus } from "./registry";
import { createDatabaseChecker } from "./checkers";

export function createHealthRoutes(app: Hono, dbDir: string): void {
  // 注册数据库检查器
  registerChecker(createDatabaseChecker(dbDir));

  // 轻量存活检查
  app.get("/health", (c) => c.json({ status: "ok" }));

  // 详细检查（包括数据库）
  app.get("/health/db", async (c) => {
    const results = await runAllChecks();
    const status = overallStatus(results);
    return c.json(
      {
        status,
        checks: results,
        timestamp: new Date().toISOString(),
      },
      status === "ok" ? 200 : 503,
    );
  });
}
