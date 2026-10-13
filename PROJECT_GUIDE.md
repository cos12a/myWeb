# 项目完整说明

本仓库是一个物联网学习、设备调试和数据采集项目集合。根目录服务负责提供统一主页、API 和若干浏览器工具；其他子目录包含可单独运行的 Web 工具、桌面封装，以及多种 MQTT 数据后端实现。

> 根目录主站现由 **Deno 2 + Hono** 提供服务。Bun、Go、Rust 等运行时仍用于各自的子项目，不代表它们都属于主站的运行依赖。

## 1. 从哪里开始

| 目标 | 推荐入口 |
| --- | --- |
| 启动统一主页及其工具 | 根目录 `deno task dev` |
| 构建主页托管的前端子项目 | 根目录 `bun run build` |
| 开发某一个前端 | 进入对应子目录，按本指南的命令运行 |
| 构建 Windows 桌面串口/烧录工具 | `stm32WebFlasher-desktop` 或 `stoovTest-desktop` |
| 运行 IoT MQTT 数据采集管道 | 选择 `bun-mqtt-backend`、`go-mqtt-backend` 或 `rust-mqtt-backend` 中一个 |

根目录主页的开发、API 和部署说明另见 [README.md](./README.md)。

## 2. 总体结构

```text
根目录 Deno + Hono 服务
├── public/                         主页、PWA 文件与通用静态资源
├── stoov-test/                     Web 加热垫测试台
├── stoov-corr/                     加热垫校准控制面板
├── InstrumentTestLit/              BLE 仪器实时测量面板
├── ws8623Demo/                     WS8623 BLE 演示页面
├── stm32WebFlasher/                浏览器 STM32 烧录器
├── webSerialPlotter/               浏览器串口绘图器
└── usb-test/                       WebUSB 调试页面

桌面封装（独立项目）
├── deno-desktop/                   主页服务的桌面分发尝试/快照
├── stoovTest-desktop/              加热垫测试台桌面版
└── stm32WebFlasher-desktop/        STM32 烧录器桌面版

设备数据后端（独立部署）
├── bun-mqtt-backend/               MQTT → InfluxDB，Bun 实现
├── go-mqtt-backend/                MQTT → InfluxDB，Go 实现
└── rust-mqtt-backend/              MQTT → InfluxDB，Rust 实现
```

根目录 `src/index.ts` 将路径映射到各目录的静态资源。桌面项目和 MQTT 后端不由主站自动启动，也不包含在根目录 `bun run build` 中。

## 3. 根目录主站和页面路由

主站入口为 `src/index.ts`，路由/API 位于 `src/routes/`，健康检查位于 `src/health/`。默认监听 `127.0.0.1:30000`，用 `HOST`、`PORT` 可覆盖。静态文件按仓库根目录相对路径读取，因此直接运行主站时应将工作目录设为仓库根目录。

| URL | 文件来源 | 说明 |
| --- | --- | --- |
| `/` 及主页静态资源 | `public/` | IoT 主页、PWA 文件；未匹配页面路由回退至 `public/index.html` |
| `/api/iot-data` | `src/routes/api.ts` | 随机生成的演示传感器数据，不是实际设备数据 |
| `/health`、`/health/db` | `src/health/` | 进程存活与 SQLite 数据库健康检查 |
| `/api/stoov/mqtt-config` | `src/routes/stoov.ts` | 返回 Web 测试台所需 MQTT 连接配置 |
| `/api/stoov/test-data/download` | `src/routes/stoov.ts` | 从 SQLite 测试库导出 CSV |
| `/stoov-test/` | `stoov-test/dist/` | Web 加热垫测试台 |
| `/stoov-corr/` | `stoov-corr/` | 校准控制面板 |
| `/instrument/` | `InstrumentTestLit/dist/` | Web Bluetooth 仪器面板 |
| `/ws8623/` | `ws8623Demo/` | WS8623 BLE 测试页面 |
| `/stm32flasher/` | `stm32WebFlasher/dist/` | Web Serial STM32 烧录工具 |
| `/WebSerialPlotter/` | `webSerialPlotter/dist/` | 实时串口绘图；路径大小写不可更改 |
| `/usb-test/` | `usb-test/` | WebUSB 设备通信页面 |

