# 架构总览

本文档描述 myWebBun 仓库的整体架构、模块关系、数据流向和技术选型，帮助开发者快速建立系统全貌认知。

## 1. 系统定位

这是一个**物联网设备调试与数据采集平台**，围绕三个核心场景构建：

- **设备测试**：加热垫、BLE 传感器、STM32  MCU 的功能验证与参数调试
- **固件烧录**：通过浏览器或桌面应用完成 STM32 USART Bootloader 烧写
- **数据管道**：MQTT 传感器消息采集、规范化后写入 InfluxDB 时序数据库

所有浏览器工具由一个统一入口聚合托管，桌面应用为独立可执行文件，MQTT 后端按语言分三套等价实现供部署选择。

## 2. 顶层架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户浏览器 / 桌面窗口                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │stoov-test│ │instrument│ │stm32flash│ │plotter   │ │i2c       │ ...       │
│  │(加热垫)   │ │(BLE仪器) │ │(STM32)   │ │(串口绘图)│ │(I²C 调试)│           │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│       │ Web Serial / Web Bluetooth / WebUSB / MQTT.js           │
└───────┼──────────────┼──────────────┼────────────┼──────────────┘
        │              │              │            │
   ┌────▼──────────────▼──────────────▼────────────▼──────────────┐
   │              根目录主站 (Deno 2 + Hono)                       │
   │              127.0.0.1:30000                                 │
   │  ┌──────────────────────────────────────────────────────┐    │
   │  │ 静态路由层：URL → 子项目 dist/ 目录映射                │    │
   │  ├──────────────────────────────────────────────────────┤    │
   │  │ API 层：/api/iot-data, /api/stoov/mqtt-config,      │    │
   │  │        /api/stoov/test-data/download, /health        │    │
   │  ├──────────────────────────────────────────────────────┤    │
   │  │ SQLite 读取：yaokong.db, Heating.db                  │    │
   │  └──────────────────────────────────────────────────────┘    │
   └──────────────────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────┐
   │              桌面封装层 (deno compile → .exe)                 │
   │  ┌─────────────────┐  ┌──────────────────────────────────┐  │
   │  │ deno-desktop    │  │ stoovTest-desktop               │  │
   │  │ 多应用聚合快照   │  │ 本地 Hono + Win32 FFI 串口桥    │  │
   │  │ 端口 30000      │  │ + MQTT 后端桥 + SQLite 存储     │  │
   │  └─────────────────┘  │ 端口 30077                      │  │
   │                        └──────────────────────────────────┘  │
   │  ┌──────────────────────────────────────────────────────┐    │
   │  │ stm32WebFlasher-desktop                              │    │
   │  │ 本地服务 + Win32 FFI 串口桥（固件烧录专用）           │    │
   │  │ 端口 30000                                           │    │
   │  └──────────────────────────────────────────────────────┘    │
   └──────────────────────────────────────────────────────────────┘

   ┌──────────────────────────────────────────────────────────────┐
   │              MQTT → InfluxDB 数据后端（三选一部署）           │
   │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐     │
   │  │bun-mqtt-     │ │go-mqtt-      │ │rust-mqtt-        │     │
   │  │backend       │ │backend       │ │backend           │     │
   │  │健康端口 9000 │ │健康端口 9002 │ │健康端口 9004     │     │
   │  └──────┬───────┘ └──────┬───────┘ └──────┬───────────┘     │
   │         └────────────────┼────────────────┘                  │
   │                          ▼                                    │
   │                    InfluxDB 2.x                               │
   └──────────────────────────────────────────────────────────────┘
