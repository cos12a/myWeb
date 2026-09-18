# Web Serial Plotter

实时、美观、零门槛的串口设备数据绘图工具 —— 直接在浏览器中运行。

> 连接 Arduino、传感器板或任何支持 UART 的设备，无需驱动程序或本地应用程序，即可即时获取图表。基于 Vite + React + TypeScript + Tailwind CSS 构建。

## 教程与演示

[![教程视频](https://img.youtube.com/vi/MEQCPBF99FQ/hqdefault.jpg)](https://blog.csdn.net/cos12a/article/details/162878546?fromshare=blogdetail&sharetype=blogdetail&sharerId=162878546&sharerefer=PC&sharesource=cos12a&sharefrom=from_link)

## 在线体验

你可以直接访问 **[esp.unito.top](https://esp.unito.top)** 在线使用。也可以按照下面的说明在本地运行。

## 支持与赞助

如果这个项目对你有帮助，欢迎通过以下方式支持它的发展：

[![支持 CSDN](https://img.shields.io/badge/支持-CSDN-critical?logo=csdn&logoColor=white)](https://blog.csdn.net/cos12a/article/details/156298530?fromshare=blogdetail&sharetype=blogdetail&sharerId=156298530&sharerefer=PC&sharesource=cos12a&sharefrom=from_link)

你的支持将帮助维护和改进这个工具，造福整个社区！

## 目标

- 提供美观、现代的 UI，让实时串口数据可视化"开箱即用"。
- 所有处理都在浏览器本地完成 —— 快速、私密、可移植。

## 状态

**生产就绪** — 核心功能已完善且稳定。该应用以专业级的性能和用户体验成功处理实时串口数据绘图。

## 当前功能

✅ **实时绘图**

- 支持 CSV/空格/制表符分隔的串口数据多系列绘图
- 自动从标题行检测系列名称（例如 `# time ax ay az`）
- 动态系列调整（根据数据自动添加/删除系列）

✅ **交互控制**

- 鼠标/触摸平移和缩放，支持惯性滚动
- 触摸设备支持双指缩放
- Ctrl+滚轮精确缩放
- 播放/暂停（冻结）功能
- Y 轴自动缩放，支持手动覆盖

✅ **数据分析**

- 实时统计：最小值/最大值/平均值/中位数/标准差
- 每个数据系列的实时直方图
- 可配置时间显示（绝对时间/相对时间）
- 采样率监控
- 悬停提示，显示精确值和时间戳

✅ **通道管理**

- 系列重命名和颜色自定义
- 交互式图例，点击即可编辑
- 基于传入数据动态创建系列

✅ **导出与测试**

- PNG 截图导出（图表 + 单个统计卡片）
- CSV 数据导出，多种选项：
  - 导出可见数据或所有存储数据
  - 多种时间戳格式（ISO、相对、原始）
  - 可配置时间参考（会话开始时间）
- 内置信号发生器用于测试（正弦波、噪声、斜坡）
- 可配置采样率和幅值

✅ **串口控制台**

- 双标签界面（图表/控制台视图）
- 与串口设备的双向通信
- 向设备发送文本命令
- 查看原始输入/输出数据流
- 多种格式导出消息（TXT、CSV、JSON）
- 可配置消息历史记录（10-10,000 条）
- 实时消息时间戳

✅ **用户体验**

- 深色/浅色主题切换，支持系统偏好检测
- 响应式设计，适配各种屏幕尺寸
- 基于浏览器（无需驱动程序或安装）
- 实时连接状态，带视觉指示器
- 专业的页脚，包含项目链接

## 使用应用：在线 vs. 本地

大多数用户**无需**在本地运行此项目！日常使用只需访问在线站点：

- **[esp.unito.top](https://esp.unito.top)**

只有在你想参与贡献、开发新功能或测试代码变更时，才需要按照下面的本地设置说明进行操作。

## 快速开始（开发环境）

### 前提条件

- **Node.js 20.19+ 或 22.12+**（Vite 必需；旧版本无法运行）
  - 检查版本，运行：
    ```bash
    node --version
    ```
  - 如果版本低于 20.19.0，请[在此下载最新的 Node.js](https://nodejs.org/en/download) 并安装。
  - 升级说明请参阅[官方 Node.js 文档](https://nodejs.org/en/download/package-manager/)。
- **npm**（随 Node.js 一起安装）
- **基于 Chromium 的浏览器**，支持 Web Serial API（Chrome、Edge、Opera）

### 安装与运行

```bash
npm install
npm run dev
```

打开终端打印的本地 URL（Vite 默认为 `http://localhost:5173`）。

## 使用说明

### 串口设备连接

1. 点击 **"Connect"**，在弹出的对话框中选择你的串口设备
2. 为你的设备选择适当的**波特率**
3. 开始接收数据流 —— 应用支持 CSV、空格或制表符分隔的值

### 数据格式

你的设备应发送数值数据行：

```text
# 可选标题行，定义系列名称
# time(ms), ax, ay, az
0, 0.01, 0.02, 0.98
10, 0.02, 0.01, 0.99
20, 0.03, 0.00, 1.01
```

### 交互控制

- **平移**：在图表上点击并拖动
- **缩放**：Ctrl+滚轮 或触摸设备双指缩放
- **冻结**：点击暂停按钮停止实时更新
- **导出**：使用下载按钮导出 CSV 数据（可见数据或全部数据）
- **截图**：使用相机按钮导出 PNG 图片
- **系列**：点击图例条目编辑名称和颜色
- **控制台**：切换到控制台选项卡，发送命令并查看原始数据

### 内置信号发生器

无需硬件即可测试：

1. 使用顶部的**发生器面板**
2. 选择信号类型：正弦波（带相位）、噪声或斜坡
3. 调整采样率，点击 **"Start"**
4. 数据将像真实设备一样显示

### 统计面板

底部面板（图表选项卡）显示实时分析数据：

- **统计信息**：最小值/最大值/平均值/中位数/标准差
- **直方图**：带样本计数的实时分布可视化
- **导出**：每个数据系列可单独导出 PNG 截图

### 控制台面板

控制台选项卡提供直接的设备通信：

- **发送命令**：输入并发送文本消息到你的设备
- **消息历史**：查看所有带有时间戳的输入和输出消息
- **导出选项**：将控制台日志保存为 TXT、CSV 或 JSON 文件
- **可配置缓冲区**：调整消息历史大小（10-10,000 条）

## 浏览器支持

Web Serial API 受现代基于 Chromium 的浏览器支持：

- Chrome 89+
- Edge 89+
- Opera（当前版本）

Firefox 和 Safari 目前不支持 Web Serial。在桌面端，请使用 Chrome 或 Edge 以获得最佳体验。

## 安全与隐私

- 每次连接时，你需要通过浏览器的权限提示显式授予串口访问权限（按设备和按来源）。
- 所有数据都保留在你的本地机器上。该应用不会上传你的串口数据。

## 技术栈

- Vite + React + TypeScript
- Tailwind CSS v4（通过 `@tailwindcss/vite`）

## 脚本命令

- `npm run dev` – 启动开发服务器
- `npm run build` – 类型检查并构建生产版本
- `npm run preview` – 本地预览生产构建
- `npm run lint` – 运行 ESLint 代码质量检查
- `npm run typecheck` – 运行 TypeScript 类型检查
- `npm test` – 运行测试套件
- `npm run test:coverage` – 运行测试套件并生成覆盖率报告

## 项目结构

```
.
├─ src/
│  ├─ main.tsx              # 应用入口点
│  ├─ App.tsx               # 主应用组件
│  ├─ components/           # React 组件
│  │  ├─ PlotCanvas.tsx     # 高性能 Canvas 渲染器
│  │  ├─ Header.tsx         # 连接控制
│  │  ├─ TabNav.tsx         # 图表/控制台标签导航
│  │  ├─ SerialConsole.tsx  # 控制台界面
│  │  ├─ ConsoleLog.tsx     # 消息显示组件
│  │  ├─ ConsoleInput.tsx   # 命令输入组件
│  │  ├─ Legend.tsx         # 交互式系列图例
│  │  ├─ StatsPanel.tsx     # 实时统计信息
│  │  ├─ PlotToolsOverlay.tsx # 图表控制覆盖层
│  │  ├─ Footer.tsx         # 项目链接页脚
│  │  └─ ui/               # 可复用 UI 组件
│  ├─ hooks/               # 自定义 React Hooks
│  │  ├─ useSerial.ts      # Web Serial API 集成
│  │  ├─ useDataConnection.ts # 连接管理
│  │  ├─ useConsoleStore.ts # 控制台数据管理
│  │  └─ useSignalGenerator.ts # 测试信号生成
│  ├─ store/               # 数据管理
│  │  ├─ RingStore.ts      # 高性能环形缓冲区
│  │  ├─ ConsoleStore.ts   # 控制台消息存储
│  │  └─ dataStore.tsx     # React store 集成
│  ├─ utils/               # 工具函数
│  │  ├─ plotRendering.ts  # Canvas 渲染工具
│  │  ├─ chartExport.ts    # CSV 数据导出
│  │  ├─ consoleExport.ts  # 控制台消息导出
│  │  ├─ canvasInteractions.ts # 鼠标/触摸处理
│  │  └─ screenshot.ts     # PNG 导出工具
│  └─ types/               # TypeScript 类型定义
├─ public/                 # 静态资源
├─ vite.config.ts          # 构建配置
└─ eslint.config.js        # 代码质量规则
```

## 路线图

**潜在的未来增强功能：**

- 会话保存/加载（绘图配置和数据）
- 二进制协议支持（CBOR/SLIP/COBS）
- 高级数据处理过滤器（移动平均、FFT）
- 光标/十字准星工具，用于精确测量
- 键盘导航和无障碍性改进
- 多设备连接支持
- 数据记录/回放功能
- 自定义波特率输入
- 高级触发条件用于数据捕获

## 贡献

欢迎提出想法、问题和拉取请求。如果你使用特定硬件进行测试，请分享设备详细信息和示例输出，以便我们改进默认配置和解析逻辑。

## 许可证

本项目基于 **GNU General Public License v3.0** 许可 — 详见 [LICENSE](LICENSE) 文件。

**总结**：这是免费开源软件。你可以根据 GPL v3 条款重新分发和修改它，确保对所有用户保持自由软件。
