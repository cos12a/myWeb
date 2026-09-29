# stoovTest-desktop 实现过程详细文档

>  companion 文档：`DESKTOP_EVALUATION.md` 记录"为什么这么做"（勘察与决策），本文记录"怎么做的、验证到什么程度、踩过什么坑"。
> 完成时间：2026-09-29。全程 `stoov-test` 原项目零改动。

---

## 一、背景与目标

把纯前端项目 `stoov-test`（加热垫测试台，原生 ESM 免构建）做成 Deno 桌面版 `stoovTest-desktop`：
单可执行文件 = 本地服务 + 自动弹出系统默认浏览器。

经两轮确认的硬性决策（用户提出，取代最初的"简单打包"方案）：

| 编号 | 决策 | 落地点 |
| --- | --- | --- |
| D1 | MQTT 连接用**后台原生连接**，与前端分离 | `mqtt-backend.ts` + `/ws/mqtt` + 前端垫片 |
| D2 | MQTT 配置放**本地磁盘 JSON** | `config/mqtt-config.json`，缺失回退内置默认 |
| D3 | 测试结果**写本地 SQLite + MQTT 上云两者都要**；下载改为**本地库导出 CSV 另存** | 后台 save 主题拦截落库 + `sqlite-store.ts` |
| D4 | 串口**直接移植 Win32 原生 + 参数设置弹窗**，不用 Web Serial | 复用 stm32WebFlasher-desktop 桥 + `native-serial-webcompat.js` |
| — | 先做 spike 验证最大风险（Deno 下 npm:mqtt），回报后再展开 | spike PASS 后全面实现 |

---

## 二、过程时间线（阶段划分）

1. **勘察评估** → `DESKTOP_EVALUATION.md`
   - 摸清 stoov-test 结构、网络依赖（mqtt-config 接口 / 下载接口 / EMQX wss / Google Fonts / PWA SW / Web Serial）；
   - 对照服务端契约 `src/routes/stoov.ts`（表结构、CSV 列、mqtt-config 字段）；
   - 参考先例：既有 `deno-desktop` 曾因无 `bun:sqlite` 放弃 download 端点——本项目用 `node:sqlite` 翻越此限制。
2. **Spike**（最大风险消除）
   - `node:sqlite DatabaseSync` 在 Deno 2.9 开箱可用（无需 FFI/dll）；
   - `npm:mqtt` 需项目 `deno.json` 开 `nodeModulesDir:"auto"`；`deno run` 与 `deno compile` 出的 exe 均能连 EMQX wss broker（隔离主题 pub/sub 往返 PASS，见 `spike/mqtt-spike.ts`）。
3. **全面实现**（本文主体，共 10 个新文件 + 4 个复用文件）。
4. **验证**：`deno check` → 起服务端到端脚本 → `deno compile` exe 冒烟 → **真机串口收发浏览器走查**。

---

## 三、最终架构

```
浏览器 UI (static/)                              Deno 后台 (exe)
  main.js ── requestNativeSerialPort() ══ WS /ws/serial ══> serial-bridge.ts -> serial-ffi.ts (kernel32)
        │    （参数设置弹窗，点确定即真正打开）
        │
        │  mqtt.connect()（同名垫片）══ WS /ws/mqtt ══> mqtt-backend.ts ──原生 npm:mqtt──> EMQX broker
        │                                                  │ 拦截 save 主题
        │                                                  └──> sqlite-store.ts (node:sqlite)
        ├─ fetch /api/stoov/mqtt-config ─────────────────> 读 config/mqtt-config.json
        └─ POST /api/stoov/test-data/download ──────────> 本地库导出 CSV（浏览器另存）
```

核心思想：**前端只当 UI；串口、MQTT、存储全部下沉后台**，但通过"兼容层 + 同名 API 垫片 + 发布拦截"三个技巧，让 `main.js`/`index.html` 的改动全部收敛为 sync 补丁（原文件零触碰）。

### 单次保存 = 上云 + 落库（D3"两者都要"的零改动实现）

