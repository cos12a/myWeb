// stoov-test 开发服务器（纯 Deno，零依赖，替代原 vite dev）。
// 上游已将应用逻辑内联进 index.html（原生 ESM 免构建），dev 只需静态托管：
//   - 项目根为文档根（index.html / serial-protocol.js / yaokong-wc.js / mqtt.min.js / manifest.json / sw.js）
//   - public/ 作为兜底映射到根路径（favicon.ico、logo-*.png），与原 vite publicDir 行为一致
// 用法：deno task dev（端口可用 PORT 覆盖，默认 8788）
const root = (import.meta.dirname ?? "").replace(/[\\/]+$/, "");
const publicDir = `${root}/public`;
const port = Number(Deno.env.get("PORT") ?? 8788);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

async function tryServe(filePath: string): Promise<Response | null> {
  try {
    const data = await Deno.readFile(filePath);
    const dot = filePath.lastIndexOf(".");
    const type = MIME[filePath.slice(dot).toLowerCase()] ?? "application/octet-stream";
    return new Response(data, { headers: { "Content-Type": type, "Cache-Control": "no-cache" } });
  } catch {
    return null;
  }
}

const server = Deno.serve({ port, hostname: "127.0.0.1" }, async (request) => {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  // 防目录穿越：拒绝任何 .. 段
  if (rel.split(/[\\/]/).includes("..")) return new Response("400 Bad Request", { status: 400 });
  // 先项目根，再 public/ 兜底（与 vite publicDir 覆盖语义一致）
  const candidates = [`${root}/${rel}`, `${publicDir}/${rel}`];
  for (const candidate of candidates) {
    const res = await tryServe(candidate);
    if (res) return res;
  }
  return new Response(`404 Not Found: /${rel}`, { status: 404 });
});

console.log(`🚀 stoov-test dev 服务已启动： http://127.0.0.1:${port}/`);
await server.finished;
