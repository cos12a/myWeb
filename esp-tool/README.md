# esp-tool · ESP32 网页烧录工具（评估与实现方案）

> 状态：**评估与方案阶段**，代码尚未实现。本文档是后续开发与验收的唯一依据；
> 实现时若发现与实测不符，先改本文档与 Skill，再改代码。

## 1. 定位与结论摘要

用浏览器（Web Serial）给 ESP32 全系列芯片烧录固件的网页工具，参考
[meshtastic/web-flasher](https://github.com/meshtastic/web-flasher)（最终效果
[flasher.meshtastic.org](https://flasher.meshtastic.org)）的页面加载与烧录流程，
使用 Espressif 官方 [esptool-js](https://github.com/espressif/esptool-js) 作为烧录内核。

评估结论：

| 问题 | 结论 |
| --- | --- |
| 烧录内核 | **esptool-js**（npm 包，Apache-2.0）。官方维护、支持全系芯片检测与烧录、Web Serial 传输，直接作为依赖使用，不自行实现 ROM 协议 |
| 参考项目 | web-flasher 是 **GPL-3.0**，**只能参考交互设计与页面流程，不能复制代码**；且它是 Nuxt/Vue 技术栈，与本仓库的 React 栈不同，逐概念重新实现 |
| 服务端 | **Deno 2 + Hono**：只做静态托管 + 固件文件托管 + 清单 API；烧录 100% 发生在浏览器端（与 `i2c_web_tool` 完全同构） |
| 前端 | React 19 + Vite（Deno 工具链跑 `npm:vite`），模式完全复制本仓库 `i2c_web_tool/` |
| 可行性 | 高。esptool-js API 稳定（web-flasher 锁定 `^0.5.7`），Web Serial 在 Chromium 系可用 |

## 2. 依赖评估

### 2.1 esptool-js（烧录内核）

- 仓库：`espressif/esptool-js`，Apache-2.0，npm 包 `esptool-js`（web-flasher 用 `^0.5.7`，
  实现时取 npm 最新稳定版）。CDN 单文件 `https://unpkg.com/esptool-js/bundle.js`
  （pako 已内联），但我们走 npm 依赖 + Vite 打包。
- **能力**：芯片检测、擦除、烧录、读 flash、MD5 校验、DTR/RTS 复位策略、进度回调、
  波特率协商（烧录时自动切换到更高波特率）。
- **边界（不提供）**：ELF→bin 转换、`espefuse.py`/`espsecure.py` 类工具——这些留
  给 Python esptool，本工具只烧录现成二进制。

核心 API 流程（官方 README + web-flasher 实测用法交叉确认）：

```ts
import { ESPLoader, Transport } from "esptool-js";

const port = await navigator.serial.requestPort();        // 必须用户手势触发
const transport = new Transport(port, true);             // true = 日志打印到终端
const loader = new ESPLoader({
  transport,
  baudrate: 115200,                                      // 首次握手波特率
  terminal: { clean, write, writeLine },                 // IEspLoaderTerminal 适配 xterm
  // resetConstructors: { classicReset, usbJtagSerialReset, ... } // 特殊板子才需要
});
const chip = await loader.main();                        // 复位 + 同步 + 检测芯片型号
await loader.writeFlash({
  fileArray: [{ data: binaryString, address: 0x10000 }], // 注意：web-flasher 用二进制字符串
  flashSize: "keep", flashMode: "keep", flashFreq: "keep", // 或显式 "4MB"/"dio"/"40m"
  eraseAll: false, compress: true,                       // 压缩传输，大固件必开
  reportProgress: (fileIndex, written, total) => {},     // 按文件粒度上报进度
});
await transport.setRTS(true); await sleep(100); await transport.setRTS(false); // 硬复位
await transport.disconnect();                            // 释放读锁
await transport.waitForUnlock(1500);
await port.open({ baudRate: 115200 });                   // 重开串口读启动日志
```

> 数据格式注意：web-flasher 用**二进制字符串**（`convertToBinaryString`）作为
> `fileArray[].data`；官方示例用 `Uint8Array`。两条路都通，实现时统一选一种并写进
> Skill（建议跟随 web-flasher 的 binary string，已有生产验证）。

### 2.2 meshtastic/web-flasher（交互参考）

**许可：GPL-3.0，禁止复制代码**。只借鉴以下设计：

1. **页面三步向导**：① USB 连接与芯片说明（含 ESP32-S3 的 `baud1200()` 复位按钮）
   → ② 波特率选择（115200/230400/460800/921600）→ ③ 烧录选项（全擦开关 + 警告）
   + Flash 按钮 + 分区级进度条 + xterm 终端实时日志。
2. **固件加载三级清单**（核心参考点）：
   - 发布清单 `firmware-<version>.json`：`{ version, targets: [{ board, platform }] }`
     ——一个版本发布了哪些板子；
   - 目标清单 `firmware-<board>-<version>.mt.json`：`{ files[], part[] }`——
    `files` 列出固件文件（name/md5/bytes/part_name），`part` 列出分区表
     （name/type/subtype/offset/size/flags）；
   - 按 `part` 的 offset 与 `files` 的 part_name 配对，逐分区 fetch 后 `writeFlash`
     的 `fileArray` 一次传入多文件（app0/app1(OTA)/spiffs/otadata…）。
3. **烧后处理**：写完后 RTS 硬复位 → `transport.disconnect()` 释放读锁 →
   `waitForUnlock(1500)` → 用应用波特率 115200 重开端口读启动日志（`readSerial` 循环）。
4. **本地文件上传**：File API 直接读 bin，或 zip 解包（`@zip.js/zip.js`）取
   factory bin；区分 factory bin / update bin 以决定是否允许全擦。
5. **固件版本频道**：stable / alpha / nightly / 本地文件（我们按需简化，见 §5）。
6. **进度语义**：`reportProgress(fileIndex, written, total)` 按文件索引驱动
   「正在烧录分区 N/M」文案；`written === total` 只表示单文件完成，
   整体成功以 `writeFlash()` resolve 为准。

技术栈差异（web-flasher → 我们的替代）：

| web-flasher | esp-tool 方案 | 说明 |
| --- | --- | --- |
| Nuxt 3 / Vue 3 | React 19 + Vite | 用户指定 React |
| Pinia | React 状态（Context 或 zustand） | 单一烧录会话，无路由无 SSR，不需要重型状态库 |
| Tailwind CSS | 沿用仓库 ui-ux-pro-max 视觉规范 | 子项目风格向主站靠拢 |
| @xterm/xterm | 同样用 @xterm/xterm | 终端是烧录工具的刚需，直接采用 |
| vue-i18n（20+ 语言） | 中文为主，预留 en | 参考主页 i18n.js 的 7 语言在首页卡片处处理；工具页语言后续按需 |
| mande（HTTP 封装） | 原生 fetch | 无拦截器需求 |
| @vercel/analytics、Datadog | 不引入 | 无遥测需求 |
| crypto-js MD5 | 复用 esptool-js 的 `calculateMD5Hash` 或仓库已有实现 | 按需 |

## 3. 技术选型与理由

完全复用本仓库 `i2c_web_tool/` 的「Deno 全工具链 + React」先例：

| 项 | 选型 | 理由 |
| --- | --- | --- |
| 运行时 | Deno 2 | 仓库主站与 i2c_web_tool 同款；deno.json 的 `imports` 映射 npm 包 |
| 服务端 | Hono（`hono/deno` 的 serveStatic） | 静态托管 + `/api/*` 轻量接口；模式照抄 `i2c_web_tool/server.ts` |
| 前端 | React 19 + Vite 8 | 用户指定 React；`deno task build` = `deno run -A npm:vite build` |
| 烧录库 | esptool-js（npm） | §2.1 结论 |
| 终端 | @xterm/xterm + @xterm/addon-fit | web-flasher 同款，esptool 日志量大必须有终端 |
| 部署 base | `"./"` 相对 base | 既能独立 `deno task start` 根路径运行，也能挂主站 `/esp-tool/` 子路径（尾斜杠规则同 `/i2c/`） |

## 4. 目录结构（规划）

```
esp-tool/
├── README.md               # 本文档
├── deno.json               # npm: 依赖映射 + tasks（build/dev/start/check）
├── server.ts               # Hono：/api/health、清单 API、firmware 文件托管、dist 静态 + SPA 回退
├── vite.config.ts          # react 插件 + base "./" + 固定端口
├── index.html
├── src/
│   ├── main.tsx / App.tsx
│   ├── types/manifest.ts   # ReleaseManifest / FirmwareManifest / Partition 类型（自写，非复制）
│   ├── lib/
│   │   ├── esptool.ts      # ESPLoader 封装：connect/检测/flash/复位/重开端口读日志
│   │   ├── firmwareRepo.ts # 三级清单加载 + 分区文件 fetch（404 必须 fail-fast）
│   │   ├── terminal.ts     # xterm 实例管理 + IEspLoaderTerminal 适配
│   │   └── fileUtils.ts    # binary string 转换、zip 解包（@zip.js/zip.js）
│   ├── store/flashStore.ts # 烧录会话状态机：idle→connecting→flashing→done/error
│   └── components/
│       ├── DeviceSelect.tsx    # 设备/芯片选择（hardware-list.json 驱动）
│       ├── FirmwareSelect.tsx  # 版本频道选择 + 本地文件上传
│       ├── FlashOptions.tsx    # 波特率 + 全擦开关
│       ├── FlashStep.tsx       # 三步向导外壳
│       ├── ProgressBar.tsx     # 分区级进度
│       └── TerminalPanel.tsx   # xterm 挂载点
├── public/data/hardware-list.json   # 设备清单（页面加载第一级数据）
├── firmware/                # 服务端托管固件目录（不入库，部署时放置；结构见 §6）
└── dist/                    # 构建产物（不入库）
```

## 5. 页面加载与烧录流程（核心设计）

仿 web-flasher，但按本仓库实际简化频道模型：

```
页面加载
  └─ fetch(/data/hardware-list.json)          → 设备/芯片下拉
  └─ fetch(/api/firmware/versions)            → 固件版本列表（stable + 本地文件入口）
选中版本
  └─ fetch(/api/firmware/<version>/manifest)  → 发布清单 targets
选中设备 + 版本 → Flash 按钮就绪
  ① 请求串口（用户手势）→ requestPort()
  ② Transport + ESPLoader.main()             → 芯片检测（终端回显）
  ③ fetch 目标清单 mt.json → 按分区逐文件 fetch 固件（响应 !ok 即抛错，防止把
     404 页面当固件烧进去）
  ④ writeFlash({ fileArray, flashSize:'keep', compress:true, eraseAll: 全擦开关 })
     reportProgress → 分区进度条 + 终端
  ⑤ RTS 硬复位 → disconnect → waitForUnlock → port.open(115200) → readSerial 启动日志
  ⑥ 完成态：成功/失败文案 + 「重新开始」
```

状态机（`flashStore`）：`idle → connecting → detecting → fetching → flashing → resetting → reading_logs → done | error`；
任何硬件错误进入 `error`，串口断开（`port.ondisconnect`）兜底回 `idle` 并提示。

## 6. 服务端（Hono）职责

烧录全在浏览器，服务端只做「数据供应」，接口规划：

| 路由 | 说明 |
| --- | --- |
| `GET /api/health` | 探活，返回服务名 |
| `GET /api/firmware/versions` | 扫描 `firmware/` 目录（Deno 端只读）生成版本清单 JSON |
| `GET /api/firmware/<version>/manifest` | 返回该版本的发布清单（firmware/<version>/firmware-<version>.json） |
| `GET /firmware/...` | 固件二进制文件静态托管（含 mt.json），跨域同源无 CORS 问题 |
| `/*` | `dist/` 静态 + SPA 回退 |

> 与 web-flasher 的差异：他们从 `release.meshtastic.org` 远程 CDN 取固件；
> 我们固件放在服务端本地 `firmware/` 目录（同 stm32WebFlasher 的 `firmware/` 模式），
> 目录不入库、部署时由运维放置，`versions` 接口即时反映内容。

## 7. 主站与仓库集成（实施时按 site-hosting-and-build Skill 执行）

1. `src/index.ts` 路由：`/esp-tool` 302 → `/esp-tool/`，再 `serveStatic` 映射
   `esp-tool/dist`（相对 base 必须先重定向，顺序在 `/esp-tool/*` 之前）。
2. `public/index.html` 首页 `.pieces` 加卡片 + `public/js/i18n.js` 七语言补齐
   `tools.items.<下标>`；hero 3×3 不挤占。
3. 根 `package.json`：`build:esp-tool = cd esp-tool && deno install && deno task build`，
   串入 `build`；`scripts/build-all.ts` 的 `projects` 加
   `{ dir: "esp-tool", toolchain: "deno", install: "deno" }`。
4. 根 `README.md` / `PROJECT_GUIDE.md` / `ARCHITECTURE.md` 路由表、结构树、构建链同步。
5. 交付时同步 `.agents/skills/esp-web-flasher/SKILL.md`（已随本方案创建）。

## 8. 实施阶段划分

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| 0 脚手架 | deno.json/vite/server.ts/空页面，`deno task build && deno task start` 可跑 | 页面可开、`/api/health` 200 |
| 1 连接检测 | 串口请求 → ESPLoader.main() 芯片检测 → xterm 回显 | 真板显示芯片型号、MAC、flash 大小 |
| 2 本地文件烧录 | File 上传 bin → 单文件烧录 + 进度条 + 烧后复位读日志 | 任一 ESP32 开发板烧录成功并启动 |
| 3 清单烧录 | 三级清单 + 多分区 fileArray + 全擦开关 + 版本下拉 | 仿 web-flasher 完整页面流程跑通 |
| 4 集成打磨 | 主站路由/首页卡片/七语言/README 同步/zip 上传/波特率档位 | §10 清单全过 |

## 9. 已知风险与应对

| 风险 | 应对 |
| --- | --- |
| web-flasher GPL-3.0 | 只抄设计概念，代码逐行自写；Skill 中标注 |
| 烧录后读锁竞争（`port.readable.locked`） | 严格按 `disconnect → waitForUnlock → open` 顺序；`isReaderLocked` 防重入 |
| 固件 fetch 404 被当数据烧入 | 所有 fetch 检查 `response.ok`，失败即终止流程 |
| ESP32-S3/ESP32-C3 USB-JTAG 复位不进下载模式 | 提供 `baud1200()` 按钮与 `UsbJtagSerialReset`/`CustomReset` 预设 |
| 大固件串口传输慢 | `compress: true`（web-flasher 同款）；烧录阶段自动升波特率（esptool 内建） |
| 无自动复位电路的板子 | 页面步骤①给出手动按住 BOOT 的图文引导（照搬 web-flasher 交互） |

## 10. 验证清单（实现后执行）

```powershell
cd esp-tool
deno install                # 兑现 node_modules
deno task check
deno task build
deno task start             # 独立运行 http://127.0.0.1:8787/
# 硬件实测（Chromium 浏览器 + 真板）：
#  - 检测：芯片型号 / MAC / flash 大小是否正确
#  - 烧录：4MB bin 烧录成功率、进度条与终端输出、烧后启动日志
#  - 全擦：eraseAll 分支
#  - 异常：拔线中断、错误波特率、不支持的 bin
# 主站接入后：/esp-tool/ 路由 200、首页卡片七语言、根 bun run build 全链路过
```

## 参考

- esptool-js：https://github.com/espressif/esptool-js（Apache-2.0，含完整 API 文档）
- web-flasher：https://github.com/meshtastic/web-flasher（GPL-3.0，仅作交互参考）
- 本仓库同构先例：`i2c_web_tool/`（Deno + Vite + React + Hono server.ts）
- 主站接入规范：`.agents/skills/site-hosting-and-build/SKILL.md`
