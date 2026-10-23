# Web 串口 / 蓝牙 I²C 工具 · 程序设计说明

本文档描述 `i2c_web_tool` 的完整程序设计：为什么这样分层、每一层如何工作、一次操作从按钮到总线的完整路径、异步与超时模型、错误处理、测试策略与扩展方式。面向“读代码 / 改代码”的人；面向使用者的接线与操作步骤见 [Web串口I2C-操作说明](./Web串口I2C-操作说明.md)，传输模块接口细节见 [docs/TRANSPORT_MODULES.md](./docs/TRANSPORT_MODULES.md)，按运行顺序的时序见 [docs/PROGRAM_FLOW.md](./docs/PROGRAM_FLOW.md)。

> 一句话定位：把 `i2c_dev_desktop` 的“串口 LWPKT I²C 后端”搬到浏览器里，用 **Web Serial** 或 **Web Bluetooth（BLE NUS 串口透传）** 直接打开设备，用 **Deno + Hono** 只做静态托管，从而做到“打开网页即可用，无安装、无 DLL、无 FFI”。两种传输共用同一套字节流抽象与 I²C 业务层，传输管理器保证任意时刻只有一条活跃连接，并可平滑扩展到 WebUSB。

## 1. 需求与设计约束

### 1.1 目标

- 在浏览器中完成：I²C 总线扫描、单字节寄存器读写、原始 I²C 传输、24Cxx EEPROM 读写。
- 复用桌面版已验证的 CH224A（PD/QC 取电）与 MLX90614（红外测温）业务逻辑。
- 新增 LIS3DH 三轴加速度页：三种读取模式（单次轮询 / FIFO 批量 / 中断推送）、g/原始值/倾角/温度、
  CSS 3D 姿态、量程/输出模式三档/ODR 全表/FIFO/中断路由配置、37 条寄存器表与单字节读写；
  业务规则仍按“纯逻辑 .mjs + 控制器 .ts + 面板”三层拆分。
- 协议与桌面版串口后端**完全一致**：同一套 LWPKT 帧格式、命令码、CRC、分片规则。
- 服务端零硬件依赖，可部署在任意能跑 Deno 的机器（本机或内网服务器）。

### 1.2 硬约束（决定了整个架构）

| 约束 | 影响 |
| --- | --- |
| Web Serial / Web Bluetooth 只在浏览器中可用，且只能访问用户授权的设备 | 服务端不可能代替浏览器打开设备；Hono 只能托管静态资源 |
| 两者仅在 Chromium 内核、安全上下文（localhost / 127.0.0.1 / https）可用 | 需要给出明确的浏览器与访问方式提示，并按 `isAvailable()` 禁用不可用方式 |
| Web Serial 是 Streams API，`reader.read()` 的 Promise 会一直挂起 | 后端接口必须全异步；需要后台读泵 + 缓冲 |
| Web Bluetooth 没有“读取流”，只有 GATT 通知回调 | 需要统一字节队列 `ByteQueue` 提供带 deadline 的 `read()` |
| 浏览器没有 `PurgeComm`，不能清操作系统/控制器缓冲 | `purgeInput()` 降级为清本地队列；协议层需容忍迟到帧 |
| Web Serial 不暴露 COM 名，BLE 不暴露固定短地址 | 设备用“传输种类 + 会话内 id”标识，展示名由 VID/PID 或 BLE 设备名生成 |
| BLE 单次写入受 ATT MTU 限制（默认 20 字节可用载荷） | 传输层负责分片，协议层仍按整帧下发 |
| 两种传输不能同时占用同一固件 | 由 `TransportManager` 强制互斥：打开新传输前先关闭旧传输 |
| 固件不支持 SPI，浏览器也无法加载 CH341 DLL | 删除 CH341 后端、SPI 页面与相关类型 |

### 1.3 五项关键决策

1. **功能范围：完整复用 + LIS3DH 新增**（I²C + EEPROM + CH224A + MLX90614 + LIS3DH），去掉 CH341 切换器与 SPI 页。  
   理由：控制器与协议逻辑是纯 JS/TS，与运行环境无关；保留它们能最大化复用已验证的业务规则（PDO 校验、PEC、EEPROM 安全写）；LIS3DH 按同一分层新增，不引入新依赖。
2. **同步模型：纯异步重构**。  
   理由：Web Serial / Web Bluetooth 都无法同步阻塞；与其在浏览器里用 Atomics/Worker 造“假同步”，不如让 `I2cBackend` 全 Promise 化，代码更直观、错误传播更自然。
3. **服务端职责：Hono 仅静态托管 + 健康检查**。  
   理由：做服务端串口桥必须引入本机进程 + FFI（即桌面版），与“网页即用”的目标冲突；而纯静态托管可以部署到任何静态服务器。
4. **传输可插拔：字节流抽象 + Provider 注册 + 单活跃连接**。  
   理由：Web Serial、BLE NUS、未来的 WebUSB 只是“如何搬字节”不同，LWPKT 分帧、CRC、器件规则完全一致。把差异收敛到 `TransportProvider`，后端与 UI 不需要为每种传输写分支，互斥由 `TransportManager` 统一保证。
5. **蓝牙复用串口语义：用 NUS 而不是自定义 GATT**。  
   理由：Nordic UART Service 是事实标准（写特征下行、通知特征上行），固件侧只需把 UART 字节流桥接到 NUS，网页侧就能原样复用 `ByteTransport` 与 LWPKT 协议，不需要为蓝牙定义第二套协议。

## 2. 总体架构

### 2.1 运行形态

```text
开发：deno task dev   → Vite 开发服务器 127.0.0.1:5174（HMR）
生产：deno task build → dist/
      deno task start → Hono 127.0.0.1:8787 托管 dist/ + SPA 回退
```

开发模式下 Vite 直接提供页面，**不经过 Hono**；生产模式由 Hono 托管构建产物。两种模式下的浏览器代码完全相同。

### 2.2 分层图

```text
┌──────────────────────────────────────────────────────────────────┐
│ UI 层    src/ui/App.tsx  I²C 操作台 / 连接面板 / 历史           │
│          src/ui/Ch224Panel.tsx  src/ui/Mlx90614Panel.tsx          │
└───────────────────────────┬──────────────────────────────────────┘
                            │ 方法调用（Promise）
┌───────────────────────────▼──────────────────────────────────────┐
│ 适配层   src/api.ts        单例装配 + 类型契约收口                 │
│          src/types.ts       UI 可见的结果类型与传输类型 re-export  │
└───────────────────────────┬──────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│ 器件层   src/serial/ch224.ts      PD/QC 取电业务规则               │
│          src/serial/mlx90614.ts   SMBus/PEC/EEPROM 安全写          │
└───────────────────────────┬──────────────────────────────────────┘
                            │ I2cBackend（read/write/scan/streamI2C）
┌───────────────────────────▼──────────────────────────────────────┐
│ 后端层   src/serial/serial_lwpkt.ts  方法面 ↔ LWPKT 命令帧         │
│          src/serial/backend.ts       I2cBackend / BackendStatus    │
└───────────────────────────┬──────────────────────────────────────┘
                            │ ByteTransport（write/read/purgeInput/close）
┌───────────────────────────▼──────────────────────────────────────┐
│ 传输层   src/transport/types.ts      统一接口与传输类型            │
│          src/transport/manager.ts    唯一活跃连接 + 事件广播       │
│          src/transport/byte_queue.ts 字节队列（等待/唤醒）         │
│          src/serial/web_serial_transport.ts  Web Serial Provider   │
│          src/serial/ble_nus_transport.ts     BLE NUS Provider      │
└──────────────┬───────────────────────────────┬───────────────────┘
               │ navigator.serial              │ navigator.bluetooth
┌──────────────▼──────────────┐  ┌─────────────▼───────────────────┐
│ 浏览器 Web Serial → USB 串口 │  │ 浏览器 Web Bluetooth → GATT NUS │
│ → ESP32-Bus-Pirate 固件      │  │ → ESP32-Bus-Pirate 固件          │
└─────────────────────────────┘  └─────────────────────────────────┘

另有纯逻辑层（无任何浏览器/Deno API）：
  lwpkt.mjs（分帧/CRC/codec）、protocol.mjs（校验）、
  ch224.mjs（PDO/PPS/AVS 解析）、mlx90614.mjs（PEC/温度换算）、
  serial.mjs（波特率表）
```

### 2.3 依赖方向规则

- **纯逻辑层（`.mjs`）不 import 任何 `.ts`、不访问 `navigator`/`Deno`**，因此可以被 Deno 测试直接运行。
- **传输层是唯一接触 `navigator.serial` / `navigator.bluetooth` 的地方**，对外只暴露 `ByteTransport` / `TransportProvider` / `TransportManager` 与各自的注册函数。
- **后端层只通过 `TransportManager` 打开设备**，不直接 new 任何具体传输；测试通过 `manager` 或 `transportFactory` 注入替代实现。
- **器件层只依赖 `I2cBackend`**，不知道串口、蓝牙、帧、CRC 的存在。
- **UI 只依赖 `api` 与 `types.ts`**：连接方式由 `api.transports()` 描述，设备由 `api.devices(kind)` 枚举，插拔与被动断开统一走 `api.watchTransportEvents()`，不 import 任何传输实现。
- **新增 WebUSB 只需新增一个 `TransportProvider` 并注册**，后端、控制器、页面结构都不变。

### 2.4 与桌面版的对照

| 维度 | `i2c_dev_desktop` | `i2c_web_tool` |
| --- | --- | --- |
| 设备访问 | Deno FFI → kernel32（仅 Windows） | Web Serial / Web Bluetooth（Chromium，跨平台） |
| 后端 | CH341 USB / 串口 LWPKT 可切换 | 仅 LWPKT，传输可插拔（串口 / 蓝牙 / 预留 USB） |
| 调用模型 | 同步方法 | 全异步 Promise |
| 服务端 | Deno HTTP API（`/api/*`） | Hono 静态托管 + `/api/health` |
| 设备标识 | `COM3` 等 | 传输种类 + 会话内设备 id + 展示名 |
| 清缓冲 | `PurgeComm(PURGE_RXCLEAR)` | 仅清本地队列 |
| 迟到帧处理 | 直接抛帧错误 | 跳过不匹配 CMD，继续等 |
| 并发连接 | 单串口 | `TransportManager` 强制单活跃传输 |
| SPI | CH341 页可用 | 不提供 |

## 3. 目录与文件职责

```text
i2c_web_tool/
├── deno.json                 Deno 配置、npm 依赖、任务
├── package.json              npm 元数据与镜像脚本（实际任务以 deno.json 为准）
├── vite.config.ts            React 插件 + 端口 5174
├── index.html                Vite 入口
├── server.ts                 Hono 静态托管 + /api/health
├── README.md                 快速开始、传输能力对照与故障排查
├── docs/
│   ├── TRANSPORT_MODULES.md  传输模块说明（接口/互斥/BLE 细节/扩展步骤）
│   ├── PROGRAM_FLOW.md       程序流程与时序图
│   ├── I2C_BUS_CONFIG.md     I²C 引脚/频率设置协议与固件实现
│   ├── ESP32_FIRMWARE_PROTOCOL.md  ESP32 CAPS v2 能力/引脚上报协议指引
│   ├── ESP32-I2C-PINMAP.md   ESP32/S2/S3/C3/C6 保留引脚参考
│   └── STM32-I2C-PINMAP.md   STM32 I2C1–I2C4 引脚/备用引脚表
├── src/
│   ├── main.tsx              React 挂载
│   ├── api.ts                本地 API 适配器（无 HTTP）
│   ├── types.ts              UI 契约类型 + 传输类型 re-export
│   ├── transport/
│   │   ├── types.ts          ByteTransport / TransportProvider / 事件
│   │   ├── manager.ts        Provider 注册 + 唯一活跃连接 + 事件广播
│   │   └── byte_queue.ts     字节队列（read(deadline)/close 唤醒）
│   ├── serial/
│   │   ├── backend.ts        I2cBackend / BackendStatus / ConnectRequest
│   │   ├── serial_lwpkt.ts   方法面 ↔ LWPKT，异步请求-应答 + STREAM 接收泵
│   │   ├── web_serial_transport.ts  Web Serial Provider + 端口注册表
│   │   ├── ble_nus_transport.ts     BLE NUS Provider（GATT/分片/通知）
│   │   ├── lwpkt.mjs         帧编解码、FrameDecoder、命令 codec
│   │   ├── protocol.mjs      参数校验、hex 解析、结果格式化
│   │   ├── serial.mjs        波特率表与校验
│   │   ├── ch224.ts/.mjs     CH224A 控制器与纯逻辑
│   │   ├── mlx90614.ts/.mjs  MLX90614 控制器与纯逻辑
│   │   └── lis3dh.ts/.mjs    LIS3DH 控制器与纯逻辑
│   └── ui/
│       ├── App.tsx           主界面与全部交互编排
│       ├── BusConfigPanel.tsx I²C 引脚/频率参数面板
│       ├── Ch224Panel.tsx    CH224A 面板
│       ├── Mlx90614Panel.tsx MLX90614 面板
│       ├── Lis3dhPanel.tsx   LIS3DH 面板（含 CSS 3D 姿态）
│       └── styles.css        主题与布局
├── tests/                    8 个测试文件，102 项
└── dist/                     构建产物（git 忽略）
```