```

## 3. 模块关系

### 3.1 主站与前端子项目

主站 (`src/index.ts`) 是纯粹的**静态资源聚合器 + 轻量 API 网关**，不构建任何前端代码，仅将 URL 路径映射到各子项目的 `dist/` 或原生静态目录：

| URL 前缀 | 文件来源 | 构建方式 |
|---|---|---|
| `/` | `public/` | 无需构建 |
| `/stoov-test/` | `stoov-test/dist/` | `deno task build`（纯 Deno） |
| `/stoov-corr/` | `stoov-corr/` | 原生静态，无需构建 |
| `/instrument/` | `InstrumentTestLit/dist/` | `bun run build` |
| `/ws8623/` | `ws8623Demo/` | 原生静态，无需构建 |
| `/stm32flasher/` | `stm32WebFlasher/dist/` | `bun run build`（Vite） |
| `/WebSerialPlotter/` | `webSerialPlotter/dist/` | `bun run build`（Vite） |
| `/i2c/` | `i2c_web_tool/dist/` | `deno install && deno task build`（Vite） |
| `/usb-test/` | `usb-test/` | 原生静态，无需构建 |

统一构建命令：`bun run build`（串行）或 `bun run build:parallel`（并行），桌面应用和 MQTT 后端不在其中。

### 3.2 桌面封装与 Web 子项目

桌面应用采用**同步 + 补丁**模式将 Web 项目转为本地桌面版：

```
Web 子项目                    桌面封装
stoov-test/  ──deno task sync──▶  stoovTest-desktop/static/
stm32WebFlasher/ ──deno task sync──▶ stm32WebFlasher-desktop/static/
                                        │
                                   overlay/ 补丁文件
                                   ┌────┴────┐
                                   │注入原生串口│
                                   │替换 MQTT  │
                                   │移除 PWA   │
                                   └─────────┘
                                        │
                                   deno compile
                                        │
                                   ▼ .exe 分发
```

核心替换逻辑：
- **Web Serial → Win32 FFI 串口**：`serial-ffi.ts` 通过 `Deno.dlopen("kernel32.dll")` 调用 CreateFile/ReadFile/WriteFile，`serial-bridge.ts` 将其包装为 WebSocket 协议供前端使用
- **MQTT.js → 后端桥接**：桌面进程持有 MQTT 连接，前端通过 WebSocket 中继，同时拦截 "save" 主题写入本地 SQLite
- **PWA 移除**：离线场景不需要 Service Worker 和 manifest

### 3.3 MQTT 后端三语言等价实现

三个后端是**同一数据管道的不同语言版本**，功能完全等价：

```
传感器设备 ──MQTT──▶ Broker ──subscribe──▶ [bun | go | rust]-mqtt-backend
                                                  │
                                         ┌────────┼────────┐
                                         │  JSON 解析       │
                                         │  Zod/结构校验     │
                                         │  消息去重(LRU+TTL)│
                                         │  7层字段分类      │
                                         │  时间戳归一化     │
                                         │  批量写入         │
                                         └────────┼────────┘
                                                  ▼
                                           InfluxDB 2.x
                                     measurement: sensor_reading
```

三套实现的关键参数完全一致：

| 参数 | 值 |
|---|---|
| 订阅主题 | `sensors/#` |
| QoS | 1 (At Least Once) |
| 会话 | 持久化 (`clean: false`) |
| 测量名 | `sensor_reading` |
| 批量大小 | 500 条 |
| 刷新间隔 | 1000ms |
| 时间精度 | 纳秒 |
| 去重策略 | 显式 messageId 优先，回退哈希（wyhash/xxhash） |
| 优雅关闭 | 5s 超时，顺序：health → dedup → MQTT → InfluxDB |

**7 层字段分类器**（三语言实现规则一致）：

```
跳过名单 → null 值 → 标签字段 → 浮点数 → NaN 跳过 → 布尔值 → 字符串(含数字提示强转)
```

## 4. 数据流向

### 4.1 传感器数据管道（云端）

```
传感器/设备
    │
    │ MQTT publish (sensors/{deviceId}/...)
    ▼
MQTT Broker (EMQX)
    │
    │ subscribe (QoS 1, persistent session)
    ▼
MQTT 后端 (bun/go/rust)
    │
    │ 1. JSON 解析 + 校验
    │ 2. 去重 (LRU+TTL)
    │ 3. 字段分类 (tag/field/skip)
    │ 4. 时间戳归一化 → 纳秒
    │ 5. 构建 InfluxDB Point
    │
    │ batch write (500条/1s)
    ▼
InfluxDB 2.x
    │
    │ 查询 (Flux)
    ▼
前端展示 / CSV 导出
```

