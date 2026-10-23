# stoovTest-desktop

将 `stoov-test`（纯前端加热垫测试台）做成 **Deno 桌面版**：单可执行文件 = 本地服务 + 自动弹出浏览器界面。
`stoov-test` 原项目**零改动**，桌面所需文件每次由 `deno task sync` 单向拷贝进 `static/` 并自动打补丁。

## 与网页版的关键差异（按既定决策重架构）

| 能力 | 网页版（stoov-test） | 桌面版（本项目） |
| --- | --- | --- |
| 串口 | 浏览器 Web Serial | **Win32 原生串口**（FFI 桥 `/ws/serial`），带**参数设置弹窗** |
| MQTT | 浏览器直连 broker（wss） | **后台原生 MQTT**（`npm:mqtt` 持有 broker 连接），前端经 `/ws/mqtt` 垫片，UI 与 broker 解耦 |
| 测试结果保存 | 仅 MQTT 上云 | **写本地 SQLite + 同时 MQTT 上云**（后台中继拦截 save 主题落库，单次 publish 两者都要） |
| 数据下载 | 后端读服务器 SQLite | **从本地 SQLite 导出 CSV 另存** |
| MQTT 配置 | 后端接口硬编码 | **本地磁盘 JSON**（`config/mqtt-config.json`，可回退内置默认） |
| 字体 / PWA SW | Google Fonts 外链 / SW 缓存 | 离线（移除外链、禁用 SW） |

## 架构

```
浏览器 UI (static/)                         Deno 后台 (exe)
  main.js ── navigator.serial ──X            （原生串口改为↓）
        │  requestNativeSerialPort() ═══ WS /ws/serial ═══> serial-bridge.ts -> serial-ffi.ts (kernel32)
        │
        │  mqtt.connect() (垫片) ══════ WS /ws/mqtt ══════> mqtt-backend.ts ──原生──> EMQX broker
        │                                                       │ save 主题
        │                                                       └──> sqlite-store.ts (node:sqlite)
        └─ fetch /api/stoov/mqtt-config ──────────────────────> 读 config/mqtt-config.json
           POST /api/stoov/test-data/download ───────────────> 本地库导出 CSV
```

- 前端只当 UI；**串口、MQTT、存储都在后台**，与原 stoov-test 的 `main.js`/`index.html` 近乎零改动衔接（靠兼容层 + 同名 API 垫片 + sync 补丁）。

## 目录

```
stoovTest-desktop/
├─ main.ts              本地服务 + 各端点 + 启动后台 MQTT/存储
├─ desktop.ts           启动器：等待就绪后打开默认浏览器
├─ serial-ffi.ts        Win32 kernel32 原生串口（复用自 stm32WebFlasher-desktop）
├─ serial-bridge.ts     /ws/serial 串口桥 + /api/serial/ports
├─ mqtt-backend.ts      后台原生 MQTT + /ws/mqtt 中继 + save 拦截入库
├─ sqlite-store.ts      node:sqlite 建库/写入/查询/CSV
├─ sync-static.ts       从 stoov-test 拷文件进 static/ 并打桌面补丁
├─ config/mqtt-config.json   本地磁盘 MQTT 配置
├─ overlay/            桌面专属前端（拷进 static/）
│  ├─ native-serial-transport.js   /ws/serial 传输层
│  ├─ native-serial-dialog.js      串口参数设置弹窗
│  ├─ native-serial-webcompat.js   Web Serial 形状兼容端口（open/close/readable/writable）
│  └─ native-mqtt-shim.js          同名 API 的 mqtt 垫片
├─ static/             sync 生成（勿手改，被覆盖）
├─ bin/                编译产物 exe
└─ data/               本地 SQLite（运行时生成，exe 版落在 exe 同级）
```

## 使用

```bash
deno task sync      # 从 ../stoov-test 拷资源 + 打补丁到 static/
deno task check     # 类型检查全部后端模块
deno task start     # 开发运行（自动打开浏览器，默认 http://127.0.0.1:30077/）
deno task compile   # 产出 bin/stoovTest-desktop.exe
```

> **端口说明**：默认 30077（避开根 Bun 服务与 deno-desktop 共用的 30000）。若默认端口被占用，
> 服务会自动 +1 递增重试（最多 100 次）并打印告警；连续 100 个端口全被占用才报错退出。
> 启动器 `desktop.ts` 会从已绑定的 `server.addr` 取真实端口打开浏览器，并校验 `/health` 应答带
> 专属标记头 `X-Stoov-Desktop`，避免端口被别的应用占用时误弹对方页面。可用 `PORT=` 强制指定。

编译分发：把 `bin/stoovTest-desktop.exe` + 同级 `static/` + `config/` 一起打包
（exe 会优先用 `../static`、`../config`；`PORT`/`HOST`/`STOOV_DESKTOP_ROOT`/`STOOV_MQTT_CONFIG`/`STOOV_DESKTOP_DATA_DIR` 可覆盖）。

## 串口兼容层原理

`main.js` 原按 Web Serial 形状使用端口（`port.open/readable/writable/close`）。桌面版把
`navigator.serial.requestPort()` 换成 `requestNativeSerialPort()`：弹出参数设置窗 → 点确定即经 `/ws/serial`
真正打开原生串口 → 返回一个把已打开传输层包装成 `readable/writable` 流的兼容端口对象，于是原有读写循环零改动。
打开失败时弹窗不关闭、显示原因，可重试或取消。

## 数据与隐私

- 测试结果写入本地 `data/stoov-desktop.db`（表 `data_table` / `heating_data`，字段与线上服务端一致）。
- 「下载数据」直接读本地库导出 CSV，无需任何远程服务器。
- 上云走后台 MQTT；断开网络时本机测试与导出仍可用（仅上云受影响）。

## 验证状态

`sync` 全锚点命中、`deno check` 通过、起服务端到端（`/ws/mqtt` 发布 save 主题 → broker 回执 ok 且本地库命中、CSV 导出正确）、`deno compile` 出的 exe 自包含运行（health / 配置 / 串口枚举均正常）。真机串口收发已走查通过（COM6，器件ID/版本/周期数据实时解析，Console 零报错）。

> 2026-09-29 上游更新适配：stoov-test 已把应用逻辑从 src/main.js 整段内联进 index.html，桌面串口/PWA 补丁已全部重新锁定到 index.html 内联块并浏览器实测生效。

> 2026-09-29 上游转纯 Deno + 桌面同步优化：stoov-test 已从 npm/bun/pnpm+Vite 迁移为纯 Deno 工程（index.html 零改动，14 锚点仍全中）；src/main.js 等上游 `src/` 已确认不被 index.html 加载，sync 不再拷贝它（改为重建前清空 static/src），并移除了失效的 install.js 整文件置换。同步修正 `main.ts` 静态根判据：由 `index.html + src/main.js` 改为 `index.html + native-mqtt-shim.js`（否则停拷 src/ 会导致静态根定位失败）。

> 完整实现过程、补丁清单、验证记录与踩坑总结见 [IMPLEMENTATION.md](./IMPLEMENTATION.md)；前期勘察与决策依据见 [DESKTOP_EVALUATION.md](./DESKTOP_EVALUATION.md)。

## 模块改动指南

静态根解析、`sync-static.ts` 锚点补丁、`/ws/serial` 与 `/ws/mqtt` 的实现约束见
[`.agents/skills/desktop-serial-bridge/SKILL.md`](../.agents/skills/desktop-serial-bridge/SKILL.md)。
