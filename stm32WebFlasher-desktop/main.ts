import {
  fromFileUrl,
  join,
  resolve,
  dirname,
} from "https://deno.land/std@0.224.0/path/mod.ts";
import { portsResponse, upgradeSerialSocket } from "./serial-bridge.ts";

const host = Deno.env.get("HOST") ?? "127.0.0.1";
const port = Number(Deno.env.get("PORT") ?? 30000);

// 桌面版自带静态资源目录的识别特征：index.html + src/app.js + 固件文件。
function isLikelyProjectRoot(candidate: string): boolean {
  try {
    const indexPath = join(candidate, "index.html");
    const appPath = join(candidate, "src", "app.js");
    return Deno.statSync(indexPath).isFile && Deno.statSync(appPath).isFile;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 静态资源根目录解析（桌面版关键差异）
//
// 优先使用随桌面程序分发的 static 目录（从原项目 Copy 而来，原项目保持不动），
// 这样编译后的 exe 无论从哪里启动都能定位资源；找不到时再回退到同级
// stm32WebFlasher 原项目目录（开发模式兼容）。优先级：
//   1) STM32_WEB_FLASHER_ROOT 环境变量（显式覆盖）
//   2) 可执行文件同级/上一级的 static（编译版）
//   3) 源码模块同级的 static（开发版 deno run）
//   4) CWD 同级/下一级的 static 与 stm32WebFlasher 原项目目录
// ---------------------------------------------------------------------------
function resolveProjectRoot(): string {
  const envRoot = Deno.env.get("STM32_WEB_FLASHER_ROOT");
  if (envRoot && isLikelyProjectRoot(envRoot)) {
    return envRoot;
  }

  const candidates = new Set<string>();

  try {
    const exeDir = dirname(Deno.execPath());
    candidates.add(join(exeDir, "static"));
    candidates.add(resolve(exeDir, "..", "static"));
    candidates.add(resolve(exeDir, "..", "stm32WebFlasher"));
    candidates.add(resolve(exeDir, "stm32WebFlasher"));
  } catch {
    // 运行在某些环境下可能取不到 execPath，忽略。
  }

  try {
    // Windows 下必须用 fromFileUrl 转换（pathname 会得到 /D:/... 的错误路径）。
    const importDir = dirname(fromFileUrl(import.meta.url));
    candidates.add(join(importDir, "static"));
    candidates.add(resolve(importDir, "..", "stm32WebFlasher"));
    candidates.add(resolve(importDir, "stm32WebFlasher"));
  } catch {
    // 忽略。
  }

  const cwd = Deno.cwd();
  candidates.add(join(cwd, "static"));
  candidates.add(cwd);
  candidates.add(resolve(cwd, "..", "stm32WebFlasher"));
  candidates.add(resolve(cwd, "stm32WebFlasher"));

  for (const candidate of candidates) {
    if (isLikelyProjectRoot(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "无法定位静态资源目录。请确认桌面项目的 static 目录完整，或设置 STM32_WEB_FLASHER_ROOT 环境变量指向 stm32WebFlasher 项目目录。",
  );
}

const projectRoot = resolveProjectRoot();
const firmwarePath = join(projectRoot, "firmware", "stoov-bed-firmware.hex");

function guessContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".bin") || lower.endsWith(".hex"))
    return "application/octet-stream";
  return "application/octet-stream";
}

function normalizeRequestPath(url: URL): string {
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") return "/index.html";
  return pathname;
}

async function serveStaticFile(requestPath: string): Promise<Response | null> {
  const filePath = resolve(projectRoot, requestPath.replace(/^\/+/, ""));

  if (!filePath.startsWith(projectRoot)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const stat = await Deno.stat(filePath);
    if (stat.isDirectory) {
      return serveStaticFile(join(requestPath, "index.html"));
    }
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

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = normalizeRequestPath(url);

  // ---------- 原生串口（Win32 FFI 桥）端点 ----------
  if (pathname === "/api/serial/ports") {
    return portsResponse();
  }
  if (pathname === "/ws/serial") {
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 400 });
    }
    return upgradeSerialSocket(request);
  }

  if (pathname === "/stoov-bed-firmware.hex") {
    try {
      const bytes = await Deno.readFile(firmwarePath);
      return new Response(bytes, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition":
            'attachment; filename="stoov-bed-firmware.hex"',
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return new Response("Default firmware file not found", { status: 404 });
    }
  }

  if (pathname === "/health") {
    return new Response("ok", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const staticResponse = await serveStaticFile(pathname);
  if (staticResponse) {
    return staticResponse;
  }

  return new Response("Not Found", { status: 404 });
}

const server = Deno.serve(
  {
    hostname: host,
    port,
    onListen({ hostname, port }) {
      console.log(`📦 stm32WebFlasher 桌面服务已启动`);
      console.log(`📁 静态资源目录：${projectRoot}`);
      console.log(`💾 默认固件（本地磁盘）：${firmwarePath}`);
      console.log(`🔌 原生串口桥：/api/serial/ports + /ws/serial（Windows Win32 FFI）`);
      console.log(`🌐 地址：http://${hostname}:${port}/`);
    },
  },
  handleRequest,
);

export { server, projectRoot };
