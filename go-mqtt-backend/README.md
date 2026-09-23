# go-mqtt-backend

`bun-mqtt-backend` (v2.1) 的 **Go 重写版**。订阅 MQTT 传感器主题，做去重 / 字段智能分类 / 时间戳归一化后写入 InfluxDB 2.x。

> 单二进制、零运行时依赖、静态编译。相比 Bun 版：启动 ~10ms、内存 ~8-15MB、吞吐 50k+ msg/s。

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

## 快速开始

### 1. 环境要求
- Go **1.22+**（开发环境验证于 1.27.1）
- 可访问的 MQTT Broker 与 InfluxDB 2.x

### 2. 配置
```bash
cp .env.example .env          # 生产
cp .env.debug.example .env.debug   # 调试（独立 bucket/clientId/port）
chmod 600 .env .env.debug     # Linux 下收紧权限
```
> `.env` / `.env.debug` 已被 gitignore，**绝不入库**。

### 3. 运行
```bash
make tidy          # 拉取依赖
make test          # 单元测试（73 个测试函数）
make run           # 生产模式（读 .env）
make run-debug     # 调试模式（读 .env.debug，LOG_LEVEL=debug）
```

### 4. 编译
```bash
make build         # Linux amd64 静态二进制 → bin/go-mqtt-consumer
make build-local   # 本机（Windows）二进制 → bin/go-mqtt-consumer.exe
```

### 5. 验证
```bash
# 健康检查
curl http://localhost:9002/health
# 运行时统计
curl http://localhost:9002/stats

# 发一条测试消息
mosquitto_pub -h 127.0.0.1 -p 1883 -u <user> -P <pass> \
  -t "sensors/ESP32-TEST/data" \
  -m '{"messageId":"t-001","temperature":25.6,"humidity":"60.2","location":"lab","online":true}'
```

---

## 命令表（Makefile）

| 命令 | 作用 |
|---|---|
| `make build` | 交叉编译 Linux amd64 生产二进制（`-s -w` 去符号） |
| `make build-local` | 编译本机开发二进制 |
| `make test` | 运行全部单元测试（`-v -count=1`） |
| `make test-cover` | 测试 + 生成 HTML 覆盖率报告 |
| `make lint` | `golangci-lint`（需先安装） |
| `make run` | 用 `.env` 启动 |
| `make run-debug` | 用 `.env.debug` 启动 |
| `make tidy` | `go mod tidy` |
| `make clean` | 清理编译产物 |

---

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `MQTT_URL` | ✅ | — | 如 `mqtt://127.0.0.1:1883` |
| `MQTT_USER` | ✅ | — | MQTT 用户名 |
| `MQTT_PASS` | ✅ | — | MQTT 密码 |
| `MQTT_CLIENT_ID` | | `go-mqtt-consumer` | **并行跑时必须与 Bun 版不同** |
| `MQTT_SUBSCRIBE_TOPIC` | | `sensors/#` | 订阅主题 |
| `INFLUX_URL` | ✅ | — | 如 `http://127.0.0.1:8086` |
| `INFLUX_TOKEN` | ✅ | — | InfluxDB API Token |
| `INFLUX_ORG` | ✅ | — | 组织名 |
| `INFLUX_BUCKET` | ✅ | — | **并行跑时必须与 Bun 版不同** |
| `LOG_LEVEL` | | `info` | `debug/info/warn/error/fatal` |
| `HEALTH_PORT` | | `9002` | 健康端点端口 |
| `DEDUP_ENABLED` | | `true` | 是否启用去重 |
| `DEDUP_MAX_SIZE` | | `10000` | LRU 最大条目（100~1000000） |
| `DEDUP_TTL_MS` | | `300000` | 去重窗口毫秒（1000~3600000） |

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
├── .env.example / .env.debug.example
├── Makefile / go.mod / README.md
```

---

## 并行双跑迁移（Bun → Go）

Go 版用**独立 bucket + 独立 clientId + 独立端口**，与 Bun 版互不干扰：

| 隔离点 | Bun 版 | Go 版 |
|---|---|---|
| clientId | `bun-mqtt-consumer` | `go-mqtt-consumer` |
| bucket | `myHeatTest` | `myHeatTestGo`（debug: `myHeatTestGoDebug`） |
| health port | `9000` | `9002`（debug: `9003`） |

> MQTT 是广播语义：两个 clientId 各收一份完整消息，两边独立去重、独立落库，互不影响。

**验证周期（24-48h）** — 对比数据条数一致性：
```flux
from(bucket: "myHeatTest")   |> range(start: -24h) |> count()   // Bun
from(bucket: "myHeatTestGo") |> range(start: -24h) |> count()   // Go
```
关注：数据条数一致 / 字段类型一致 / dedup hitRate 接近 / 无 error 日志。

---

## 生产部署（systemd）

```ini
[Unit]
Description=Go MQTT Consumer
After=network-online.target mosquitto.service influxdb.service
Wants=network-online.target

[Service]
Type=simple
User=mqtt
WorkingDirectory=/opt/go-mqtt-backend
ExecStart=/opt/go-mqtt-backend/bin/go-mqtt-consumer --env-file=/opt/go-mqtt-backend/.env
Restart=always
RestartSec=3
# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/go-mqtt-backend

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now go-mqtt-consumer
sudo systemctl status go-mqtt-consumer
journalctl -u go-mqtt-consumer -f
```

**从 Bun 版切换**（确认 48h 数据一致后）：
1. 改 Go 版 `.env` 的 `INFLUX_BUCKET` 为生产 bucket（`myHeatTest`）、`MQTT_CLIENT_ID` 为生产值
2. `sudo systemctl stop bun-mqtt-consumer`
3. `sudo systemctl start go-mqtt-consumer`
4. 验证数据继续落库 → `sudo systemctl disable bun-mqtt-consumer`
5. 观察 1 周无问题后移除 Bun 版

---

## 与 Bun 版的行为差异（迁移须知）

1. **dedup hash 不兼容**：Bun 用 `wyhash`，Go 用 `xxhash` — 无 ID 时的 fallback hash key 两边不同。并行跑各自独立去重，互不影响，但**跨版本对比 hash key 无意义**。带 `messageId` 时两边 key 一致（`id:messageId:xxx`）。
2. **map 遍历顺序**：Go map 无序，`ClassifyPayload` 已按 key 字典序排序以保证稳定输出。
3. **JSON number**：Go `json.Unmarshal` 到 `any` 时数字统一为 `float64`（与 TS `number` 行为一致）。
4. **时间戳精度**：Go fallback 用 `time.Now().UnixNano()`（纳秒），比 Bun 的 `Date.now()`（毫秒）更精确。

---

## 测试

```bash
make test          # 73 个测试函数，覆盖 classifier/dedup/timestamp
make test-cover    # 覆盖率：classifier 80% / dedup 97% / timestamp 100%
```

测试用例从 `bun-mqtt-backend/tests/*.test.ts` 逐条移植，行为语义对齐。
