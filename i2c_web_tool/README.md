# I²C Web Tool

在浏览器里直接操作 I²C 总线：通过 **Web Serial** 或 **Web Bluetooth（BLE NUS 串口）**
连接运行 ESP32-Bus-Pirate 固件的设备，用 LWPKT 帧协议完成 I²C 引脚/频率设置、扫描、
寄存器读写、EEPROM、CH224A PD 取电、MLX90614 测温与 LIS3DH 三轴加速度。Deno + Hono 只负责托管静态资源，
硬件访问全部发生在浏览器端。

- 无本地服务、无 DLL、无 FFI：打开网页即可用。
- 串口与蓝牙共用同一套 `ByteTransport` 抽象与 `TransportManager` 互斥管理，
  后续增加 WebUSB 不需要改 LWPKT 后端、器件控制器或页面。
- 协议与 `i2c_dev_desktop` 的串口后端完全一致（LWPKT 金帧已用测试固定）。
- 支持 Chrome / Edge 等 Chromium 内核浏览器（Web Serial / Web Bluetooth 尚未进入 Firefox / Safari）。

## 文档与 Skill

- [Web串口I2C-操作说明](./Web串口I2C-操作说明.md)：串口/蓝牙授权、连接、各页面操作与故障排查。
- [Web串口I2C-程序设计说明](./Web串口I2C-程序设计说明.md)：分层架构、传输抽象、LWPKT 协议、异步请求-应答、测试与扩展。
- [docs/TRANSPORT_MODULES.md](./docs/TRANSPORT_MODULES.md)：传输模块说明（接口契约、互斥、BLE NUS、WebUSB 扩展点）。
- [docs/PROGRAM_FLOW.md](./docs/PROGRAM_FLOW.md)：程序流程（启动、授权、连接握手、请求-应答、断开、状态机）。
- [docs/I2C_BUS_CONFIG.md](./docs/I2C_BUS_CONFIG.md)：I²C 引脚/频率设置协议（CONFIG / CAPS / BUS_SELECT / SWAP / RECOVER）与固件实现指南。
- [docs/ESP32_FIRMWARE_PROTOCOL.md](./docs/ESP32_FIRMWARE_PROTOCOL.md)：ESP32 CAPS v2 能力/引脚上报纸质协议指引（字节布局、金帧、固件实现与验收）。
- [docs/ESP32-I2C-PINMAP.md](./docs/ESP32-I2C-PINMAP.md)：ESP32/S2/S3/C3/C6 的 Flash、PSRAM、USB、UART0、strap 与仅输入引脚参考。
- [docs/STM32-I2C-PINMAP.md](./docs/STM32-I2C-PINMAP.md)：STM32 各系列 I2C1–I2C4 引脚、备用引脚与 CAPS 表模板。
- [docs/LIS3DH_STREAM_PROTOCOL.md](./docs/LIS3DH_STREAM_PROTOCOL.md)：LIS3DH 主动数据推送（STREAM `0x0230`–`0x0232`）字节布局、金帧、INT1 接线、固件参考实现与验收清单。
- [`.agents/skills/web-serial-lwpkt-i2c/SKILL.md`](../.agents/skills/web-serial-lwpkt-i2c/SKILL.md)：给编码代理的模块地图与改动指南。
- [`.agents/skills/esp32-i2c-caps-firmware/SKILL.md`](../.agents/skills/esp32-i2c-caps-firmware/SKILL.md)：ESP32 固件侧 CAPS v2 上报的实现指南。

## 快速开始

```powershell
cd i2c_web_tool
deno install          # 安装 npm 依赖（react / vite / hono）
deno task dev         # 开发服务器 http://127.0.0.1:5174
```

生产运行：

```powershell
deno task build       # 构建到 dist/
deno task start       # Hono 托管 http://127.0.0.1:8787
```

`deno task preview` 等价于“先 build 再 start”。端口可用 `PORT` 环境变量覆盖，
例如 `$env:PORT=9000; deno task start`。

> Web Serial 与 Web Bluetooth 都要求安全上下文：`localhost` / `127.0.0.1` 或 https 均可。
> 如果通过局域网 IP 访问，需要自行配置 HTTPS 反向代理。

