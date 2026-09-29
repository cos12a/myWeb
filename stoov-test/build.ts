// stoov-test 生产构建（纯 Deno，零依赖，替代原 `vite build && node compress.mjs`）。
//
// 上游把应用逻辑整段内联进了 index.html，脚本引用全部是相对路径（./mqtt.min.js、
// ./serial-protocol.js、./yaokong-wc.js），没有需要打包的模块图——因此构建退化为
// 「拷贝运行时资源 + 轻量压缩 index.html + 按部署 base 重写绝对路径」。
//
// 用法：deno task build
//   端口/前缀可配：STOOV_BASE（默认 /unito/stoov/bed-test/，与原 vite base 一致）。
const root = (import.meta.dirname ?? "").replace(/[\\/]+$/, "");
const sep = root.includes("\\") ? "\\" : "/";
const outDir = `${root}${sep}dist`;
const publicDir = `${root}${sep}public`;

let base = Deno.env.get("STOOV_BASE") ?? "/unito/stoov/bed-test/";
if (!base.startsWith("/")) base = "/" + base;
if (!base.endsWith("/")) base += "/";

// 需要原样拷贝进 dist 的运行时脚本/资源（位于项目根）。
const rootAssets = ["serial-protocol.js", "yaokong-wc.js", "mqtt.min.js", "sw.js"];

async function copyToDist(srcAbs: string, dstName: string): Promise<number> {
  const data = await Deno.readFile(srcAbs);
  await Deno.writeFile(`${outDir}${sep}${dstName}`, data);
  return data.byteLength;
}

// 区域感知轻量压缩：只处理 <script>/<style> 之外的 HTML 片段，
// 内联 JS/CSS 内容原样保留（不引入 terser，零风险、零依赖）。
function minifyHtml(html: string): string {
  const stash: string[] = [];
  const holdout = (s: string): string => {
    stash.push(s);
    return `\u0000${stash.length - 1}\u0000`;
  };
  // 先摘出 script / style 整块（含标签），避免误伤其中的注释/字符串/空白敏感内容
  let work = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, holdout)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, holdout);
  // HTML 区域：去注释、折叠空白、去除标签间纯空白
  work = work
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
  // 还原摘出的块（其内部保持原样，仅去掉块前后多余空白）
  work = work.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)] ?? "");
  return work;
}

async function build(): Promise<void> {
  // 清空并重建 dist（避免残留旧 vite assets/ 产物）
  await Deno.remove(outDir, { recursive: true }).catch(() => {});
  await Deno.mkdir(outDir, { recursive: true });

  const report: Array<[string, number]> = [];

  // index.html：读源 → base 重写绝对路径 → 轻压缩 → 写出
  const rawHtml = await Deno.readTextFile(`${root}${sep}index.html`);
  const based = rawHtml
    .replace(/href="\/favicon\.ico"/g, `href="${base}favicon.ico"`)
    .replace(/"\/(logo-[0-9x]+\.png)"/g, `"${base}$1"`); // 若有绝对 logo 引用
  const minHtml = minifyHtml(based);
  await Deno.writeTextFile(`${outDir}${sep}index.html`, minHtml);
  report.push(["index.html", minHtml.length]);
  const htmlSaving = ((1 - minHtml.length / rawHtml.length) * 100).toFixed(1);
  console.log(`  index.html  ${rawHtml.length} → ${minHtml.length} 字节（减 ${htmlSaving}%）`);

  // manifest.json：按 base 重写 start_url/scope/icons
  const manifest = JSON.parse(await Deno.readTextFile(`${root}${sep}manifest.json`));
  manifest.start_url = base;
  manifest.scope = base;
  if (Array.isArray(manifest.icons)) {
    for (const icon of manifest.icons) {
      if (typeof icon.src === "string") {
        icon.src = base + icon.src.split("/").pop();
      }
    }
  }
  const manifestText = JSON.stringify(manifest, null, 2) + "\n";
  await Deno.writeTextFile(`${outDir}${sep}manifest.json`, manifestText);
  report.push(["manifest.json", manifestText.length]);

  // 根运行时脚本原样拷贝
  for (const f of rootAssets) {
    const size = await copyToDist(`${root}${sep}${f}`, f);
    report.push([f, size]);
  }

  // public/ 全部资源（favicon、logo 等）拷到 dist 根
  for await (const entry of Deno.readDir(publicDir)) {
    if (entry.isDirectory) continue;
    // sw.js/mqtt.min.js 若 public 与根重复，以根版本为准（已拷贝则跳过）
    if (rootAssets.includes(entry.name)) continue;
    const size = await copyToDist(`${publicDir}${sep}${entry.name}`, entry.name);
    report.push([entry.name, size]);
  }

  const total = report.reduce((n, [, s]) => n + s, 0);
  console.log(`\n✅ 构建完成 → ${outDir}`);
  console.log(`   base=${base}  共 ${report.length} 个文件  合计 ${(total / 1024).toFixed(1)} KB`);
  for (const [name, size] of report) console.log(`   - ${name}  ${(size / 1024).toFixed(1)} KB`);
}

await build();