运行时环境变量：

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `HOST`、`PORT` | 监听地址和端口 | `127.0.0.1`、`30000` |
| `STOOV_DB_DIR` | `yaokong.db`、`Heating.db` 所在目录 | `/home/yzluo/unito/sqlit-db/stoov-bed` |
| `STOOV_MQTT_URL` | Stoov MQTT Broker 地址 | 代码内演示 Broker |
| `STOOV_MQTT_USER`、`STOOV_MQTT_PASS` | Stoov MQTT 登录信息 | 代码内兼容默认值 |

生产环境应通过环境变量提供 MQTT 凭证，并限制数据库目录的文件访问权限。服务需要 Deno 的网络、静态文件读取和环境变量权限；权限由根目录 `deno.json` 的任务参数明确授予。SQLite 通过 Deno 的 `node:sqlite` 兼容接口读库。

## 4. 浏览器工具子项目

### 4.1 `stoov-test`：加热垫 Web 测试台

- **用途**：在浏览器中进行加热垫测试，包含串口通信及 MQTT 数据上报相关页面逻辑。
- **技术**：原生 HTML/JavaScript，项目自身为纯 Deno 工程；无需 Bun/Vite 打包。
- **运行**：`cd stoov-test` 后运行 `deno task dev`。
- **构建**：`deno task build`，根目录统一构建时由 `bun run build` 调用。
- **检查**：`deno task check`。
- **产物**：`dist/`，由根目录主站映射到 `/stoov-test/`。

### 4.2 `stoov-corr`：校准控制面板

- **用途**：加热垫校准/控制页面，按原生静态文件提供；可由根目录主站访问 `/stoov-corr/`。
- **技术**：原生 HTML/JavaScript 及项目内静态脚本。
- **运行**：通过根目录 `deno task dev` 提供。也可用任意仅绑定本机的静态文件服务预览。
- **构建**：没有纳入根目录子项目构建任务；编辑后由根目录服务直接读取文件。

### 4.3 `InstrumentTestLit`：BLE 测量面板

- **用途**：显示总线电压、分流电压、电流和功率等测量参数，通过 Web Bluetooth 与 Nordic UART Service 设备通信。
- **技术**：Lit、TypeScript、Bun bundler。
- **开发**：`cd InstrumentTestLit`，先 `bun install`，再运行 `bun run dev`。
- **构建**：`bun run build`；可用 `bun run typecheck` 做类型检查。
- **访问**：由根目录主站提供 `/instrument/`。

### 4.4 `ws8623Demo`：WS8623 BLE 示例

- **用途**：WS8623 蓝牙设备的演示/测试页面。
- **技术**：原生 HTML/JavaScript，目录内也有 Node `server.js`。
- **访问**：由根目录主站提供 `/ws8623/`。需要单独预览时，先阅读其 `server.js` 配置，避免和根服务端口冲突。

### 4.5 `stm32WebFlasher`：浏览器 STM32 烧录工具

- **用途**：通过 STM32 USART Bootloader 和 Web Serial 烧录 `.hex`/`.bin` 固件，提供擦除、写入、校验等流程；仓库也包含 CLI。
- **技术**：Vite、Web Serial；另有 Node CLI。
- **开发**：`cd stm32WebFlasher`，`bun install` 后运行 `bun run dev`。
- **构建/测试**：`bun run build`、`bun test`；CLI 参数见该目录 README，可用 `bun run cli -- --help` 查看。
- **访问**：主站 `/stm32flasher/`，静态文件取自 `dist/`。
- **限制**：浏览器烧录需 Chromium 系浏览器和安全上下文（HTTPS 或 localhost）。

### 4.6 `webSerialPlotter`：串口实时绘图器