## 接入主站（`/i2c/`）

本工具已作为根目录主站的子页面托管：

```text
根目录主站 (Deno + Hono, 127.0.0.1:30000)
└─ /i2c/*  →  i2c_web_tool/dist/*
```

- 构建：根目录执行 `bun run build`（会调用 `cd i2c_web_tool && deno install && deno task build`），或单独执行 `bun run build:i2c`。
- 访问：`http://localhost:30000/i2c/`。**必须带尾斜杠**；访问 `/i2c` 会由主站 302 重定向到 `/i2c/`。
- Vite 使用 `base: "./"`（相对路径）。因此同一份 `dist/` 既能让本项目的 `deno task start` 托管在根路径，也能被主站挂到 `/i2c/` 子路径；不要改回绝对 `/`，否则子路径下 JS/CSS 会 404。
- `dist/` 已在 `.gitignore` 中忽略，部署前必须先构建。

## 连接硬件

### 串口（Web Serial）

1. 给 ESP32 烧录 ESP32-Bus-Pirate 固件，UART2 默认 **115200 8N1**。
2. 打开页面 → 左栏「设备连接」→ 连接方式选 **串口** → **＋ 选择串口设备（浏览器授权）**。
3. 选择波特率 → **连接串口**。连接时自动发送 ECHO 握手，校验分帧与 CRC。
4. 未授权过的串口不会出现在下拉框；授权记录由浏览器保存，可点「↻ 刷新」重新枚举。

设备被拔出时页面会收到浏览器 `disconnect` 事件，自动断开后端并刷新端口列表。

### I²C 引脚与频率

连接后左栏「I²C 参数」面板会读取当前 SDA/SCL/频率：

- **ESP32 等自由引脚芯片（CAPS v2 固件）**：页面从固件上报的可用 GPIO 下拉框中选择
  SDA/SCL，并显示频率范围；保留引脚（Flash/PSRAM、USB、UART0、仅输入）不会出现在
  列表中。点「应用引脚与频率」后固件重建总线，约 1 秒。
- **ESP32 旧固件（无 CAPS 或 CAPS v1）**：退回数字输入，GPIO 0–63（禁用 43/44），
  频率 1 kHz–1 MHz。
- **STM32 等固定复用芯片**：固件通过 CAPS 上报可用 I²C 实例与引脚方案，页面显示
  I2C1/I2C2… 与方案下拉框；点「切换实例与引脚」生效。
- **旧固件**：不识别 CAPS 时自动降级为“兼容模式 · 自由引脚”，不影响原有功能。

修改引脚/频率后旧的扫描结果会清空，请重新扫描。协议细节见
[docs/I2C_BUS_CONFIG.md](./docs/I2C_BUS_CONFIG.md)；ESP32 固件实现见
[docs/ESP32_FIRMWARE_PROTOCOL.md](./docs/ESP32_FIRMWARE_PROTOCOL.md)。

### 蓝牙（Web Bluetooth / NUS）

固件需要把 UART 透传映射到 Nordic UART Service（NUS）：

| 角色 | UUID |
| --- | --- |
| Service | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| 主机 → 设备（Write） | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` |
| 设备 → 主机（Notify） | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` |

1. 给设备烧录启用 BLE NUS 透传的 ESP32-Bus-Pirate 固件，并确认设备已广播。
2. 页面左栏「设备连接」→ 连接方式切到 **蓝牙** → **＋ 选择蓝牙设备（浏览器授权）**。
3. 浏览器弹窗只列出名称以 **BUS** 开头的 BLE 设备（前缀由 `BLE_DEVICE_NAME_PREFIX` 定义），连接时严格校验 NUS 服务。
4. 点 **连接蓝牙**。无需设置波特率；LWPKT 帧按 20 字节 ATT 载荷自动分片写入，设备通知自动入队。

> 固件 BLE 名称需以 `BUS` 开头（例如 `BUS-ESP32`）；若改用其他前缀，修改
> `src/serial/ble_nus_transport.ts` 中的 `BLE_DEVICE_NAME_PREFIX` 即可。

