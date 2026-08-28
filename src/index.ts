import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import api from "./routes/api";
import stoov from "./routes/stoov";

const app = new Hono();

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