## 4. 启动、构建与部署

### 4.1 `deno.json`

- `nodeModulesDir: "auto"`：让 Vite/React 这类 npm 包按 node_modules 方式解析，兼容 Vite 插件生态。
- `imports`：react 19.2、vite 7.3、`@vitejs/plugin-react` 5.0、hono（跟随最新）。
- `compilerOptions.jsx: "react-jsx"` + `jsxImportSource: "react"`：无需在每个文件 import React。
- `lib` 包含 `deno.window`、`dom`、`dom.iterable`、`dom.asynciterable`，让 `ReadableStream`、`navigator` 等类型可用。
- `exports: "./server.ts"`：允许 `deno run` 直接以包方式引用（也便于 IDE 建索引）。
- `check` 任务覆盖 13 个入口（server、main、api、types、3 个 `src/transport/*`、6 个 `src/serial/*.ts`），保证跨文件类型一致。

### 4.2 Vite

- `@vitejs/plugin-react` 提供 JSX 转换与 Fast Refresh。
- `server.port = 5174`、`host = "127.0.0.1"`、`strictPort: true`：端口被占用时直接报错，避免悄悄换端口导致访问地址不一致。
- `build.outDir = "dist"`，与 `server.ts` 的 `root` 对应。

### 4.3 Hono 服务端逻辑

```ts
app.get("/api/health", (c) => c.json({ ok: true, ... }));
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));
Deno.serve({ port, hostname: "127.0.0.1", onListen }, app.fetch);
```

程序思路：

1. **health 先注册**，避免被静态中间件吞掉。
2. `serveStatic({ root: "./dist" })` 处理真实文件（`/assets/*`、`/favicon` 等）。
3. `app.get("*", ...index.html)` 做 SPA 回退：`/ch224` 这类前端路由直接刷新也能打开。
4. 端口取 `PORT` 环境变量，默认 8787；`onListen` 打印实际地址，方便发现端口冲突后的行为。
5. 绑定 `127.0.0.1` 而非 `0.0.0.0`：默认只本机可访问，减少暴露面；需要局域网访问时自行改 hostname 并配置 HTTPS（Web Serial 要求安全上下文）。

### 4.4 为什么没有 `/api/connect`

桌面版 UI 通过 HTTP 调 `/api/connect`，服务端再打开 COM。Web 版如果也这么做，服务端打开的是**服务器所在机器**的串口，而不是用户电脑的串口，语义完全错误。因此 `api.ts` 改成同进程调用，UI 方法名保持不变，避免重写面板。

## 5. 数据流全景

### 5.1 连接时序（含失败分支）

```text
用户点击「＋ 选择设备」
  └─ api.requestDevice(kind)                  kind = "serial" | "ble"
       ├─ serial → navigator.serial.requestPort() → 注册表 { id, label }
       └─ ble    → navigator.bluetooth.requestDevice() → { id, label }
     两者都必须在用户手势内调用

用户点击「连接串口 / 连接蓝牙」
  └─ api.connect({ kind, deviceId, baudRate })
       └─ SerialLwpktBackend.connect()
            1. 若已连接 → disconnect()
            2. serial: validateBaud(baud ?? 115200)；ble: baud = null
            3. manager.open(kind, deviceId, { baudRate, chunkSize, writeDelayMs })
                 ├─ await manager.close()          ← 互斥：先关旧传输
                 ├─ 测试注入 transportFactory → 直接返回
                 └─ provider.open() → WebSerialTransport / BleNusTransport
            4. 记录 kind/port/baud，decoder.reset()，订阅 onClosed
            5. #request(ECHO, DE AD)
                 ├─ 成功 → 返回 status()，UI 显示“串口/蓝牙已连接”
                 └─ 失败（超时/CRC/状态码）→ 清状态 + manager.close() + 抛错
```

关键点：

- `connect` 失败时一定回滚：不会留下“半开”的 transport，否则下一次连接会撞上“端口已打开”。
- 互斥在 `manager.open()` 内部完成：即使 UI 状态被绕过，打开新传输前也会先关闭旧传输。
- 握手用 ECHO 而不是 PING：ECHO 不碰 I²C 总线，只验证链路、分帧与 CRC，对串口和蓝牙都适用，失败原因更纯粹。
- 错误文案区分“无法连接〈传输〉设备”和“〈传输〉已连接但握手失败”，便于定位是授权/驱动/蓝牙配对问题还是固件/接线问题。
- `baud` 只对串口有意义；蓝牙与后续 USB 一律为 `null`，UI 也不显示波特率控件。

### 5.2 读寄存器时序

```text
readRegister() → run("寄存器读取", …)
  → api.read(addr, reg)
    → backend.read()
       validateAddress / validateByte
       encodeReadReg(addr, reg)
       #request(CMD.READ_REG, payload)
         ├─ busy 检查
         ├─ transport.purgeInput()
         ├─ decoder.reset()
         ├─ transport.write(buildFrame(...))
         ├─ while (now <= deadline)
         │    frames = decoder.push(await transport.read(10))
         │    过滤 from/to，匹配 cmd → 返回 data
         └─ 超时 → LwpktError(kind:"timeout")
       decodeReadRegResp(data) → { value }
  → run() 记录历史、刷新状态、返回给 UI
```

`run()` 是 UI 的统一执行器：进入时置 `busy`（按钮禁用），成功写一条历史并刷新状态，失败写失败历史并弹 toast。所有操作（扫描、读写、EEPROM、CH224、MLX）都走它，保证交互一致。

### 5.3 扫描时序

- `api.scan(start, end)` → `CMD.SCAN`（无载荷）→ 固件扫描整段总线。
- 固件返回 `status + count + addresses`，`decodeScanResp` 解析。
- 后端按用户请求的 `[start, end]` **再次过滤**。固件已经全扫，过滤放在前端可以避免为不同范围重复发起扫描，同时保证越界地址不显示。

### 5.4 原始传输的分派逻辑

`transfer(writeHex, readLength)` 与 `streamI2C(bytes, readLength)` 都遵循 CH341 的“命令流”约定：**首字节是 8 位写地址（7 位地址 << 1）**，其余字节是寄存器/数据前缀。

```text
address = firstByte >> 1
prefix  = bytes[1..]

readLength == 0:
  transfer:  prefix 为空 → 参数错误（无意义）
             prefix 非空 → WRITE_RAW
  streamI2C: prefix 为空 → PING（地址探测）
             prefix 非空 → WRITE_RAW

readLength > 0:
  prefix.length == 0 → READ_RAW（每次 ≤255）
  prefix.length == 1 → READ_BLOCK（寄存器自增，每次 ≤255）
  prefix.length >= 2 → READ_MEM16（16 位地址，每次 ≤1000）
```

为什么这样分派：固件只提供“无寄存器裸读 / 8 位寄存器块读 / 16 位地址块读”三种读命令；CH341 的命令流本身不携带“这是哪种读”的标记，只能靠前缀长度推断。这与桌面版串口后端保持一致。

### 5.5 EEPROM 读写时序

```text
eepromRead(type, offset, length)
  1. validateEeprom → 查本地型号表（容量、页大小）
  2. #openEeprom(type, offset, length)
       EEPROM_OPEN(deviceAddress=0x50, model=type+1)
       解码 status + capacity + pageSize + addrBytes + ack
       ack=0 → 抛 ERR_NOACK
       offset+length > capacity → RangeError
  3. 按 ≤1000 字节分片发 EEPROM_READ
       每片校验返回长度必须等于请求长度
  4. toTransferResult(buffer) → { bytesRead, hex, ascii }

eepromWrite(type, offset, writeHex)
  1. parseEepromWrite → hex 解析 + 空数据拒绝 + 本地容量校验
  2. #openEeprom(type, offset, buffer.length)
  3. 按 ≤1000 字节分片发 EEPROM_WRITE
```

`model = CH341 type + 1` 是沿用桌面版的**假设**（对应固件 Console 的 `-m` 编号）；真机若型号识别异常，先校准 `serial_lwpkt.ts` 的 `eepromModel()`。

### 5.6 器件控制器时序

**CH224A 取电**（`ch224.ts`）：

1. `discover()` 扫描 `0x22–0x23`。
2. `readCapabilities()` 读 `0x09` 状态 → 若 `0xFF` 直接判定“未上电/无应答”，**不写入任何配置**；否则读 `0x50` 电流能力，逐字节读 `0x60–0x8F` 的 Source Capabilities，解析 PDO/APDO。
3. `requestFixedVoltage()`：先确认 PD 激活且 PDO 有效；>20 V 还要求 EPR 置位；电源未广播该固定档则拒绝写入。
4. `requestPpsVoltage()`：要求存在覆盖目标电压的 PPS APDO；写 `0x53`（100 mV/单位）再写模式 6。
5. `requestAvsVoltage()`：要求 AVS 能力位 + 覆盖目标电压的 AVS APDO；写 `0x51/0x52`（10 mV/单位，高字节带 0x80）再写模式 7。
6. `requestNonPdPower()`：PD/EPR 未激活且检测到 QC2/QC3/BC 时，按协议白名单固定档写模式寄存器。
7. 每次写模式后延时 120 ms 读 `0x09`；`0xFF`（掉电）或 `0`（握手失败）都抛错，并提示用万用表确认输出。

**MLX90614**（`mlx90614.ts`）：

1. 读流程 `streamI2C([addr<<1, reg], 3)` 拿 `low/high/pec`，用 SMBus PEC 校验。
2. 温度：`raw` 有效且非 `0xFFFF` 才换算摄氏度/华氏度；否则标记 `noResponse`。
3. 写寄存器按地址分类：
   - RAM `0x00–0x1F`：只读，直接拒绝。
   - EEPROM `0x20–0x3F`：擦除（写 0）→ 延时 10 ms → 写值 → 延时 10 ms → 回读校验（Melexis 四步法，不含重新上电）。
   - 命令 `0x60–0x7F`：只发单字节命令，无数据/PEC。
4. 发射率固定走 EEPROM `0x24`，范围 0.1–1.0，写入后回读比对。

**LIS3DH 三轴加速度**（`lis3dh.ts`）：

1. `discover()` 扫 `0x18/0x19`，读 `0x0F WHO_AM_I`（应为 `0x33`）与 `CTRL_REG1/3/4/5`、`TEMP_CFG`、`FIFO_CTRL`，识别成功才标记 `identified`。
2. 三种采样通道：
   - 轮询 `readSample()`：`readRegisters(address, 0xA8, 6)`；不足 6 字节时退化为 6 次 `read(address, 0x28 + i)`，`readMode` 标记实际路径；
   - FIFO 批量 `readFifoBatch()`：先读 `FIFO_SRC` 取待读组数，再一次块读 `count × 6` 字节，`decodeAccelerationBatch()` 逐组换算；
   - 中断推送 `subscribeStream()`：订阅后端 `STREAM_DATA` 帧，用 `decodeAccelerationBatch()` 解码后逐组回调 `Lis3dhSample`（`at` 取帧到达时间）。
3. 纯逻辑 `decodeAcceleration()` / `decodeAccelerationBatch()` 拼 16 位小端、转有符号、除 `accRange` 得 g，再算 `|g|`、pitch、roll。
4. 配置：`configure()` 按 `Lis3dhConfig` 编码六个寄存器（`CTRL_REG1/3/4/5`、`TEMP_CFG`、`FIFO_CTRL`）后写入，再回读比对 `matches`；输出模式从原始入参解析（三档互斥，兼容旧布尔字段）。
5. 温度：`readRegisters(address, 0x8C, 2)`，`°C = int8(OUT_ADC3_H) + 25`；全 0 视为未启用。
6. 手动读写走单字节 `read`/`write`，读回用 `describeRegister()` 展开位域。

## 6. 传输层（Web Serial / BLE NUS）

传输层由五个文件组成：

| 文件 | 职责 |
| --- | --- |
| `src/transport/types.ts` | `ByteTransport` / `TransportProvider` / 事件与设备的全部类型 |
| `src/transport/manager.ts` | Provider 注册、唯一活跃连接、事件广播 |
| `src/transport/byte_queue.ts` | 字节队列：`read(deadlineMs)` 的等待与唤醒 |
| `src/serial/web_serial_transport.ts` | Web Serial Provider（端口注册表 + 后台读泵） |
| `src/serial/ble_nus_transport.ts` | BLE NUS Provider（GATT 连接 + 分片写 + 通知入队） |

