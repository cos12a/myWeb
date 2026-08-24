# 物联网学习和展示

基于 Bun 和 Hono 构建的物联网学习与展示项目，用于托管静态页面，并提供一组模拟的 IoT 实时数据接口。

## 技术栈

- [Bun](https://bun.sh/)：JavaScript/TypeScript 运行时与开发工具
- [Hono](https://hono.dev/)：轻量级 Web 框架
- TypeScript：服务端类型安全开发
- PWA：通过 `manifest.json` 提供可安装的渐进式 Web 应用配置

## 环境要求

- Bun 1.x
- Windows、macOS 或 Linux

可以使用以下命令确认 Bun 是否已安装：

```bash
bun --version
```

## 安装与运行

安装依赖：

```bash
bun install
```

开发模式会在文件变化后自动重载：

```bash
bun run dev
```

生产模式启动服务：

```bash
bun run start
```

服务默认运行在 `http://localhost:3000`。如需修改端口，可以设置 `PORT` 环境变量：

```bash
$env:PORT=8080
bun run dev
```

## API

### 获取 IoT 模拟数据

```http
GET /api/iot-data
```

示例响应：

```json
{
  "temperature": "24.3",
  "humidity": 63,
  "onlineDevices": 7,
  "totalDevices": 8,
  "apiCalls": 1234,
  "sensorId": "Node-01",
  "updatedAt": "14:30"
}
```

接口当前返回随机生成的演示数据，真实数据源（MQTT、Redis 或数据库）尚未接入。

## 项目结构

```text
.
├── index.ts              # Bun 默认入口，目前为简单示例
├── src/
│   ├── index.ts          # Hono 应用入口、静态资源和 SPA 兜底
│   └── routes/
│       └── api.ts        # API 路由
├── public/
│   ├── index.html        # IoT 展示页面
│   ├── manifest.json     # PWA 配置
│   └── sw.js             # Service Worker
├── package.json
└── tsconfig.json
```

## 路由行为

- `/api/*`：由 Hono API 路由处理。
- 其他静态资源：从 `public` 目录提供。
- 未匹配的页面路径：回退到 `public/index.html`，支持单页应用访问。

## 开发说明

主要服务入口是 `src/index.ts`，而 `package.json` 中的 `dev` 和 `start` 脚本也都使用该入口。新增接口时，可以在 `src/routes/api.ts` 中扩展路由；接入真实设备数据时，应替换 `/api/iot-data` 中的随机数据生成逻辑。
