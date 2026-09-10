import { serve, file } from "bun";

serve({
  port: 3000,
  hostname: "0.0.0.0",
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const f = file(`./dist${path}`);
    if (await f.exists()) {
      return new Response(f, { headers: { "Cache-Control": "no-cache" } });
    }
    return new Response("404 Not Found", { status: 404 });
  },
});

console.log("InstrumentTestLit running at http://localhost:3000");