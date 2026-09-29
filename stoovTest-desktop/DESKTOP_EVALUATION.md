# stoov-test 桌面化（stoovTest-desktop）评估与设计说明

> 阶段：**检测评估 + 方案设计**（本文件）。实际改造（复制文件、写启动器、打补丁、编译）留到确认后的一阶段执行。
> 原则：**`stoov-test` 原项目零改动**，桌面所需内容 Copy 到 `stoovTest-desktop/` 开发，与 `stm32WebFlasher-desktop` 同构。

---

## 一、目标

把 `stoov-test`（Stoov Bed 加热垫测试面板，纯前端 Web 应用）用 **Deno 桌面能力**包装成 Windows 桌面应用：

- 单可执行文件 = 本地静态服务 + 自动打开系统默认浏览器；
- 把「从网络加载」改为「从本地磁盘加载」；
- 不改动 `stoov-test` 源码与功能，桌面定制通过同步补丁实现。

---

## 二、现状勘察结论

### 2.1 项目性质与技术栈

- **纯前端、无框架**：`index.html` + 原生 ES Module 脚本 + 一个 Web Component（`yaokong-wc.js`）。
- **构建工具**：Vite（`vite.config.js`，`base: "/stoov-test/"`），仅用于 dev/打包，产物在 `dist/`。
- **运行时依赖库**（本地文件）：`mqtt.min.js`（MQTT over WebSocket 客户端，全局脚本）、`serial-protocol.js`（串口帧协议）、`yaokong-wc.js`（加热/遥控面板 Web Component）。
- **入口脚本**：`index.html` 末尾 `<script type="module">` 直接引用 `./serial-protocol.js`、`./yaokong-wc.js`、`./src/main.js`。
  - 关键结论：**源码可被现代浏览器原生加载运行，无需 Vite 构建**即可作为静态站点直接托管（与 stm32WebFlasher 类似）。

### 2.2 功能与数据流

- **设备数据来源 = Web Serial**：`src/main.js` 的 `readSerialData()` 经 `navigator.serial.requestPort()` 打开串口，读取帧 → `globalParser` 解析 → `handleMessage()` 驱动 UI 与测试判定。
- **MQTT = 结果上报 / 控制下发**：仅 `publish`（测试遥控 `/unito/stoov/heating-bed/yaokong`、保存 `save/yaokong`；内部模式对应 `heating` / `save/heating`），无 `subscribe`。即 MQTT 是**云端遥测通道**，桌面版仍需联网访问 EMQX broker 才能上报测试结果。
- **两种测试模式**：遥控 PCBA（external）、加热 PCBA（internal），船形开关切换；快捷键、条码输入、电流范围设置（密码 1234）等。

### 2.3 「网络加载」相关点（桌面化需处理清单）

| # | 位置 | 现状 | 影响 | 桌面化处理 |
|---|------|------|------|-----------|
| N1 | `src/config/runtime-config.js` | `fetch("/api/stoov/mqtt-config")` 取 broker 参数 | 无后端则取不到 MQTT 配置 | **由本地 Deno 服务提供该端点，读本地磁盘配置文件** |
| N2 | `src/main.js` `downloadData()` | `POST /api/stoov/test-data/download` 读**服务器端 SQLite**（`STOOV_DB_DIR/Heating.db`、`yaokong.db`）导出 CSV | 桌面单机无该数据库，功能失效 | **需决策**：见 §六 D3 |
| N3 | `index.html` head | Google Fonts `<link href="https://fonts.googleapis.com/...">` | 离线时字体降级（非致命） | 保留联网 / 或本地化字体（可选，见 §六 D6） |
| N4 | `src/pwa/install.js` | 自动 `navigator.serviceWorker.register("./sw.js")` | SW 缓存 `.js/.html/.json` 导致桌面版**加载旧缓存**、与本地磁盘服务冲突 | **补丁禁用 SW 注册 + manifest**（桌面从磁盘实时托管，无需 SW） |
| N5 | `index.html` | `<link rel="icon" href="/favicon.ico">`（绝对路径） | 根路径托管时可用；需确保 favicon 落到静态根 | 复制 `favicon.ico` 到 static 根 |
| N6 | `manifest.json` | `start_url/scope/icons` 前缀 `/stoov-test/` | 桌面挂在根 `/` 时前缀不符 | 桌面版**不使用 manifest**（随 N4 一并处理） |

