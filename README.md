# 物联网学习和展示

基于 Deno 和 Hono 构建的物联网学习与展示项目，用于托管静态页面，并提供一组模拟的 IoT 实时数据接口。

## 技术栈

- [Deno](https://deno.com/)：主站服务运行时与 TypeScript 工具
- [Hono](https://hono.dev/)：轻量级 Web 框架
- TypeScript：服务端类型安全开发
- PWA：通过 `manifest.json` 提供可安装的渐进式 Web 应用配置
- Bun：仅用于构建仍使用 Bun 的前端子项目和运行构建编排脚本

## 环境要求

- Deno 2.x（运行主站）
- Bun 1.x（构建前端子项目）
- Windows、macOS 或 Linux

可以使用以下命令确认运行环境是否已安装：

```bash
deno --version
bun --version
```

## 安装与运行

主站依赖由 Deno 根据 `deno.json` 自动解析并缓存，无需单独安装。可运行以下命令检查代码：

```bash
deno task check
```

开发模式会在文件变化后自动重载，默认监听 `127.0.0.1:30000`：

```bash
deno task dev
```

生产模式启动服务：

```bash
deno task start
```

如需修改监听地址或端口，可以设置 `HOST` 和 `PORT` 环境变量。Linux/macOS 示例：

```bash
HOST=127.0.0.1 PORT=8080 deno task dev
```

Windows PowerShell 示例：

```powershell
$env:HOST = "127.0.0.1"
$env:PORT = "8080"
deno task dev
```

服务通过 Deno 权限标志读取静态文件和环境变量，并监听 HTTP 端口；SQLite 使用 Deno 支持的 `node:sqlite` 兼容接口。

## API

### 获取 IoT 模拟数据

```http
GET /api/iot-data
```

示例响应：

```json
{
  "temperature": "24.3",
  "humidity": 63,
  "onlineDevices": 7,
  "totalDevices": 8,
  "apiCalls": 1234,
  "sensorId": "Node-01",
  "updatedAt": "14:30"
}
```

接口当前返回随机生成的演示数据，真实数据源（MQTT、Redis 或数据库）尚未接入。

## 项目结构

仓库包含主站、多个浏览器工具、桌面封装和 MQTT 数据后端。各子项目用途、运行命令、路由与构建/部署流程见[项目完整说明](./PROJECT_GUIDE.md)。

```text
.
├── index.ts              # Bun 默认入口，目前为简单示例
├── src/
│   ├── index.ts          # Hono 应用入口、静态资源和 SPA 兜底
│   └── routes/
│       └── api.ts        # API 路由
├── public/
│   ├── index.html        # IoT 展示页面
│   ├── manifest.json     # PWA 配置
│   └── sw.js             # Service Worker
├── stoov-test/           # 加热垫 Web 测试台（Deno）
├── stoov-corr/           # 校准控制面板（静态页面）
├── InstrumentTestLit/    # BLE 仪器测量面板（Lit）
├── stm32WebFlasher/      # STM32 Web 烧录工具
├── webSerialPlotter/     # Web 串口绘图器
├── usb-test/             # WebUSB 调试页面
├── *-desktop/            # Deno 桌面封装
├── *-mqtt-backend/       # Bun/Go/Rust MQTT 后端
├── deno.json              # Deno 任务、权限相关命令和 Hono 导入映射
├── package.json
└── tsconfig.json
```

## 路由行为

- `/api/*`：由 Hono API 路由处理。
- `/stoov-test/*`：托管 `stoov-test/dist`，部署前通过 `bun run build` 构建（stoov-test 已迁移为纯 Deno 工程，实际执行 `deno task build`）。
- `/stoov-corr/*`：托管 `stoov-corr` 中的原生静态页面和资源。
- `/instrument/*`、`/ws8623/*`、`/stm32flasher/*`、`/WebSerialPlotter/*`、`/usb-test/*`：分别托管对应的 BLE、STM32、串口绘图和 USB 子项目；构建与独立运行方式见[项目完整说明](./PROJECT_GUIDE.md)。
- 其他静态资源：从 `public` 目录提供。
- 未匹配的页面路径：回退到 `public/index.html`，支持单页应用访问。

## 构建和部署

主站代码检查和测试：

```bash
deno task check
deno task test
```

构建前端子项目仍使用 Bun（其中 `stoov-test` 自身使用 Deno）：

```bash
bun install
bun run build
```

### 云服务器部署（Linux）

服务器需要安装 Deno、Bun 和 Git，并开放云平台安全组和系统防火墙的 `30000` 端口。Bun 仅用于在服务器构建前端子项目；也可以在其他机器构建后将构建产物一同部署。首次部署：

```bash
git clone git@github.com:cos12a/myWeb.git
cd myWeb
bun install
bun run build
HOST=127.0.0.1 PORT=30000 deno task start
```

通过 Nginx/Caddy 反向代理验证访问（将域名替换为自己的站点域名）：

```text
http://你的域名/
http://你的域名/stoov-test/
http://你的域名/stoov-corr/
```

默认仅监听 `127.0.0.1:30000`，不直接接受公网连接。生产环境建议使用 systemd 保持 Deno 服务运行，并使用 Nginx/Caddy 反向代理到该地址，再配置 HTTPS。将现有服务配置中的 Bun 启动命令改为 `deno task start`，并确保 `WorkingDirectory` 指向项目根目录。若确需直接从公网访问服务，可将 `HOST` 设为 `0.0.0.0`，并自行配置防火墙。代码更新后重新执行：

```bash
git pull
bun install
bun run build
sudo systemctl restart mywebbun
```

`bun run build` 会进入 `stoov-test` 执行 `deno task build`（纯 Deno 零依赖：拷贝运行时资源 + 轻量压缩 index.html），其余子项目走各自 Bun 构建；服务器启动后，两个工具分别通过以下地址访问：

- `http://localhost:30000/stoov-test/`
- `http://localhost:30000/stoov-corr/`

部署服务器时需要同时上传主项目、`stoov-test` 和 `stoov-corr` 目录，并在启动服务前执行一次构建。

## 开发说明

主要服务入口是 `src/index.ts`，Deno 的 `dev` 和 `start` 任务定义在根目录 `deno.json`；`package.json` 中对应脚本转发到这些 Deno 任务。新增接口时，可以在 `src/routes/api.ts` 中扩展路由；接入真实设备数据时，应替换 `/api/iot-data` 中的随机数据生成逻辑。
