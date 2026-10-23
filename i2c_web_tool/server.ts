// Hono 静态托管服务。Web Serial / Web Bluetooth 的硬件访问完全发生在
// 浏览器端，服务端的职责只有：托管 Vite 构建产物 + 健康检查（便于部署探活）。
import { Hono } from "hono";
import { serveStatic } from "hono/deno";

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "i2c-web-tool",
    access: "浏览器 Web Serial / Web Bluetooth (NUS) 直连串口",
  }));

// 静态资源（deno task 在 deno.json 所在目录运行，root 用相对路径）。
app.use("/*", serveStatic({ root: "./dist" }));
// SPA 回退：未知路径返回 index.html。
app.get("*", serveStatic({ path: "./dist/index.html" }));

const port = Number(Deno.env.get("PORT") ?? 8787);

Deno.serve({
  port,
  hostname: "127.0.0.1",
  onListen: ({ hostname, port: actualPort }) => {
    console.log(`I²C Web Tool → http://${hostname}:${actualPort}`);
  },
}, app.fetch);