### 4.2 浏览器直连设备

```
浏览器页面
    │
    ├─ Web Serial ──▶ UART 设备（串口通信、固件烧录）
    │                  STM32 Bootloader: 115200 8E1
    │                  自定义协议: 可配置波特率 (最高 921600)
    │
    ├─ Web Bluetooth ──▶ BLE 设备（Nordic NUS / WS8623 FFF0）
    │                     GATT 连接 → 特征值读写 → 通知订阅
    │
    └─ WebUSB ──▶ USB 设备（批量传输、控制传输、等时传输）
                   需要用户授权、HTTPS 或 localhost
```

### 4.3 桌面应用数据链路

```
桌面 .exe
    │
    ├─ Win32 FFI (kernel32.dll)
    │   └─ serial-ffi.ts → NativeSerialPort
    │       └─ serial-bridge.ts → WebSocket /ws/serial
    │           └─ 浏览器前端（替代 Web Serial）
    │
    ├─ MQTT 后端桥接
    │   └─ npm:mqtt → WebSocket /ws/mqtt
    │       └─ 浏览器前端（替代直连 Broker）
    │           └─ 拦截 save 主题 → 本地 SQLite
    │
    └─ SQLite 存储
        └─ data_table / heating_data
            └─ CSV 导出（带 BOM，Excel 兼容）
```

## 5. 技术选型

### 5.1 运行时矩阵

| 运行时 | 用途 | 版本 |
|---|---|---|
| **Deno 2** | 主站服务、stoov-test 构建、i2c_web_tool 构建、桌面应用编译 | 2.x |
| **Bun** | 前端子项目构建（InstrumentTestLit, stm32WebFlasher, webSerialPlotter） | 1.x |
| **Go** | go-mqtt-backend 独立部署 | 1.27+ |
| **Rust** | rust-mqtt-backend 独立部署 | stable |
| **Node.js** | stm32WebFlasher CLI 模式 | 可选 |

### 5.2 框架与库

| 层级 | 选型 |
|---|---|
| Web 框架 | Hono (Deno/JSR) |
| 前端组件 | Lit 3, React 19, 原生 Web Components |
| 构建工具 | Vite 8, Bun bundler, Deno build.ts |
| MQTT 客户端 | mqtt.js (Bun/Node), Paho (Go), rumqttc (Rust) |
| 时序数据库 | InfluxDB 2.x (官方 SDK / 手写 Line Protocol) |
| 日志 | Pino (Bun), zap (Go), tracing (Rust) |
| 配置校验 | Zod (Bun), 手动校验 (Go/Rust) |
| 桌面串口 | Win32 FFI via `Deno.dlopen("kernel32.dll")` |
| 浏览器硬件 API | Web Serial, Web Bluetooth, WebUSB |
| CSS | Tailwind CSS 4 (webSerialPlotter), 原生 CSS (其他) |

### 5.3 硬件通信协议

| 协议 | 使用场景 | 子项目 |
|---|---|---|
| Web Serial (UART) | STM32 烧录、串口调试、仪器通信、I²C 桥接（串口） | stm32WebFlasher, webSerialPlotter, stoov-test, stoov-corr, InstrumentTestLit, i2c_web_tool |
| Web Bluetooth (BLE) | 加热垫控制、传感器数据采集、BLE 串口透传（NUS，I²C 桥接） | stoov-test, stoov-corr, InstrumentTestLit, ws8623Demo, i2c_web_tool |
| WebUSB | USB 设备调试 | usb-test |
| MQTT | 传感器数据上报、远程控制 | stoov-test, stoov-corr, 三个 MQTT 后端 |
| Win32 FFI (kernel32) | 桌面应用原生串口 | stoovTest-desktop, stm32WebFlasher-desktop |

