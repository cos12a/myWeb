# stoov-test · Stoov 加热垫产线测试台

Stoov Bed 加热垫的浏览器产线测试工具：通过 Web Serial 连接遥控 PCBA / 加热 PCBA，
按测试项自动判定 PASS/FAIL，并把结果通过 MQTT 上报、落库后支持 CSV 导出。
主站托管在 `/stoov-test/`；构建与开发服务器是**纯 Deno、零第三方依赖**。

面向操作员的步骤、判定范围与快捷键见 [`readme.txt`](./readme.txt)（产线使用说明）；
本文面向开发者，说明工程结构、构建流程与接入方式。

## 两种测试模式

页面右上角「船形开关」切换，两套流程共用串口与条码输入：

| 模式 | 目标板 | 检测内容 | MQTT 主题 |
| --- | --- | --- | --- |
| 测试遥控（external） | 遥控 PCBA | ON/OFF、2~12h 时间档、身体 0/36°C、脚部 0/40°C | `/unito/stoov/heating-bed/yaokong` |
| 测试加热（internal） | 加热 PCBA | 设备 ID/版本、故障码、双路温度、双路设置温度、运行状态、时间、四路 ADC 电流 | `/unito/stoov/heating-bed/heating` |

点击「保存」后改发到 `save/` 子主题（`.../save/yaokong`、`.../save/heating`）。
上报载荷：

```json
{
  "mode": "external | internal",
  "barcode": "条码内容",
  "timestamp": "2026-10-21 14:30（Asia/Shanghai）",
  "deviceId": "设备ID（仅 internal）",
  "deviceVer": "版本号（仅 internal）",
  "items": { "1": "ok", "2": "ok" }
}
```

- 条码至少 6 位才会激活「开始测试 / 保存」。
- 电流与温度合格范围可在「⚙ 设置」中修改（默认密码 `1234`），仅存于当前页面会话。
- 串口帧解析由根目录 `serial-protocol.js` 与 `yaokong-wc.js` 提供；
  `index.html` 内联了页面逻辑、样式与状态机。

## 工程结构

```text
stoov-test/
├── index.html          单页应用（内联 CSS/JS，约 4600 行，无打包）
├── serial-protocol.js  串口帧编解码（SerialDataParser / SerialDataAssembler）
├── yaokong-wc.js       遥控面板 Web Component
├── mqtt.min.js         MQTT 客户端（本地副本，避免 CDN 依赖）
├── sw.js               Service Worker（PWA 离线缓存）
├── manifest.json       PWA 清单（构建时按 base 重写）
├── public/             favicon、logo 等静态资源
├── dev.ts              开发静态服务器（:8788，零依赖）
├── build.ts            生产构建（拷贝资源 + 重写 base + 压缩 HTML）
├── readme.txt          产线操作说明
└── dist/               构建产物（gitignore，由 build.ts 生成）
```

## 常用命令

```powershell
cd stoov-test
deno task dev      # http://127.0.0.1:8788/，PORT 可覆盖端口
deno task build    # 生成 dist/
deno task check    # deno check dev.ts build.ts
```

### 构建做了什么

`build.ts` 不做模块打包，按固定顺序生成 `dist/`：

1. 清空并重建 `dist/`（避免残留旧的 vite `assets/`）。
2. 读取 `index.html`，把 `href="/favicon.ico"` 等绝对路径重写到 `STOOV_BASE`，
   再做区域感知压缩：先摘出 `<script>` / `<style>` 整块，只折叠 HTML 区域空白与注释，
   内联 JS/CSS 原样保留（零依赖、不会误伤模板字符串）。
3. 按 `STOOV_BASE` 重写 `manifest.json` 的 `start_url`、`scope`、`icons`。
4. 原样拷贝根目录 `serial-protocol.js`、`yaokong-wc.js`、`mqtt.min.js`、`sw.js`。
5. 拷贝 `public/` 下的文件到 `dist/` 根（与根资源重名时以根版本为准）。

