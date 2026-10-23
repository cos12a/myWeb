# ws8623Demo · WS8623 BLE 测试页

WS8623 蓝牙模块的浏览器调试页集合，使用原生 HTML/JavaScript + Web Bluetooth，
由根目录主站托管在 `/ws8623/`。目录内提供一个可选的 Bun 静态服务器用于独立预览。

页面：

| 文件 | 访问路径 | 用途 |
| --- | --- | --- |
| `index.html` | `/ws8623/` | WS8623 模块连接、透传收发、写入速率测试、波形输出 |
| `ble-key.html` | `/ws8623/ble-key.html` | BLE NUS / FFF0 配对连接测试，验证系统配对与应用层 Key |
| `index copy.html` | 不对外路由 | 历史副本，仅作对照，不要在此修改功能 |

## 功能

### `index.html` — 模块测试

- **扫描连接**：`navigator.bluetooth.requestDevice({ filters: [{ namePrefix: "WS" }] })`，
  只列出名称以 `WS` 开头的设备。
- **串口服务 FFF0**：
  - Service `0000fff0-0000-1000-8000-00805f9b34fb`
  - TX（写）`0000fff2-0000-1000-8000-00805f9b34fb`
  - RX（通知）`0000fff1-0000-1000-8000-00805f9b34fb`
- **透传发送**：文本 / HEX 两种格式，可选自动追加换行；按 244 字节分片写入。
- **写入速率测试**：分别测试「无响应写」与「有响应写」的实际写入速率，可随时停止。
- **波形输出**：随机数 / 方波 / 正弦波 / 三角波，输出间隔 10~60000 ms、幅值 1~1000000，
  用于验证 TX 吞吐或给下游设备喂测试信号；仅支持无响应写的特征。
- **日志**：带时间戳的 INFO / 发送 / 接收 / 错误日志，可自动滚动、清空。

### `ble-key.html` — 配对测试

- 可选服务：Nordic UART Service（默认）或串口服务 FFF0。
- 显示当前 SERVICE / TX / RX UUID，便于核对固件配置。
- 系统配对弹窗与应用层 Key 分离：OS 弹窗配对时 Key 可留空；仅应用层校验时才填写。
- `startNotifications()` 触发系统配对，失败时在 120 秒窗口内每 6 秒重试；
  页面显示“未配对 / 配对中 / 已配对”徽章与配对日志。

## 运行

主站访问（推荐）：

```powershell
# 仓库根目录
deno task dev
# 浏览器打开
http://127.0.0.1:30000/ws8623/
```

独立预览：

```powershell
cd ws8623Demo
bun server.js        # http://localhost:3000 ，监听 0.0.0.0
```

`server.js` 是 27 行的 Bun 静态文件服务器：`/` 返回 `index.html`，其余路径按文件返回，
带 `Cache-Control: public, max-age=3600`；文件不存在时返回 404。修改页面后如看不到更新，
请强制刷新或调整缓存头。

## 文件结构

```text
ws8623Demo/
├── index.html       模块测试页（内联 CSS/JS，无构建）
├── ble-key.html     BLE 配对测试页（内联 CSS/JS，无构建）
├── index copy.html  历史副本（不参与路由）
└── server.js        可选的 Bun 静态预览服务器（:3000）
```

## 浏览器与安全上下文

- 仅 Chrome / Edge 等 Chromium 内核支持 Web Bluetooth；Firefox / Safari 不支持。
- 必须通过 HTTPS 或 localhost 访问；局域网 IP 直连会禁用蓝牙 API。
- 设备授权由用户点击触发；页面刷新后需要重新选择设备（浏览器会记住已授权设备）。
- 同一 BLE 设备同时只能被一个中心设备连接；调试前请断开手机 App 或其他电脑。

## 排障

| 现象 | 处理 |
| --- | --- |
| 扫描列表为空 | 确认设备名以 `WS` 开头；设备已上电且未被其他主机连接 |
| 找不到 FFF0 服务 | 核对固件 Service/Characteristic UUID 是否与页面一致 |
| 发送成功但收不到数据 | 确认已订阅 RX 通知；检查对端是否回发；HEX 格式需为偶数位十六进制 |
| 速率测试数值很低 | 属正常现象，BLE 写入受连接间隔与 MTU 限制；关闭波形输出后再测 |
| 配对失败 | 在系统蓝牙设置中删除旧配对记录，重新上电后再试 |
| 页面打不开 / 404 | 通过主站 `/ws8623/` 访问，或确认 `bun server.js` 的工作目录是 `ws8623Demo/` |

## 相关文档

- 根目录路由与构建：[`PROJECT_GUIDE.md`](../PROJECT_GUIDE.md)、[`ARCHITECTURE.md`](../ARCHITECTURE.md)。
- 模块改动指南：[`.agents/skills/ws8623-ble-demo/SKILL.md`](../.agents/skills/ws8623-ble-demo/SKILL.md)。
- 相关 BLE 项目：`InstrumentTestLit/`（NUS 仪器面板）、`stoov-test/`、`stoov-corr/`。