蓝牙没有全局插拔事件：连接中断时由 `gattserverdisconnected` 通知传输层，
后端立即回到未连接状态，页面同步刷新设备列表。

### 传输能力对照

| 能力 | Web Serial | Web Bluetooth (NUS) | WebUSB（规划中） |
| --- | --- | --- | --- |
| 设备授权 | `navigator.serial.requestPort()` | `navigator.bluetooth.requestDevice()` | `navigator.usb.requestDevice()` |
| 已授权枚举 | `getPorts()` | `getDevices()`（可用时）+ 会话缓存 | `getDevices()` |
| 连接参数 | 波特率 8N1 | 固定 NUS，20 字节分片 | 端点与传输类型 |
| 上行数据 | 后台读泵 → `ByteQueue` | 通知回调 → `ByteQueue` | 端点轮询 → `ByteQueue` |
| 热插拔 | `connect` / `disconnect` 事件 | `gattserverdisconnected` | `connect` / `disconnect` 事件 |

### 断开与资源释放

| 场景 | Web Serial | BLE NUS |
| --- | --- | --- |
| 主动断开 | 取消读泵 → 释放 reader/writer 锁 → `port.close()` | 移除通知/GATT 监听 → `stopNotifications` → `gatt.disconnect` |
| 拔出/异常断开 | 读泵异常 → `onClosed` → manager 补 `close()` → `disconnected` | `gattserverdisconnected` → 移除监听 → `onClosed` → manager 补 `close()` |
| 打开/握手失败 | `manager.close()` 关闭已打开端口 | 发现失败先 `gatt.disconnect()`，再 `manager.close()` |
| 页面刷新/关闭 | 浏览器释放设备 | 浏览器释放设备 |

- 被动断开后 manager 会记录补清理 Promise；下一次连接前自动等待，避免旧 reader/writer 锁未释放导致“端口被占用”。
- MLX90614 / LIS3DH 自动轮询在断开时停止并复位开关；LIS3DH 流式推送在断开时自动退订并停推。
- 详细时序见 [docs/PROGRAM_FLOW.md](./docs/PROGRAM_FLOW.md) 第 6 节，资源清单见 [docs/TRANSPORT_MODULES.md](./docs/TRANSPORT_MODULES.md) 第 6.6 节。

## 功能页

| 页面 | 可用 | 说明 |
| --- | --- | --- |
| I²C 参数 | ✅ | CAPS v2 上报的芯片/可用 GPIO/频率范围、SDA/SCL 下拉或输入、I2C 实例/备用引脚、SWAP/RECOVER |
| I²C 操作台 | ✅ | 总线扫描、单字节寄存器读写、原始传输、24Cxx EEPROM 读写 |
| CH224A PD 取电 | ✅ | 读取 Source Capabilities、固定 PDO / PPS / AVS / QC 取电 |
| MLX90614 测温 | ✅ | 温度轮询与曲线、16 位寄存器读写、发射率 |
| LIS3DH 三轴加速度 | ✅ | 三种读取模式（单次轮询 / FIFO 批量 / 中断推送）、输出模式三档与全 ODR 表、FIFO 与 INT1 路由配置、CSS 3D 姿态视图、温度通道、37 条寄存器表 |
| SPI | ⛔ | 串口 LWPKT 固件不支持 SPI，本工具不提供该页 |

原始传输的语义：发送数据首字节是 **8 位写地址**（`7 位地址 << 1`），
其后为寄存器/数据前缀。例如 `A0 00` 表示“向 0x50 写寄存器指针 0x00”，接收长度 2 即读回两字节。

### 界面约定

- **地址/寄存器一览表最多 6 行**：MLX90614「全部地址功能一览」、CH224A「寄存器地址与读写属性」与
  LIS3DH「性能参数与用法要点」固定为 6 行高度（`212px`：容器边框 2 + 表头 29.8 + 6 × 行高 29.8），
  表头吸顶，超出部分在表内滚动；CH224A「状态与 Source Capabilities 原始数据」同为 6 行（`190px`）。
  行高由 `8px 字号 × line-height + 上下 padding + 1px 边框` 决定，改字号/间距需同步改 `max-height`。
  另：「各 PDO 全部参数」保留 `460px`，PDO 数量不定，不限 6 行。