`saveTest()` 原有的 `mqttClient.publish("/unito/stoov/heating-bed/save/yaokong|heating", ...)` 一个调用，经垫片到后台中继时被**按主题拦截**：
1. 解析 payload → 写本地 SQLite（external→`data_table`，internal→`heating_data`）；
2. 原样转发 broker（上云）；
3. broker 回执 `{ev:"published", ok}` → 垫片触发 publish 的 cb。

前端因此**不需要新增任何 POST 保存逻辑**。

---

## 四、文件清单与职责

### 新建（stoovTest-desktop/）

| 文件 | 职责 |
| --- | --- |
| `main.ts` | 本地服务：静态托管 + `/api/stoov/mqtt-config` + `/api/stoov/test-data/download` + `/api/serial/ports` + `/ws/serial` + `/ws/mqtt` + `/health`；顶层解析静态根/配置/数据目录并启动后台 MQTT |
| `desktop.ts` | 启动器：静态导入 main.ts，轮询就绪后打开默认浏览器（cmd /c start） |
| `mqtt-backend.ts` | 后台持有唯一 broker 连接；`/ws/mqtt` 中继（publish→上云+save落库）；broker 状态广播 |
| `sqlite-store.ts` | node:sqlite 建库（IF NOT EXISTS）、save 写入、queryRows+buildCsv 导出（列映射逐字对齐服务端） |
| `sync-static.ts` | 从 `../stoov-test` 拷 7 项资源 + 4 个 overlay 进 static/（重建前先清空 static/src），再打 14 条锚点补丁 |
| `overlay/native-serial-webcompat.js` | **Web Serial 形状兼容端口**（open/close/readable/writable/getInfo），包装已打开的原生传输层 |
| `overlay/native-mqtt-shim.js` | **同名 API 的 `window.mqtt` 垫片**（classic 脚本），connect/publish/on/end 经 /ws/mqtt |
| `deno.json` | `nodeModulesDir:"auto"`；`imports.mqtt=npm:mqtt@5`；任务 sync/check/start/compile |
| `config/mqtt-config.json` | 本地磁盘 MQTT 配置（含凭据，.gitignore 已排除） |
| `README.md` / `IMPLEMENTATION.md` | 使用说明 / 本文档 |

### 复用（自 stm32WebFlasher-desktop，未改动）

`serial-ffi.ts`（Win32 kernel32 FFI，COM 枚举走 `HKLM\HARDWARE\DEVICEMAP\SERIALCOMM`）、`serial-bridge.ts`（/ws/serial 单会话桥）、`overlay/native-serial-transport.js`、`overlay/native-serial-dialog.js`（参数弹窗：确定→真正打开→成功关窗/失败留窗可重试）。

### 补丁后的前端资源（static/ 内，sync 生成勿手改）

`index.html`（含上游内联的应用逻辑，桌面补丁全部落在此）、`serial-protocol.js`、`yaokong-wc.js`、`manifest.json`、`favicon.ico`、两个 logo（共 7 项上游资源拷贝）+ 4 个 overlay 拷贝件（`native-mqtt-shim.js` 落 static 根，`native-serial-{webcompat,transport,dialog}.js` 落 static/src）。

> **2026-09-29 优化**：上游已将应用逻辑整段内联进 index.html，不再引用 `src/main.js`；因此 **sync 已停止拷贝上游 `src/`**（main.js / pwa/install.js / config/runtime-config.js / styles.css 均为不被加载的死代码）。桌面所需的 `static/src/` 内容全部由 overlay 提供，sync 会在重建前 `Deno.remove(static/src)` 以清除旧版残留。随之移除失效的 install.js 整文件置换补丁。

---

## 五、前端零改动衔接设计（14 条锚点补丁）

> **2026-09-29 上游重构适配**：上游把应用逻辑从 `src/main.js` **整段内联进 `index.html`** 的 classic `<script>`（并新增一段内联 PWA/SW 注册脚本），不再引用 `src/main.js`。因此串口与 PWA 相关补丁全部改作用到 **index.html 内联块**（旧版曾针对 src/main.js，那份文件现为未被加载的死代码，补丁已撤下）。`stoov-test` 仍零改动。

