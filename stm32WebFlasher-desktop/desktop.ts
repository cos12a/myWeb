import "./main.ts";

const hostname = Deno.env.get("HOST") ?? "127.0.0.1";
const port = Number(Deno.env.get("PORT") ?? 30000);
const target = `http://${hostname}:${port}/`;

async function waitForServer(url: string, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      await res.body?.cancel();
      if (res.status < 500) return true;
    } catch {
      // 服务还没准备好，继续等待。
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function openBrowser(url: string): void {
  const os = Deno.build.os;
  let command = "";
  let args: string[] = [];

  if (os === "darwin") {
    command = "open";
    args = [url];
  } else if (os === "windows") {
    command = "cmd";
    args = ["/c", "start", "", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  try {
    new Deno.Command(command, {
      args,
      stdout: "null",
      stderr: "null",
    }).spawn();
    console.log(`🌐 已尝试打开默认浏览器：${url}`);
  } catch {
    console.warn(`⚠️ 无法自动打开浏览器，请手动访问：${url}`);
  }
}

const ready = await waitForServer(target);
if (ready) {
  openBrowser(target);
  console.log(`\n✅ 桌面应用已就绪：${target}`);
  console.log("   关闭本窗口或按 Ctrl+C 可停止服务。\n");
} else {
  console.error(`\n❌ 服务未能在 ${target} 启动。`);
  console.error("   常见原因：端口被占用，可尝试设置 PORT=其它端口。\n");
  Deno.exit(1);
}
