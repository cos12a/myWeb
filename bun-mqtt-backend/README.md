# bun-mqtt-backend

IoT 传感器数据管道：**MQTT → Bun → InfluxDB**，生产级重构版（v2.0）。

## 特性

- 🚀 **Bun 运行时**：原生 TypeScript、原生 test、原生 `--env-file`、原生 `--watch`
- 🛡️ **Zod 校验**：启动时校验环境变量，运行时校验每条 MQTT payload
- 📊 **Pino 结构化日志**：JSON 输出，可对接 Loki / ELK / CloudWatch
- ❤️ **健康检查端点**：`GET /health` `GET /stats`（Bun.serve 原生实现）
- 🔁 **应用层去重**：LRU + TTL 缓存，防止 QoS≥1 重投与传感器重发导致数据翻倍
- ⏱️ **智能时间戳**：自动识别秒 / 毫秒 / 微秒 / 纳秒并归一化
- 🧪 **31 个单元测试**：`bun run test` 一键验证
- 🧩 **持久会话 + 批量写入**：`clean:false` + `batchSize:500` / `flushInterval:1s`

## 快速开始

```bash
# 1. 安装依赖
bun install

# 2. 配置环境变量
cp .env.debug.example .env.debug
nano .env.debug                 # 填入 MQTT_PASS / INFLUX_TOKEN

# 3. 启动（三种模式）
bun run start                   # 生产模式（读 .env）
bun run dev                     # 开发模式（读 .env，热重载）
bun run dev:debug               # 调试模式（读 .env.debug，可与生产版并行）

# 4. 验证
curl http://localhost:9000/health
curl http://localhost:9000/stats
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `bun run start` | 生产模式启动（读 `.env`） |
| `bun run dev` | 开发模式，热重载（读 `.env`） |
| `bun run start:debug` | 调试模式启动（读 `.env.debug`） |
| `bun run dev:debug` | 调试模式，热重载（读 `.env.debug`） |
| `bun run test` | 运行单元测试 |
| `bun run typecheck` | TypeScript 类型检查 |

## 项目结构

```text
src/
├── index.ts              统一入口：装配 + 优雅关闭
├── config.ts             Zod 校验环境变量
├── logger.ts             Pino 结构化日志实例
├── schema.ts             MQTT payload Zod schema + topic 解析
├── consumer.ts           MQTT 消费者（startConsumer）
├── dedup.ts              LRU + TTL 消息去重
├── influx.ts             InfluxDB WriteApi 单例（批量写入）
├── health.ts             Bun.serve() /health /stats 端点
├── services/
│   └── sensorData.ts     payload → Point 转换
└── utils/
    └── timestamp.ts      智能时间戳单位识别

tests/
├── timestamp.test.ts     12 个单测
└── dedup.test.ts         19 个单测
```

## 完整文档

详细的部署、Mosquitto / InfluxDB / ESP32 / systemd 配置、故障排查、并行调试指南等，请查看：

📘 **[PLATFORM.md](./PLATFORM.md)** — IoT 传感器数据平台完整文档（v2.0）

## 许可证

Private — 内部项目。