- **用途**：浏览器串口数据绘图、统计、命令控制台和 CSV/PNG 导出。
- **技术**：React、TypeScript、Vite、Web Serial。
- **开发**：`cd webSerialPlotter`，`bun install` 后运行 `bun run dev`。
- **构建/验证**：`bun run build`、`bun run test`、`bun run lint`。
- **访问**：主站 `/WebSerialPlotter/`。Vite 的部署 base 使用此大小写路径，不能擅自改大小写或挂载前缀。
- **设备示例**：`example_firmware/` 内包含基础绘图器固件示例。

### 4.7 `usb-test`：WebUSB 调试页

- **用途**：发现 USB 设备、声明接口，向端点发送并接收文本/HEX/字节数据。
- **技术**：原生 HTML/CSS/JavaScript、WebUSB API。
- **访问**：主站 `/usb-test/`。
- **限制**：使用 Chrome/Edge 等支持 WebUSB 的浏览器，并通过 HTTPS 或 localhost 访问；浏览器会要求用户主动授权设备。

## 5. 桌面应用子项目

桌面版是独立的 Deno 服务/可执行文件，不是根目录服务的自动模式。涉及串口 FFI 的桌面程序面向 Windows；更新上游 Web 页面后，先运行对应 `sync` 任务再编译。`static/` 多为同步生成目录，应修改源项目或 overlay，不要把同步生成物当作源文件维护。

### 5.1 `stm32WebFlasher-desktop`

- **用途**：`stm32WebFlasher` 的 Windows 桌面封装；本地 Deno 服务提供页面、默认固件和原生串口桥，并在就绪后打开浏览器。
- **关键实现**：`serial-ffi.ts` 调用 Win32 `kernel32.dll`；页面通过 WebSocket `/ws/serial` 与后端通信。
- **同步资源**：`deno task sync` 从相邻 `stm32WebFlasher/` 复制页面、脚本和固件至 `static/` 并应用桌面补丁。
- **运行/编译/检查**：`deno task desktop`、`deno task compile`、`deno task check`。
- **分发**：将 `bin/stm32WebFlasher-desktop.exe` 与 `static/` 一起打包。
- **资源源路径**：默认查找相邻 `stm32WebFlasher/`；可通过 `STM32_WEB_FLASHER_SOURCE` 覆盖。

### 5.2 `stoovTest-desktop`

- **用途**：`stoov-test` 的桌面版。除前端外，还提供本地 SQLite 保存/CSV 导出、后台 MQTT 和桌面原生串口桥。
- **同步资源**：`deno task sync` 从 `../stoov-test` 复制资源并施加桌面兼容补丁。
- **运行/编译/检查**：`deno task start`、`deno task compile`、`deno task check`。
- **数据**：本机 SQLite 默认写入该项目的 `data/`；配置、端口及资源目录可通过项目文档列出的环境变量覆盖。
- **分发**：除可执行文件外，还需要打包 `static/` 和 `config/`。
- **详细说明**：见 [`stoovTest-desktop/README.md`](./stoovTest-desktop/README.md)、[`IMPLEMENTATION.md`](./stoovTest-desktop/IMPLEMENTATION.md)。

### 5.3 `deno-desktop`

- **用途**：用 `deno compile` 打包一个本地 Hono 静态服务并尝试自动打开浏览器。
- **注意**：它携带自己的 `static/` 内容，是一份桌面场景快照，不会自动随根目录源码同步；数据库下载与 `/health/db` 等功能和当前主站可能不一致。需要维护主站功能时应以根目录 `src/` 为准，再明确同步桌面快照。
- **运行/构建**：`deno task dev`、`deno task compile`，或 Linux/macOS 使用 `./build.sh`。
- **分发**：可执行文件与同级 `static/` 目录需一起提供。
- **详细说明**：见 [`deno-desktop/README.md`](./deno-desktop/README.md)。

## 6. MQTT → InfluxDB 后端

下面三个是同一类传感器数据管道的不同语言实现，通常按部署需求选择其一。它们订阅 MQTT 消息，做数据规范化/去重后写入 InfluxDB 2.x。桌面 Stoov 应用中的本地 MQTT 功能是另一条独立链路。

