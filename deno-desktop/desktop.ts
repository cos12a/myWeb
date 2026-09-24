// deno-desktop 桌面启动器。
//
// 设计：不重复实现任何业务逻辑，直接以「静态副作用导入」复用 main.ts 里
// 完整的 Hono 服务（含 8 个静态站点托管、/api、/health、SPA 兜底）。
// main.ts 顶层会读取 HOST/PORT 环境变量并调用 Deno.serve 启动服务（非阻塞），
// 随后本文件轮询等待服务就绪，并自动打开系统默认浏览器指向本地地址，
// 从而形成「单可执行文件 = 本地服务 + 自动弹出界面」的桌面应用体验。

// 静态导入：deno compile 能静态追踪到 main.ts，无需额外 --include 该模块。
import "./main.ts";

// 与 main.ts 使用相同的默认值；可用 HOST / PORT 环境变量覆盖。
const hostname = Deno.env.get("HOST") ?? "127.0.0.1";
const port = Number(Deno.env.get("PORT") ?? 30000);
const url = `http://${hostname}:${port}/`;

// 轮询等待服务真正可访问，再打开浏览器（避免浏览器先于服务加载导致空白页）。
async function waitForServer(target: string, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(target, { method: "GET" });
      // 只要能连上（非 5xx/网络错误）即视为就绪。
      await res.body?.cancel();
      if (res.status < 500) return true;
    } catch {
      // 服务尚未监听，继续重试。
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

// 跨平台打开默认浏览器；无图形环境（如 headless 服务器）时静默降级为提示。
function openBrowser(target: string): void {
  const os = Deno.build.os;
  let cmd: string;
  let args: string[];
  if (os === "darwin") {
    cmd = "open";
    args = [target];
  } else if (os === "windows") {
    cmd = "cmd";
    args = ["/c", "start", "", target];
  } else {
    cmd = "xdg-open";
    args = [target];
  }
  try {
    new Deno.Command(cmd, { args, stdout: "null", stderr: "null" }).spawn();
    console.log(`🌐 已尝试在默认浏览器打开：${target}`);
  } catch {
    console.warn(
      `⚠️ 无法自动打开浏览器（未找到 ${cmd}）。请手动访问：${target}`,
    );
  }
}

const ready = await waitForServer(url);
if (ready) {
  openBrowser(url);
  console.log(`\n✅ 桌面服务已就绪：${url}`);
  console.log(`   关闭本窗口或按 Ctrl+C 即可停止服务。`);
} else {
  console.error(
    `\n❌ 服务未能在 ${url} 就绪。常见原因：端口 ${port} 被占用（用 PORT=其它端口 重试）。`,
  );
  Deno.exit(1);
}
