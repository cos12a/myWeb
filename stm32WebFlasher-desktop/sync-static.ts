// 从原项目 stm32WebFlasher 同步桌面版所需的静态资源到本目录 static/。
// 原项目保持不动，只做单向 Copy；每次原项目更新后运行：deno task sync
//
// 关键点：static/ 每次都从原项目重新拷贝，所以对桌面版的定制（例如"仅允许 .hex"）
// 不能直接改 static 里的文件（会被下次 sync 覆盖），而要在拷贝后套用 postPatches
// 补丁。这样既保持原项目零改动，又让桌面定制稳定可复现。
import { copy, ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { fromFileUrl, join, resolve } from "https://deno.land/std@0.224.0/path/mod.ts";

const desktopDir = fromFileUrl(new URL(".", import.meta.url));
const sourceDir = Deno.env.get("STM32_WEB_FLASHER_SOURCE") ??
  resolve(desktopDir, "..", "stm32WebFlasher");
const staticDir = join(desktopDir, "static");

// 需要 Copy 的内容（页面运行所需的最小集合）。
const entries = [
  { src: "index.html", dst: "index.html" },
  { src: "src", dst: "src" },
  { src: "docs", dst: "docs" },
  { src: "firmware", dst: "firmware" },
];

// 桌面版专属前端文件（不存在于原项目），拷贝后覆盖/新增到 static/。
const overlayEntries = [
  { src: "overlay/native-serial-transport.js", dst: "src/native-serial-transport.js" },
  { src: "overlay/native-serial-dialog.js", dst: "src/native-serial-dialog.js" },
];

// ---------------------------------------------------------------------------
// 拷贝后补丁：桌面版对 static 副本的定制，全部集中在此声明。
// 每条补丁要求 from 锚点在目标文件中「恰好出现一次」，否则整体中止并报错
// （便于原项目一旦改动、锚点漂移时第一时间发现，而不是静默产出错误副本）。
// ---------------------------------------------------------------------------
type FilePatch = { file: string; from: string; to: string; reason: string };

// 多行锚点用行数组拼接，避免在模板字符串里转义反引号 / ${}（行内双引号才需转义）。
const REQUEST_PORT_ORIGINAL = [
  "async function requestPort() {",
  "  try {",
  "    state.port = await navigator.serial.requestPort();",
  "    // Try getting info if browser supports it",
  "    const info = state.port.getInfo();",
  '    const vid = info.usbVendorId ? toHex(info.usbVendorId, 4) : "xxxx";',
  '    const pid = info.usbProductId ? toHex(info.usbProductId, 4) : "xxxx";',
  "    els.portName.textContent = `USB Serial (VID:${vid} PID:${pid})`;",
  "    await connect();",
  "  } catch (e) {",
  '    if (!e.message.includes("No port selected")) {',
  "      log(`串口选择失败: ${e.message}`, \"error\");",
  "    }",
  "  }",
  "}",
].join("\n");

const REQUEST_PORT_DESKTOP = [
  "async function requestPort() {",
  "  let session;",
  "  try {",
  "    session = await openNativeSerialDialog({",
  "      log,",
  "      getDebugRaw: () => els.debugRawRx?.checked ?? false,",
  "      defaults: {",
  "        baudRate: els.baudRate?.value,",
  "        parity: els.parity?.value,",
  "      },",
  "    });",
  "  } catch (e) {",
  "    // 取消：静默；其它异常兜底（打开失败已在弹窗内就地展示）",
  "    if (e && !e.cancelled && e.message) {",
  "      log(`串口打开失败: ${e.message}`, \"error\");",
  "    }",
  "    return;",
  "  }",
  "  // 同步对话框参数回主界面选择项，保证后续 options() 与显示一致",
  "  if (els.baudRate) els.baudRate.value = String(session.settings.baudRate);",
  "  if (els.parity) els.parity.value = session.settings.parity;",
  "  state.port = session.port;",
  "  const s = session.settings;",
  "  els.portName.textContent =",
  "    `原生串口 ${s.portPath} @${s.baudRate}-${s.dataBits}-${s.parity[0].toUpperCase()}-${s.stopBits}`;",
  "  // 传输层已在弹窗内成功打开，connect 复用该实例（跳过再次创建与 open）",
  "  await connect(session.transport);",
  "}",
].join("\n");

const CONNECT_HEADER_ORIGINAL = [
  "async function connect() {",
  "  if (!state.port) return;",
  "  const config = options();",
  "",
  "  try {",
  "    // state.transport = new SerialTransport(state.port, log);",
  "    // 【核心改动】传入获取复选框状态的箭头函数",
  "    state.transport = new SerialTransport(",
  "      state.port,",
  "      log,",
  "      () => els.debugRawRx?.checked ?? false, // 回调：实时读取 checkbox 状态",
  "    );",
].join("\n");

const CONNECT_HEADER_DESKTOP = [
  "async function connect(preOpenedTransport) {",
  "  if (!state.port) return;",
  "  const config = options();",
  "",
  "  try {",
  "    // 弹窗已打开时直接复用其传输层，否则回退到原有创建逻辑",
  "    state.transport = preOpenedTransport ?? new SerialTransport(",
  "      state.port,",
  "      log,",
  "      () => els.debugRawRx?.checked ?? false, // 回调：实时读取 checkbox 状态",
  "    );",
].join("\n");

const CONNECT_OPEN_ORIGINAL = [
  "    await state.transport.open({",
  "      baudRate: config.baudRate,",
  "      dataBits: 8,",
  "      stopBits: 1,",
  "      parity: config.parity,",
  '      flowControl: "none",',
  "    });",
].join("\n");

const CONNECT_OPEN_DESKTOP = [
  "    if (!preOpenedTransport) {",
  "      await state.transport.open({",
  "        baudRate: config.baudRate,",
  "        dataBits: 8,",
  "        stopBits: 1,",
  "        parity: config.parity,",
  '        flowControl: "none",',
  "      });",
  "    }",
].join("\n");

const postPatches: FilePatch[] = [
  {
    reason: "桌面版仅加载 .hex：文件选择器只接受 .hex",
    file: "index.html",
    from: 'accept=".bin,.hex,application/octet-stream,text/plain"',
    to: 'accept=".hex"',
  },
  {
    reason: "桌面版仅加载 .hex：文件选择框占位文案",
    file: "index.html",
    from: ">点击选择固件文件 (.bin)</span>",
    to: ">点击选择固件文件 (.hex)</span>",
  },
  {
    reason: "桌面版仅加载 .hex：解析层硬拒绝非 .hex（原逻辑会把非 .hex 当 .bin 加载）",
    file: "src/firmware.js",
    from:
      'return { bytes: new Uint8Array(await file.arrayBuffer()), baseAddress: null, format: "bin" };',
    to:
      'throw new Error(`不支持的文件类型：仅支持 .hex 固件文件（收到 "${file.name}"）`);',
  },
  {
    reason: "桌面版仅加载 .hex：中文提示文案",
    file: "src/app.js",
    from: 'chooseFirmware: "点击选择固件文件 (.bin / .hex)",',
    to: 'chooseFirmware: "点击选择固件文件 (.hex)",',
  },
  {
    reason: "桌面版仅加载 .hex：英文提示文案",
    file: "src/app.js",
    from: 'chooseFirmware: "Click to select firmware (.bin / .hex)",',
    to: 'chooseFirmware: "Click to select firmware (.hex)",',
  },
  // ---- 原生串口：用 Win32 FFI 桥取代 Web Serial（参数设置弹窗 + 传输层替换）----
  {
    reason: "原生串口：app.js 导入参数设置弹窗组件",
    file: "src/app.js",
    from: 'import { createAutoTrigger } from "./auto-trigger.js";',
    to:
      'import { createAutoTrigger } from "./auto-trigger.js";\nimport { openNativeSerialDialog } from "./native-serial-dialog.js?v=desktop";',
  },
  {
    reason: "原生串口：requestPort 改为弹出参数设置窗，由弹窗打开串口并交给 connect 复用",
    file: "src/app.js",
    from: REQUEST_PORT_ORIGINAL,
    to: REQUEST_PORT_DESKTOP,
  },
  {
    reason: "原生串口：connect 接受弹窗已打开的传输层（传入则复用、不重复创建）",
    file: "src/app.js",
    from: CONNECT_HEADER_ORIGINAL,
    to: CONNECT_HEADER_DESKTOP,
  },
  {
    reason: "原生串口：connect 仅在未传入已打开传输层时才自行 open",
    file: "src/app.js",
    from: CONNECT_OPEN_ORIGINAL,
    to: CONNECT_OPEN_DESKTOP,
  },
  {
    reason: "原生串口：Firefox 等无 Web Serial 浏览器的警告改为中性描述",
    file: "src/app.js",
    from:
      '"当前浏览器环境不支持 Web Serial（请使用新版 Edge 或 Chrome，并且必须在 HTTPS 或 localhost 环境下打开）",',
    to: '"桌面版使用本机原生串口（Win32 FFI），不依赖浏览器 Web Serial。",',
  },
  {
    reason: "原生串口：原 Web Serial 传输层类退位（保留代码供对照）",
    file: "src/serial-transport.js",
    from: 'export class SerialTransport {',
    to: 'class LegacyWebSerialTransport {',
  },
  {
    reason: "原生串口：SerialTransport 改指向 WS 桥传输层",
    file: "src/serial-transport.js",
    from: 'function invertChoice(choice) {',
    to:
      'import { NativeSerialTransport as SerialTransport } from "./native-serial-transport.js?v=desktop";\nexport { SerialTransport };\n\nfunction invertChoice(choice) {',
  },
];

async function syncAndPatch(): Promise<void> {
  try {
    Deno.statSync(join(sourceDir, "index.html"));
  } catch {
    console.error(
      `❌ 未找到原项目目录：${sourceDir}\n   请设置 STM32_WEB_FLASHER_SOURCE 环境变量指向 stm32WebFlasher。`,
    );
    Deno.exit(1);
  }

  await ensureDir(staticDir);
  for (const { src, dst } of entries) {
    await copy(join(sourceDir, src), join(staticDir, dst), { overwrite: true });
    console.log(`✅ ${src} -> static/${dst}`);
  }
  for (const { src, dst } of overlayEntries) {
    await copy(join(desktopDir, src), join(staticDir, dst), { overwrite: true });
    console.log(`✅ ${src} -> static/${dst}`);
  }

  // 第一遍：加载 + 校验所有锚点，收集问题（全有才继续）。
  const contents = new Map<string, string>();
  const problems: string[] = [];
  for (const patch of postPatches) {
    let text = contents.get(patch.file);
    if (text === undefined) {
      try {
        // 归一化行尾为 \n：多行锚点按 \n 拼接，CRLF 源文件否则会匹配不上。
        text = (await Deno.readTextFile(join(staticDir, patch.file))).replace(/\r\n/g, "\n");
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

  // 第二遍：按声明顺序应用补丁（锚点互不重叠，替换也不会重新生成锚点，安全）。
  // 用函数形式替换，避免 to 中的 $ 序列被当作特殊替换模式。
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