> 说明：**桌面化 ≠ 离线化**。串口本地测试可完全离线；但测试结果上报（MQTT）与"下载数据"（读服务器库）本质依赖云端/后端——这是产品功能决定，非包装可消除。

### 2.4 需复制的运行所需文件（源文件，免构建）

```
index.html
mqtt.min.js
serial-protocol.js
yaokong-wc.js
src/main.js
src/styles.css
src/config/runtime-config.js
src/pwa/install.js
favicon.ico            (来自 public/favicon.ico，放 static 根)
```

**不复制**（构建/开发产物、无关）：`_t0.js`、`_t1.js`、`compress.js`、`package.json`、`package-lock.json`、`bun.lock`、`vite.config.js`。
**视决策**：`manifest.json` / `sw.js` / `logo-*.png`（若桌面彻底弃用 PWA，则不纳入）。

---

## 三、可参考的既有两种桌面模式

本仓库已存在两套 Deno 桌面方案：

| 维度 | `deno-desktop/`（聚合） | `stm32WebFlasher-desktop/`（单应用自包含） |
|------|------------------------|---------------------------------------------|
| 定位 | 一个 exe 托管 8 个子应用（含 `stoov-test/dist`）+ `/api/stoov` 路由 | 单应用独立 exe，资源自包含 `static/` |
| 静态来源 | `static/stoov-test/dist`（需 Vite 预构建） | `static/` 直接从原项目 Copy 源码 |
| 定制方式 | 不改原项目，路由层实现 API | 不改原项目，`sync-static.ts` **锚点补丁** |
| MQTT 配置 | `src/routes/stoov.ts` 端点（env 可覆盖） | 类似端点 |
| 下载 CSV | **已放弃**（注释注明 Deno 无 bun:sqlite） | 不适用 |
| 启动器 | `desktop.ts` 轮询就绪 + 开浏览器 | `desktop.ts` 同逻辑 |

**结论**：用户要的是"独立桌面版放 `stoovTest-desktop`"，应采用 **`stm32WebFlasher-desktop` 的单应用自包含模式**（Copy + sync + 锚点补丁 + 本地磁盘配置端点）。`deno-desktop` 的 `desktop.ts` 启动器与 `resolveStaticRoot()` 思路可直接复用。

---

## 四、推荐目录结构（实现阶段创建）

```
stoovTest-desktop/
├── main.ts            # Deno 本地静态服务 + /api/stoov/mqtt-config（读本地磁盘配置）
├── desktop.ts         # 启动器：等待就绪 + 打开默认浏览器（复用 deno-desktop 逻辑）
├── sync-static.ts     # 从 ../stoov-test Copy 所需文件到 static/ 并打桌面补丁
├── deno.json          # tasks: desktop / sync / compile / check
├── build.bat          # Windows 一键编译
├── overlay/           # 桌面专属前端文件（原项目无），sync 时覆盖进 static/
│   └── (可选) 本地化字体/关闭SW的注入脚本
├── config/
│   └── mqtt-config.json   # 本地磁盘的 MQTT 配置（url/username/password/...）
├── static/            # 由 sync 生成：stoov-test 运行所需副本（补丁后）
└── README.md          # 桌面版使用说明（实现阶段补写）
```

### 4.1 关键设计点