接口清单、逐字段说明与“新增 WebUSB”的完整步骤见 [docs/TRANSPORT_MODULES.md](./docs/TRANSPORT_MODULES.md)；这里只解释设计动机与关键实现。

### 6.1 两个核心接口

```ts
interface ByteTransport {
  write(bytes: Uint8Array): Promise<void>;
  read(deadlineMs: number): Promise<Uint8Array>;   // 最多等 deadlineMs，可能返回空
  purgeInput(): Promise<void>;                    // 尽力丢弃未消费输入
  close(): Promise<void>;                         // 必须幂等
  onClosed?(listener: () => void): () => void;    // 被动断开
}

interface TransportProvider {
  readonly kind: TransportKind;        // "serial" | "ble" | "usb"
  readonly label: string;              // "串口" / "蓝牙" / "USB"
  readonly supportsBaudRate: boolean;  // UI 据此决定是否显示波特率
  isAvailable(): boolean;              // 浏览器是否具备该硬件 API
  listDevices(): Promise<TransportDevice[]>;   // 不得弹授权框
  requestDevice(): Promise<TransportDevice>;   // 必须在用户手势中
  open(deviceId, options): Promise<ByteTransport>;
  watch?(onChange): () => void;        // 可选：设备插拔
}
```

- `ByteTransport` 的语义与桌面版 `SerialTransport` 完全对齐，因此 `serial_lwpkt.ts` 的请求-应答循环可以原样复用；`read(deadlineMs)` 在无数据时返回空数组而不是抛错，让上层 deadline 循环自然结束。
- `TransportProvider` 把“哪种硬件、怎么授权、怎么搬字节”收敛到一个对象。`TransportManager` 只认这个接口，所以新增 WebUSB 不需要改后端与页面。
- `onClosed` 是可选方法：老测试里的假传输没实现它，后端与 manager 都做了可选链处理。

### 6.2 TransportManager：互斥与事件

```ts
async open(kind, deviceId, options) {
  await this.close();                       // 先关闭旧传输（互斥）
  const provider = this.provider(kind);
  const device = (await provider.listDevices().catch(() => []))
    .find((item) => item.id === deviceId);
  const transport = await provider.open(deviceId, options);
  this.#active = { kind, device: device ?? { id: deviceId, label: deviceId }, transport };
  this.#activeOff = transport.onClosed?.(() => {
    if (this.#active?.transport !== transport) return;
    this.#active = null;
    this.#emit({ type: "disconnected", kind, device });
  }) ?? null;
  return this.#active;
}
```

要点：

- **互斥的唯一保证点**：`open()` 第一行就是 `await this.close()`。UI 在已连接时禁用切换按钮只是体验优化；绕过 UI 也不会出现串口与蓝牙同时打开。
- **失败不留半开状态**：`provider.open()` 抛错时 `#active` 仍是 `null`（赋值在其后），下一次连接不会被“上一次半开”卡住。
- **展示名回填**：`listDevices()` 失败不阻塞打开，退化为用 id 当展示名；Provider 的 `open()` 会给出更具体的错误。
- **被动断开需要两份订阅**：后端订阅读清本地状态，manager 订阅清 `#active` 并向 UI 广播。缺一份就会出现“界面已断开但后端仍认为已连接”或反之。
- `descriptors()` 同步返回 `{kind,label,available,supportsBaudRate}`；`isAvailable()` 只判断浏览器 API 是否存在，不发任何硬件请求。
- `register()` 会顺带订阅 Provider 的 `watch()`（如果实现），转成统一的 `devices-changed` 事件；重复注册同 `kind` 会覆盖旧 Provider。

### 6.3 ByteQueue：统一的等待语义

```ts
push(bytes)   // 追加并唤醒等待者
read(ms)      // 队列非空立即返回全部缓冲；否则最多等 ms；关闭后返回空数组
clear()       // purgeInput 使用
close()       // 清空并唤醒，之后 read 立即返回空
```

- 串口读泵和 BLE 通知回调都只做 `push()`，协议层只做 `read()`，两种传输的上行路径因此完全一致。
- `#wake` 只有一个等待者：后端 `#busy` 保证同一时刻只有一个 `read()`，与桌面版语义一致。
- `close()` 必须唤醒等待者，否则 `#request` 会一直挂到超时；`read()` 在关闭后返回空数组，让上层走正常的超时分支而不是抛错。
- BLE 的 `read()` 语义完全由队列提供——GATT 通知没有“流”，不能像 Web Serial 那样直接读 `reader`。

### 6.4 Web Serial：类型声明、端口注册表与授权

`lib.dom` 尚未包含 Web Serial 类型，为避免引入 `@types/w3c-web-serial`，这里手写最小接口：

```ts
interface WebSerialPortLike {
  open(options): Promise<void>;
  close(): Promise<void>;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
}
interface WebSerialLike {
  getPorts(): Promise<WebSerialPortLike[]>;
  requestPort(options?): Promise<WebSerialPortLike>;
  addEventListener?/removeEventListener?("connect" | "disconnect", …);
}
```

这样测试可以手写 `FakePort`，无需真实浏览器类型。

- `registry: Map<string, PortEntry>`、`nextId` 自增。
- `register(port)` 先遍历已有项，**用对象引用判等**：`getPorts()` 对同一物理端口会返回同一个 `SerialPort` 实例，因此能复用原 id。
- `id` 形如 `port-1`，稳定且不含硬件信息；`label` 由 `getInfo()` 的 VID/PID 生成，例如 `USB 串口 (VID:1A86 PID:7523)`，没有信息则退回 `串口设备 #n`。
- 为什么不用 COM 名：Web Serial 不暴露；为什么不用 VID/PID 当 id：同型号设备可能插多个，会冲突。

| 函数 | 行为 |
| --- | --- |
| `getSerialApi()` | 取 `navigator.serial`；缺失时抛中文提示（Chromium + https/localhost） |
| `refreshPorts()` | `getPorts()` → 注册 → 返回 `PortEntry[]`，只包含**曾经授权过**的端口 |
| `requestPort()` | 弹浏览器选择框 → 注册 → 返回；必须在用户手势中调用 |
| `getPortEntry(id)` | 按 id 取注册项，连接时使用 |
| `watchPortEvents(cb)` | 监听 `connect`/`disconnect`，返回取消函数；API 不可用时返回空函数 |

`WebSerialProvider` 把这些函数包装成统一接口：`listDevices()` 返回 `port-N`，`requestDevice()` 代理 `requestPort()`，`open()` 构造 `WebSerialTransport`，`watch()` 代理 `watchPortEvents()`。

### 6.5 Web Serial：打开、读泵与关闭

```ts
await port.open({
  baudRate, dataBits: 8, stopBits: 1,
  parity: "none", flowControl: "none", bufferSize: 4096,
});
reader = port.readable.getReader();
writer = port.writable.getWriter();
pump = readLoop();
```

- 固定 8N1、无流控，与固件 UART2 默认配置一致。
- `bufferSize: 4096` 给浏览器内部缓冲留余量，减少高频小包场景的丢字节风险。
- 打开后立刻拿 reader/writer 并启动读泵：**先开始消费，再允许写请求**，避免第一帧应答在无人读取时堆积。

```text
#readLoop:
  while (!closed):
    { value, done } = await reader.read()
    if done: break
    queue.push(value)          // 唤醒 read(deadlineMs)
  finally: queue.close()

close():
  closed = true → queue.close()
  reader.cancel()            // 打断挂起的 read()
  await pump                 // 等读泵退出，避免与 releaseLock 竞争
  reader.releaseLock()
  writer.close(); writer.releaseLock()
  port.close()
```

- `reader.read()` 在无数据时**永远不会 resolve**，读泵把它变成“队列非空或定时器到期”，超时逻辑才成立。
- 一次 `read()` 返回**当前全部缓冲字节**，`FrameDecoder` 支持一次喂入多帧并全部解析。
- 每一步独立 `try/catch`：设备拔出时 `cancel`、`close`、`releaseLock` 都可能抛 `InvalidStateError`/`NetworkError`，但关闭流程必须走完，否则端口会一直处于“已打开”状态，导致下次连接失败。
- `close()` 幂等：`#closed` 已置位时直接返回。传输层本身不限制并发写，并发安全由后端 `#busy` 保证。

### 6.6 Web Serial：`purgeInput()` 与热插拔

浏览器没有清 OS 缓冲的 API，`purgeInput()` 只做 `queue.clear()`。因此请求前还要 `decoder.reset()`，并让 `#request` 跳过 `from/to/cmd` 不匹配的帧，避免迟到应答被当成本次结果。极端情况下迟到帧与本次 CMD 相同（连续两次 READ_REG）理论上可能被误认，但串口是严格串行的，前一次未超时就不会发起下一次，概率极低。

`watchPortEvents()` 把浏览器事件转成 `"connect" | "disconnect"`，`WebSerialProvider.watch()` 再交给 manager 转成 `devices-changed` 事件：

- `connect`：UI 刷新设备列表（新设备通常仍需用户再次授权才会出现在 `getPorts()`）。
- `disconnect`：读泵退出 → `queue.close()` → `onClosed` → manager 补一次幂等 `close()` 释放读写锁并广播 `disconnected`，UI 自动回到未连接。

这样避开“设备已拔出但界面仍显示已连接”，也避免后续请求一直等到 2 s 超时。

### 6.7 BLE NUS：UUID 与连接

BLE 侧不定义新协议，直接用 Nordic UART Service 接管串口语义：

| 角色 | UUID | 方向 |
| --- | --- | --- |
| Service | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` | 服务发现 |
| 写特征 | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` | 主机 → 设备 |
| 通知特征 | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` | 设备 → 主机 |

打开流程：

```text
requestDevice():
  navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: "BUS" }],
    optionalServices: [NUS_SERVICE],
  })

open(deviceId):
  1. 从会话缓存或 getDevices() 找到 BluetoothDevice
  2. 校验设备名以 BUS 开头（名称为空时放行，避免误伤 Chrome 未返回 name 的已授权设备）
  3. 若 device.gatt.connected → 先 disconnect()，避免复用旧连接
  4. device.gatt.connect()
  5. getPrimaryService(NUS_SERVICE)
       └─ 找不到 → 抛“未找到 NUS 服务或特征…”（含三个 UUID）
  6. getCharacteristic(写特征) / getCharacteristic(通知特征)
  7. startNotifications() + addEventListener("characteristicvaluechanged", …)
  8. device.addEventListener("gattserverdisconnected", …)
```

为什么用 `filters: [{ namePrefix: "BUS" }]`：需求是只操作名称以 `BUS` 开头的 Bus Pirate 设备，避免选择框把附近所有 BLE 设备（耳机、手环等）都列出来。名称过滤**不依赖广播包中的 128 位 Service UUID**，所以仍然兼容不在广播包里带 NUS UUID 的固件；代价是固件必须在广播名称中带 `BUS` 前缀，否则浏览器不会列出该设备。

`BLE_DEVICE_NAME_PREFIX` 集中定义前缀（默认 `"BUS"`）。`listDevices()` 刷新已授权设备时也按同一前缀过滤：名称明确不以 `BUS` 开头的设备不展示，名称为空时保留（Chrome 的 `getDevices()` 有时不返回 `name`，丢弃会导致刷新后看不到已授权设备）；`open()` 再校验一次，防止绕过 UI 连接旧缓存设备。

`deviceId` 用 `BluetoothDevice.id`（浏览器分配的会话内标识）。BLE 没有 COM 名，展示名取 `device.name?.trim()`，为空时退回 `BLE 设备 <id 前 8 位>`。

### 6.8 BLE NUS：分片写、通知与断开

**写入分片**：BLE 单次写受 ATT MTU 限制，默认 MTU 23 时可用载荷 20 字节。传输层按 `chunkSize`（默认 20）切片，逐片 `await`，可选 `writeDelayMs` 作为丢包时的退避：

```text
write(bytes):
  for offset in 0..bytes.length step chunkSize:
    chunk = bytes.subarray(offset, offset + chunkSize)
    await #writeChunk(chunk)
    if (writeDelayMs > 0) await delay(writeDelayMs)
```

`#writeChunk` 优先 `writeValueWithoutResponse()`（吞吐高、不等 ACK），浏览器抛 `NotSupportedError` 时回退 `writeValueWithResponse()`，再回退 `writeValue()`。分片顺序由 `await` 保证，协议层看到的始终是完整帧。

**通知入队**：`characteristicvaluechanged` 回调里必须**复制**数据再入队：

```ts
const view = characteristic.value;   // 浏览器可能复用同一个 DataView
queue.push(
  new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice(),
);
```

**断开**：`gattserverdisconnected` 回调里 `queue.close()` + `emitClosed()`。manager 收到 `onClosed` 后清空 `#active` 并发 `disconnected`，UI 立即恢复未连接。BLE 没有全局插拔事件，因此 `BleNusProvider` 不实现 `watch()`；设备列表由 `getDevices()`（浏览器支持时）+ 本次会话 `requestDevice` 缓存组成。

