// stoovTest-desktop 桌面启动器。
//
// 不重复实现任何业务逻辑，直接以「静态副作用导入」复用 main.ts 里的完整后台
// （静态托管 + 原生串口桥 + 后台 MQTT + 本地 SQLite 导出）。main.ts 顶层读取
// HOST/PORT 并 Deno.serve 启动（非阻塞），本文件轮询等待就绪后自动打开系统默认浏览器，
// 形成「单可执行文件 = 本地服务 + 自动弹出界面」的桌面体验。

// 静态导入：deno compile 能静态追踪到 main.ts，无需额外 --include。
// main.ts 顶层已完成选端+绑定（端口被占时会 +1 递增），故此处直接取已绑定的 server。
import { server } from "./main.ts";

// 真实监听地址来自 main.ts 已绑定的 server，自动反映端口递增结果。
const hostname = server.addr.hostname;
const port = server.addr.port;
const url = `http://${hostname}:${port}/`;

// 轮询等待服务就绪，并校验应答确实来自本应用（专属标记头 X-Stoov-Desktop + 健康端点体），
// 避免端口被别的服务占用时误弹对方的页面。
async function waitForServer(baseUrl: string, timeoutMs = 20000): Promise<boolean> {
  const healthUrl = new URL("/health", baseUrl).href;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { method: "GET" });
      const text = await res.text();
      if (res.ok && text === "ok" && res.headers.get("x-stoov-desktop") === "1") {
        return true;
      }
      // 有应答但不是本应用（例如别的程序占了该端口）：继续重试，超时后报明确错误。
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
    `\n❌ 服务未能在 ${url} 就绪，或该端口应答非本应用（可能被其它程序占用）。请换端口重试：PORT=其它端口。`,
  );
  Deno.exit(1);
}