- **页脚备案号**：页面最下方固定一行
  `© 2026 · 粤ICP备2025393310号-2 · 粤公网安备 44030002011217号`，与主站 `public/index.html` 页脚文案一致；
  样式为 `.site-filing`（居中、8px、弱化色，链接无下划线，hover 才显示）。
- **操作记录紧贴「总线操作」**：`.workspace` 右栏用 `.operations-column` 把两者上下叠放，
  宽度与「总线操作」一致，不再横跨整行；窄屏（≤820px）自动落到侧栏下方。
- **连接只在「I²C 操作台」**：串口 / 蓝牙、设备选择、波特率、断开统一在侧栏「设备连接」完成；
  CH224A / MLX90614 / LIS3DH 页不再自带连接区（顶部大框已移除），未连接时顶部只留一行
  「请先在 I²C 操作台连接」的可点击提示，四个页面共用同一条连接。

## 架构

```text
浏览器
├─ src/ui/                     React 界面（I²C / CH224 / MLX90614 / LIS3DH）
├─ src/api.ts                  本地适配器：UI → 后端（无 HTTP）
├─ src/transport/
│  ├─ types.ts                 ByteTransport / TransportProvider / 事件类型
│  ├─ byte_queue.ts            通用上行字节队列（read(deadline)）
│  └─ manager.ts               互斥管理器：唯一活跃连接 + 事件订阅
├─ src/serial/
│  ├─ serial_lwpkt.ts          LwpktBackend：方法面 ↔ LWPKT 命令帧
│  ├─ web_serial_transport.ts  Web Serial Provider + 后台读泵
│  ├─ ble_nus_transport.ts     BLE NUS Provider + GATT/通知/分片
│  ├─ ch224.ts / mlx90614.ts / lis3dh.ts
│  │                          器件控制器（全部 async）
│  ├─ lwpkt.mjs / protocol.mjs 纯逻辑：分帧、CRC、编解码、校验
│  └─ ch224.mjs / mlx90614.mjs / lis3dh.mjs
│                            纯逻辑：PDO / SMBus / 温度与加速度换算
└─ Hono (server.ts)            静态托管 dist/ + /api/health
```

主站接入时只多一层 URL 映射：`/i2c/*` → `i2c_web_tool/dist/*`；浏览器端代码不感知自己挂在根路径还是子路径。

关键设计：

- **传输无关**：`LwpktBackend` 只依赖 `ByteTransport`；串口、BLE、未来 USB 都由
  `TransportProvider` 提供设备枚举、授权与打开。
- **互斥**：`TransportManager.open()` 会先关闭旧传输，保证同一时刻只有一个固件连接；
  UI 在已连接时同时禁用传输切换，形成双重保护。
- **异步接口**：`I2cBackend` 的所有 I/O 方法都返回 `Promise`。浏览器的 Streams / GATT API 不能同步阻塞。
- **后台读泵 / 通知入队**：`reader.read()` 会一直挂起，BLE 通知也可能随时到达，因此两者都写入
  共享 `ByteQueue`；`read(deadlineMs)` 只查队列，超时返回空数组，交给协议层继续轮询。
- **无 PurgeComm**：浏览器无法清 OS 缓冲，`purgeInput()` 只清本地队列；
  协议层对“命令不匹配的迟到应答”选择跳过而不是报错。
- **请求-应答**：一次一帧，`#busy` 保证串行；默认 2000 ms 超时。

更细的接口契约与扩展步骤见 [docs/TRANSPORT_MODULES.md](./docs/TRANSPORT_MODULES.md)，
时序与状态机见 [docs/PROGRAM_FLOW.md](./docs/PROGRAM_FLOW.md)。

## LWPKT 线格式

```text
0xAA | FROM(1B) | TO(1B) | CMD(varint) | LEN(varint) | DATA | CRC-8 | 0x55
```

CRC-8 覆盖 `FROM..DATA`（含 varint 字节），反射多项式 `0x8C`、初值 0、无 xorout。
`ADDR_DEVICE=0x01`、`ADDR_HOST=0x02`。

