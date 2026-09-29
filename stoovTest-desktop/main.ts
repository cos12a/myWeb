// ---------------------------------------------------------------------------
// stoovTest 桌面版后台：单进程 = 本地静态服务 + 原生串口桥 + 后台 MQTT + 本地 SQLite。
//
// 端点：
//   GET  /api/stoov/mqtt-config         前端配置拉取（读本地磁盘 JSON，保持 main.js 不改）
//   POST /api/stoov/test-data/download  从本地 SQLite 导出 CSV（另存）
//   GET  /api/serial/ports              本机原生 COM 口枚举
//   WS   /ws/serial                     原生串口桥（Win32 FFI）
//   WS   /ws/mqtt                       前端发布 -> 后台 broker（并拦截 save 落本地库）
//   GET  /health                        健康检查
//   其余路径 -> static 目录静态资源
// ---------------------------------------------------------------------------

import { fromFileUrl, join, resolve, dirname } from "https://deno.land/std@0.224.0/path/mod.ts";
import { portsResponse, upgradeSerialSocket } from "./serial-bridge.ts";
import { StoovStore, type SavePayload } from "./sqlite-store.ts";
import { initMqttBackend, upgradeMqttSocket, type MqttConfig } from "./mqtt-backend.ts";

const host = Deno.env.get("HOST") ?? "127.0.0.1";
// 默认端口改为独立值 30077（避开根 Bun 服务与 deno-desktop 共用的 30000，防端口撞车）。
// 若默认端口被占用，从该端口起逐个 +1 重试，最多 MAX_PORT_TRIES 次；全部占用才报错退出。
const basePort = Number(Deno.env.get("PORT") ?? 30077);
const MAX_PORT_TRIES = 100;

// ---- 静态资源根目录解析（对齐 stm32WebFlasher-desktop 的做法） ----
// 判据：index.html + native-mqtt-shim.js（桌面专属 overlay 产物，上游项目中不存在）。
// 旧判据曾用 src/main.js，但上游已将应用逻辑整段内联进 index.html，sync 也不再拷贝死代码 src/。
function isLikelyProjectRoot(candidate: string): boolean {
  try {
    return (
      Deno.statSync(join(candidate, "index.html")).isFile &&
      Deno.statSync(join(candidate, "native-mqtt-shim.js")).isFile
    );
  } catch {
    return false;
  }
}

function candidateDirs(): string[] {
  const list: string[] = [];
  try {
    const exeDir = dirname(Deno.execPath());
    list.push(join(exeDir, "static"), resolve(exeDir, "..", "static"));
  } catch { /* 忽略 */ }
  try {
    const importDir = dirname(fromFileUrl(import.meta.url));
    list.push(join(importDir, "static"));
  } catch { /* 忽略 */ }
  const cwd = Deno.cwd();
  list.push(join(cwd, "static"), cwd);
  return list;
}

function resolveStaticRoot(): string {
  const envRoot = Deno.env.get("STOOV_DESKTOP_ROOT");
  if (envRoot && isLikelyProjectRoot(envRoot)) return envRoot;
  for (const candidate of candidateDirs()) {
    if (isLikelyProjectRoot(candidate)) return candidate;
  }
  throw new Error(
    "无法定位静态资源目录。请先运行 `deno task sync` 生成 static，或设置 STOOV_DESKTOP_ROOT 环境变量。",
  );
}

const staticRoot = resolveStaticRoot();

// ---- 本地磁盘 JSON 配置（D2）----
// 找不到文件时回退内置默认，保证桌面端开箱可用。
const DEFAULT_MQTT_CONFIG: MqttConfig = {
  url: "wss://r61d1d77.ala.cn-shenzhen.emqxsl.cn:8084/mqtt",
  username: "__REDACTED_MQTT_USER__",
  password: "__REDACTED_MQTT_PASS__",
  reconnectPeriod: 5000,
  connectTimeout: 10000,
};

async function loadMqttConfig(): Promise<MqttConfig> {
  const paths: string[] = [];
  const env = Deno.env.get("STOOV_MQTT_CONFIG");
  if (env) paths.push(env);
  for (const base of candidateDirs().map((d) => resolve(d, ".."))) {
    paths.push(join(base, "config", "mqtt-config.json"));
  }
  const cwd = Deno.cwd();
  paths.push(join(cwd, "config", "mqtt-config.json"));
  for (const path of paths) {
    try {
      const text = await Deno.readTextFile(path);
      const parsed = JSON.parse(text) as MqttConfig;
      if (parsed?.url) {
        console.log(`📄 MQTT 配置来自本地磁盘：${path}`);
        return { ...DEFAULT_MQTT_CONFIG, ...parsed };
      }
    } catch { /* 尝试下一个 */ }
  }
  console.log("📄 未找到本地 MQTT 配置文件，使用内置默认配置");
  return DEFAULT_MQTT_CONFIG;
}

// ---- 本地 SQLite 数据目录（可写；编译版落在 exe 同级 data/）----
function resolveDataDir(): string {
  const env = Deno.env.get("STOOV_DESKTOP_DATA_DIR");
  if (env) return env;
  try {
    return join(dirname(Deno.execPath()), "data");
  } catch { /* 忽略 */ }
  return join(Deno.cwd(), "data");
}

