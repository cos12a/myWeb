import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import api from "./routes/api";

const app = new Hono();

// 挂载 API 路由
app.route("/api", api);

// 托管 public 目录下的静态文件
app.use("/*", serveStatic({ root: "./public" }));

// SPA 兜底：未匹配的路径返回 index.html
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT) || 3000;
console.log(`🚀 Server running at http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
