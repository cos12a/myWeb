# Web USB 连接器

基于 [WebUSB API](https://developer.mozilla.org/docs/Web/API/WebUSB_API) 的自定义 USB 设备连接与通信页面。

## 功能

- **设备发现** — 支持按 VID/PID 过滤或显示全部 USB 设备
- **设备信息** — 显示设备名称、VID、PID、序列号、配置数、接口数
- **接口声明** — 自动枚举配置、接口和端点，一键声明接口
- **数据发送** — 支持文本、HEX、字节数组三种格式
- **数据接收** — 实时监听 IN 端点，支持文本/HEX/混合显示
- **快捷命令** — 预置 LED ON/OFF、读取状态、重启设备等常用命令
- **日志面板** — 带时间戳的收发日志，自动滚动

## 使用方法

1. 使用 **Chrome** 或 **Edge** 浏览器打开 `index.html`
2. 点击「连接设备」，在弹出的设备列表中选择目标 USB 设备
3. 在「接口配置」区域选择配置号、接口号和端点
4. 点击「声明接口」
5. 在「数据通信」区域发送和接收数据

## 文件结构

```
usb-test/
├── index.html   # 主页面
├── styles.css   # 样式
├── app.js       # WebUSB 逻辑
└── README.md    # 说明文档
```

## 浏览器兼容性

| 浏览器    | 支持 |
| --------- | ---- |
| Chrome    | ✅   |
| Edge      | ✅   |
| Firefox   | ❌   |
| Safari    | ❌   |

> **注意**: WebUSB 仅在安全上下文（HTTPS 或 localhost）下可用。直接打开本地 HTML 文件（file://）在某些浏览器中可能受限。

## 自定义快捷命令

在 `app.js` 中修改 `.quick-send` 按钮的 `data-cmd` 属性即可自定义：

```html
<button class="btn btn-sm" data-cmd="0xFF">自定义命令</button>
```

HEX 值会作为单字节发送到 OUT 端点。如需发送多字节命令，用空格或逗号分隔：

```html
<button class="btn btn-sm" data-cmd="0xAA 0x01 0x55">多字节命令</button>
```