| 项目 | 技术 | 本地运行/测试 | 端口/说明 |
| --- | --- | --- | --- |
| `bun-mqtt-backend` | Bun、MQTT.js、InfluxDB client、Zod、Pino | `bun install`；配置 `.env`；`bun run start`；`bun run test` | 健康端点默认 `9000`；详细部署见 `PLATFORM.md` |
| `go-mqtt-backend` | Go、Paho MQTT、InfluxDB client、zap | `make tidy`、配置 `.env`、`make run`、`make test` | 健康端点默认 `9002`；用 `USAGE.md`/`DEPLOY.md` |
| `rust-mqtt-backend` | Rust、rumqttc、axum、InfluxDB HTTP client | `cargo run -- --env-file=.env`、`cargo test` | 健康端点默认 `9004`；用 `USAGE.md`/`DEPLOY.md` |

这些服务需要可用的 MQTT Broker 和 InfluxDB，并需在本地 `.env`/环境变量中配置地址、账号、令牌和 bucket。使用各自的 `.env.example`，不要将真实密钥提交到 Git。版本对照、数据规则、systemd 部署和故障排查以各子项目自己的文档为准。

## 7. 构建、测试和部署流程

### 主站与主页静态子项目

```bash
# 从仓库根目录执行
deno task check
deno task test
bun install
bun run build
deno task start
```

`bun run build` 依次构建 `stoov-test`（调用 Deno）、`InstrumentTestLit`、`stm32WebFlasher` 和 `webSerialPlotter`。若希望并行构建，可运行 `bun run build:parallel`。它不会构建三个桌面封装或 MQTT 后端。

生产服务默认只监听本机回环地址，应由 Nginx/Caddy 代理并配置 HTTPS。systemd 的工作目录应指向仓库根目录；更新主站托管页面时，先完成上面的构建，再重启根目录 Deno 服务。

### 单独构建桌面程序

```bash
cd stm32WebFlasher-desktop
deno task sync
deno task check
deno task compile
```

`stoovTest-desktop` 流程相同：进入目录后运行 `deno task sync`、`deno task check`、`deno task compile`。桌面程序使用 FFI 时，要遵循 Deno `--allow-ffi` 权限提示及操作系统限制。

## 8. 文档、配置与维护边界

- **主站 Deno 任务**：根目录 `deno.json`；主站入口与 API：`src/`。
- **根目录构建流程**：根 `package.json` 与 `scripts/build-all.ts`。
- **网页工具源代码**：分别位于其项目目录；主站读取它们的 `dist/` 或静态源文件。
- **桌面生成资源**：`*-desktop/static/` 是同步副本；使用 `sync` 更新，不直接修改后期待更改回流上游。
- **运行时数据和编译产物**：如 `data/`、`bin/`、`dist/`、`node_modules/` 按各子项目约定生成，不作为源码入口。
- **`test/`**：根主站的 Deno 路由测试及历史数据库检查脚本。
- **`out/`**：测试/演示图片等输出文件，不是运行服务所需代码。
- **`esp-tool/`**：当前目录未发现可运行的项目配置或源文件；如后续加入工具，再补充其独立说明和入口。

## 9. 浏览器与硬件使用注意

1. Web Serial、Web Bluetooth、WebUSB 都受浏览器权限与安全上下文限制；面向局域网/公网的正式域名请配置 HTTPS。
2. 浏览器硬件 API 通常要求用户通过页面操作触发设备授权；桌面版的 FFI 串口桥行为不同，且通常限定 Windows。
3. 不同测试台之间共享页面静态资源不等于共享本地数据库或 MQTT 会话。查看对应项目配置确认数据实际写入位置。
4. 部署主页时要同时保留各路由所需的目录和构建产物；缺少某个子项目目录时，仅该路由可能无法正常提供页面。
5. 修改 API、静态路由或运行权限时，需同时检查根 Deno 任务配置、README 部署步骤和桌面快照是否需要同步。
