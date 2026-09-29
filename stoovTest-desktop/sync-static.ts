// 从原项目 stoov-test 同步桌面版所需静态资源到本目录 static/。
// 原项目保持零改动，只做单向 Copy；每次原项目更新后运行：deno task sync
//
// 关键点：static/ 每次都从原项目重新拷贝，所以桌面定制（原生串口、后台 MQTT 垫片、
// 离线字体、禁用 SW 等）不能直接改 static 里的文件（会被下次 sync 覆盖），而要在
// 拷贝后套用 postPatches。补丁要求锚点在目标文件中「恰好出现一次」，否则整体中止，
// 便于原项目一旦漂移第一时间发现，而不是静默产出错误副本。
import { copy, ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { dirname, fromFileUrl, join, resolve } from "https://deno.land/std@0.224.0/path/mod.ts";

const desktopDir = fromFileUrl(new URL(".", import.meta.url));
const sourceDir = Deno.env.get("STOOV_TEST_SOURCE") ??
  resolve(desktopDir, "..", "stoov-test");
const staticDir = join(desktopDir, "static");

// 需要 Copy 的内容（免构建可直接运行的最小集合）。
// 注意：上游已将应用逻辑整段内联进 index.html，不再引用 src/（main.js 等）；
// 桌面所需的 src/native-serial-*.js 全部来自本目录 overlay，因此不拷贝上游 src/。
const entries = [
  { src: "index.html", dst: "index.html" },
  { src: "serial-protocol.js", dst: "serial-protocol.js" },
  { src: "yaokong-wc.js", dst: "yaokong-wc.js" },
  { src: "manifest.json", dst: "manifest.json" },
  { src: "public/favicon.ico", dst: "favicon.ico" },
  { src: "public/logo-192x192.png", dst: "logo-192x192.png" },
  { src: "public/logo-512x512.png", dst: "logo-512x512.png" },
];

// 桌面版专属前端文件（不存在于原项目），拷贝后覆盖/新增到 static/。
const overlayEntries = [
  { src: "overlay/native-serial-transport.js", dst: "src/native-serial-transport.js" },
  { src: "overlay/native-serial-dialog.js", dst: "src/native-serial-dialog.js" },
  { src: "overlay/native-serial-webcompat.js", dst: "src/native-serial-webcompat.js" },
  { src: "overlay/native-mqtt-shim.js", dst: "native-mqtt-shim.js" },
];

type FilePatch = { file: string; from: string; to: string; reason: string };

// 上游 index.html 底部的内联 PWA 脚本（beforeinstallprompt + SW 注册），桌面版整体退场。
// 手法：在 <script> 后、</script> 前各包一层 JS 块注释 /* ... */，整段内联代码惰性化（
// 不再注册监听、不再 navigator.serviceWorker.register）。前提：块内无 */ 且无提前
// 出现的 </script>（已核实），否则注释/标签会被提前闭合。锚点取首尾各三行，降低上游
// 行内漂移导致失配的概率；首行 HTML 注释仅作定位用，与退场无关。
const PWA_INLINE_SCRIPT_START = [
  "    <!-- PWA Service Worker 注册 & 安装处理 -->",
  "    <script>",
  "        let deferredPrompt = null;",
].join("\n");

const PWA_INLINE_SCRIPT_END = [
  "        // 初始状态",
  "        updatePwaStatus();",
  "    </script>",
].join("\n");

// index.html 底部 PWA 安装区（含按钮与状态徽标），桌面版整块移除。
const PWA_FOOTER_ORIGINAL = [
  '        <div class="footer-pwa">',
  '            <button id="pwaInstallBtn" class="pwa-install-btn" title="安装为桌面应用">',
  '                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
  '                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />',
  '                    <polyline points="7 10 12 15 17 10" />',
  '                    <line x1="12" y1="15" x2="12" y2="3" />',
  "                </svg>",
  "                安装应用",
  "            </button>",
  '            <span id="pwaStatusBadge" class="pwa-status-badge need-http">需要 HTTP 服务器</span>',
  "        </div>",
].join("\n");

// ---- 原生串口：上游已将逻辑内联进 index.html 的 classic <script>（不再引用 src/main.js），
// 因此兼容层注入、守卫去除、requestPort 改写全部针对 index.html 内联块。----

// 兼容层是 ES 模块；内联脚本是 classic，无法 import，故插入一个 module 脚本把
// requestNativeSerialPort 暴露到 window，classic 代码里再调用（点连接时才用到，届时已就绪）。
const SERIAL_BRIDGE_ANCHOR = [
  '    <script type="module" src="./yaokong-wc.js"></script>',
  "",
  "    <script>",
].join("\n");

const SERIAL_BRIDGE_DESKTOP = [
  '    <script type="module" src="./yaokong-wc.js"></script>',
  '    <script type="module">',
  "        // 桌面版：引入原生串口兼容层并暴露到全局，供下方 classic 内联脚本调用",
  '        import { requestNativeSerialPort } from "./src/native-serial-webcompat.js?v=desktop";',
  "        window.requestNativeSerialPort = requestNativeSerialPort;",
  "    </script>",
  "",
  "    <script>",
].join("\n");

const GUARD_ORIGINAL = [
  '            if (!("serial" in navigator)) {',
  '                alert("您的浏览器不支持 Web Serial API");',
  "                return;",
  "            }",
].join("\n");

const GUARD_DESKTOP =
  "            // 桌面版走本机原生串口（Win32 FFI 桥），不依赖浏览器 Web Serial";

const postPatches: FilePatch[] = [
  // ---- MQTT：前端换成同名 API 垫片（后台原生连接）----
  {
    reason: "MQTT：index.html 用桌面垫片取代浏览器 mqtt.min.js",
    file: "index.html",
    from: '<script src="./mqtt.min.js"></script>',
    to: '<script src="./native-mqtt-shim.js?v=desktop"></script>',
  },
  {
    reason: "离线：移除 Google Fonts 外链，使用系统字体回退",
    file: "index.html",
    from: [
      "    <link",
      '        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"',
      '        rel="stylesheet" />',
    ].join("\n"),
    to: "    <!-- 桌面版离线运行：已移除 Google Fonts 外链（使用系统字体回退） -->",
  },
  {
    reason: "favicon：改用相对路径（本地静态根）",
    file: "index.html",
    from: '<link rel="icon" type="image/x-icon" href="/favicon.ico" />',
    to: '<link rel="icon" type="image/x-icon" href="./favicon.ico" />',
  },
  {
    reason: "桌面版移除 PWA：manifest 链接",
    file: "index.html",
    from: '    <link rel="manifest" href="manifest.json" />',
    to: "    <!-- 桌面版：PWA 已移除（无 manifest / 安装 / Service Worker） -->",
  },
  {
    reason: "桌面版移除 PWA：底部安装按钮与状态徽标",
    file: "index.html",
    from: PWA_FOOTER_ORIGINAL,
    to: "        <!-- 桌面版：PWA 安装区已移除 -->",
  },
  {
    reason: "桌面版移除 PWA：内联脚本块起点（包入 JS 块注释）",
    file: "index.html",
    from: PWA_INLINE_SCRIPT_START,
    to:
      "    <!-- 桌面版移除 PWA：内联 Service Worker/安装脚本整体停用 -->\n    <script>/*\n        let deferredPrompt = null;",
  },
  {
    reason: "桌面版移除 PWA：内联脚本块终点（闭合 JS 块注释）",
    file: "index.html",
    from: PWA_INLINE_SCRIPT_END,
    to:
      "        // updatePwaStatus();\n    */</script>",
  },

  // ---- 原生串口：作用于 index.html 内联 classic 脚本 ----
  {
    reason: "原生串口：注入兼容层 module 桥（暴露 window.requestNativeSerialPort）",
    file: "index.html",
    from: SERIAL_BRIDGE_ANCHOR,
    to: SERIAL_BRIDGE_DESKTOP,
  },
  {
    reason: "原生串口：去掉 Web Serial 支持守卫",
    file: "index.html",
    from: GUARD_ORIGINAL,
    to: GUARD_DESKTOP,
  },
  {
    reason: "原生串口：requestPort 改为返回原生串口兼容端口（带参数设置弹窗）",
    file: "index.html",
    from: "                port = await navigator.serial.requestPort();",
    to:
      '                port = await window.requestNativeSerialPort({ log: (m) => bleAddLog("串口", m), defaults: SERIAL_OPTIONS });',
  },

  // ---- manifest：路径本地化（桌面版已不再引用 manifest，保留以兼容直接访问）----
  {
    reason: "manifest start_url 本地化",
    file: "manifest.json",
    from: '  "start_url": "/unito/stoov/bed-test/",',
    to: '  "start_url": "/",',
  },
  {
    reason: "manifest scope 本地化",
    file: "manifest.json",
    from: '  "scope": "/unito/stoov/bed-test/",',
    to: '  "scope": "/",',
  },
  {
    reason: "manifest 192 图标路径本地化",
    file: "manifest.json",
    from: '      "src": "/unito/stoov/bed-test/logo-192x192.png",',
    to: '      "src": "/logo-192x192.png",',
  },
  {
    reason: "manifest 512 图标路径本地化",
    file: "manifest.json",
    from: '      "src": "/unito/stoov/bed-test/logo-512x512.png",',
    to: '      "src": "/logo-512x512.png",',
  },
];

async function syncAndPatch(): Promise<void> {
  try {
    Deno.statSync(join(sourceDir, "index.html"));
  } catch {
    console.error(
      `❌ 未找到原项目目录：${sourceDir}\n   请设置 STOOV_TEST_SOURCE 环境变量指向 stoov-test。`,
    );
    Deno.exit(1);
  }

  await ensureDir(staticDir);
  // 清理历史遗留：旧版本曾整目录拷贝上游 src/（main.js/pwa/config 等）；
  // 上游内联重构后这些已是死代码，重建前清空 static/src，避免陈旧文件残留。
  await Deno.remove(join(staticDir, "src"), { recursive: true }).catch(() => {});
  for (const { src, dst } of entries) {
    await copy(join(sourceDir, src), join(staticDir, dst), { overwrite: true });
    console.log(`✅ ${src} -> static/${dst}`);
  }
  for (const { src, dst } of overlayEntries) {
    const dstPath = join(staticDir, dst);
    await ensureDir(dirname(dstPath)); // static/src 已由上方清理，这里负责重建
    await copy(join(desktopDir, src), dstPath, { overwrite: true });
    console.log(`✅ ${src} -> static/${dst}`);
  }

  // 第一遍：加载 + 校验所有锚点，收集问题（全部命中才继续）。
  const contents = new Map<string, string>();
  const problems: string[] = [];
  for (const patch of postPatches) {
    let text = contents.get(patch.file);
    if (text === undefined) {
      try {
        // 归一化行尾为 \n：多行锚点按 \n 拼接，CRLF 源文件否则会匹配不上。
        text = (await Deno.readTextFile(join(staticDir, patch.file))).replace(
          /\r\n/g,
          "\n",
        );
      } catch {
        problems.push(`无法读取 static/${patch.file}`);
        text = "";
      }
      contents.set(patch.file, text);
    }
    const count = text.split(patch.from).length - 1;
    if (count !== 1) {
      problems.push(
        `static/${patch.file}: 锚点出现 ${count} 次（期望恰好 1 次）—— ${patch.reason}\n     锚点: ${
          patch.from.slice(0, 60)
        }`,
      );
    }
  }

  if (problems.length > 0) {
    console.error("\n❌ 桌面定制补丁校验失败，static 已拷贝但未打补丁：");
    for (const p of problems) console.error(`   - ${p}`);
    console.error(
      "\n   原项目相关文件可能已变更，请对照更新 sync-static.ts 里的 postPatches 锚点。",
    );
    Deno.exit(1);
  }

  // 第二遍：按声明顺序应用补丁（用函数形式替换，避免 to 中的 $ 被当作特殊替换模式）。
  for (const patch of postPatches) {
    contents.set(
      patch.file,
      contents.get(patch.file)!.replace(patch.from, () => patch.to),
    );
  }
  for (const [file, text] of contents) {
    await Deno.writeTextFile(join(staticDir, file), text);
    console.log(`🔧 已打补丁：static/${file}`);
  }

  console.log(`\n同步完成：${staticDir}`);
}

await syncAndPatch();