- **本地磁盘托管 MQTT 配置（N1）**：`main.ts` 实现 `GET /api/stoov/mqtt-config`，从 `config/mqtt-config.json`（exe 同级可编辑）读取返回。前端 `runtime-config.js` 的 `fetch` 路径不变即可命中（仍是 `/api/...` 绝对路径，由本地服务应答）——**这就是"网络加载→本地磁盘加载"的核心转换**。默认值与现网一致（`wss://...emqxsl.cn:8084/mqtt`），可改指向任意 broker。
- **免构建直连**：`static/` 存 `stoov-test` 源文件，浏览器原生 ESM 直接跑，`sync` 后无需 Vite。
- **补丁而非改源（N4）**：`sync-static.ts` 用锚点补丁在 `static/pwa/install.js` 停用 SW 注册与 `manifest`（桌面从磁盘实时服务，SW 缓存有害）。
- **路径基准**：源 `index.html` 用相对路径（`./src/main.js`），挂在 `/` 根下即可，无需改 `base`。
- **静态根解析**：复用 `resolveStaticRoot()`（exe 同级/上一级 `static` → 源码同级 `static` → 兜底）。

---

## 五、sync 补丁清单（相对原文件，实现阶段）

| 补丁 | 目标文件 | 作用 |
|------|----------|------|
| P1 | `src/pwa/install.js` | 短路 Service Worker 注册（桌面不缓存，避免陈旧） |
| P2 | `index.html` | 移除/停用 `<link rel="manifest">`（可选，随 D5） |
| P3 | `index.html` | Google Fonts：保留在线 / 或替换为本地字体链接（随 D6） |
| （端点）| `main.ts` | 提供 `/api/stoov/mqtt-config` 读磁盘配置（不改前端） |

> 采用 `sync-static.ts` 现有机制：锚点需**恰好命中一次**，否则中止报错，保证原项目漂移时第一时间发现。

---

## 六、关键决策（已确认 → 见 §十 修订版架构）

| # | 决策 | **已确认方向** | 落地方式 |
|---|------|----------------|----------|
| **D1** | 运行形态 | 源码直连（免构建）+ **MQTT 与串口都下沉到后台原生、与前端解耦** | static/ 存源文件；后端新增 MQTT 客户端与串口桥模块 |
| **D2** | MQTT 配置来源 | ✅ 本地磁盘 JSON | `config/mqtt-config.json`，`/api/stoov/mqtt-config` 读取 |
| **D3** | 下载数据 | ✅ **桌面端直接保存到本地 SQLite**；下载 = 从本地 SQLite 导出 CSV 另存 | 后端 `node:sqlite`（Deno 2.9.7 内置，无需 FFI/dll）建库、写入、导出 |
| **D4** | 串口 | ✅ **直接移植原生串口（Win32 FFI）+ 参数设置弹窗** | 复用 `stm32WebFlasher-desktop` 的 `serial-ffi.ts`/`serial-bridge.ts`/`overlay/*.js` |
| **D5** | PWA/SW | 桌面禁用 | 补丁短路 `install.js` 的 SW 注册与 manifest |
| **D6** | Google Fonts | v1 保留在线（离线自动降级），二期本地化 | 暂不改 |

> 已核实：`node:sqlite`（`DatabaseSync`/`StatementSync`）在本机 Deno 2.9.7 开箱可用且能被 `deno compile` 内置；`npm:mqtt` 需在项目 `deno.json` 开 `"nodeModulesDir": "auto"`（本工作区未开所以 eval 报错，非不兼容）。

---

## 十、修订版目标架构（按 §六 确认决策）

桌面版不再是单纯“静态托管”，而是把**网络（MQTT）与硬件（串口）都下沉到 Deno 后台，前端只当 UI**，并自带本地数据库：

```text
[浏览器 UI：stoov-test 源码，经补丁改造]
  ├─ 串口：navigator.serial → 原生串口弹窗 + NativeSerialTransport(WS)
  ├─ MQTT：全局 mqtt 垫片（connect/publish/on/end 同名 API）→ 本地 WS /ws/mqtt
  ├─ 取配置：fetch /api/stoov/mqtt-config（不变的路径，本地服务应答）
  └─ 保存/下载：POST /api/stoov/test-data/{save,download}（本地）
         │
[Deno 桌面后台（单 exe）]
  ├─ main.ts     静态托管 + 路由分发
  ├─ serial-ffi.ts / serial-bridge.ts      Win32 原生串口 + /ws/serial（复用 stm32）
  ├─ mqtt-backend.ts                       npm:mqtt 连 EMQX(wss:8084) + /ws/mqtt 本地代理
  ├─ sqlite-store.ts                         node:sqlite 建库/写入/查询（data_table / heating_data）
  └─ config/mqtt-config.json               本地磁盘 broker 配置
```