| 方法 | 固件命令 | 说明 |
| --- | --- | --- |
| `connect` | ECHO `0x0101` | 握手帧 `AA 02 01 81 02 02 DE AD D5 55` |
| `scan` | SCAN `0x0202` | 固件扫描整段总线，前端按请求范围过滤 |
| `read` / `write` | READ_REG `0x0204` / WRITE_REG `0x0205` | 单字节寄存器 |
| `readRegisters` | READ_BLOCK `0x0206` | 每次 ≤255 字节，寄存器自增分片 |
| `transfer` / `streamI2C` | READ_RAW `0x0208` / WRITE_RAW `0x0209` / READ_MEM16 `0x020A` | 按前缀长度选择 |
| `readBusConfig` / `configureBus` | CONFIG `0x0210` | 查询/设置 SDA、SCL、频率（ESP32 自由引脚） |
| `swapBusPins` / `recoverBus` | SWAP `0x0212` / RECOVER `0x0211` | 交换 SDA/SCL；9 时钟恢复总线 |
| `readBusCapabilities` | CAPS `0x0220` | 上报芯片、引脚模式、实例/引脚方案与自由引脚表（CAPS v2）；旧固件返回 ERR_ARG → 前端降级 |
| `selectBus` | BUS_SELECT `0x0221` | 切换 I2C1/I2C2… 与备用引脚方案（STM32 固定复用） |
| `startStream` / `stopStream` | STREAM_START `0x0230` / STREAM_STOP `0x0231` | LIS3DH 中断推送：固件按计划读寄存器并主动上报，停止时回累计帧数 |
| （设备主动） | STREAM_DATA `0x0232` | 设备→主机主动帧（address/seq/length/data），上位机接收泵分发 |
| `eepromRead` / `eepromWrite` | EEPROM_OPEN `0x0301` / READ `0x0302` / WRITE `0x0303` | 先 OPEN 读取容量 |

EEPROM 型号映射沿用桌面版假设：`model = CH341 type + 1`，器件地址固定 `0x50`，
如与实际固件不符，请在真机联调时校准（见 `serial_lwpkt.ts` 的 `eepromModel`）。

## 测试

```powershell
deno task check    # 类型检查
deno task test     # 102 项：LWPKT 金帧、STREAM 编解码、协议校验、总线参数、CAPS v2 引脚表、传输层、后端、BLE/互斥/断开释放
                   # 另含 LIS3DH 三轴换算、输出模式三档、FIFO/中断路由、批量解码与流式分发（约 30 项）
```

测试全部为纯内存：`FakePort` 用内存 `ReadableStream` 模拟串口，`FakeTransport` 解析请求帧并回同 CMD
应答帧，`FakeDevice`/`FakeGatt` 模拟 Web Bluetooth 通知与断开，因此无需硬件即可回归。

## 与 i2c_dev_desktop 的差异

