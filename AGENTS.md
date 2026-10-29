# AGENTS.md · 仓库级协作说明

本文件面向在本仓库工作的编码代理与新加入的开发者，给出**全局约束、命令入口和改动流程**。
模块级细节不要写在这里：先看 `.agents/skills/README.md` 的索引，再读对应模块的
`SKILL.md` 与该目录的 `README.md`。

## 1. 仓库定位

物联网设备调试与数据采集项目集合，四类产物：

| 类别 | 目录 | 部署形态 |
| --- | --- | --- |
| 统一主站 | `src/`、`public/`、`scripts/` | Deno 2 + Hono，默认 `127.0.0.1:30000` |
| 浏览器工具 | `stoov-test/`、`stoov-corr/`、`InstrumentTestLit/`、`ws8623Demo/`、`stm32WebFlasher/`、`webSerialPlotter/`、`i2c_web_tool/`、`usb-test/` | 由主站按 URL 前缀托管 |
| 桌面封装 | `deno-desktop/`、`stoovTest-desktop/`、`stm32WebFlasher-desktop/` | `deno compile` 单 exe + `static/` |
| 数据后端 | `bun-mqtt-backend/`、`go-mqtt-backend/`、`rust-mqtt-backend/` | 独立部署，MQTT → InfluxDB |

主站只是**静态资源聚合器 + 轻量 API**，不构建前端，也不启动桌面/后端进程。

## 2. 命令入口

```powershell
# 仓库根目录
deno task dev            # 主站（HOST/PORT 可覆盖），浏览器访问 http://127.0.0.1:30000/
deno task check          # 主站类型检查
deno task test           # 主站单测（test/stoov.test.ts）
bun run build            # 串行构建全部主站前端子项目
bun run build:parallel   # 并行构建（scripts/build-all.ts）
bun run install:all      # 安装各子项目依赖
```

工具链边界（不要混用）：

- **Deno**：主站、`stoov-test`、`i2c_web_tool` 的构建、全部 `*-desktop`。
- **Bun**：`InstrumentTestLit`、`stm32WebFlasher`、`webSerialPlotter` 的安装与构建。
- **Node.js 22+**：`stoov-corr` 的 Node-RED 流程校验脚本（`node:sqlite`）。
- **Go 1.22+ / Rust stable**：各自 MQTT 后端，不参与根构建。

## 3. 主站路由与新增子项目

路由集中在 `src/index.ts`，统一模式是 `serveStatic` + `rewriteRequestPath`：

```ts
// 相对 base 的子项目：重定向必须注册在 /prefix/* 之前
app.get("/prefix", (c) => c.redirect("/prefix/"));
app.use("/prefix/*", serveStatic({
  root: "./",
  rewriteRequestPath: (path) => path.replace(/^\/prefix/, "/实际目录/dist"),
}));
app.get("/prefix/", serveStatic({ path: "./实际目录/dist/index.html" }));
```

新增一个浏览器工具时，按顺序完成：

1. `src/index.ts` 增加路由；相对 base 的子项目先注册 `app.get("/prefix", ...redirect)`，
   再注册 `/prefix/*`（否则 serveStatic 会抢先返回 index.html，无尾斜杠访问白屏）。
2. `public/index.html` 首页 `.pieces` 作品卡区加卡片，并在 `public/js/i18n.js` 七种语言里补齐文案；
   hero 右侧 3×3 核心入口网格保留，不要挤占或删减。
3. 根 `package.json` 增加 `build:<name>` 并串进 `build`；`scripts/build-all.ts` 的
   `projects` 增加条目（Deno 项目显式写 `install: "deno"`）。
4. `README.md`、`PROJECT_GUIDE.md`、`ARCHITECTURE.md` 同步路由表、结构树、构建链。
5. 子项目 `README.md` + `.agents/skills/<name>/SKILL.md`，并在 Skill 索引登记。

Vite 子项目的 `base` 决定部署方式：

- `base: "/WebSerialPlotter/"` 这类绝对 base 只能挂在同名前缀下，路径大小写不可改。
- `base: "./"`（`i2c_web_tool`）同一份产物既能独立根路径运行，也能挂子路径，
  但**必须带尾斜杠访问**，否则相对资源会解析到站点根。

## 4. 浏览器硬件 API 约束

- Web Serial / Web Bluetooth / WebUSB 只支持 Chromium 系浏览器，且需要安全上下文
  （`https://` 或 `localhost`/`127.0.0.1`）。
- `requestPort()` / `requestDevice()` 必须由用户点击手势触发，不能在 `useEffect` 或
  页面加载时调用。
- 读循环、断开顺序、端口占用是最高频故障点；改动前先读对应 Skill 的「常见坑」。
- 硬件相关改动无法用单测覆盖，交付时写清实测条件：板子、端口、固件、命令、结果。

## 5. 构建与产物

- `dist/`、`bin/`、`node_modules/`、`data/`、`.env*` 均不入库；不要手改 `dist/`。
- 桌面项目的 `static/` 是 `deno task sync` 生成物，改上游后重新同步，不要直接改副本。
- `stoov-test` 的 `STOOV_BASE`（默认 `/unito/stoov/bed-test/`）是**生产反代前缀**，
  与主站 `/stoov-test/` 不是同一个；通过主站预览且需要图标/PWA 正确时显式设置。
- 修改前端资源后，若页面仍显示旧内容，先检查 Service Worker 缓存与 `?v=` 版本号。

## 6. 文档与 Skill 维护

- 每个有独立构建/运行方式的目录必须有 `README.md`（做什么、怎么跑、结构、排障）。
- 每个模块在 `.agents/skills/<kebab-case>/SKILL.md` 有一份**改动指南**，
  frontmatter 只写 `name` 与 `description`，正文写架构、命令、数据流、扩展步骤、坑。
- Skill 索引：`.agents/skills/README.md`；新增/删除 Skill 必须同时更新索引与相关 README 链接。
- 文档语言为中文；路径、命令、UUID、主题名保持原样，不翻译。
- 不写未验证的结论；硬件时序与协议常量以源码和实测为准。

## 7. 安全与提交

- 绝不提交真实 MQTT/InfluxDB 凭据；源码中的 `__REDACTED_*__` 是占位符，部署时用环境变量注入。
- 不提交固件二进制、设备日志、数据库文件。
- 不执行破坏性 git 操作（`push --force`、`reset --hard`）；不回滚用户未提交的改动。
- 提交信息用简短祈使句，一次提交只做一件事。
- AI 产生的提交需同步到全部已配置远程：公共改动先推公开镜像，再合并进私有备份分支推送；
  入库边界、顺序与校验见私有备份分支的 `GIT_REMOTE_WORKFLOW.md` 与
  `.agents/skills/git-remote-branches/SKILL.md`（这两个文件不在主分支，需切到私有分支查看）。

## 8. 最低验证清单

```powershell
deno task check
deno task test
bun run build
# 启动主站后逐个确认关键路由 200：
# /、/stoov-test/、/instrument/、/stm32flasher/、/WebSerialPlotter/、/i2c/、/usb-test/
```