**关闭顺序**：先移除事件监听、停止通知，再 `gatt.disconnect()`。设备已断电时这些调用会抛错，全部 `try/catch` 包住，保证 `close()` 幂等。

### 6.9 两种传输的对照

| 维度 | Web Serial | BLE NUS |
| --- | --- | --- |
| 授权 | `requestPort()` 只显示未授权端口 | `requestDevice()` 列出附近 BLE 设备 |
| 连接 | `port.open(8N1)` | `gatt.connect()` + 发现 NUS |
| 下行 | `writer.write(bytes)` | 按 20 字节分片写特征 |
| 上行 | 后台读泵 `reader.read()` | 通知回调 → `ByteQueue` |
| 单包上限 | 无（由浏览器分块） | 20 字节（默认 ATT MTU 23） |
| 波特率 | 需要 | 不适用（`supportsBaudRate = false`） |
| 被动断开 | 读泵异常 + `disconnect` 事件 | `gattserverdisconnected` |
| 清缓冲 | 清本地队列 | 清本地队列 |
| 吞吐 | 高（115200 及以上） | 受 MTU 与连接间隔限制，长帧明显慢于串口 |

### 6.10 断开、异常断开与资源释放

`ByteTransport` 的关闭契约：

- `close()` 幂等，重复调用不抛错；主动关闭不触发 `onClosed`。
- 被动断开先关内部队列，再触发 `onClosed`；监听器内可以安全地再调用 `close()`。
- `onClosed` 只通知，资源释放集中在 `close()`。

各场景的处理：

| 场景 | 串口 | 蓝牙 | 上层 / UI |
| --- | --- | --- | --- |
| 用户主动断开 | `queue.close` → `reader.cancel` → `await pump` → `releaseLock` → `writer.close` → `port.close` | `queue.close` → 移除通知/GATT 监听 → `stopNotifications` → `gatt.disconnect` | 后端清 `kind/port/baud`；UI 回到未连接 |
| 拔出 / 读流异常 | 读泵 `catch/finally` 关队列 → `onClosed` → manager 补 `close()` 释放锁与端口 | — | 广播 `disconnected`，刷新状态与设备 |
| GATT 异常断开 | — | `gattserverdisconnected` → 关队列、移除监听 → `onClosed` → manager 补 `close()` | 同上 |
| 打开失败 | `port.open()` 已成功但取流失败时立即 `close()` | 发现服务/特征失败先 `gatt.disconnect()` | 保持未连接 |
| 握手失败 | 清状态 + `manager.close()` | 清状态 + `manager.close()` | 提示“已连接但握手失败” |
| 页面刷新/关闭 | 浏览器释放；异步 `close()` 不保证完成 | 同左 | 无后台定时器残留 |

实现要点：

1. **主动关闭先退订再 close**：`TransportManager.close()` 先清 `active`、调用 `#activeOff()`，再 `transport.close()`，避免关闭动作反向触发 `disconnected`。
2. **被动断开补一次 close**：传输层被动断开时只关了队列；manager 在 `onClosed` 中登记 `#passiveClose = transport.close()`，再广播事件。这样 Web Serial 的 reader/writer 锁会被释放，BLE 的监听器也会被移除。
3. **重连前等待清理**：`TransportManager.open()` 和“无活跃连接”的 `close()` 都会 `await #passiveClose`，避免旧端口仍被锁住时发起新连接。
4. **BLE 被动断开也要解监听**：`#onDisconnected` 与 `close()` 共用 `#detachListeners()`；否则反复重连会在同一 `BluetoothDevice` 上累积监听器。链路已断时跳过 `stopNotifications()`（调用会抛 `NetworkError`）。
5. **串口半开保护**：`port.open()` 成功后若 `readable/writable` 不可用，`open()` 立即 `close()` 已打开端口。
6. **UI 定时器随连接状态停止**：MLX90614 自动轮询在 `connected=false` 时清除 `setInterval` 并复位开关，避免断开后继续发请求、刷“读取失败”。

不释放或延后释放的部分：

- 串口注册表（`Map<id, SerialPort>`）与 BLE 会话缓存保留到页面卸载，用于刷新后重连；它们不持有已打开的读写锁。
- 浏览器无法清 OS/控制器缓冲，`purgeInput()` 只清本地队列；迟到应答由协议层跳过。
- 页面刷新/关闭由浏览器释放设备，不依赖异步 `beforeunload` 清理。

## 7. LWPKT 协议层

文件：`src/serial/lwpkt.mjs`。

### 7.1 帧结构

```text
0xAA | FROM(1) | TO(1) | CMD(varint) | LEN(varint) | DATA… | CRC-8 | 0x55
```

- `ADDR_DEVICE = 0x01`、`ADDR_HOST = 0x02`。
- 请求：`FROM=HOST, TO=DEVICE`；应答：`FROM=DEVICE, TO=HOST`。
- `MAX_FRAME_DATA = 1024`。
- CRC-8 覆盖 `FROM..DATA`（含 CMD/LEN 的 varint 字节），反射多项式 `0x8C`、初值 0、无 xorout。

### 7.2 varint

- 小端 7 位分组，最高位表示“还有后续字节”。
- `MAX_VARINT_VALUE = 0x3FFF`（14 位），本项目命令码恒为 2 字节。
- 编码器对负数/超限值抛 `RangeError`，避免静默截断。

### 7.3 `FrameDecoder` 状态机

`push(bytes)` 的流程：

1. 把新字节追加进内部数组。
2. 循环调用 `#takeFrame()`：
   - 找 `0xAA`；不是则丢弃前面的字节（计入 `resynced`）。
   - 读 FROM/TO/CMD/LEN；不足则保留缓冲等待下一批。
   - LEN 超过 `MAX_FRAME_DATA` → 视为伪帧，丢弃 1 字节后重新同步。
   - 校验 STOP `0x55` 与 CRC；失败计入 `crcErrors`，丢弃 1 字节后重新同步。
   - 成功则切除该帧、返回 `{ from, to, cmd, data }`。
3. `reset()` 清空缓冲（不清统计）。

这种“失败只丢 1 字节”的策略保证在垃圾数据/半帧/错帧后能尽快重新对齐，而不会整段丢弃。

### 7.4 命令码与状态码

命令表（`CMD`）：

| 命令 | 值 | 用途 |
| --- | --- | --- |
| ECHO | 0x0101 | 链路握手 |
| PING | 0x0201 | 地址探测 |
| SCAN | 0x0202 | 总线扫描 |
| DETECT | 0x0203 | 设备检测（本工具未用） |
| READ_REG | 0x0204 | 读 8 位寄存器 |
| WRITE_REG | 0x0205 | 写 8 位寄存器 |
| READ_BLOCK | 0x0206 | 8 位寄存器块读（≤255） |
| WRITE_BLOCK | 0x0207 | 块写（本工具未用） |
| READ_RAW | 0x0208 | 无寄存器裸读（≤255） |
| WRITE_RAW | 0x0209 | 无寄存器裸写 |
| READ_MEM16 | 0x020A | 16 位地址读（≤1000） |
| WRITE_MEM16 | 0x020B | 16 位地址写（本工具未用） |
| CONFIG | 0x0210 | 查询与设置 I²C 引脚/频率 |
| RECOVER | 0x0211 | 总线恢复（9 个时钟） |
| SWAP | 0x0212 | 交换 SDA/SCL |
| CAPS | 0x0220 | 芯片能力与引脚方案协商（扩展） |
| BUS_SELECT | 0x0221 | 切换 I²C 实例/引脚方案（扩展） |
| STREAM_START | 0x0230 | 启动主动上报（LIS3DH 中断推送） |
| STREAM_STOP | 0x0231 | 停止主动上报（应答回累计帧数） |
| STREAM_DATA | 0x0232 | 设备→主机主动数据帧（无应答） |
| EEPROM_OPEN | 0x0301 | 打开 EEPROM |
| EEPROM_READ | 0x0302 | EEPROM 读（≤1000） |
| EEPROM_WRITE | 0x0303 | EEPROM 写（≤1000） |

状态码（`STATUS`）：0 OK、1 ERR_ARG、2 ERR_CRC、3 ERR_BUS、4 ERR_NOACK、5 ERR_NOTREADY、6 ERR_RANGE、7 ERR_UNSUPPORTED、8 ERR_INTERNAL。`STATUS_TEXT` 提供中文文案，`LwpktError` 同时携带 `status` 与 `kind`（`status`/`timeout`/`frame`/`crc`）。

### 7.5 载荷 codec

| 方向 | 函数 | 布局 |
| --- | --- | --- |
| 请求 | `encodeReadReg` | addr, reg |
| 请求 | `encodeWriteReg` | addr, reg, value |
| 请求 | `encodeReadBlock` | addr, reg, len |
| 请求 | `encodeReadRaw` | addr, len |
| 请求 | `encodeWriteRaw` | addr, data… |
| 请求 | `encodeReadMem16` | addr, regHi, regLo, len |
| 请求 | `encodePing` | addr |
| 请求 | `encodeEepromOpen` | deviceAddr, model |
| 请求 | `encodeEepromRead` | offset(u32), len(u16) |
| 请求 | `encodeEepromWrite` | offset(u32), data… |
| 请求 | `encodeConfigQuery` / `encodeConfigSet` | 空 / flags + [sda] + [scl] + [freq u32] |
| 请求 | `encodeCapsQuery` | 空 |
| 请求 | `encodeBusSelect` | busId, schemeId, freqHz(u32) |
| 请求 | `encodeStreamStart` | address, register, length, mode, periodMs(u16), intPin, count(u16) |
| 请求 | `encodeStreamStop` | 空 |
| 应答 | `decodeStreamStartResp` | status, mode, periodMs(u16), flags(bit0 中断支持) |
| 应答 | `decodeStreamStopResp` | status, frames(u32) |
| 主动帧 | `decodeStreamData` | address, seq(u16), length, bytes |
| 应答 | `decodeConfigResp` | status, sda, scl, freq u32 |
| 应答 | `decodeCapsResp` | status, version, machine, pinMode, flags, freqMin/Max, name, buses[], pins[](v2), defaultSda/Scl |
| 应答 | `decodeBusSelectResp` | status, sda, scl, freq u32, busId, schemeId |
| 应答 | `decodeSwapResp` | status, sda, scl |
| 应答 | `decodeReadRegResp` | status, value, u32 |
| 应答 | `decodeScanResp` | status, count, addresses |
| 应答 | `decodeReadBlockResp` | status, u16 len, bytes |
| 应答 | `decodeEepromOpenResp` | status, u32 capacity, u16 pageSize, addrBytes, ack |

所有多字节字段小端；应答首字节由 `takeStatus()` 检查，非 0 直接抛 `LwpktError`。

### 7.6 金帧（测试固定）

```text
ECHO 请求  AA 02 01 81 02 02 DE AD D5 55
ECHO 应答  AA 01 02 81 02 03 00 DE AD 39 55
PING 请求  AA 02 01 81 04 01 50 74 55
```

任何改动分帧、varint 或 CRC 的提交，都必须同步更新 `tests/lwpkt.test.ts` 中的金帧断言；这是与固件兼容性的“契约测试”。

## 8. 后端映射层

文件：`src/serial/serial_lwpkt.ts`，实现 `src/serial/backend.ts` 的 `I2cBackend`。

### 8.1 契约

```ts
interface I2cBackend {
  readonly kind: TransportKind | null;   // 当前活跃传输；未连接为 null
  status(): BackendStatus;               // 同步，只读内存状态
  transports(): TransportDescriptor[];   // 可用传输能力，UI 据此渲染切换
  listDevices(kind?: TransportKind): Promise<TransportDevice[]>;
  requestDevice(kind?: TransportKind): Promise<TransportDevice>;
  subscribe(listener: (event: TransportEvent) => void): () => void;
  connect(request: ConnectRequest): Promise<BackendStatus>;
  disconnect(): Promise<BackendStatus>;
  scan(start, end): Promise<ScanResult>;
  readBusConfig(): Promise<I2cBusConfig>;
  configureBus(patch: I2cBusConfigPatch): Promise<I2cBusConfig>;
  readBusCapabilities(): Promise<I2cCapabilities | null>;
  selectBus(busId, schemeId, freqHz?): Promise<I2cBusConfig>;
  swapBusPins(): Promise<I2cSwapResult>;
  recoverBus(): Promise<void>;
  read(address, register): Promise<{ value: number }>;
  write(address, register, value): Promise<{ written: boolean }>;
  readRegisters(address, start, length): Promise<number[]>;
  transfer(writeHex, readLength): Promise<unknown>;
  streamI2C(writeBytes, readLength): Promise<number[]>;
  startStream?(request: I2cStreamRequest): Promise<I2cStreamInfo>;
  stopStream?(): Promise<{ frames: number }>;
  subscribeStream?(listener: (frame: I2cStreamFrame) => void): () => void;
  eepromRead/eepromWrite(...): Promise<unknown>;
  close(): Promise<void>;
}

interface ConnectRequest {
  kind: TransportKind;   // "serial" | "ble" | "usb"
  deviceId: string;      // Provider 返回的设备 id
  baudRate?: number;     // 仅串口使用
  chunkSize?: number;    // 仅 BLE 使用，默认 20
  writeDelayMs?: number; // 仅 BLE 使用，默认 0
}
```

