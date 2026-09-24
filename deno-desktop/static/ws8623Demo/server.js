// server.js
import { serve, file } from "bun";

serve({
  port: 3000,
  hostname: "0.0.0.0", // 允许外部访问

  async fetch(request) {
    const url = new URL(request.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = `.${path}`; // 从当前目录开始

    // 尝试返回文件，如果不存在则返回 404
    const f = file(filePath);
    if (await f.exists()) {
      return new Response(f, {
        headers: {
          "Cache-Control": "public, max-age=3600",
        },
      });
    } else {
      return new Response("404 Not Found", { status: 404 });
    }
  },
});

console.log("Static server running at http://localhost:3000");