const dataDir = resolveDataDir();
await Deno.mkdir(dataDir, { recursive: true });
const store = new StoovStore(join(dataDir, "stoov-desktop.db"));
console.log(`🗄️  本地测试数据库：${join(dataDir, "stoov-desktop.db")}`);

// ---- 启动后台 MQTT（进程内持有一条 broker 连接）----
const mqttConfig = await loadMqttConfig();
initMqttBackend(mqttConfig);

// ---- 静态托管 ----
function guessContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return "application/javascript; charset=utf-8";
  }
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".webmanifest")) return "application/manifest+json";
  if (lower.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function normalizeRequestPath(url: URL): string {
  const pathname = decodeURIComponent(url.pathname);
  return pathname === "/" ? "/index.html" : pathname;
}

async function serveStaticFile(requestPath: string): Promise<Response | null> {
  const filePath = resolve(staticRoot, requestPath.replace(/^\/+/, ""));
  if (!filePath.startsWith(staticRoot)) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const stat = await Deno.stat(filePath);
    if (stat.isDirectory) return serveStaticFile(join(requestPath, "index.html"));
    const bytes = await Deno.readFile(filePath);
    return new Response(bytes, {
      headers: {
        "Content-Type": guessContentType(filePath),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return null;
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function datePrefix(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
    new Date(),
  );
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = normalizeRequestPath(url);

  // ---- 前端配置拉取（保持 main.js 的 fetch 不改） ----
  if (pathname === "/api/stoov/mqtt-config") {
    return jsonResponse(mqttConfig);
  }

  // ---- 本地 CSV 导出（另存） ----
  if (pathname === "/api/stoov/test-data/download" && request.method === "POST") {
    const body = (await request.json().catch((): unknown => ({}))) as
      { mode?: string };
    const mode = body.mode === "internal" ? "internal" : "external";
    try {
      const csv = store.exportCsv(mode);
      const filename = `${mode === "internal" ? "heating_test_data" : "Stoov_Remote"}_${datePrefix()}.csv`;
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    } catch (error) {
      console.error("导出 CSV 失败:", error);
      return jsonResponse(
        { success: false, message: "本地数据库不可用或查询失败", mode },
        503,
      );
    }
  }

  // ---- 原生串口 ----
  if (pathname === "/api/serial/ports") return portsResponse();
  if (pathname === "/ws/serial") {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }
    return upgradeSerialSocket(request);
  }

  // ---- 后台 MQTT 桥 ----
  if (pathname === "/ws/mqtt") {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }
    return upgradeMqttSocket(request, store);
  }

  if (pathname === "/health") {
    // 专属标记头 X-Stoov-Desktop：供 desktop.ts 的就绪校验识别「应答是否来自本应用」，
    // 避免端口被别的服务占用时误弹对方页面。
    return new Response("ok", {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Stoov-Desktop": "1",
      },
    });
  }

  const staticResponse = await serveStaticFile(pathname);
  if (staticResponse) return staticResponse;
  return new Response("Not Found", { status: 404 });
}

// 启动服务：默认端口被占则 +1 递增重试（最多 MAX_PORT_TRIES 次）。
// AddrInUse 由 Deno.serve 同步抛出（实测验证），据此在循环内安全重试，无需预探测。
function startServer(): {
  server: Deno.HttpServer<Deno.NetAddr>;
  boundPort: number;
  busy: number[];
} {
  const busy: number[] = [];
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    const candidate = basePort + i;
    try {
      const srv = Deno.serve(
        {
          hostname: host,
          port: candidate,
          onListen({ hostname, port }) {
            console.log("📦 stoovTest 桌面服务已启动");
            console.log(`📁 静态资源目录：${staticRoot}`);
            console.log(`🔌 原生串口桥：/api/serial/ports + /ws/serial（Windows Win32 FFI）`);
            console.log(`📡 后台 MQTT：/ws/mqtt -> broker（save 主题同时写本地库）`);
            console.log(`🌐 地址：http://${hostname}:${port}/`);
          },
        },
        handleRequest,
      );
      return { server: srv, boundPort: candidate, busy };
    } catch (err) {
      if (err instanceof Deno.errors.AddrInUse) {
        busy.push(candidate); // 记为占用，试下一个端口
        continue;
      }
      throw err; // 其它错误（权限/非法端口等）不吞，直接上抛
    }
  }
  // 连续 MAX_PORT_TRIES 个端口全被占用：打印友好提示（含占用检测）后退出，不抛裸栈。
  console.error(
    `\n❌ stoovTest-desktop 启动失败：端口 ${basePort}~${basePort + MAX_PORT_TRIES - 1}` +
      `（共 ${MAX_PORT_TRIES} 个）全部被占用，无法监听。`,
  );
  console.error(`   占用检测：以上端口均返回 AddrInUse（已被其它进程监听）。`);
  console.error(
    `   处理建议：关闭占用进程，或用 \`PORT=<空闲端口> deno task start\` 指定其它端口重试。`,
  );
  Deno.exit(1);
}

const { server, boundPort: actualPort, busy } = startServer();
if (busy.length > 0) {
  console.warn(
    `⚠️ 端口 ${busy.join(", ")} 被占用，已自动改用 ${actualPort}（可用 PORT= 指定端口覆盖）。`,
  );
}

export { server, actualPort, staticRoot, store, mqttConfig };
// 让 SavePayload 类型在此模块可见（供工具/测试引用，不影响运行时）
export type { SavePayload };
