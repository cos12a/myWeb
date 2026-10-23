# InstrumentTestLit · 仪器测量面板

浏览器端实时测量面板：通过 **Web Bluetooth（Nordic UART Service）** 或 **Web Serial** 连接仪器，
把设备上报的 JSON 行解析为 4 个指标卡片，并显示数据流呼吸灯。最终产物是标准 Web Components
（`<instrument-panel>`），框架无关，由根目录主站托管在 `/instrument/`。

## 功能

- 双数据源：BLE NUS 透传与 Web Serial UART，二者解析同一套行协议，可在同一页面切换。
- 指标显示：总线电压 `vbus`、分流电压 `vshunt`、电流 `ibus`、功率 `pbus`，数值缺失时保留上一次有效值。
- 呼吸灯指示：收到任意有效数据后点亮，1 秒无新数据自动熄灭。
- BLE 配对容错：访问受保护特征时由操作系统弹窗配对，`discoverServices()` 在 120 秒窗口内每 6 秒重试，等待用户输入密钥。
- 移动端适配：连接栏与指标卡在窄屏自动单列/双列切换。

## 数据协议

设备按行发送 JSON，一行一帧，以 `\n` 分包：

```json
{"vbus": 5.0123, "vshunt": 12.345, "ibus": 246.9, "pbus": 1238.5}
```

| 键 | 含义 | 单位 |
| --- | --- | --- |
| `vbus` | 总线电压 | V |
| `vshunt` | 分流电压 | mV |
| `ibus` | 电流 | mA |
| `pbus` | 功率 | mW |

- 解析失败的行直接忽略（`parseJsonLine` 返回 `null`），不会中断连接。
- 指标定义集中在 `src/core/metrics.ts`；新增指标需要同时保证设备侧键名一致。
- BLE 服务/特征固定为 Nordic UART Service：`6e400001/2/3-b5a3-f393-e0a9-e50e24dcca9e`，
  BLE 设备名过滤器为前缀 `BleUart`。

## 技术栈

- Lit 3 + `@lit/task`、TypeScript（严格模式）、原生 Web Components。
- 构建：Bun bundler（`bun build index.html --outdir dist --target browser --format esm --minify`）。
- 浏览器 API：Web Bluetooth、Web Serial；均要求安全上下文（HTTPS 或 localhost）。

## 开发与构建

```powershell
cd InstrumentTestLit
bun install
bun run dev        # 先构建再启动本地静态服务 http://127.0.0.1:3000
bun run watch      # 监听源码变化持续构建
bun run build      # 只构建到 dist/
bun run typecheck  # tsc --noEmit
```

根目录统一构建：`bun run build`（或单独的 `bun run build:instrument`），产物由主站映射到
`/instrument/`。主站只读取 `dist/`，因此部署前必须构建。

> 修改代码后请递增 `src/core/version.ts` 中的 `APP_VERSION`，浏览器控制台会打印当前版本，便于确认缓存已更新。

## 代码结构

```text
InstrumentTestLit/
├── index.html                  页面骨架，加载 design-tokens.css / app.css
├── server.ts                   本地静态预览服务（Bun，端口 3000）
├── src/
│   ├── main.ts                 入口：注册 <instrument-panel>
│   ├── core/
│   │   ├── types.ts            纯类型契约（Metric / ConnStatus / SourceKind）
│   │   ├── metrics.ts          默认 4 项指标定义
│   │   ├── parse.ts            JSON 行解析与指标提取（纯函数）
│   │   └── version.ts          程序版本号
│   ├── controllers/
│   │   ├── ble-controller.ts   Web Bluetooth + NUS + 行分包 + 配对重试
│   │   ├── serial-controller.ts Web Serial + 读循环 + 行分包
│   │   ├── data-stream-controller.ts 数据流呼吸灯定时器
│   │   └── pairing-controller.ts 6 位密钥模态与 40 秒倒计时
│   ├── components/             Lit 组件：面板、指标卡、连接栏、配对提示
│   └── tokens/design-tokens.css 设计变量
└── dist/                       构建产物（git 忽略）
```

分层约定：

- `core/` 不碰 DOM 和硬件，只做纯数据变换，便于单测与复用。
- `controllers/` 集中所有副作用（浏览器 API、定时器、事件监听），实现 Lit `ReactiveController`。
- `components/` 的 `render()` 只读状态，不直接调用硬件。

## 连接流程

BLE：

1. 点击「连接」→ `navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "BleUart" }], optionalServices: [NUS_SERVICE] })`。
2. `device.gatt.connect()` → 获取 NUS 服务与 TX/RX 特征。
3. `rxChar.startNotifications()` 会触发系统配对弹窗；失败时按 6 秒间隔重试，最多 120 秒。
4. 收到通知后按 `\n` 拆行，交给 `parseJsonLine`。

Serial：

1. 点击「连接」→ `navigator.serial.requestPort()`（必须由用户手势触发）→ `port.open({ baudRate: 921600 })`。
2. 后台 `readLoop()` 持续读取，按 `\n` 拆行；断开时取消 reader 并关闭端口。

## 排障

| 现象 | 处理 |
| --- | --- |
| 提示不支持 Web Bluetooth / Web Serial | 换 Chrome / Edge（Android 可用 Chrome），并使用 localhost 或 HTTPS |
| BLE 选不到设备 | 确认设备名以 `BleUart` 开头、已上电、未被手机或其他主机连接 |
| 一直停留在“配对中” | 在操作系统蓝牙弹窗输入 6 位密钥；超时后重新连接，必要时在系统设置中删除配对后重试 |
| 串口打不开 | 关闭串口助手 / Arduino IDE 等占用端口的程序；确认波特率与固件一致 |
| 数据不刷新 | 设备需按行输出 JSON，键名必须为 `vbus/vshunt/ibus/pbus`；用串口工具确认换行符 |
| 数字一直是 `--` | 该行 JSON 缺少对应键或值不是数字，检查设备端字段类型 |

## 相关文档

- 根目录路由与构建说明：[`PROJECT_GUIDE.md`](../PROJECT_GUIDE.md)、[`ARCHITECTURE.md`](../ARCHITECTURE.md)。
- 模块改动指南：[`.agents/skills/instrument-ble-panel/SKILL.md`](../.agents/skills/instrument-ble-panel/SKILL.md)。
