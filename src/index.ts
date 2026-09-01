import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import api from "./routes/api";
import stoov from "./routes/stoov";
import { logger } from "hono/logger"; // 导入 Logger 中间件
import { createHealthRoutes } from "./health";

const app = new Hono();

app.use(logger()); // 使用 Logger 中间件
// ---------- 健康检查（必须放在静态路由之前） ----------
const dbDir =
  process.env.STOOV_DB_DIR || "/home/yzluo/unito/sqlit-db/stoov-bed";
createHealthRoutes(app, dbDir);

// 挂载 API 路由
app.route("/api", api);
app.route("/api/stoov", stoov);

// Stoov 测试工具：将公开 URL 映射到 Vite 的 dist 目录
app.use(
  "/stoov-test/*",
  serveStatic({
    root: "./",
    rewriteRequestPath: (path: string) =>
      path.replace(/^\/stoov-test/, "/stoov-test/dist"),
  }),
);
app.get("/stoov-test", serveStatic({ path: "./stoov-test/dist/index.html" }));
app.get("/stoov-test/", serveStatic({ path: "./stoov-test/dist/index.html" }));

// Stoov 校准控制面板：直接托管原生静态页面
app.use(
  "/stoov-corr/*",
  serveStatic({
    root: "./",
    rewriteRequestPath: (path: string) =>
      path.replace(/^\/stoov-corr/, "/stoov-corr"),
  }),
);
app.get("/stoov-corr", serveStatic({ path: "./stoov-corr/index.html" }));
app.get("/stoov-corr/", serveStatic({ path: "./stoov-corr/index.html" }));

// STM32 Web 烧录工具：将公开 URL 映射到 stm32WebFlasher 的 dist 目录
app.use(
  "/stm32flasher/*",
  serveStatic({
    root: "./",
    rewriteRequestPath: (path: string) =>
      path.replace(/^\/stm32flasher/, "/stm32WebFlasher/dist"),
  }),
);
app.get(
  "/stm32flasher",
  serveStatic({ path: "./stm32WebFlasher/dist/index.html" }),
);
app.get(
  "/stm32flasher/",
  serveStatic({ path: "./stm32WebFlasher/dist/index.html" }),
);

// 托管 public 目录下的静态文件
app.use("/*", serveStatic({ root: "./public" }));

// SPA 兜底：未匹配的路径返回 index.html
app.get("*", serveStatic({ path: "./public/index.html" }));

// 固定服务端口，与 Nginx 的反向代理配置保持一致。
const port = 30000;
// 仅允许本机 Nginx 通过回环地址访问，不直接暴露 Bun 服务。
const hostname = "127.0.0.1";

console.log(`🚀 Server running at http://${hostname}:${port}`);

export default {
  port,
  hostname,
  fetch: app.fetch,
};
