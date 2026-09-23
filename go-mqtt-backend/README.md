# go-mqtt-backend

`bun-mqtt-backend` (v2.1) 的 **Go 重写版**。订阅 MQTT 传感器主题，做去重 / 字段智能分类 / 时间戳归一化后写入 InfluxDB 2.x。

> 单二进制、零运行时依赖、静态编译。相比 Bun 版：启动 ~10ms、内存 ~8-15MB、吞吐 50k+ msg/s。

---

## 📚 文档导航

文档按职责拆分为三份，各取所需：

| 文档 | 面向 | 内容 |
|---|---|---|
| **README.md**（本文） | 所有人 | 项目概览、特性、目录结构、技术栈、5 分钟上手 |
| **[USAGE.md](USAGE.md)** | 使用者 / 运维 | 本地运行、环境变量、命令表、**数据处理规则**（分类器 / 黑名单 / 时间戳 / 去重）、健康端点、测试、FAQ |
| **[DEPLOY.md](DEPLOY.md)** | 构建 / 上线 | 编译（本地/交叉/服务器）、**云端 git 部署**、systemd、更新与回滚、Bun→Go 并行迁移与切换、行为差异、部署坑 |

**我想……**
- 在本地跑起来 → [USAGE.md 第 2 节](USAGE.md#2-快速开始本地运行)
- 搞懂某个字段为什么没入库 → [USAGE.md 第 6 节 数据处理规则](USAGE.md#6-数据处理规则核心)
- 部署到云服务器 → [DEPLOY.md 第 2 节 云端部署](DEPLOY.md#2-云端部署git-拉取式推荐)
- 更新已上线的服务 → [DEPLOY.md 第 4 节 更新流程](DEPLOY.md#4-更新流程与回滚)
- 从 Bun 版平滑切换 → [DEPLOY.md 第 5-6 节](DEPLOY.md#5-并行双跑迁移bun--go)

---

## 特性对齐（v2.1）

| 特性 | 说明 |
|---|---|
| **LRU + TTL 去重** | `messageId` 优先，无 ID 时回退 `xxhash(topic+raw)`；惰性过期 + 周期清扫 |
| **字段分类器（7 层优先级）** | SKIP_FIELDS 黑名单 → null → tag → float → 非有限数 → bool → string（白名单强转） |
| **SKIP_FIELDS 元字段黑名单** | `messageId/msgId/message_id/msg_id/uuid/id/timestamp/deviceId` 一律不入库 |
| **数值白名单强转** | `temperature/humidity/voltage/...` 被误传成字符串时自动转 float + warn |
| **智能时间戳** | 自动识别 s/ms/us/ns 并归一化为纳秒；缺失时用服务器当前时间 |
| **健康端点** | `/` `/health`（200/503）`/stats`（uptime + mqtt + influx + dedup 统计） |
| **优雅关闭** | SIGINT/SIGTERM → health → dedup → mqtt → influx flush → logger，5s 兜底强退 |
| **持久会话** | CleanSession=false + QoS1 + 自动重连 + 断线重订阅 |

---

## 5 分钟上手

```bash
# 1) 配置
cp .env.example .env && nano .env    # 填 MQTT / InfluxDB 密钥

# 2) 拉依赖 + 测试
make tidy && make test

# 3) 运行
make run                             # 或 make run-debug（调试模式）

# 4) 验证（另开终端）
curl http://localhost:9002/health
```

详见 [USAGE.md](USAGE.md)。上线部署详见 [DEPLOY.md](DEPLOY.md)。

---

## 目录结构

```
go-mqtt-backend/
├── cmd/consumer/main.go        # 入口：装配 + 优雅关闭
├── internal/
│   ├── config/                 # 环境变量解析 + 校验（脱敏 Snapshot）
│   ├── logger/                 # zap 全局 JSON 日志
│   ├── mqtt/                   # paho 消费者 + 消息流水线
│   ├── influx/                 # InfluxDB 批量写入封装
│   ├── dedup/                  # LRU+TTL 去重 + ComputeDedupKey  (dedup_test.go)
│   ├── classifier/             # 字段分类器 + SKIP_FIELDS 常量   (classifier_test.go)
│   ├── timestamp/              # 智能时间戳归一化               (normalize_test.go)
│   ├── sensor/                 # payload → InfluxDB Point
│   └── health/                 # /health /stats HTTP 端点
├── deploy/
│   └── go-mqtt-consumer.service   # 加固版 systemd unit
├── .env.example / .env.debug.example
├── Makefile / go.mod / go.sum
├── README.md                  # 本文：入口导航
├── USAGE.md                   # 使用说明
└── DEPLOY.md                  # 编译与部署
```

---

## 技术栈

| 职责 | 库 |
|---|---|
| MQTT 客户端 | `github.com/eclipse/paho.mqtt.golang` v1.5 |
| InfluxDB 写入 | `github.com/influxdata/influxdb-client-go/v2` v2.14 |
| 结构化日志 | `go.uber.org/zap` v1.28 |
| LRU 缓存 | `github.com/hashicorp/golang-lru/v2` v2.0 |
| Hash（dedup fallback） | `github.com/cespare/xxhash/v2` v2.3 |
| .env 加载 | `github.com/joho/godotenv` v1.5 |
| HTTP 服务 | `net/http` 标准库 |
| 测试断言 | `github.com/stretchr/testify` v1.8 |

Go 版本要求：**1.22+**（开发验证于 1.27.1）。

---

## 测试

```bash
make test          # 73 个测试函数，覆盖 classifier / dedup / timestamp
make test-cover    # 覆盖率：classifier 80% / dedup 97% / timestamp 100%
```
