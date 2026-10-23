/**
 * 并行构建所有子项目（混合工具链：Bun 项目走 bun，纯 Deno 项目走 deno）。
 * 使用：bun run build:parallel  （等价于 bun run scripts/build-all.ts）
 *
 * 相比串行的 `bun run build`，本脚本并行触发所有子项目的 build，
 * 输出会带项目前缀以便区分。任一子项目失败会以非 0 退出码结束。
 */

type Project = {
  dir: string;
  toolchain: "bun" | "deno";
  /** 构建前兑现依赖：bun → bun install；deno → deno install；缺省按 toolchain 推导。 */
  install?: "bun" | "deno";
};

// stoov-test 已迁移为纯 Deno（免构建内联 index.html），无 package.json，故跳过 bun install。
// i2c_web_tool 用 Deno 的 npm 映射，首次构建前需 deno install 兑现 node_modules。
const projects: Project[] = [
  { dir: "stoov-test", toolchain: "deno" },
  { dir: "InstrumentTestLit", toolchain: "bun" },
  { dir: "stm32WebFlasher", toolchain: "bun" },
  { dir: "webSerialPlotter", toolchain: "bun" },
  { dir: "i2c_web_tool", toolchain: "deno", install: "deno" },
];

const colors = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m", "\x1b[34m"];

async function run(cmd: string[], cwd: string, label: string): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
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
        if (line.length) console.log(`${label} ${line}`);
      }
    }
    if (buf.length) console.log(`${label} ${buf}`);
  };
  await Promise.all([pipe(proc.stdout!), pipe(proc.stderr!)]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exit ${code}`);
}

async function buildOne(project: Project, color: string) {
  const { dir, toolchain } = project;
  const tag = `${color}[${dir}]\x1b[0m`;
  const started = Date.now();
  console.log(`${tag} 🔨 build start`);
  try {
    // 仅需安装的项目先兑现依赖（--frozen-lockfile：node_modules 存在时几乎零耗时，缺失时自动安装）
    const installKind = project.install ?? (toolchain === "bun" ? "bun" : undefined);
    if (installKind === "bun") {
      await run(["bun", "install", "--frozen-lockfile"], dir, tag);
    } else if (installKind === "deno") {
      await run(["deno", "install"], dir, tag);
    }
    // 逐行转发子进程输出，加上项目名前缀
    await run(
      toolchain === "deno" ? ["deno", "task", "build"] : ["bun", "run", "build"],
      dir,
      tag,
    );
    const cost = ((Date.now() - started) / 1000).toFixed(1);
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