## 6. 部署架构

### 6.1 云端部署

```
                    ┌─────────────┐
                    │  Nginx/Caddy │
                    │  (HTTPS + 反代)│
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
        主站 :30000   MQTT后端 :900x   MQTT Broker
        (Deno+Hono)  (bun/go/rust)    (EMQX)
              │            │
              │            ▼
              │      InfluxDB 2.x
              │
        ┌─────┴─────┐
        │ 静态资源   │
        │ dist/ 目录 │
        └───────────┘
```

- 主站默认监听 `127.0.0.1:30000`，由反向代理暴露
- MQTT 后端健康检查端口 9000/9002/9004，可选暴露
- 生产环境使用 systemd 管理服务进程

### 6.2 桌面分发

```
编译产物
├── bin/stoovTest-desktop.exe      (或 stm32WebFlasher-desktop.exe)
├── static/                        (同步后的 Web 资源 + 桌面补丁)
│   ├── index.html
│   ├── *.js
│   └── ...
├── config/                        (stoovTest-desktop: MQTT 配置)
└── data/                          (stoovTest-desktop: SQLite 数据目录)
```

### 6.3 端口分配

| 服务 | 默认端口 | 说明 |
|---|---|---|
| 根目录主站 | 30000 | Deno + Hono |
| deno-desktop | 30000 | 桌面聚合快照 |
| stoovTest-desktop | 30077 | 自动递增避免冲突 |
| stm32WebFlasher-desktop | 30000 | 桌面烧录工具 |
| bun-mqtt-backend 健康检查 | 9000 | |
| go-mqtt-backend 健康检查 | 9002 | |
| rust-mqtt-backend 健康检查 | 9004 | |
| InstrumentTestLit 开发服务器 | 3000 | 独立开发时 |

## 7. 构建依赖关系

```
bun run build (根目录)
├── stoov-test          → deno task build (纯 Deno)
├── InstrumentTestLit   → bun install && bun run build
├── stm32WebFlasher     → bun install && bun run build (Vite)
├── webSerialPlotter    → bun install && bun run build (Vite)
└── i2c_web_tool        → deno install && deno task build (Vite)

桌面编译 (独立)
├── stoovTest-desktop       → deno task sync → deno task compile
└── stm32WebFlasher-desktop → deno task sync → deno task compile

MQTT 后端 (独立)
├── bun-mqtt-backend    → bun install → bun run start
├── go-mqtt-backend     → make tidy → make run
└── rust-mqtt-backend   → cargo run
```

## 8. 关键设计决策

1. **Deno 为主、Bun 为辅**：主站和桌面应用使用 Deno，前端子项目构建仍用 Bun（Vite 生态兼容）
2. **三语言等价后端**：同一数据管道提供 Bun/Go/Rust 实现，按部署场景选择，核心逻辑（字段分类、去重、时间戳归一化）保持一致
3. **同步 + 补丁桌面化**：不 fork 前端代码，通过 `deno task sync` 复制源文件后施加字符串替换补丁，保持 Web 版和桌面版上游同步
4. **Win32 FFI 串口桥**：桌面应用通过 WebSocket 将原生串口暴露给浏览器前端，前端代码几乎零改动
5. **浏览器硬件 API 优先**：Web Serial / Web Bluetooth / WebUSB 减少驱动依赖，桌面场景退回 FFI 保证兼容性
6. **应用层去重**：不依赖 MQTT QoS 机制，在消费者端通过 LRU+TTL 缓存实现消息去重，兼容无 messageId 的慢变化传感器
7. **相对 base 的子路径部署**：`i2c_web_tool` 使用 Vite `base: "./"`，同一份 `dist/` 既能被独立 Hono 服务托管在根路径，也能挂到主站 `/i2c/`；代价是必须通过带尾斜杠的目录 URL 访问，`/i2c` 由主站 302 补齐
