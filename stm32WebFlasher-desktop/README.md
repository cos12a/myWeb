# stm32WebFlasher Desktop

这是从原始 `stm32WebFlasher` 项目拆出来的 **Windows 桌面版包装层**，不修改原项目任何功能与代码。

## 设计原则

- **原项目零改动**：`../stm32WebFlasher` 目录内容保持不变。
- **自包含分发**：桌面运行所需的页面、样式、脚本、文档图片与默认固件，全部 Copy 到本目录的 `static/` 中，编译后的 exe 无论从哪里启动都能定位资源。
- **本地磁盘加载**：浏览器端默认固件从「网络下载」改为「本地磁盘读取」——前端仍用 `fetch("./stoov-bed-firmware.hex")`，但该请求由本地 Deno 服务直接读磁盘文件返回，不再依赖任何远程网络资源。
- **原生串口（Win32 FFI）**：桌面版不再使用浏览器 Web Serial API，改由本地 Deno 服务通过 FFI 直接调用 Win32 `kernel32.dll` 操作串口，页面经 WebSocket 桥接下发指令——不弹浏览器授权框、可选任意 COM 口、DTR/RTS 拉线在后端生效后回执，复位/进入 bootloader 时序更确定。
- **桌面定制走补丁**：以上串口接线、`.hex` 硬限制等改动全部由 `sync-static.ts` 的锚点补丁在 Copy 后的 `static/` 上施加，原项目源码依旧零改动。
- **桌面体验**：单可执行文件 = 本地静态服务 + 原生串口桥 + 自动打开系统默认浏览器。

## 运行方式

### 开发模式

```bash
deno task desktop
```

启动本地服务并自动打开浏览器访问 `http://127.0.0.1:30000/`。

### 同步原项目资源到 static

原项目 `stm32WebFlasher` 更新后，运行以下命令把最新页面/脚本/固件 Copy 到本目录 `static/`：

```bash
deno task sync
```

> 若原项目不在默认同级位置，可设置 `STM32_WEB_FLASHER_SOURCE` 环境变量指向其目录。

### 编译为 Windows 可执行文件

```bash
deno task compile
```

编译产物输出到：

```text
stm32WebFlasher-desktop/bin/stm32WebFlasher-desktop.exe
```

分发时需将 `bin/stm32WebFlasher-desktop.exe` 与 `static/` 目录一起打包（exe 同级或上一级放置 `static/`）。

### 类型检查

```bash
deno task check
```

## 默认固件加载行为

桌面程序读取本目录中：

```text
static/firmware/stoov-bed-firmware.hex
```

当浏览器访问 `/stoov-bed-firmware.hex` 时，由本地服务直接从上述磁盘文件返回，前端自动加载该固件（连接串口后若无用户已选固件则自动拉取），默认固件加载完全从本地磁盘读取，不依赖网络资源。

## 原生串口（Win32 FFI）

桌面版用本机原生串口取代浏览器 Web Serial API，链路如下：

```text
页面 app.js  requestPort()
  └─ openNativeSerialDialog()            (overlay/native-serial-dialog.js 参数设置弹窗组件)
       └─ NativeSerialTransport.open()     (overlay/native-serial-transport.js 传输层)
            └─ WebSocket /ws/serial + GET /api/serial/ports  (main.ts 路由)
                 └─ serial-bridge.ts  (WS 编解码 / 单会话管理 / signals 回执)
                      └─ serial-ffi.ts  (Deno.dlopen 调 kernel32.dll：CreateFileW / DCB / ReadFile / WriteFile / EscapeCommFunction 等)
```

- **端口枚举**：读 `HKLM\HARDWARE\DEVICEMAP\SERIALCOMM` 注册表得到可用 COM 号，经 `/api/serial/ports` 返回给页面。
- **参数设置弹窗**：点“选择串口”弹出 `openNativeSerialDialog()`，可选 **串口号 / 波特率 / 数据位 / 停止位 / 校验位**，带“刷新”重枚举。“确定”后由弹窗真正打开串口：**打开成功才关闭弹窗**并交付已开启的传输层（`connect` 直接复用，不再二次 open）；**失败则保持弹窗、就地显示失败原因**，可改参数重试或“取消”退出。
- **时序**：`setSignals`（DTR/RTS）等待后端 `signals` 回执，确保复位/进入 bootloader 的时序以拉线成功为起点。
- **数据**：串口原始字节走 WS 二进制帧；`open`/`write`/`signals`/`close` 走 JSON 文本帧。

> 原生串口依赖 `--allow-ffi`，仅适用于 Windows；`deno task desktop` / `compile` 已带该权限。
>
> `openNativeSerialDialog()` 为自包含、可复用、自带样式的独立模块，宿主只需 `import` 调用，可作为其它项目的原生串口选口/配置组件复用。

## 静态资源根目录解析优先级

`main.ts` 按以下顺序定位资源目录，命中即止：

1. `STM32_WEB_FLASHER_ROOT` 环境变量（显式覆盖）
2. 可执行文件同级 / 上一级的 `static`（编译版）
3. 源码模块同级的 `static`（开发版 `deno run`）
4. CWD 同级 / 下一级的 `static` 与 `stm32WebFlasher` 原项目目录（兜底）

## 目录说明

- `main.ts`：本地静态文件服务器，托管 `static/` 中的页面、脚本与固件，并提供 `/health`、`/stoov-bed-firmware.hex`、`/api/serial/ports`、`/ws/serial` 端点。
- `desktop.ts`：桌面启动器，等待服务就绪后自动打开系统默认浏览器。
- `serial-bridge.ts`：原生串口 WebSocket 桥（单会话管理、JSON/二进制帧编解码、`signals` 回执）。
- `serial-ffi.ts`：基于 Deno FFI 的 Win32 原生串口实现与 COM 口枚举。
- `overlay/native-serial-transport.js`：前端原生串口传输层（接口兼容原 `SerialTransport`，sync 时覆盖到 `static/src/`）。
- `overlay/native-serial-dialog.js`：原生串口“参数选择 + 设置”弹窗组件（自带样式、可复用；点“确定”才真正打开，失败不关窗就地报错可重试）。
- `sync-static.ts`：从原项目单向 Copy 运行所需资源到 `static/`，并按锚点打补丁（原生串口接线 + `.hex` 硬限制）。
- `deno.json`：Deno 任务配置（desktop / compile / sync / check）。
- `static/`：桌面版自带的静态资源（从原项目 Copy，不入库的可放 `.gitignore`）。
- `build.bat`：Windows 下一键编译脚本。

## 端口配置

默认监听 `127.0.0.1:30000`，可通过环境变量覆盖：

- `PORT`：服务端口
- `HOST`：监听地址