- `status()` 保持同步，因为 UI 需要频繁读取且不涉及 I/O；`kind` 变为可空，表示“当前活跃传输”。
- 后端不再自己管理串口列表，`transports()/listDevices()/requestDevice()/subscribe()` 全部转发给 `TransportManager`，因此新增传输时后端零改动。
- `connect` 仍保留 `connect(portId, baud)` 重载，等价于 `{ kind: "serial", deviceId: portId, baudRate: baud }`，用于兼容旧测试与旧调用点。

### 8.2 状态与设备

`BackendStatus = { connected, kind, port, baud, crcErrors, frames }`：

- `connected` 以 `#transport !== null` 为准；
- `kind` 为当前活跃传输，未连接时 `null`；
- `port` 存设备展示名（连接时由 manager 从 Provider 的设备列表回填）；
- `baud` 仅串口有值，蓝牙/USB 一律为 `null`；
- `crcErrors` 来自 `decoder.stats.crcErrors`，`frames` 是成功匹配的应答帧计数；
- UI 用 `crcErrors` 展示链路质量，用 `kind` 决定文案（串口/蓝牙）。

### 8.3 `connect` / `disconnect`

- 先断开旧连接，保证幂等；同时兼容旧重载 `connect(portId, baud)`。
- `kind === "serial"` 时 `validateBaud` 限定在桌面版同一份波特率表（9600–921600）；其它传输不校验波特率，`#baud` 记为 `null`。
- 打开失败统一包成“无法连接<传输>设备：…”，底层错误（未授权、GATT 失败、端口被占用）保留在冒号后的细节里。
- 握手失败时清空 `#transport/#kind/#port/#baud` 并 `manager.close()`，再抛“<传输>已连接但握手失败：…”。
- 连接成功后立即订阅 `transport.onClosed`，设备被动断开时清本地状态（manager 自己也会清 `#active`）。
- `disconnect` 调 `manager.close()` 后清状态；`close()` 是 `I2cBackend` 生命周期别名。

### 8.4 `scan`

- 校验 `0x08 ≤ start ≤ end ≤ 0x77`；
- 发 `SCAN`（空载荷）；
- `decodeScanResp` 得到固件扫描结果，再按请求区间过滤；
- 返回 `{ addresses, start, end }`，UI 直接渲染。

### 8.5 `read` / `write` / `readRegisters`

- `read`：`READ_REG` → `{ value }`。
- `write`：`WRITE_REG` → `{ written: true }`（固件状态非 0 已在解码时抛错）。
- `readRegisters`：校验 `start + length ≤ 0x100`，按 `MAX_BLOCK_LEN=255` 循环 `READ_BLOCK`，寄存器地址自增。这样既满足固件单帧上限，也能读完整 256 字节寄存器空间。

### 8.6 `transfer` / `streamI2C`

- `parseHex` 支持空格、逗号、分号、冒号、下划线、连字符分隔；奇数长度或非 hex 抛 `TypeError`。
- `readLength` 限制 0–4096。
- `transfer` 要求首字节存在；`streamI2C` 要求非空 `Uint8Array`。
- 纯写：`WRITE_RAW`；仅地址：`transfer` 报错、`streamI2C` 发 `PING`。
- 读：进入 `#readBurst`，见下节。

### 8.7 `#readBurst` 三分支

| 前缀长度 | 命令 | 单次上限 | 地址推进 |
| --- | --- | --- | --- |
| 0 | READ_RAW | 255 | 无 |
| 1 | READ_BLOCK | 255 | 8 位寄存器 `+chunk & 0xff` |
| ≥2 | READ_MEM16 | 1000 | 16 位地址 `+chunk & 0xffff` |

- 输出缓冲一次分配 `readLength`，每片按 `out.set(bytes, done)` 填充。
- 若固件返回字节少于请求，`subarray` 只拷贝实际长度，剩余保持 0；调用方可从 `bytesRead` 感知实际长度（`transfer` 用 `toTransferResult` 统计）。
- `prefix ≥ 2` 时只取前两字节作为 16 位地址，多余字节按桌面版语义忽略。

### 8.8 EEPROM

- 型号表 `EEPROM_TYPES`（0–12，对应 24C01–24C4096）来自 `protocol.mjs`，用于本地容量校验与展示名。
- `eepromRead`：本地校验 → `#openEeprom` → 分片 `EEPROM_READ` → 每片长度必须严格匹配。
- `eepromWrite`：`parseEepromWrite` 解析并校验 → `#openEeprom` → 分片 `EEPROM_WRITE`。
- `#openEeprom`：器件地址固定 `0x50`，`model = type + 1`；解析固件返回的 `capacity` 后再做一次范围校验（以固件为准）。
- `ack=0` 时抛 `LwpktError(status: ERR_NOACK)`，文案包含型号名与地址。

### 8.9 `#request`：异步请求-应答