`STOOV_BASE` 默认 `/unito/stoov/bed-test/`，是**生产反向代理前缀**，
与主站路由 `/stoov-test/` 不是同一个东西：

```powershell
# 通过主站预览时，让 favicon / manifest / PWA 作用域也对齐
$env:STOOV_BASE = "/stoov-test/"
deno task build
```

不设置时页面主体仍能工作（脚本引用是相对路径），但 favicon、PWA 安装图标与
Service Worker 作用域会指向生产前缀，控制台会出现 404。生产部署按实际域名前缀设置即可。

## 主站接入

根 `src/index.ts` 将 `/stoov-test/*` 重写到 `stoov-test/dist/`，
`/stoov-test` 与 `/stoov-test/` 都返回 `dist/index.html`。因此：

```powershell
# 仓库根目录
deno task dev
# 浏览器打开
http://127.0.0.1:30000/stoov-test/
```

- 主站只做静态托管，不代理 MQTT（浏览器直连 `wss://`）。
- 页面内的业务接口是生产绝对路径：数据下载 POST `/unito/stoov/heat-bed/test-data/datat-dl`。
  主站保留了对应实现 `/api/stoov/test-data/download`（`src/routes/stoov.ts`），
  本地联调时需要反向代理或临时改前端 URL。
- MQTT 凭据当前在 `index.html` 中是占位符（`__REDACTED_MQTT_USER__` / `__REDACTED_MQTT_PASS__`），
  部署前必须替换为真实值，且不要把真实凭据提交到仓库。
- `public/index.html` 首页「项目开发工具」区提供入口卡片。

## 修改指引

- **新增/调整测试项**：改 `index.html` 中的 `TEST_ITEMS`、判定函数与
  `columns.internal` / `columns.external`（`src/routes/stoov.ts`）保持一致，
  否则导出的 CSV 会缺列。
- **改串口协议**：优先改 `serial-protocol.js`，保持 `SerialDataParser` 的对外方法不变；
  `index.html` 直接依赖其解析结果。
- **改 MQTT 主题**：`index.html` 中有多处模式分支（实时上报、保存上报），需同步修改。
- **改样式**：样式内联在 `index.html` 的 `<style>` 中；构建压缩不会破坏它。
- **升级缓存**：改了 `sw.js` 的 `CACHE_NAME` 或预缓存列表后，记得提升版本号，
  否则已安装的 PWA 可能继续使用旧缓存。

## 排障

| 现象 | 处理 |
| --- | --- |
| 「连接」无反应 | 必须经 HTTP(S) 打开，不能用 `file://`；使用 Chrome/Edge |
| 页面能开但图标/manifest 404 | 构建时 `STOOV_BASE` 与访问前缀不一致，按上文重设后重建 |
| 开始测试按钮灰色 | 条码不足 6 位 |
| 遥控模式某项一直不通过 | 按 OFF→ON 顺序操作；温度需到达 0/36°C、0/40°C 档位 |
| 加热模式电流不通过 | 「⚙ 设置」中的 ADC 范围与产线标准不一致 |
| MQTT 一直重连 | 占位凭据未替换，或网络无法访问 `wss://...:8084/mqtt` |
| 下载 CSV 失败 | 生产接口不可达；本地需代理到 `/api/stoov/test-data/download` |

## 相关文档

- 产线操作步骤：[`readme.txt`](./readme.txt)
- 主站路由与构建：[`PROJECT_GUIDE.md`](../PROJECT_GUIDE.md)、[`ARCHITECTURE.md`](../ARCHITECTURE.md)
- 模块改动指南：[`.agents/skills/stoov-test-console/SKILL.md`](../.agents/skills/stoov-test-console/SKILL.md)
- 同类页面：`stoov-corr/`（校准）、`stoovTest-desktop/`（桌面版，本地 SQLite + 后台 MQTT）