| # | 文件 | 锚点（摘要） | 改为 | 目的 |
| --- | --- | --- | --- | --- |
| 1 | index.html | `<script src="./mqtt.min.js">` | `./native-mqtt-shim.js?v=desktop` | MQTT 垫片替换浏览器 mqtt.js |
| 2 | index.html | Google Fonts `<link>`（3 行） | HTML 注释 | 离线化 |
| 3 | index.html | `href="/favicon.ico"` | `./favicon.ico` | 本地路径 |
| 4 | index.html | `<link rel="manifest" href="manifest.json" />` | HTML 注释 | 移除 PWA：manifest 链接 |
| 5 | index.html | 底部 `footer-pwa` 整块（11 行，含安装按钮/徽标） | HTML 注释 | 移除 PWA：安装 UI |
| 6 | index.html | 内联 PWA 脚本起点：`<!-- PWA Service Worker … -->` + `<script>` + `let deferredPrompt = null;` | 保留注释行，`<script>` 改为 `<script>/*` | 移除 PWA：内联脚本起包（上游新增块） |
| 7 | index.html | 内联 PWA 脚本终点：`// 初始状态` + `updatePwaStatus();` + `</script>` | `*/</script>` | 移除 PWA：整块 JS 块注释惰性化 |
| 8 | index.html | yaokong-wc `<script type="module">` 与内联 `<script>` 之间 | 插入 module 桥：`import{requestNativeSerialPort}…; window.requestNativeSerialPort=…` | 注入兼容层（classic 脚本不能 import，用 module 桥挂全局） |
| 9 | index.html | 内联块 `connectSerial` 开头 Web Serial 守卫（4 行） | 仅留注释 | 桌面不依赖 navigator.serial |
| 10 | index.html | 内联块 `port = await navigator.serial.requestPort();` | `port = await window.requestNativeSerialPort({ log: (m) => bleAddLog("串口", m), defaults: SERIAL_OPTIONS });` | 原生串口+弹窗 |
| 11-14 | manifest.json | `/unito/stoov/bed-test/` 前缀 ×4 | `/`、`/logo-*.png` | 本地化（桌面已不引用 manifest，保留以兼容直接访问） |
| — | （引擎） | — | 锚点须恰好命中 1 次否则整体中止 | 防静默产出错误副本 |

**内联 PWA 脚本惰性化手法（补丁 6+7）**：起点 `<script>` → `<script>/*`、终点 `</script>` → `*/</script>`，中间整段（beforeinstallprompt 监听、`navigator.serviceWorker.register('./sw.js')` 等）全部处于 JS 块注释内：不执行、也不会因 `pwaInstallBtn` 已删而报 null 错。前提：块内无 `*/` 且无提前 `</script>`（均已核实）；首尾锚点各取三行，降低上游行内漂移失配风险。

**为何串口兼容层需额外 module 桥（补丁 8）**：上游内联脚本是 **classic** `<script>`（无 type=module），不能写 `import`；而 `native-serial-webcompat.js` 是 ES 模块。故在内联块前注入一个 `<script type="module">`，import 后将 `requestNativeSerialPort` 挂到 `window`，classic 代码里调 `window.requestNativeSerialPort(...)`。module 脚本 deferred，但 `connectSerial()` 只在用户点“连接”时才执行，届时全局已就绪。

**为什么串口只需 3 条补丁**：运行时串口用法全部经由 `port` 对象（`open()`、`readable.getReader()` 读循环、`writable.getWriter()` 写队列、`close()`），兼容端口对象把这四个面全部实现掉了；MQTT 用法全部是 mqtt.js 标准 API，垫片同名实现。`WS_URL/ws` 经查仍为死代码（仅声明无使用），不处理。

### 兼容端口对象（overlay/native-serial-webcompat.js）关键实现