```text
1. transport == null            → Error(`请先连接${#transportLabel()}后端。`)
                                        // 未连接时 #transportLabel() 返回“串口”
2. #busy == true                → waitBusy ? 等闸门释放后再发（stopStream 收口）
                                         : Error(`已有请求在进行中，请稍候。`)
3. #busy = true
4. await transport.purgeInput()
5. decoder.reset()
6. request = buildFrame(cmd, payload); await transport.write(request)
7. deadline = now + (responseTimeoutMs ?? 2000)
8. while (now <= deadline):
     frames = decoder.push(await transport.read(10))
     for frame of frames:
       if from != DEVICE || to != HOST: continue
       if cmd == STREAM_DATA: #dispatchStreamFrame(主动帧分发，不占用应答位)
       if cmd != 期望: continue
       frames++; return frame.data
9. 超时 → LwpktError(kind:"timeout"，含 #transportLabel() 与最后发送帧 hex)
10. finally: #busy = false
```

设计要点：

- **为什么串行**：一条链路同一时刻只能有一个在途请求，否则应答无法归属。`#busy` 直接拒绝并发（而不是排队），让 UI 的 busy 状态与后端一致，也避免用户连点造成队列堆积。
- **为什么先 purge 再 reset**：先丢掉本地残留字节，再清解码器，减少把旧帧当新帧的概率。
- **为什么跳过不匹配 CMD**：浏览器无法清 OS/控制器缓冲，迟到的旧应答可能先到；如果像桌面版一样抛错，用户会遇到大量“假失败”。跳过策略的代价是极端情况下可能等满 2 s 超时，但行为更稳定。
- **为什么 `read(10)` 而不是无限等**：保持与桌面版一致的轮询结构，让 deadline 由上层统一控制，传输层无需知道协议超时。
- **错误文案为什么动态**：串口与蓝牙共用同一个 `#request`，文案必须能回答“是哪条链路超时”。`#transportLabel()` 按 `#kind` 返回“串口/蓝牙/USB”，未连接时回退为“串口”以保持历史文案不变。
- **主动帧与应答共存**：`#request` 在匹配循环里额外识别 `STREAM_DATA`（设备主动上报）并直接分发，
  避免“请求-应答”把流式帧误当成不相关 CMD 丢弃；分发只在 `#streaming` 时生效。
- **stopStream 的 waitBusy 模式**：`#busy` 默认拒绝并发，但切模式时 configure 与 stopStream 几乎必然相撞；
  stopStream 传 `waitBusy: true` 后先等 `#busy` 闸门释放（`#waitBusyReleased`，均 20 ms，最长 3 s）再发
  `STREAM_STOP`，保证 STOP 一定排在在途请求之后；否则固件收不到 STOP 会持续推帧、下次 `STREAM_START` 被拒。
- `frames` 只统计成功匹配的应答，不包含 CRC 错帧；CRC 错帧由解码器统计。

### 8.10 总线参数（CONFIG / CAPS / BUS_SELECT）

对应 `docs/I2C_BUS_CONFIG.md`。

- `readBusConfig()`：发 `CONFIG` 空载荷，`decodeConfigResp()` 得到 sda/scl/freqHz。
- `configureBus(patch)`：校验 GPIO 0–63、无引脚表时禁用 43/44、SDA≠SCL、频率 1k–1M；
  若已读到 CAPS v2 引脚表，还要求引脚在表内、非保留且具备对应 SDA/SCL 角色，
  频率落在 `[freqMin, freqMax]`。组装 `encodeConfigSet()` 后发送，使用
  `busConfigTimeoutMs`（默认 5000 ms）。
- `readBusCapabilities()`：发 `CAPS`，`decodeCapsResp()` 解析 v1/v2；解析结果缓存到
  `#capabilities` 供 `configureBus()` 二次校验。遇到 `ERR_ARG` / `ERR_UNSUPPORTED` /
  `timeout` 返回 `null`（旧固件降级）并清空缓存，其他错误继续抛。
- `#clearConnection()` 同时清空 `#capabilities`，避免跨设备复用旧引脚表。
- `selectBus(busId, schemeId, freqHz)`：校验 1–255，freq=0 表示保持；发 `BUS_SELECT`，
  用 `decodeBusSelectResp()` 返回实际生效值。
- `swapBusPins()` / `recoverBus()`：空载荷，长超时。
- 设置类命令会重建总线，因此 `#request(cmd, payload, label, timeoutMs?)` 增加可选超时；
  普通请求仍用 2000 ms。
- 前端在连接成功后调用 `readBusConfig()` + `readBusCapabilities()`；失败不阻断连接。
  应用成功后清空扫描结果与已选地址。

### 8.11 流式主动上报（STREAM）

协议细节见 [docs/LIS3DH_STREAM_PROTOCOL.md](./docs/LIS3DH_STREAM_PROTOCOL.md)。后端侧要点：

- `startStream(request)`：发 `STREAM_START 0x0230`（计划：address/register/length/mode/periodMs/intPin/count），
  解码应答 `{ mode, periodMs, flags, intSupported }` 后置 `#streaming`，并启动接收泵；`intSupported=false` 时
  文案改为“固件回退为定时推送”。
- 接收泵 `#runStreamPump`：循环 `#withLock(() => transport.read(10))`，解出 `STREAM_DATA` 后调
  `#dispatchStreamFrame` 广播；`#busy`（请求-应答在途）时 `sleepMs(3)` 让位，传输异常时退避 10 ms
  由外部断开事件收口；`#streamPumpId` 递增使旧泵自然退出（stop/重连/断开都会失效旧泵）。
- `stopStream()`：幂等（未在推送中直接返回 0）；先清 `#streaming` 与旧泵 ID，再以 `waitBusy` 模式发
  `STREAM_STOP 0x0231`（等待在途请求完成后再发，最长 3 s），返回固件累计帧数；`disconnect()` 会先尝试
  `stopStream()`，失败不阻断断开流程。
- `#clearConnection()` 一并清 `#streaming`/泵 ID/计数，避免重连后旧泵继续跑。
- **帧读写互斥链 `#withLock`**：请求-应答与接收泵共用一把串行锁（`#lockChain`），先到先得、
  出错不断链——两者操作同一字节流，必须严格串行。

### 8.12 错误分类

| 错误 | 来源 | UI 表现 |
| --- | --- | --- |
| `Error("请先连接串口后端。")` | 未连接（默认文案） | toast + 失败历史 |
| `Error("请先连接蓝牙后端。")` | 已连过蓝牙后又被动断开 | toast + 失败历史 |
| `Error("已有请求在进行中，请稍候。")` | 重入 | toast |
| `LwpktError(kind:"timeout")` | 2 s 无匹配应答 | 含传输种类与最后发送帧 hex |
| `LwpktError(status: 1..8)` | 固件返回非 0 状态 | `STATUS_TEXT` 中文文案 |
| `LwpktError(kind:"frame")` | 应答长度/内容不符 | 例如 EEPROM 长度不符 |
| `RangeError` | 地址/长度/型号/电压越界 | 参数错误提示 |
| `TypeError` | hex 格式非法、命令流非法 | 参数错误提示 |
| `Error("无法连接串口设备：…")` | 串口打开失败（占用/驱动/授权） | 提示关闭占用程序 |
| `Error("无法连接蓝牙设备：…")` | GATT 连接失败/设备不在范围 | 提示重新选择并确认设备上电 |
| `Error("未找到 NUS 服务或特征…")` | 固件未启用 NUS 透传 | 提示核对三个 UUID |
| `Error("串口/蓝牙已连接但握手失败：…")` | ECHO 失败 | 提示固件/接线/波特率 |
| `LwpktError(status: 7)`（STREAM_START） | 旧固件不支持流式 | 提示固件需实现 STREAM，或改用轮询 / FIFO |

## 9. 器件控制器层

### 9.1 异步化改造原则

从桌面版复制后，控制器只做了两类修改：

1. 所有 `#hardware.xxx(...)` 调用前加 `await`，方法声明加 `async`。
2. 读寄存器的写法统一为 `const status = (await this.#hardware.read(...)).value`，避免把 `Promise` 或整个对象当数值用。

业务规则、文案、常量、寄存器地址一律未改——这是“复用已验证逻辑”的关键。

### 9.2 CH224A 的安全策略

- **0xFF 拦截**：总线上拉时读操作可能“成功”但全为 0xFF。若不拦截，0xFF 会被误判为“所有协议激活”，从而允许错误写入。因此 `readCapabilities` 在第一步就检查 `0x09`，命中即返回 `noResponse: true` 且不写任何配置。
- **写前校验**：固定档必须被电源广播；PPS/AVS 必须落在 APDO 范围内；>20 V 必须 EPR 置位；AVS 必须能力位置位。
- **写后确认**：每次写模式延时 120 ms 读 `0x09`；`0xFF` 视为掉电，`0` 视为握手失败，都抛错并提示“勿接负载、用万用表确认”。
- **只写寄存器**：`0x0A/0x51/0x52/0x53` 无法读回，写入结果只能通过状态位间接判断，返回 `writeOnly: true`。
- **QC 路径**：PD 未激活但检测到 QC/BC 时，按协议固定档白名单写入；明确提示“不做 PDO 校验、状态位不等于 VBUS 测量”。

### 9.3 MLX90614 的安全策略

- **PEC**：每次读 3 字节（low/high/pec），用 SMBus PEC 校验；失败不阻断读取，但 UI 会提示可能受干扰。
- **0xFFFF**：视为无响应/未上电，温度返回 `null` 而不是伪造数值。
- **RAM 只读**：写入直接拒绝，避免误写。
- **EEPROM 四步法**：擦除 → 延时 → 写值 → 延时 → 回读；返回 `matches` 与提示“部分参数需重新上电生效”。
- **发射率**：只允许 0.1–1.0，内部换算为 raw 后走 EEPROM 安全写。

### 9.4 LIS3DH 的读取与换算策略

- **地址自增位**：LIS3DH 的 I²C 子地址不会自动递增，多字节读必须把子地址最高位置 1
  （`0x28 | 0x80 = 0xA8`）。固件把寄存器字节原样下发，所以这条规则由调用侧保证。
- **块读回退**：部分固件/接线在块读时返回短包，`readSample()` 检测到不足 6 字节就退化为 6 次单字节读；
  `readMode` 随结果返回，UI 直接显示本次用的路径，便于联调。
- **换算与量程绑定**：`accRange` 由 `fullScale` 决定，改动 `FULL_SCALES` 必须同步面板的量程下拉
  与测试断言，否则会出现“切换量程后示值跳变 16 倍”。
- **12 位左对齐**：原始值低 4 位为 0，1 g 对应 16000 计数而不是手册的 1000；这就是换算用
  `16000/7282/3968/1280` 而不是 `1000/500/250/83` 的原因。
- **温度通道占用 ADC3**：`TEMP_EN=1` 后 `OUT_ADC3` 输出温度；`defaultConfig()` 默认关闭
  （`TEMP_CFG=0x80`，仅 ADC 上电）。
- **配置写后必回读**：`configure()` 不假设写入成功，返回 `matches` 与回读六个字节；UI 用回读值
  刷新表单，避免界面与硬件不一致。
- **输出模式三档**：低功耗 8 位 / 正常 10 位 / 高分辨率 12 位（`OUTPUT_MODES`），LPen 与 HR 的
  非法组合被三按钮互斥从结构上排除；三档数据统一左对齐 16 位，共用同一组 `accRange` 除数。
- **FIFO 与轮询互斥**：`FIFO_EN=1` 后必须读 FIFO（读即弹出一级）；FIFO 批量模式先读
  `FIFO_SRC` 的 FSS 待读组数（满级时保守取 31），并按 `fifoIntervalHint`（阈值 ÷ ODR）给出建议读取周期。
- **中断推送的性能路径**：接收泵在无请求时每轮 `read(10)` 取帧；样本经
  `latestSampleRef` + `requestAnimationFrame` 节流到 60 fps 才进 React 状态——高 ODR 下
  DOM 更新量恒定，页面不被数据洪峰拖垮；速率/丢帧统计都在 ref 里累积，每 500 ms 才刷一次 UI。
- **位域掩码归一化**：`REGISTER_FIELDS` 允许按手册“高位在前”写 `{ low: 7, high: 4 }`，
  `describeRegister()` 用 `Math.min/Math.max` 归一化后再算 mask；否则 `1 << (high - low + 1)` 会得到负位移。

## 10. API 适配层与类型契约

文件：`src/api.ts`、`src/types.ts`。

### 10.1 单例装配

```ts
const backend = new SerialLwpktBackend();
const ch224 = new Ch224Controller(backend);
const mlx = new Mlx90614Controller(backend);
const lis3dh = new Lis3dhController(backend);
```

整个页面共享一个后端实例：串口是独占资源，多个实例会互相抢端口；单例也让 `status()`、`frames`、`crcErrors` 的统计连续。

### 10.2 方法表

| 分组 | 方法 |
| --- | --- |
| 连接 | `status`、`transports`、`devices`、`requestDevice`、`connect`、`watchTransportEvents`、`disconnect` |
| I²C | `scan`、`read`、`write`、`transfer`、`eepromRead`、`eepromWrite` |
| CH224 | `ch224Discover`、`ch224Registers`、`ch224Capabilities`、`ch224ReadRegister`、`ch224WriteRegister`、`ch224RequestPower` |
| MLX | `mlxDiscover`、`mlxRegisters`、`mlxReadRegister`、`mlxWriteRegister`、`mlxReadTemperature`、`mlxReadEmissivity`、`mlxWriteEmissivity` |
| LIS3DH | `lis3dhDiscover`、`lis3dhRegisters`、`lis3dhReadSample`、`lis3dhReadTemperature`、`lis3dhConfigure`、`lis3dhReadRegister`、`lis3dhWriteRegister`、`lis3dhReadFifoStatus`、`lis3dhReadFifoBatch`、`lis3dhResetFifo`、`lis3dhFifoHint`、`lis3dhStartStream`、`lis3dhStopStream`、`lis3dhSubscribeStream` |

- 旧的 `serialPorts` / `requestPort` 已移除，统一为 `devices(kind)` / `requestDevice(kind)`；
- 连接方法从 `connect(portId, baud)` 改为 `connect({ kind, deviceId, baudRate })`，连接前不再需要判断“当前是哪种后端”；
- 其余 I²C/CH224/MLX 方法名与桌面版保持一致，面板组件几乎不需要改调用点。

### 10.3 为什么用 `as unknown as`

`.mjs` 纯逻辑层没有 JSDoc，TypeScript 会把返回对象推断成宽泛的 `string`/`number` 组合，与 `types.ts` 的联合字面量（如 `access: "read" | "write"`）不兼容。处理方式：

- 只在 `api.ts` 边界做 `as unknown as Promise<Types>`；
- 纯逻辑层与控制器内部保持原样，不为了类型而加一堆 JSDoc；
- 风险控制：`types.ts` 与面板 props 是唯一契约来源，改动 `.mjs` 返回结构时必须同步改类型与测试。

### 10.4 `types.ts` 的变化

- `BackendKind = TransportKind`（`"serial" | "ble" | "usb"`），不再是 `"ch341" | "serial"` 或 `"web-serial"`。
- `DeviceStatus = { connected, kind: TransportKind | null, port, baud, crcErrors, frames }`。
- `SerialPortSummary = TransportDevice`（兼容旧命名），新增 `TransportDevice` / `TransportDescriptor` / `TransportEvent` 等 re-export，UI 不需要直接 import `src/transport/*`。
- 删除 `BackendInfo`、`ApiResult`、`SpiTransferInput/Result`。
- CH224/MLX 的结果类型原样保留。
- LIS3DH 新增 `Lis3dhSample` / `Lis3dhConfig` / `Lis3dhRegisterDetail` / `Lis3dhReadMode`（poll/fifo/stream）/
  `Lis3dhFifoStatus` / `Lis3dhFifoBatch` / `Lis3dhFifoHint` 等契约；`FULL_SCALES` 的
  `mgPerDigit` 只用于展示，换算以 `accRange` 为准（两者关系见 9.4）。STREAM 相关传输类型
  （`I2cStreamRequest/Info/Frame`）定义在 `backend.ts`，经 `types.ts` re-export 给 UI。

## 11. 前端 UI

文件：`src/ui/App.tsx`（约 1280 行），面板复用桌面版。

### 11.1 页面结构

- 左侧栏：品牌、设备连接面板、I²C 参数面板、扫描卡片、导航（I²C / CH224A / MLX90614 / LIS3DH）、主题切换、页脚。
- 主区：按 `activePage` 渲染 I²C 操作台、CH224 面板、MLX 面板或 LIS3DH 面板。
- I²C 操作台：扫描卡片、寄存器读写卡片、原始传输 / EEPROM 标签页、最近操作。

### 11.2 状态模型

| 状态 | 说明 |
| --- | --- |
| `activePage` | `"i2c" \| "ch224" \| "mlx" \| "lis3dh"` |
| `status` | 后端状态（连接、传输种类、设备展示名、波特率、帧统计） |
| `transports` | `api.transports()` 的结果，渲染连接方式切换按钮 |
| `transportKind` | 当前选中的传输；已连接时切换按钮被禁用 |
| `devices` | 当前传输的设备列表；`null` 表示加载中，`[]` 表示无已授权设备 |
| `deviceId` / `baudRate` | 当前选择；波特率默认 115200，仅串口显示 |
| `refreshingDevices` | 防止刷新按钮重入 |
| `address/register/writeValue/...` | 各表单输入 |
| `activeTab` | `"register" \| "raw" \| "eeprom"` |
| `busy` + `busyRef` | 全局操作门闩 |
| `toast` | 3.5 s 自动消失 |
| `scanResult/transferResult` | 最近一次结果 |
| `busConfig` / `busCapabilities` | 当前 SDA/SCL/频率与芯片能力；断开时清空 |
| `history` | 最多 100 条，新的在前 |

`statusRef` 保存最新状态，供 `watchTransportEvents` 的回调读取，避免闭包拿到旧值；`transportKindRef` 同理，用于被动断开后刷新“当前选中的那种传输”的设备列表。

### 11.3 `run()` 统一执行器

```ts
async function run(operation, detail, action, describe) {
  if (busyRef.current) return;
  busyRef.current = true; setBusy(true);
  try {
    const value = await action();
    record(operation, detail, describe(value), true);
    await refreshStatus();
    return value;
  } catch (error) {
    record(operation, detail, message, false);
    notify(message);
  } finally {
    busyRef.current = false; setBusy(false);
  }
}
```

- 用 `busyRef` 而不是 `busy` 做立即判重：`setState` 是异步的，连点两次时 `busy` 仍是旧值。
- 成功后才 `refreshStatus()`：失败时状态通常没变，少一次无意义调用。
- `describe` 回调把结果转成人类可读字符串，历史记录与 UI 展示解耦。

### 11.4 连接与授权流程

- 挂载时 `refreshStatus()` + `refreshDevices(transportKind)`：`devices()` 不会弹授权框，可以静默执行。
- 切换串口/蓝牙时重新枚举对应设备并清空旧选择；已连接时按钮禁用，即使绕过也会被 `TransportManager` 互斥。
- 「＋ 选择〈传输〉设备」按钮 → `api.requestDevice(transportKind)`：必须在点击回调中调用；用户取消时浏览器抛 `NotFoundError`，UI 静默忽略（不弹错误）。
- 选择后 `refreshDevices(kind)` 再 `setDeviceId(device.id)`，确保下拉框包含新设备。
- 「连接串口 / 连接蓝牙」按钮：已连接则断开；未选设备则提示“请先选择并授权一个〈传输〉设备”；否则 `api.connect({ kind, deviceId, baudRate })`，仅当 `supportsBaudRate` 时传波特率。
- 连接面板显示传输种类、设备展示名、波特率（仅串口）与 CRC 错帧数；未连接时显示“未连接设备”。
- 浏览器缺少某个 API 时，该传输按钮禁用，并显示“当前浏览器不支持〈传输〉”提示。

### 11.5 热插拔与被动断开

```ts
useEffect(() => {
  void refreshStatus();
  void refreshDevices(transportKind);
  const stop = api.watchTransportEvents((event) => {
    if (event.type === "disconnected") {
      void (async () => {
        if (statusRef.current.connected) await api.disconnect();
        await refreshStatus();
        await refreshDevices(transportKindRef.current);
      })();
    } else if (event.kind === transportKindRef.current) {
      void refreshDevices(event.kind);
    }
  });
  return stop;
}, [refreshStatus, refreshDevices, transportKind]);
```

- 只订阅一次，切换传输时重建，卸载时取消。
- `disconnected` 先断开再刷新，避免后端仍持有已失效的 transport；串口拔出与 BLE `gattserverdisconnected` 走同一条路径。
- `devices-changed` 只在事件属于当前选中传输时刷新列表，不自动连接（授权与连接都应交给用户）。

### 11.6 历史记录与主题

- `record()` 用 `Date.now() + Math.random()` 生成 key，`slice(0, 100)` 限制长度。
- 历史包含操作、详情、结果、成功/失败，失败记录同时在 toast 中提示。
- 主题存 `localStorage["i2c-theme"]`，默认深色；读写都包 `try/catch`，隐私模式下也能工作。

### 11.7 器件页的连接归属

`Ch224Panel` / `Mlx90614Panel` / `Lis3dhPanel` 不带任何连接 UI（没有设备序号输入、没有连接/断开按钮、没有 `backendLabel` 分支）：

- 串口 / 蓝牙连接统一在「I²C 操作台」的侧栏「设备连接」建立，器件页与总线操作台共用同一个 transport 与同一条 LWPKT 会话。
- 面板只接收 `connected`、`busy`、`onGoConnect` 和各自的业务回调；`onGoConnect` 由 `App.tsx` 传 `() => setActivePage("i2c")`。
- 未连接时页面顶部渲染一行 `.page-connect-hint`，其中的 `I²C 操作台` 是可点击的 `hint-link`，直接跳到连接页，避免用户找不到入口。
- 因此器件页的入口不再重复顶部 hero 框；页面标题由 `intro-row` 统一给出（h1 随 `activePage` 切换）。

这样新增器件页时只需要写业务操作，连接状态由 `status.connected` 单向流入。

`Lis3dhPanel` 的区块划分（其它器件页可参照）：

| 区块 | 内容 | 数据来源 |
| --- | --- | --- |
| 01 读取模式与实时姿态 | 三种读取模式卡片 + 模式参数行（轮询间隔 / FIFO 周期 / 触发方式与 GPIO）、X/Y/Z 卡、`\|g\|`/Pitch/Roll/温度、`VectorScene`、推送帧/丢帧/实测 Hz | `lis3dhReadSample` / `lis3dhReadFifoBatch` / `lis3dhSubscribeStream`（60 fps 渲染节流）+ 每 10 次 `lis3dhReadTemperature` |
| 02 工作模式配置 | 输出模式三档/FS/ODR/BDU/INT1 路由/FIFO（启用/模式/阈值/复位）/温度 + 轴使能 + 六寄存器回读卡 | `lis3dhConfigure`（写后回读） |
| 03 手动寄存器 | 单字节读写结果卡 + 37 条地址表 + 写入警告 | `lis3dhReadRegister` / `lis3dhWriteRegister` / `lis3dhRegisters` |
| 04 性能参数 | 12 条性能与用法要点（复用 `.ch224-register-map` 的 6 行限高） | 面板内 `PERFORMANCE_ROWS` 常量 |
| 05 推荐流程 | 7 步操作顺序（含读取率与 ODR 配合、FIFO、中断推送） | 纯文案 |

- 纯展示文案（`PERFORMANCE_ROWS`、`KIND_LABELS`）留在面板内，**不进** `.mjs`：逻辑层只放可测试的换算与解码。
- `VectorScene` 不旋转场景：屏幕右 = +X、屏幕上 = +Z、屏幕外 = +Y，`translate3d(x*72, -z*72, y*72)`，
  |g| 上限 1.4 防溢出；12 个取样点 + 末端高亮。
- 轮询用 `busyRef`（全局忙锁）+ `pollingRef`（本地在途）双门闩；断开或 `autoOn=false` 时清 interval。
- 读取模式互斥由 `selectReadMode` 收口：切入 FIFO 自动启用 Stream FIFO，切入推送先写 INT1 路由
  再订阅 + `startStream`；退出/断开/卸载统一由 teardown effect 退订并 `stopStream`，
  用 `streamingRef` 防 effect 依赖环。
- 高速渲染优化：`handleStreamFrame` 只做 ref 累积 + RAF 节流提交；实测 Hz（500 ms 窗口）与
  丢帧（seq 差值）随节流一起刷新，避免每条样本触发一次 React 重渲染。

### 11.8 长表格限高与页脚备案

`styles.css` 里有两种“一览表”布局模式，改动时不要混用：

| 作用域类 | 表格 | `max-height` | 效果 |
| --- | --- | --- | --- |
| `.ch224-register-map` | `.ch224-register-map-table`（MLX「全部地址功能一览」、CH224A「寄存器地址与读写属性」、LIS3DH「性能参数与用法要点」） | `212px` | 表头 + 6 行，超出表内滚动 |
| `.ch224-register-dump` | `.ch224-register-table`（CH224A 状态与 Source Capabilities 原始数据） | `190px` | 表头 + 6 行 |
| （无修饰） | `.ch224-param-table-inner`（「各 PDO 全部参数」） | 继承基础 `460px` | 不限 6 行，PDO 数量不定 |

算式的来源：

- map 表行高 `≈ 29.8px = 8px × 1.6（line-height）+ 8 + 8（padding）+ 1（border）`；
  `212 = 2（容器上下边框）+ 29.8（表头）+ 6 × 29.8`。
- dump 表行高 `≈ 27px = 8px × 1.5 + 7 + 7 + 1`；`190 ≈ 表头 27 + 6 × 27`。
- 限高写在**作用域类**而非 `.ch224-register-table-wrap`：后者还被「各 PDO 全部参数」和
  「状态与 Source Capabilities 原始数据」共用，全局加限高会把 PDO 列表一起压扁。
- 表头依靠 `position: sticky; top: 0` 吸顶，背景用不透明的 `var(--panel-raised)`，否则滚动时文字重叠。
- map 表带 `min-width: 680px`：窄屏走容器横向滚动，单元格不折行，行高才能稳定在 29.8px；
  若改字号 / 行距 / padding，必须同步重算 `max-height`。

页脚备案号：

```tsx
<footer className="footer">…三个 span（品牌 / 传输说明 / 隐私）…</footer>
<div className="site-filing">© 2026 · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">粤ICP备2025393310号-2</a> · 粤公网安备 44030002011217号</div>
```

- 单页应用，`App.tsx` 只写一处，I²C / CH224A / MLX90614 / LIS3DH 四页共用。
- `.site-filing`：居中、`8px`、`var(--text-muted)`；链接 `color: inherit; text-decoration: none`，hover 才下划线。
- 文案与主站 `public/index.html` 页脚一致（同一备案主体），修改时两边同步。

### 11.9 I²C 操作台的两栏结构

```text
.workspace（grid-template-columns: 310px minmax(0, 1fr); gap: 18px; align-items: start）
├─ aside.sidebar            设备连接 / I²C 参数 / 地址扫描
└─ div.operations-column    右栏：display: grid + gap 18px + align-content: start
   ├─ section.operations-panel
   └─ section.history-panel
```

- 「操作记录」必须包在 `.operations-column` 里。直接放在 `.workspace` 下会落到第二行并横跨两列
  （占满整行）；用 `grid-row` / `margin-left` 硬摆也不行：侧栏（约 950px）远高于
  `operations-panel`（`min-height: 519px`），会在中间留出约 400px 竖向空白。
- `.history-panel` 基础规则有 `margin-top: 17px`，右栏内用 `.operations-column .history-panel { margin-top: 0 }`
  清零，否则叠加在 18px `gap` 上变成 35px。
- `.operations-column` 自身与 `.operations-column > *` 都要 `min-width: 0`，否则 680px 宽的表会把右栏撑破。
- `≤820px` 媒体查询把 `.workspace` 改为单列，右栏自然落到侧栏下方，不需额外规则。

## 12. 测试设计

### 12.1 分层策略

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/ch224.test.mjs` | CH224A 协议状态位、固定 PDO / PPS / EPR AVS 解码、能力汇总 |
| `tests/lwpkt.test.ts` | varint、CRC、金帧、`FrameDecoder` 再同步、各命令 codec、状态码、CONFIG/CAPS/BUS_SELECT 金字节 |
| `tests/protocol.test.ts` | 地址/字节/长度/EEPROM 校验、`parseHex`、`toTransferResult` |
| `tests/mlx90614.test.ts` | PEC、温度换算、发射率、EEPROM 写流程（纯逻辑） |
| `tests/lis3dh.test.ts` | 0xA8 自增地址、16 位符号扩展、量程除数、六字节解码/倾角、温度换算、输出模式三档（含 LPen+HR 禁止组合与 legacy 兼容）、ODR 双速率、INT1 路由、FIFO 编码/阈值钳制/`decodeFifoSrc`/`fifoIntervalHint`、批量解码与六寄存器配置往返 |
| `tests/serial_lwpkt.test.ts` | 后端方法面 ↔ 帧、握手、超时、范围过滤、注入点、STREAM 请求金帧/接收泵分发/停止帧数/旧固件拒绝 |
| `tests/web_serial_transport.test.ts` | 打开参数、读泵、超时、purge、close、被动断开/半开回滚 |
| `tests/transport.test.ts` | `ByteQueue`、`TransportManager` 互斥/被动断开、BLE 分片/通知/Provider |

合计 102 项，全部纯内存，无需浏览器与硬件。其中 `tests/transport.test.ts` 11 项，专测“与具体硬件 API 无关”的传输公共层（含 manager 被动断开补 close、BLE 监听器解绑）；`tests/web_serial_transport.test.ts` 7 项，覆盖读泵异常与 `port.open()` 后取流失败的回滚，因此后续加 WebUSB 时可以复用同套假对象扩展。

### 12.2 `FakePort`

```ts
class FakePort implements WebSerialPortLike {
  readable = new ReadableStream({ start(c) { this.controller = c } });
  writable = new WritableStream({ write(chunk) { this.written.push(...) } });
  async open(options) { this.options = options }
  push(bytes) { this.controller.enqueue(bytes) }
  async close() { this.controller.close() }
}
```

- 用 `push()` 模拟设备上行数据，验证读泵把数据搬进缓冲。
- 记录 `open` 参数，断言 8N1、波特率、bufferSize。

BLE 侧用 `FakeCharacteristic` / `FakeDevice` / `FakeGatt` 模拟 GATT：通知回调通过 `emit(value)` 触发，断言数据被**复制**入队（后续修改原 `DataView` 不影响已入队内容），断开通过 `emitDisconnected()` 触发并验证 `onClosed`。

### 12.3 `FakeTransport`

- 内部持有 `FrameDecoder`，`write()` 解析请求帧。
- 按 `responder(cmd, data)` 生成同 CMD 的应答帧（`buildFrame` 的 from/to 反向），放入 `outbox`。
- `read()` 从 outbox 取数据；为空时 `await delay(2)` 让出事件循环，模拟真实轮询。
- 可配置“静默”模式（不回帧）验证握手超时。

### 12.4 注入点

```ts
new SerialLwpktBackend({
  responseTimeoutMs: 200,
  transportFactory: async () => fakeTransport,
  listPorts: async () => [{ id: "p1", label: "Fake" }],
});
```

- `transportFactory` 让后端跳过 `navigator.serial` / `navigator.bluetooth` 与具体 Transport。
- `listPorts` 替代浏览器授权枚举；注入时 manager 只注册一个假串口 Provider，不注册 BLE。
- 需要验证互斥时直接构造 `TransportManager` 并注册两个假 Provider，断言打开第二个时第一个已 `close()`。
- 注入点只在构造参数里，生产代码不感知，也不污染公开 API。

### 12.5 关键断言

- ECHO 请求逐字节等于金帧。
- READ_REG 请求帧头为 `AA 02 01 84 04 02 50 00`。
- WRITE_RAW（`transfer("A00001", 0)`）帧头为 `AA 02 01 89 04`。
- 扫描 `scan(0x50, 0x50)` 只返回 0x50。
- 静默设备在握手阶段报“〈传输〉已连接但握手失败”。
- 未连接时任何操作都报“请先连接串口后端”（默认文案）。
- 未知 deviceId 抛 `RangeError`。
- `read()` 超时返回空数组且耗时 ≥ 设定值。
- `purgeInput()` 后 `read()` 立即返回空。
- `close()` 后 `read()` 返回空且可重复调用。
- `TransportManager` 打开第二种传输时，第一种 `close()` 被调用且 `active()` 指向新传输。
- BLE 写 30 字节时特征收到 `[20, 10]` 两片；通知数据被复制入队；`gattserverdisconnected` 后 `read()` 立即返回空且 `onClosed` 被调用。
- `BleNusProvider.requestDevice()` 使用 `filters:[{namePrefix:"BUS"}] + optionalServices:[NUS]`；`listDevices()` 过滤非 BUS 名称，`open()` 对旧缓存再做前缀校验；缺少 NUS 特征时 `open()` 抛错。
- LIS3DH：`OUT_AUTO_INC === 0xA8`；`0x3E80 → +1 g`、`0xC180 → -1 g`；
  `[0x80,0x3E,0x80,0xC1,0,0]` 解码得 `pitch=-45°`、`roll=-45°`；默认配置编码为
  `CTRL_REG1=0x57`、`CTRL_REG4=0x88`、`TEMP_CFG=0x80`，`decodeConfig()` 能往返；
  `describeRegister(0x23, 0x88)` 的 `FS` 字段显示 `±2 g`。
- LIS3DH 新增：输出模式三档编码（含 LPen+HR 禁止组合校验与 legacy 布尔兼容）、ODR code 8/9
  双速率、INT1 路由位、FIFO 寄存器编码与阈值钳制、`decodeFifoSrc`/`fifoIntervalHint`、
  `decodeAccelerationBatch` 与六寄存器 `decodeConfig()` 往返。
- STREAM：命令码 varint 映射（`B0/B1/B2 04`）、`STREAM_START` 载荷金帧
  `AA 02 01 B0 04 09 18 A8 06 01 00 00 04 00 00 3D 55`、应答解码、`STREAM_STOP` frames 与
  `STREAM_DATA` 多组往返；后端侧接收泵分发（seq 顺序）与旧固件拒绝路径。

### 12.6 未覆盖项

- CH224A 控制器的取电规则：桌面版有 `bridge/ch224.test.ts` 覆盖，Web 版本次未复制该测试，仅靠移植时保持逻辑不变 + 真机联调验证。
- 真实 USB 串口的打开/授权/拔出行为。
- 真实 BLE 的 GATT 连接、MTU 协商、系统配对与固件 NUS 透传时序（假对象只验证代码分支）。
- 固件真实应答的时序与 CRC。
- CH224/MLX/LIS3DH 的实际电气行为（需要实物与电源）。
- EEPROM `model = type + 1` 的真实型号匹配。

这些必须在 Chrome/Edge + ESP32-Bus-Pirate 上联调验收（串口与蓝牙各跑一遍）。

## 13. 扩展指南

### 13.1 新增一条 LWPKT 命令

1. `lwpkt.mjs` 的 `CMD` 加命令码；如需中文状态文案加到 `STATUS_TEXT`。
2. 写 `encodeXxx()` / `decodeXxxResp()`（`WriteCursor`/`ReadCursor`，小端，应答首字节 `takeStatus()`）。
3. `serial_lwpkt.ts` 在对应方法 `await this.#request(CMD.XXX, encodeXxx(...), "标签")` 并解码。
4. `tests/lwpkt.test.ts` 补 codec/金帧；`tests/serial_lwpkt.test.ts` 补 fake transport 往返。
5. UI 需要入口时：`api.ts` 加方法 → `App.tsx` 或面板接入。
6. 若是「设备主动上报」类型（参照 `STREAM_DATA`）：走接收泵 `#runStreamPump` + `#dispatchStreamFrame`
   分发给订阅者（`subscribeXxx()`）；测试用 `FakeTransport.enqueue()` 直投帧验证分发与 seq 顺序。

### 13.2 新增器件页面

1. 纯逻辑放 `src/serial/xxx.mjs`（不碰浏览器 API）。
2. 控制器 `xxx.ts` 构造注入 `I2cBackend`，方法全 `async`。
3. `types.ts` 补结果类型；`api.ts` 单例装配并收口类型。
4. `App.tsx` 增加页面枚举、导航项、`run()` 包装；面板只传 `connected`、`busy`、`onGoConnect` 与业务回调，连接在「I²C 操作台」统一建立。

LIS3DH 页就是按上述步骤落地的参照：`lis3dh.mjs`（纯逻辑）→ `lis3dh.ts`（控制器）→
`types.ts` + `api.ts` → `Lis3dhPanel.tsx` + `App.tsx` 导航/路由 + `styles.css` 的 `.lis3dh-*` 样式 →
`tests/lis3dh.test.ts`。新增时记得同步把 `deno.json` 的 `check` 入口加上新控制器。

### 13.3 新增一种传输（以 WebUSB 为例）

后端只依赖统一接口，因此新增传输不需要改 `serial_lwpkt.ts`、器件层与页面结构：

1. **扩展类型**：`TransportKind` 已包含 `"usb"`，`TransportDescriptor` / `ConnectRequest` 无需改。
2. **实现 Provider**：新建 `src/usb/usb_transport.ts`，实现 `TransportProvider`：
   - `isAvailable()`：`"usb" in navigator`；
   - `listDevices()`：`navigator.usb.getDevices()`（已授权设备）；
   - `requestDevice()`：`navigator.usb.requestDevice({ filters })`（用户手势内）；
   - `open()`：`device.open()` → `selectConfiguration()` → `claimInterface()` → 构造实现 `ByteTransport` 的对象；
   - 上行：批量/中断 `transferIn` 循环 → `ByteQueue.push()`；
   - 下行：`transferOut` 按端点包长分片；
   - `close()`：`releaseInterface()` + `device.close()`，幂等。
3. **注册**：`serial_lwpkt.ts` 的 `createManager()` 里 `manager.register(new UsbProvider())`；现有后端代码零修改。
4. **UI**：连接方式按钮由 `api.transports()` 自动多出一个；`supportsBaudRate: false` 自动隐藏波特率控件。
5. **测试**：参照 `tests/transport.test.ts` 的假 GATT 写法，用假 USBDevice 验证端点分片、被动拔出与告警分支。

同样的步骤也适用于 WebSocket 网关、Electron IPC 等“非浏览器原生”传输：只要实现 `ByteTransport` 与 `TransportProvider` 即可。

### 13.4 支持 SPI 的路径

当前固件没有 SPI 命令。若未来固件新增：

1. 在 `lwpkt.mjs` 加 `SPI_TRANSFER` 等命令与 codec。
2. `backend.ts` 恢复 `spiTransfer` 契约；`serial_lwpkt.ts` 实现映射。
3. `types.ts` 恢复 SPI 类型；`api.ts` 加方法；UI 恢复 SPI 页。

浏览器本身不限制 SPI，只受固件能力限制。

## 14. 已知限制与后续

- 串口与蓝牙均仅 Chromium 内核浏览器；Firefox/Safari 不支持。
- 必须安全上下文：`localhost`/`127.0.0.1` 或 https；局域网 IP 需自建 HTTPS 反代。
- 串口不支持 SPI（固件限制）。
- BLE 单包 20 字节，长帧（EEPROM 读写）吞吐明显低于串口；写间隔可调但会进一步降低吞吐量。
- BLE 设备选择只列出名称以 `BUS` 开头的设备（不依赖广播 UUID，兼容不带 NUS UUID 的固件）；前缀由 `BLE_DEVICE_NAME_PREFIX` 定义，固件名称不符时不会出现在选择框。
- BLE 无全局插拔事件，设备列表只能在授权/刷新时更新；串口可直接利用浏览器 `connect`/`disconnect`。
- EEPROM `model = type + 1` 为待校准假设。
- STM32 的 I²C 引脚由 AF/remap 固定，前端只能选择固件 CAPS 上报的方案；旧固件降级为自由引脚模式。
- ESP32 的可用引脚由 CAPS v2 自由引脚表上报表述；未上报时退回 0–63 数字输入（禁 43/44）。
- CAPS/BUS_SELECT 需固件配合；STM32 固件按 `docs/STM32-I2C-PINMAP.md` 适配，
  ESP32 固件按 `docs/ESP32_FIRMWARE_PROTOCOL.md` 适配。
- 页面刷新/关闭标签页由浏览器释放设备（不保证异步 `close()` 执行）；历史记录、串口注册表与 BLE 会话缓存只在内存中。
- 浏览器无法清 OS/控制器缓冲，极端时序下可能出现一次超时，重试即可。
- 多标签页同时打开时，同一种设备只能被其中一个占用；另一种传输也会被同一固件排斥，连接失败时先关闭其他标签页。
- LIS3DH「中断推送」需固件实现 STREAM 命令（`0x0230`–`0x0232`）并把 INT1 接至主控 GPIO；
  115200 串口下单帧约 1.6 ms，逐样本推送上限约 640 帧/s，更高 ODR 需提高波特率或用 FIFO 成批推送；
  旧固件启动推送会得到明确提示，可继续用轮询 / FIFO 模式。

## 附录 A：命令与状态码速查

命令：ECHO 0x0101、PING 0x0201、SCAN 0x0202、DETECT 0x0203、READ_REG 0x0204、WRITE_REG 0x0205、READ_BLOCK 0x0206、WRITE_BLOCK 0x0207、READ_RAW 0x0208、WRITE_RAW 0x0209、READ_MEM16 0x020A、WRITE_MEM16 0x020B、CONFIG 0x0210、RECOVER 0x0211、SWAP 0x0212、CAPS 0x0220、BUS_SELECT 0x0221、STREAM_START 0x0230、STREAM_STOP 0x0231、STREAM_DATA 0x0232、EEPROM_OPEN 0x0301、EEPROM_READ 0x0302、EEPROM_WRITE 0x0303。

状态：0 OK、1 参数非法、2 CRC 失败、3 总线错误、4 无应答、5 未就绪、6 范围越界、7 不支持、8 内部错误。

## 附录 B：常见错误信息索引

| 信息 | 含义 / 处理 |
| --- | --- |
| 当前浏览器不支持 Web Serial API | 换 Chrome/Edge，使用 localhost 或 https |
| 当前浏览器不支持 Web Bluetooth API | 换 Chrome/Edge，开启系统蓝牙，使用 localhost 或 https |
| 端口不存在或尚未授权，请重新选择串口 | 重新点「选择串口」授权 |
| 蓝牙设备不存在或尚未授权，请重新选择蓝牙设备 | 重新点「选择蓝牙设备」授权 |
| 无法连接串口设备：… | 关闭占用程序（串口助手/Arduino IDE），检查驱动 |
| 无法连接蓝牙设备：… | 确认设备上电、在范围内、未被其它主机占用；重新授权 |
| 未找到 NUS 服务或特征（6e400001/2/3） | 固件未启用 BLE NUS 串口透传，或选错了设备 |
| 串口/蓝牙已连接但握手失败：… | 固件不是 ESP32-Bus-Pirate、波特率不符、接线错误、NUS 未桥接到 UART |
| 请先连接串口后端 | 先点「连接串口」（默认文案，也用于未连接时的蓝牙） |
| 已有请求在进行中，请稍候 | 上一次操作未完成，等待 busy 结束 |
| …超时：串口/蓝牙在 2000ms 内未收到应答帧（最后发送 …） | 链路/固件无响应；核对帧 hex 与固件日志 |
| 器件无应答 | 器件未上电、地址错误、缺上拉 |
| 读写范围超出固件报告的容量 | EEPROM 型号选择与实际芯片不符 |
| CH224 读写异常：状态寄存器 0x09 读回 0xFF | 模块未上电或 I²C 无应答 |
| 读数全为 0xFF：器件疑似未上电 | MLX90614 供电/接线/上拉问题 |
| 固件不支持该命令（STREAM_START） | 旧固件未实现流式推送；升级固件或改用轮询 / FIFO 模式 |

## 附录 C：术语

| 术语 | 说明 |
| --- | --- |
| LWPKT | 固件使用的轻量二进制帧协议（0xAA…0x55，varint + CRC-8） |
| PDO / APDO | USB PD 的固定/可调电源能力对象 |
| PPS / AVS | PD 的可编程电源 / 可调电压供电 |
| PEC | SMBus 包错误校验码，MLX90614 读事务使用 |
| 读泵 | 常驻 `reader.read()` 循环，把串口字节搬进内存队列 |
| 金帧 | 逐字节固定的参考帧，用于锁定协议兼容性 |
| ByteTransport | 已打开的双向字节流抽象（write/read/purgeInput/close/onClosed） |
| TransportProvider | 一种传输的提供者（授权、枚举、打开），如 Web Serial / BLE NUS |
| TransportManager | 注册 Provider、保证单活跃连接、广播事件的互斥管理器 |
| ByteQueue | 串口读泵与 BLE 通知共用的字节队列，提供带 deadline 的 `read()` |
| STREAM_DATA | 设备主动上报帧（`0x0232`）：address/seq/length/data，上位机接收泵分发 |
| NUS | Nordic UART Service，BLE 串口透传事实标准（服务 + 写特征 + 通知特征） |
| ATT MTU | BLE 属性协议最大传输单元；默认 23，可用载荷 20 字节 |
| GATT | 通用属性配置文件，BLE 服务/特征的组织方式 |