### 10.1 前端 MQTT 解耦策略（关键：少改主逻辑）

`main.js` 中 `mqtt.connect(...)`、`mqttClient.publish(...)`、`mqttClient.on(...)`、`end()` 等多处使用。
为**最小化对主逻辑的改动**，提供一个**与 mqtt.js 同 API 的垫片**替代浏览器 `mqtt.min.js`：
- `connect(url, opts)` 返回一个对象，内部走本地 WebSocket `/ws/mqtt` 连后台；
- `publish`/`on('connect'|'error'|'close')`/`end` 语义与原来一致，事件由后台代理回报。
这样 `main.js` 几乎不需改（只换 `index.html` 里 mqtt 脚本来源），MQTT 连接真正“后台原生、与前端分离”。

### 10.2 本地 SQLite 与数据流

- **库/表**（与服务器 schema 一致，CSV 导出逻辑可直用）：
  - external：`data_table(barcode, timestamp, items_json, updated_at)`
  - internal：`heating_data(barcode, timestamp, deviceId, deviceVer, items_json, updated_at)`
  - `updated_at` 存 epoch 秒（服务器查询用 `datetime(updated_at,'+8 hours')`）。
- **写入时机**：原服务器由 Node-RED 订阅 save 主题写库；桌面版改为**后台直接写本地 SQLite**（保存动作同时：写本地库 + 通过代理 MQTT 发布到云 broker）。
- **下载**：`POST /api/stoov/test-data/download` → 后台查本地库 → 拼 CSV（沿用 `src/routes/stoov.ts` 的 `queryRows`/`buildCsv` 思路）→ 前端 blob 下载（现有 UI 不变）。
- **库文件位置**：exe 同级 `data/`（首次自动建表），可环境变量覆盖。

### 10.3 sync 补丁新增清单（均只改 static 副本，原项目零改动）

| 补丁 | 目标 | 作用 |
|------|------|------|
| S1 | `index.html` | 本地 `mqtt.min.js` → 本地垫片 `native-mqtt-shim.js`（覆盖进 static） |
| S2 | `index.html` | 移除 manifest link；Google Fonts 保留 |
| S3 | `src/pwa/install.js` | 短路 SW 注册 |
| S4 | `src/main.js` | 选口 `navigator.serial.requestPort()` → `pickNativeSerialPort()`；connect 走原生传输层（同 stm32） |
| S5 | `src/main.js` | 保存测试 → 额外/改为 POST `/api/stoov/test-data/save`（写本地库）；下载保持同路径（现指本地） |
| S6 | overlay | `native-serial-transport.js`、`native-serial-dialog.js`、`native-mqtt-shim.js` 拷入 static |

### 10.4 新增后台模块

- `mqtt-backend.ts`：`npm:mqtt` 连 broker（URL/凭据从 mqtt-config.json）；`/ws/mqtt` 将前端 publish 转发到 broker、broker 状态回前端。
- `sqlite-store.ts`：`node:sqlite` 封装，启动建库；`saveResult(mode,row)`、`queryRows(mode)`。
- `/api/stoov/test-data/save`、`/api/stoov/test-data/download`、`/api/stoov/mqtt-config`、`/ws/mqtt`、`/ws/serial`、`/api/serial/ports`。

### 10.5 编译与分发

- `deno.json`：`nodeModulesDir:"auto"`（拉 npm:mqtt）；`compile` 带 `--allow-net --allow-read --allow-write --allow-env --allow-run --allow-ffi`。
- 分发：`bin/*.exe` + `static/` + `config/` + `data/`（本地库，首次自建）。