- 先经 `openNativeSerialDialog` 完成"选口+参数+**真正打开**"，成功才返回；
- `readable = new ReadableStream({start(ctrl){ transport.setDataListener(b=>ctrl.enqueue(b)) }, cancel(){ setDataListener(null) }})`；
- `writable = new WritableStream({write(chunk){ return transport.write(asBytes(chunk)) }})`；
- `open()` 为空操作（保持调用形状）；`transport.onDisconnect` → `ctrl.error()` 使读循环退出；
- `close()` → 关流 + `transport.close()`（关 WS、释放 COM）。

### MQTT 垫片（overlay/native-mqtt-shim.js）协议

前端→后台：`{op:"publish", id, topic, payload, qos}`；后台→前端：`{ev:"status", connected, reconnecting, offline, error}` / `{ev:"published", id, ok, error}`。
事件映射：connected→`connect`；由连转断→`close`；reconnecting→`reconnect`；offline→`offline`；error→`error`。
**必须是 classic 脚本**（与 mqtt.min.js 原位同型）：main.js 在模块求值期就调用 `loadMqttAndConnect()`，classic 脚本先于 deferred module 同步执行，`window.mqtt` 才保证就绪。

---

## 六、后端实现要点

### 6.1 main.ts 端点

- `GET /api/stoov/mqtt-config`：返回磁盘配置（合并内置默认），保持 `runtime-config.js` 的 fetch 不改；
- `POST /api/stoov/test-data/download`：`{mode}` → `store.exportCsv(mode)`，响应带 `Content-Disposition` 附件名（`heating_test_data_*.csv` / `Stoov_Remote_*.csv`），前端 `downloadData()` **一行未改**即可用；
- 静态根解析：`STOOV_DESKTOP_ROOT` → exe 同级/上一级 `static` → 源码同级 `static` → CWD；识别特征 `index.html + native-mqtt-shim.js`（桌面专属 overlay 产物，上游项目中不存在；旧版曾用 `src/main.js`，但上游内联重构后该文件已成死代码不再拷贝，作判据会导致定位失败）。

### 6.2 sqlite-store.ts（D3）

- 单文件 `data/stoov-desktop.db`，两表 `data_table`（external）/ `heating_data`（internal），`updated_at` 存 epoch 秒；
- 导出查询与 CSV 构建**逐字复刻**服务端 `src/routes/stoov.ts`：`strftime('%Y-%m-%d %H:%M:%S', datetime(updated_at,'+8 hours'))`、`items_json` 展平成 `func_1..12`、`\uFEFF` BOM、同样的 escapeCsv。

### 6.3 mqtt-backend.ts（D1）

- 进程启动即连 broker（`clientId: stoov-desktop-<rand>`，reconnect/connectTimeout 来自磁盘配置）；前端关闭不影响上云通道；
- `/ws/mqtt` 中继内完成 save 拦截（`SAVE_TOPICS` 映射）→ 落库失败只记日志、**不阻塞上云**；
- broker 状态实时广播，页面"MQTT 连接成功"指示反映的是**后台**连接。

### 6.4 编译与权限

`deno compile --output bin/stoovTest-desktop.exe --allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi desktop.ts`
产物内置 node_modules≈7.84MB（npm:mqtt 链路）+ std 远程模块 250KB；`--allow-ffi` 供 kernel32 串口，`--allow-run` 供开浏览器。
分发 = exe + 同级 `static/` + `config/`；运行时数据在 **exe 同级 `data/`**。

---

## 七、验证过程与结果（全部通过）

1. `deno task sync`：12 锚点全部恰好命中一次。
2. `deno task check`（6 个后端模块）：通过。
3. **端到端脚本**（临时 `_e2e.ts`，验后已删除）：
   - 各 HTTP 端点 200；补丁落地断言（index 无 google fonts / main.js 无 `navigator.serial.requestPort` 残留 / install.js SW 已禁）；
   - **闭环关键证据**：经 `/ws/mqtt` 发布 save 主题条码 `E2E-957354` → broker 回执 `ok=true` **且** 随后 download CSV 命中该条码 → "上云+落库"同时成立。
