import { Hono } from "hono";
import { serveStatic } from "hono/deno";
import { logger } from "hono/logger";
import api from "./src/routes/api.ts";
import stoov from "./src/routes/stoov.ts";
import { createHealthRoutes } from "./src/health.ts";

// ---------------------------------------------------------------------------
// 静态资源根目录解析（桌面版关键差异）
//
// Bun/Hono 原版用 root:"./static"（相对运行时 CWD）。但 deno compile 出的可执行
// 文件可能从任意目录启动，CWD 相对路径会失效。这里把静态根解析成「绝对路径」：
//   1) STATIC_ROOT 环境变量（最高优先，显式覆盖）
//   2) 可执行文件同级 static，或上一级 static（编译版：Deno.execPath 所在目录）
//   3) 源码模块同级 static（开发版：deno run，import.meta.url）
//   4) 兜底 ./static（相对 CWD）
// 由此，编译后的桌面程序无论从哪里启动，都能定位到随程序分发的 static 目录。
// ---------------------------------------------------------------------------
function resolveStaticRoot(): string {
  const fromEnv = Deno.env.get("STATIC_ROOT");
  if (fromEnv) return fromEnv;

  const candidates: string[] = [];
  try {
    const exeDir = Deno.execPath().replace(/[^/\\]*$/, "");
    candidates.push(`${exeDir}static`, `${exeDir}../static`);
  } catch {
    // 某些环境下取不到 execPath，忽略。
  }
  try {
    candidates.push(new URL("./static", import.meta.url).pathname);
  } catch {
    // 忽略。
  }
  candidates.push("./static");

  for (const c of candidates) {
    try {
      if (Deno.statSync(c).isDirectory) return c;
    } catch {
      // 该候选不存在，试下一个。
    }
  }
  return "./static";
}

const S = resolveStaticRoot();

const app = new Hono();

app.use(logger()); // Logger 中间件

// ---------- 健康检查（必须放在静态路由之前） ----------
createHealthRoutes(app);

// ---------- 挂载 API 路由 ----------
app.route("/api", api);
app.route("/api/stoov", stoov);

// ---------- 静态资源托管 ----------
// URL 前缀与重写规则与 Bun 原版逐字一致，仅把静态根 "./static" 换成解析出的绝对路径 S。

// Stoov 测试工具（Vite 构建产物）
app.use(
  "/stoov-test/*",
  serveStatic({
    root: S,
    rewriteRequestPath: (path: string) =>
      path.replace(/^\/stoov-test/, "/stoov-test/dist"),
  }),
);
app.get(
  "/stoov-test",
  serveStatic({ path: `${S}/stoov-test/dist/index.html` }),
);
app.get(
  "/stoov-test/",
  serveStatic({ path: `${S}/stoov-test/dist/index.html` }),
);

// Stoov 校准控制面板（原生静态页面）
app.use(
  "/stoov-corr/*",
  serveStatic({
    root: S,
    rewriteRequestPath: (path: string) =>
      path.replace(/^\/stoov-corr/, "/stoov-corr"),
  }),
);
app.get("/stoov-corr", serveStatic({ path: `${S}/stoov-corr/index.html` }));
app.get("/stoov-corr/", serveStatic({ path: `${S}/stoov-corr/index.html` }));

// InstrumentTestLit 仪器指标面板（Lit 组件构建产物）
app.use(
  "/instrument/*",
  serveStatic({
    root: S,
    rewriteRequestPath: (path: string) =>
      path.replace(/^\/instrument/, "/InstrumentTestLit/dist"),
  }),
);
app.get(
  "/instrument",
  serveStatic({ path: `${S}/InstrumentTestLit/dist/index.html` }),
);
app.get(
  "/instrument/",
  serveStatic({ path: `${S}/InstrumentTestLit/dist/index.html` }),
);

// WS8623 BLE 蓝牙测试（原生静态页面）
app.use(
  "/ws8623/*",
  serveStatic({
    root: S,
    rewriteRequestPath: (path: string) => path.replace(/^\/ws8623/, "/ws8623Demo"),
  }),
);
app.get("/ws8623", serveStatic({ path: `${S}/ws8623Demo/index.html` }));
app.get("/ws8623/", serveStatic({ path: `${S}/ws8623Demo/index.html` }));

// STM32 Web 烧录工具（Vite 构建产物）
app.use(
  "/stm32flasher/*",
  serveStatic({
    root: S,
    rewriteRequestPath: (path: string) =>
      path.replace(/^\/stm32flasher/, "/stm32WebFlasher/dist"),
  }),
);
app.get(
  "/stm32flasher",
  serveStatic({ path: `${S}/stm32WebFlasher/dist/index.html` }),
);
app.get(
  "/stm32flasher/",
  serveStatic({ path: `${S}/stm32WebFlasher/dist/index.html` }),
);

// Web 串口绘图器：dist 使用绝对 base "/WebSerialPlotter/"，URL 前缀必须保持一致
app.use(
  "/WebSerialPlotter/*",
  serveStatic({
    root: S,
    rewriteRequestPath: (path: string) =>
      path.replace(/^\/WebSerialPlotter/, "/webSerialPlotter/dist"),
  }),
);
app.get(
  "/WebSerialPlotter",
  serveStatic({ path: `${S}/webSerialPlotter/dist/index.html` }),
);
app.get(
  "/WebSerialPlotter/",
  serveStatic({ path: `${S}/webSerialPlotter/dist/index.html` }),
);

// USB 测试工具（原生静态页面）
app.use(
  "/usb-test/*",
  serveStatic({
    root: S,
    rewriteRequestPath: (path: string) => path.replace(/^\/usb-test/, "/usb-test"),
  }),
);
app.get("/usb-test", serveStatic({ path: `${S}/usb-test/index.html` }));
app.get("/usb-test/", serveStatic({ path: `${S}/usb-test/index.html` }));

// 托管 public 目录下的静态文件
app.use("/*", serveStatic({ root: `${S}/public` }));

// SPA 兜底：未匹配的路径返回 index.html
app.get("*", serveStatic({ path: `${S}/public/index.html` }));

// ---------- 启动服务 ----------
// 与 Bun 原版一致，默认固定端口 30000、仅监听回环地址（桌面本地访问）；
// 可用 PORT / HOST 环境变量覆盖。
const port = Number(Deno.env.get("PORT") ?? 30000);
const hostname = Deno.env.get("HOST") ?? "127.0.0.1";

console.log(`📁 静态资源根目录：${S}`);
console.log(`🚀 Server running at http://${hostname}:${port}`);

Deno.serve({ port, hostname }, app.fetch);