### 10.6 需尽早验证的技术点（实现阶段第一步先跑）

1. **npm:mqtt 在 Deno + `deno compile` 后能否正常连 wss broker**（最高不确定性；先写一个最小程序实测）。
2. `node:sqlite` 写入/查询与 CSV 导出（已初步验证可用）。
3. 原生串口移植到本项目的传输层适配（stoov 直接读写 port，需把 `navigator.serial` 读循环改接原生传输层）。

> **✅ Spike 实测结论（已完成）**：`spike/mqtt-spike.ts` 读取 `config/mqtt-config.json`，向隔离主题 `stoov-desktop/spike`（不碰生产加热主题）自发自收。结果：**`deno run` 与 `deno compile` 出的 exe 两种方式均 PASS**（连上 EMQX wss:8084，pub/sub 往返成功）。编译产物内置 `node_modules`（约 7.8MB）。→ **后台原生 MQTT 方案成立**，无需回退。

### 10.7 建议实施顺序

1. 先跑一个 **MQTT 后端可行性 spike**（npm:mqtt 连 EMQX + 本地 WS 代理）；不过则回退方案（前端保留 mqtt.min.js、仅后台另路写库）。
2. 搭壳：静态托管 + 本地 mqtt-config + 原生串口（复用 stm32）+ 页面能跑。
3. 接入本地 SQLite（save 写库 + download 导出）。
4. MQTT 前端垫片 → 彻底后台化。
5. 编译、分发、README。

> 因架构变大，**阶段 1（MQTT spike）结果会影响后续选型**，建议先实现并回报该 spike 再展开全部。`stoov-test` 全程零改动。

---

## 七、分阶段实施计划（确认后执行）

1. **阶段一：可运行桌面壳**
   - 建目录、写 `main.ts`（静态托管 + `/api/stoov/mqtt-config`）、`desktop.ts`、`deno.json`、`sync-static.ts`（Copy + P1/P2 补丁）。
   - `deno task sync` → `deno run main.ts` 验证页面加载、串口、MQTT 连接、配置来自本地磁盘。
2. **阶段二：编译与分发**
   - `deno task compile` 产出 `bin/stoovTest-desktop.exe`；exe + `static/` + `config/` 一起分发。
   - 写 `README.md`、`build.bat`。
3. **阶段三（可选增强）**
   - D4 原生串口（移植 FFI 桥 + 参数设置弹窗，复用现成模块）；D6 本地化字体；D3 若有需求再实现。

---

## 八、风险与限制

- **`/api/stoov/test-data/download` 无本地数据源**：桌面单机不持有服务器 SQLite，导出 CSV 必然受限（见 D3）。
- **凭据内置**：`mqtt-config.json` 含 broker 账号口令，属敏感项；建议 exe 分发包外单独下发或允许用户改（默认值沿用现网）。
- **Web Serial 浏览器依赖**：需 Edge/Chrome；D4 若走原生串口则不依赖浏览器授权。
- **SW 残留**：若曾用浏览器访问过线上版，本机可能残留旧 SW 缓存——桌面版禁用 SW 后建议提示用户硬刷新一次。
- **免构建兼容**：源码直连依赖浏览器原生 ESM + Web Component；现代 Edge/Chrome 满足，无需 polyfill。

---

## 九、下一步

决策已定（见 §六 / §十）。因本次不是简单打包而是**重架构**（MQTT/串口下沉后台 + 本地 SQLite），建议按 §10.7 从 **MQTT 后端可行性 spike** 开工（npm:mqtt 在 Deno/编译后能否连上 EMQX wss broker）——这是最大不确定性， spike 结果决定后续是否采用前端垫片方案。

需你确认两点后开工：
1. 是否认可“**先做 spike、回报后再全面展开**”的节奏（而不是一次性写全部）。
2. 本地 SQLite 写入时机：保存时“**写本地库 + 同时 MQTT 上云**”两者都要，还是只写本地库？