4. **exe 冒烟**：`bin/stoovTest-desktop.exe` 自包含运行，health/配置/串口枚举(COM6)正常。
5. **真机串口走查**（Browser 代理驱动，服务 `http://127.0.0.1:31055/`，见 §八）。
6. **后补变更（2026-09-29）：应用户要求整体移除 PWA 功能**——manifest 链接、底部安装按钮/徽标、install.js 整文件置换（补丁表见 §五），`stoov-test` 仍零改动。回归通过：footer 无 PWA 元素、快捷键/版本文字完好、console 0 消息、SW 注册数 0、无 sw.js/manifest 请求、串口弹窗打开/取消正常。
7. **上游更新适配（2026-09-29 第二次）**：上游将 main.js 逻辑整段内联进 index.html、新增内联 PWA/SW 脚本、manifest 部署路径改 `/unito/stoov/bed-test/`。桌面侧：串口 3 补丁 + manifest 4 补丁重新锚定，新增内联 PWA 脚本惰性化 2 补丁（共 14 锚点 + 1 置换）。验证全绿：`deno task check` 通过；端到端 10 项（垫片/惰性化/串口接管/新版 isSave 分支同步/internal 保存上云回执+落库/CSV 列映射/非 save 主题转发不入库）；浏览器实测 `window.requestNativeSerialPort` 为 function、点【连接】弹的是自定义原生弹窗（nsd 系列 DOM，列出 COM6，默认 115200-8-N-1）、兼容层三件套全 200、探针计数 `navigator.serial.requestPort` 调用 0 次、console 0 error/warn；`deno task compile` 重编译成功（静态资源运行时从磁盘 static/ 读取，exe 本体无需变）。
8. **上游转纯 Deno + 桌面同步优化（2026-09-29 第三次）**：stoov-test 已从 npm/bun/pnpm+Vite 迁移为纯 Deno 工程（但 index.html 零改动，14 锚点仍全中）；删除了无引用的内联碎片 `_t0.js/_t1.js`。桌面侧优化：sync 不再拷贝死代码上游 `src/`（改为重建前清空 static/src）、移除失效的 install.js 整文件置换。❗ 由此发现并修复一个隐藏回归：`main.ts` 静态根判据原为 `index.html + src/main.js`，停拷 src/ 后会定位失败——已改为 `index.html + native-mqtt-shim.js`。验证全绿：`deno task check`（6 模块）通过；static/index.html 16 项结构断言全 PASS；浏览器实测无 `/src/*` 404、`requestNativeSerialPort` 为 function、SW 注册 0、无安装按钮、自定义串口弹窗正常、无意外 JS 报错；直起 main.ts 端到端冒烟（静态根定位成功、overlay 三件套与 native-mqtt-shim.js 全 200、`/api/serial/ports` 真实枚举 200、`/src/main.js` 404 属预期）；`deno task compile` 重编译成功（exe 已含新判据）。

---

## 八、真机串口收发走查记录（最终验收）

设备：COM6，参数默认 115200-8-N-1。步骤与结果：

| 步骤 | 预期 | 实测 |
| --- | --- | --- |
| 打开页面 | 串口"未连接" | ✅ |
| 点【连接】 | 弹"打开原生串口"参数窗 | ✅ 列出 COM6，默认值正确 |
| 点【确定】 | 真正打开，成功即关窗 | ✅ 弹窗自动关闭，状态绿色"已连接" |
| 点【手动获取】（**写路径**） | 下发查询帧并收到回包 | ✅ <1s：**器件ID `HT-56006500`、版本 `v4.2`、硬件运行时间 00:02:17** 回填 |
| 等待周期上报（**读路径**） | 数据持续更新 | ✅ 运行时间 00:02:43→00:02:49 稳定递增；设置温度 28/30°C；状态"已关闭"；面板 BODY/FEET 36°/40° |
| Console/网络 | 无异常 | ✅ 0 报错；overlay 三件套+API 全 200 |

截图（`../out/`）：`serial-01-initial.png` → `serial-02-dialog.png` → `serial-03-connected.png` → `serial-04-after-manual-fetch.png` → `serial-05-periodic-data.png` → `serial-06-final.png`。