| 项目 | i2c_dev_desktop | i2c_web_tool |
| --- | --- | --- |
| 串口访问 | Deno FFI + kernel32 | 浏览器 Web Serial |
| 无线访问 | 无 | 浏览器 Web Bluetooth（NUS 串口） |
| 后端 | CH341 USB / 串口 LWPKT 可切换 | Web Serial / BLE NUS（可扩展 WebUSB） |
| SPI | CH341 页可用 | 不提供 |
| 调用模型 | 同步 | 全异步 |
| 服务端 | Deno HTTP API | Hono 静态托管 |

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 页面提示“浏览器不支持 Web Serial API” | 换 Chrome/Edge，使用 localhost 或 https |
| 页面提示“浏览器不支持 Web Bluetooth API” | 换 Chrome/Edge；Windows 需打开系统蓝牙并允许浏览器权限 |
| 串口下拉框为空 | 点「选择串口」授权；USB 线需支持数据 |
| 蓝牙列表为空 | Windows 设置中先配对/允许访问；确认设备正在广播 |
| 连接失败 / 无法打开串口 | 关闭占用该串口的软件（串口助手、Arduino IDE 等）后重试 |
| 蓝牙提示“未找到 NUS 服务或特征” | 固件未启用 NUS 透传，或 Service/特征 UUID 不符 |
| 握手超时 | 确认固件为 ESP32-Bus-Pirate、UART 参数一致、TX/RX 交叉接线 |
| 蓝牙握手超时 | 缩短距离、减少 2.4 GHz 干扰；必要时增大 `writeDelayMs` |
| 读写超时 / CRC 错帧增加 | 降低串口波特率、缩短杜邦线、确认共地 |
| 错误提示“ERR_NOACK” | 器件未上电、地址错误或缺上拉电阻 |
| CH224/MLX 读数全为 0xFF | 模块未上电或 I²C 无应答，检查 VCC/GND |
| 修改引脚后扫描为空 | 新引脚接线/上拉是否正确；修改后需重新扫描 |
| 提示“不能使用 GPIO43/44” | 43/44 是 ESP32-S3 的 UART0 控制台；换其他 GPIO。若固件已上报 CAPS v2 引脚表，下拉框会直接排除它们 |
| ESP32 参数面板是下拉框但没有我要的引脚 | 固件把该 GPIO 标成了保留（Flash/PSRAM、USB、UART0、仅输入或板载外设）；展开「已排除」查看原因 |
| ESP32 参数面板仍是数字输入 | 固件未实现 CAPS v2（无 CAPS 或 v1）；升级固件后自动变为下拉框 |
| STM32 没有实例/方案下拉 | 固件未实现 CAPS；升级固件，或临时按自由引脚模式使用 |
| 切换 I2C 实例超时 | 固件重建总线约 1 秒；确认 `busConfigTimeoutMs` 为 5000 ms、供电稳定 |
| LIS3DH 三轴恒为同一组值 | 块读未置子地址 MSB（`0xA8`），或 ODR 低于读取率；用页面默认块读路径并按提示把 ODR 调到 ≥2× 读取率 |
| 「中断推送」提示固件需实现 STREAM_START | 旧固件未实现 STREAM 命令；升级固件（见 `docs/LIS3DH_STREAM_PROTOCOL.md`）或改用轮询/FIFO 模式 |
| 中断推送已启动但无数据 | INT1 未接到固件声明的 GPIO、上拉/共地问题，或固件未实现中断触发（应答 `flags` 未声明时页面会提示回退）；检查跳线与接线 |
| FIFO 模式提示「没有可读样本」 | 读取间隔太小（读得比攒得快）；按页面提示加大批量读取周期或提高 ODR |
| LIS3DH 读数为 0 或全 `0xFF` | `CTRL_REG1` 的 ODR 为 0（掉电）/轴未使能，或器件未上电；在 02 区下发配置并看回读 |
| LIS3DH 温度恒为 0 | `TEMP_CFG.TEMP_EN` 未置位；在 02 区勾选「温度通道」后下发 |

## 已知限制

- 仅 Chromium 内核浏览器；Firefox / Safari 不支持 Web Serial / Web Bluetooth。
- BLE NUS 默认按 20 字节分片，长帧吞吐低于串口；如需更高速率需协商更大 ATT MTU。
- 蓝牙没有全局插拔事件，设备断电后依赖 GATT 断开回调更新状态。
- 串口不支持 SPI（固件限制）。
- STM32 的 I²C 引脚由 AF/remap 固定，页面只能选择固件上报的方案，不能任意输入 GPIO。
- ESP32 的可用引脚由固件上报（CAPS v2）；未上报时退回 0–63 数字输入（禁 43/44）。
- CAPS/BUS_SELECT 需要新固件；旧固件自动降级为 ESP32 自由引脚模式。
- EEPROM 型号 `model = type + 1` 为待校准假设。
- 页面刷新或关闭标签页会释放串口/蓝牙连接；操作记录仅保存在内存中。
- LIS3DH 轮询 / FIFO 模式依赖固件往返时延：蓝牙分片下单帧更慢，实际周期可能大于设定值；ODR 需 ≥2× 读取率才有新数据。
- LIS3DH「中断推送」依赖固件实现 STREAM 命令（`0x0230`–`0x0232`）并把 INT1 接至主控 GPIO；旧固件会自动提示降级方案。
