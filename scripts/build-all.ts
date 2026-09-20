/**
 * 并行构建所有子 Bun 项目。
 * 使用：bun run build:parallel  （等价于 bun run scripts/build-all.ts）
 *
 * 相比串行的 `bun run build`，本脚本并行触发所有子项目的 build，
 * 输出会带项目前缀以便区分。任一子项目失败会以非 0 退出码结束。
 */

const projects = [
  "stoov-test",
  "InstrumentTestLit",
  "stm32WebFlasher",
  "webSerialPlotter",
] as const;

const colors = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m"];

async function buildOne(dir: string, color: string) {
  const tag = `${color}[${dir}]\x1b[0m`;
  const started = Date.now();
  console.log(`${tag} 🔨 build start`);
  try {
    // 先兑现依赖（--frozen-lockfile：node_modules 存在时几乎零耗时，缺失时自动安装）
    const install = Bun.spawn(["bun", "install", "--frozen-lockfile"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const installCode = await install.exited;
    if (installCode !== 0) {
      const err = await new Response(install.stderr).text();
      throw new Error(`install exit ${installCode}: ${err.trim()}`);
    }
    // 逐行转发子进程输出，加上项目名前缀
    const proc = Bun.spawn(["bun", "run", "build"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const pipe = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length) console.log(`${tag} ${line}`);
        }
      }
      if (buf.length) console.log(`${tag} ${buf}`);
    };
    await Promise.all([pipe(proc.stdout!), pipe(proc.stderr!)]);
    const code = await proc.exited;
    const cost = ((Date.now() - started) / 1000).toFixed(1);
    if (code !== 0) throw new Error(`exit ${code}`);
    console.log(`${tag} ✅ done in ${cost}s`);
  } catch (err) {
    console.error(`${tag} ❌ failed: ${(err as Error).message}`);
    throw err;
  }
}

const results = await Promise.allSettled(
  projects.map((p, i) => buildOne(p, colors[i % colors.length] ?? "")),
);
const failed = results.filter((r) => r.status === "rejected").length;
if (failed > 0) {
  console.error(`\n❌ ${failed}/${projects.length} 个子项目构建失败`);
  process.exit(1);
}
console.log(`\n✅ 全部 ${projects.length} 个子项目构建完成`);