**两条非桌面版引入的观察**：
1. 实时温度显示"传感器开路"——设备上报的故障码（物理探头未接），解析链路本身正常；
2. 设备上报设置温度(28/30) 与遥控面板显示(36°/40°) 不一致——原 stoov-test 既有的双状态源现象，桌面补丁未触碰 UI 逻辑；如需修正应走 sync 补丁。

---

## 九、踩坑记录（本过程实际遇到并解决）

| 坑 | 症状 | 解法 |
| --- | --- | --- |
| `Request.json<T>()` | TS2558 Expected 0 type arguments（Deno 的 json() 无泛型） | `(await request.json().catch((): unknown => ({}))) as { mode?: string }` |
| 多行锚点 0 命中 | 源文件 CRLF、锚点 join("\n") 是 LF | 读入后 `.replace(/\r\n/g, "\n")` 归一化（沿用了 stm32 的教训） |
| 垫片脚本形态 | 若做成 ES module，main.js 模块求值期 `loadMqttAndConnect()` 会拿到 undefined | 保持与 mqtt.min.js 同位的 **classic script**，同步定义 `window.mqtt` |
| `npm:mqtt` 报找不到包 | 根工作区未开 nodeModulesDir | 项目 `deno.json` 设 `"nodeModulesDir": "auto"`（spike 阶段即确认） |
| exe 被占用重编译失败 | os error 5 拒绝访问 | 先 `Get-Process stoovTest-desktop \| Stop-Process -Force`（沿用 stm32 教训） |
| 大文件无法用编辑工具删 | `_spike.exe`/测试 db | `.gitignore` 排除 + `Remove-Item` 清理测试库 |
| IDE 报"找不到名称 Deno" | 工作区 tsconfig 非 Deno 感知 | 忽略 IDE，以 `deno task check` 为准 |
| 副作用 import 的模块要整体退场 | 逐行锚点无法优雅清空 install.js | 引擎新增 `wholeFileReplacements` 第三步：补丁后整文件覆写为空模块，import 行不动（**上游内联重构后 main.js 不再加载 install.js、sync 也不再拷 src/，此置换随之移除；机制作为引擎设计能力保留**） |
| 旧服务进程未死透 | `Get-NetTCPConnection` 查不到监听但 `AddrInUse` 仍报（杀进程命令因 shell 回显错乱未执行） | `Get-CimInstance Win32_Process -Filter "Name='deno.exe'"` 列出 PID+命令行精确停掉，确认计数为 0 再起 |
| **上游把 main.js 内联进 index.html** | sync 全部锚点命中、补丁"成功"，但浏览器运行时仍走 `navigator.serial.requestPort()`（补丁落在了死代码上）——锚点全中≠运行时生效 | 用浏览器实测（typeof 全局函数/DOM 弹窗探针/requestPort 调用计数）而非仅静态断言发现；补丁重新锚定到 index.html 内联块，classic 内联脚本不能 import → 注入 module 桥挂 window 全局 |
| 上游新增内联 PWA/SW 脚本块 | 仅盯既有锚点会漏新代码：SW 注册 `./sw.js` 会随页面加载复活并报 null 错 | 对非 save 类的新增脚本块，用起点 `<script>/*` + 终点 `*/</script>` 整块惰性化（先核实块内无 `*/` 与提前 `</script>`）；同步时用关键字扫描（serviceWorker/beforeinstallprompt 等）兜底 |

---

## 十、日常维护

- **原项目更新后**：`deno task sync` → 若报"锚点出现 0 次/N 次"，说明 stoov-test 相应代码漂移，对照本文 §五 的表更新 `sync-static.ts` 锚点；
- **改 broker**：编辑 `config/mqtt-config.json`（或设 `STOOV_MQTT_CONFIG` 指向别处）；
- **换串口参数默认**：改 `requestNativeSerialPort({ defaults })` 传参（来自页面 `SERIAL_OPTIONS`）；
- **本地库**：`data/stoov-desktop.db`，删文件即重置；备份/迁移直接拷文件；
- **发版**：`deno task sync && deno task check && deno task compile`，打包 `bin/*.exe + static/ + config/`。
