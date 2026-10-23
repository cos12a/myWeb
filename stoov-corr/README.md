# stoov-corr · Stoov 加热垫温度参数修正面板

面向 Stoov Bed 加热垫的**校准与参数修正**页面：通过 BLE 或串口连接加热控制器，
查看身体/脚部/环境温度和设备状态，完成传感器标定、环境温度设置、周期设置与硬件复位，
并把标定结果通过 MQTT 上报到云端。页面是原生 HTML/JavaScript，无需构建，由根目录主站托管在 `/stoov-corr/`。

## 功能

- **加热控制器状态**：硬件运行时间、器件 ID、器件版本，支持手动刷新；提供硬件复位。
- **周期设置**：按秒配置自动获取设备状态的周期。
- **温度监测**：身体实时温度、环境温度、脚部实时温度，并显示与环境温度的差值。
- **环境温度**：双击环境温度卡片设置（0~40°C，支持 1 位小数）。
- **传感器标定**：
  - 身体（sensorId=1）与脚部（sensorId=0），标定温度范围 5~30°C。
  - 标定前校验：必须已连接发送通道、实时温度有效且与标定温度偏差 ≤10°C、传感器不得处于短路/开路。
  - 多阶段验证：发送标定后 3 秒读取，再次重发并读取，比较两次阻值差 ≤1.0Ω；超差自动重试，最多 3 次。
  - 支持获取当前标定值、清除单项或全部标定值。
- **通信接口管理**：BLE 与串口各自可独立开关接收/发送；连接后自动勾选收发。
- **日志**：带时间戳的收发/状态日志，最多保留 200 条。
- **标定结果上报**：MQTT 自动连接（仅上行、不订阅），发布到 `/unito/stoov/heating-bed/cal-result`，QoS 1。

## 运行与访问

本目录没有构建步骤，文件即产物：

```powershell
# 在仓库根目录启动主站
deno task dev
# 浏览器打开
http://127.0.0.1:30000/stoov-corr/
```

也可以把本目录交给任意静态文件服务器预览；但页面内的 `/api/...` 请求依赖主站时必须改用主站访问。

- 部署：根目录 `bun run build` **不会**构建本目录，更新文件后重启主站即可生效。
- 缓存：`index.html` 通过 `?v=` 查询串强制刷新 `serial-protocol.min.js`、`mqtt.min.js`、`app-modules.js`，
  页面标题下方会显示 `app-modules.js` 的版本号。修改脚本后请同步递增三处 `?v=`，否则浏览器可能继续使用旧缓存。
- 浏览器：Chrome / Edge（Web Serial + Web Bluetooth），需要 HTTPS 或 localhost。

## 通信协议

- `serial-protocol.min.js` 在全局注入 `SerialDataParser`、`SerialDataAssembler`、`MSGTYPE`、`MSGOP` 等常量。
- 帧为设备自定义二进制协议；本页发送方地址 `0x08`，目标地址 `0x02`。
- BLE 使用 Nordic UART Service（NUS）；串口默认 115200 8N1（以设备固件为准）。
- MQTT 只用于上报标定结果，不参与设备指令收发。

标定结果消息结构（`cal-result`，字段在 `b` / `f` 段内）：

```json
{
  "date": "2026-08-14",
  "time": "09:30:31",
  "type": "CAL",
  "did": "HT-57006500",
  "dv": "v4.2",
  "upt": "00:02:35",
  "et": 29,
  "b": { "pt": 29.2, "ct": 29, "f1": { "tp": 29, "rs": 552 }, "f2": { "tp": 29, "rs": 552 }, "r": "OK", "df": 0 },
  "f": { "pt": 29, "ct": 29, "f1": { "tp": 29, "rs": 486.1 }, "f2": { "tp": 29, "rs": 485.9 }, "r": "OK", "df": 0.2 }
}
```

`r`（结果）、`df`（阻值差）、`rsn`（失败原因）必须位于对应 `b` / `f` 段内，不要放到顶层。

## 文件结构

```text
stoov-corr/
├── index.html                页面骨架、样式、标定流程 UI 逻辑
├── app-modules.js            模块化主逻辑（IIFE，全局 App）
│   ├─ App.Logger             日志
│   ├─ App.Protocol           协议常量 / 解析器 / 组装器
│   ├─ App.Interfaces         BLE / Serial / MQTT / Manager
│   ├─ App.Processor          消息处理、温度解析、状态机
│   ├─ App.UI                 温度/状态/日志/面板渲染
│   └─ App.Controller         初始化、命令发送、事件绑定
├── serial-protocol.min.js    串口协议解析/组装库（全局注入）
├── mqtt.min.js               MQTT.js 浏览器构建
├── yaokong-wc.min.js         遥控 Web Component（复用资源）
├── node-red.js               当前 Node-RED 流程：cal-result → SQLite（由构建脚本生成）
├── nodered.js                历史 Node-RED 函数节点：加热垫数据 → InfluxDB 行协议
├── build-node-red-flow.js    生成 node-red.js（需 node-red-contrib-sqlite）
├── validate-flow.js          校验 node-red.js：示例消息 → SQL → 内存 SQLite
└── validate-index-publish.js 校验 index.html 发布的标定 JSON 结构
```

## 校验脚本

```powershell
cd stoov-corr
node build-node-red-flow.js      # 重新生成 node-red.js
node validate-flow.js            # 节点齐全性 + 3 个示例消息 + SQLite 插入
node validate-index-publish.js   # 标定 JSON 的 b/f 分层结构
```

`validate-flow.js` 与 `validate-index-publish.js` 依赖 Node.js 的 `node:sqlite` / `vm`，Node 22+ 可直接运行。

## 操作要点

1. 先连接 BLE 或串口，确认指示灯变绿、收发复选框已勾选。
2. 等待实时温度稳定，再双击环境温度卡片填写当前环境温度。
3. 输入标定温度（5~30°C），点击「标定身体」或「标定脚部」。
4. 标定过程中不要断电或断开连接；进度条会显示验证阶段。
5. 标定完成后可点「获取标定值」核对；异常时可用「清除标定」重置。

## 排障

| 现象 | 处理 |
| --- | --- |
| 页面提示未连接任何通讯端口 | 先在「通信接口管理」连接 BLE 或串口，并勾选「发送」 |
| 标定按钮无效 | 确认实时温度不是 `--`/短路/开路，且与标定温度偏差 ≤10°C |
| 阻值验证一直超差 | 检查传感器接触与接线；环境温度是否稳定；必要时清除标定后重试 |
| BLE 连接失败 | 关闭其他占用设备的 App，重新上电后重试；必要时在系统蓝牙设置删除配对 |
| 串口无数据 | 确认波特率与固件一致、TX/RX 交叉、共地；关闭串口助手等占用程序 |
| MQTT 未连接 | 检查网络能否访问 Broker；页面仍可本地标定，只是不会上报 |
| 修改脚本后页面没变化 | 递增 `index.html` 中三处 `?v=` 版本号并强制刷新 |

## 相关文档

- 根目录说明：[`PROJECT_GUIDE.md`](../PROJECT_GUIDE.md)、[`ARCHITECTURE.md`](../ARCHITECTURE.md)。
- 模块改动指南：[`.agents/skills/stoov-corr-panel/SKILL.md`](../.agents/skills/stoov-corr-panel/SKILL.md)。
- 同类产品页面：`stoov-test/`（产线测试）、`stoovTest-desktop/`（桌面版，本地 SQLite + 后台 MQTT）。
