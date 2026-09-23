# Go MQTT Backend 重写计划

## 总体策略

- 迁移方式：并行双跑对比（Go 版用独立 bucket `myHeatTestGo` + 独立 clientId `go-mqtt-consumer`）
- 验证周期：24-48h 数据一致性对比后停 Bun 版
- 目标：v2.1 全特性对齐（SKIP_FIELDS / LRU dedup / 智能时间戳 / 字段分类 7 层 / 健康端点 / 优雅关闭）
- 预计 Go 代码量：~2000-2500 行（含测试）

## 技术栈确认

| 职责 | 库 | 版本 |
|---|---|---|
| MQTT 客户端 | `github.com/eclipse/paho.mqtt.golang` | v1.5+ |
| InfluxDB 写入 | `github.com/influxdata/influxdb-client-go/v2` | v2.14+ |
| 结构化日志 | `go.uber.org/zap` | v1.27+ |
| 环境变量解析 | `github.com/caarlos0/env/v11` | v11+ |
| 字段校验 | `github.com/go-playground/validator/v10` | v10+ |
| LRU 缓存 | `github.com/hashicorp/golang-lru/v2` | v2.0+ |
| HTTP 服务 | `net/http` 标准库 | Go 1.22+ |
| 测试断言 | `github.com/stretchr/testify` | v1.9+ |
| .env 文件加载 | `github.com/joho/godotenv` | v1.5+ |
| Hash（dedup fallback） | `github.com/cespare/xxhash/v2` | v2.3+ |

Go 版本要求：**1.22+**（range over int、enhanced routing pattern）

## 目录结构

```
d:\Michael\myNodejs\myWebBun\go-mqtt-backend\
├── cmd/
│   └── consumer/
│       └── main.go              # 入口：装配 + 优雅关闭
├── internal/
│   ├── config/
│   │   └── config.go            # env struct + 校验（对应 config.ts）
│   ├── logger/
│   │   └── logger.go            # zap 初始化（对应 logger.ts）
│   ├── mqtt/
│   │   └── consumer.go          # MQTT 连接 + 消息回调（对应 consumer.ts）
│   ├── influx/
│   │   └── writer.go            # InfluxDB WriteAPI 封装（对应 influx.ts）
│   ├── dedup/
│   │   ├── dedup.go             # MessageDeduplicator（对应 dedup.ts）
│   │   └── dedup_test.go
│   ├── classifier/
│   │   ├── classifier.go        # 字段分类器（对应 fieldClassifier.ts）
│   │   ├── classifier_test.go
│   │   └── fields.go            # TAG_FIELDS / NUMERIC_FIELD_HINTS / SKIP_FIELDS 常量
│   ├── timestamp/
│   │   ├── normalize.go         # 智能时间戳（对应 utils/timestamp.ts）
│   │   └── normalize_test.go
│   ├── sensor/
│   │   └── writer.go            # payload -> Point 转换（对应 sensorData.ts）
│   └── health/
│       └── server.go            # /health /stats 端点（对应 health.ts）
├── .env.example                  # 生产配置模板
├── .env.debug.example            # 调试配置模板
├── .gitignore
├── go.mod
├── go.sum
├── Makefile                      # build / test / lint / run / run-debug
└── README.md
```

## Phase 1：MVP 骨架（预计 3-4h）

### 1.1 项目初始化
- `go mod init github.com/cos12a/go-mqtt-backend`（或 monorepo 内相对路径）
- 创建目录结构
- Makefile（build / test / lint / run / run-debug / clean）
- .gitignore（二进制、.env、.env.debug、vendor/）
- .env.example + .env.debug.example（从 bun 版复制，bucket 改为 `myHeatTestGo`，clientId 改为 `go-mqtt-consumer`，HEALTH_PORT 改为 `9002`）

### 1.2 config 模块
- `internal/config/config.go`：用 `caarlos0/env` + struct tag 解析环境变量
- 必填校验（MQTT_URL / MQTT_USER / MQTT_PASS / INFLUX_URL / INFLUX_TOKEN / INFLUX_ORG / INFLUX_BUCKET）
- 可选 + 默认值（LOG_LEVEL=info / HEALTH_PORT=9000 / DEDUP_ENABLED=true / DEDUP_MAX_SIZE=10000 / DEDUP_TTL_MS=300000）
- 校验失败 → 打印每条错误 → os.Exit(1)
- `ConfigSnapshot()` 脱敏方法（密码/Token 用 `***` 替代）

### 1.3 logger 模块
- `internal/logger/logger.go`：zap.NewProduction() / zap.NewDevelopment() 按 LOG_LEVEL 切换
- 全局 `var Log *zap.Logger`
- JSON 输出，字段与 Bun 版 Pino 对齐（level / time / app / msg）

### 1.4 influx 模块
- `internal/influx/writer.go`：
  - `NewWriter(cfg)` → 创建 influxdb2.Client + WriteAPI（非阻塞批量）
  - `WritePoint(p *write.Point)`
  - `Close()` → flush + 关闭
  - 配置：BatchSize=500 / FlushInterval=1s / RetryInterval=1s / MaxRetries=3
  - DefaultTags: `app=mqtt-consumer`

### 1.5 mqtt 模块（MVP 版）
- `internal/mqtt/consumer.go`：
  - `NewConsumer(cfg, msgHandler)` → 创建 paho Client
  - 选项：SetCleanSession(false) / SetClientID / SetAutoReconnect(true) / SetConnectRetry(true) / SetKeepAlive(60s) / SetResumeSubs(true)
  - 订阅 `sensors/#` QoS 1
  - 消息回调：JSON parse → 调 msgHandler(deviceId, payload)
  - `Stop()` → 优雅断开

### 1.6 sensor writer（MVP 版，先不做分类器）
- `internal/sensor/writer.go`：
  - `WriteSensorData(deviceId string, data map[string]any, timestamp *int64)`
  - MVP：遍历 map，number → FloatField / string → StringField / bool → BoolField
  - 永远 `.Tag("device_id", deviceId)`
  - 时间戳：有就用，没有就 time.Now()

### 1.7 health 模块
- `internal/health/server.go`：
  - `net/http` 标准库
  - `GET /` → JSON 介绍
  - `GET /health` → 200/503 基于 mqtt.IsConnected()
  - `GET /stats` → uptime / mqtt / influx / dedup 信息
  - `Start(port) / Stop(ctx)`

### 1.8 main.go 入口
- `cmd/consumer/main.go`：
  - godotenv.Load（按 --env-file 参数或默认 .env）
  - config.Load() → 校验
  - logger.Init(cfg.LogLevel)
  - influx.NewWriter(cfg)
  - dedup.New(cfg)
  - mqtt.NewConsumer(cfg, handler)
  - health.Start(cfg.HealthPort)
  - signal.Notify(SIGINT, SIGTERM) → 优雅关闭（health.Stop → mqtt.Stop → influx.Close → logger.Sync）
  - 5s 超时强制退出兜底

### 1.9 MVP 验证
- `make build` → 编译通过
- `make run-debug` → 连接 MQTT + InfluxDB + 健康端点
- 手动 `mosquitto_pub` 发一条 → 确认 InfluxDB 落库
- `curl /health` → 200

## Phase 2：特性对齐（预计 4-6h）

### 2.1 字段分类器（核心，最复杂）
- `internal/classifier/fields.go`：
  - `TagFields = map[string]bool{"location": true, "type": true}`
  - `NumericFieldHints = map[string]bool{...}` （与 TS 版完全一致的 28 个字段）
  - `SkipFields = map[string]bool{...}` （DEDUP_ID_FIELDS + timestamp + deviceId）
  - `DedupIDFields = []string{"messageId", "msgId", "message_id", "msg_id", "uuid", "id"}`

- `internal/classifier/classifier.go`：
  - `type FieldKind int` (Skip / Tag / Float / Boolean / String)
  - `type ClassifiedField struct { Kind FieldKind; Key string; Value any; Coerced bool; Raw string; Reason string }`
  - `ClassifyField(key string, value any) ClassifiedField`：7 层优先级（与 TS 版完全一致）
    - 第 0 层：SkipFields 黑名单
    - 第 1 层：nil → skip
    - 第 2 层：TagFields + string → tag
    - 第 3 层：float64（有限）→ float
    - 第 4 层：NaN/Inf → skip
    - 第 5 层：bool → boolean
    - 第 6 层：string → 检查 NumericFieldHints → tryParse → float(coerced) 或 string
    - 第 7 层：其他 → skip
  - `ClassifyPayload(data map[string]any) []ClassifiedField`
  - `TryParseNumericString(s string) (float64, bool)`

- 注意：Go 的 `json.Unmarshal` 到 `map[string]any` 时，number 统一是 `float64`，integer 也是 `float64`。这与 TS 的 `typeof === "number"` 行为一致，无需特殊处理。

### 2.2 智能时间戳
- `internal/timestamp/normalize.go`：
  - `type Unit string` (Second / Millisecond / Microsecond / Nanosecond / Invalid)
  - `DetectUnit(ts float64) Unit`：阈值 1e11 / 1e14 / 1e17
  - `NormalizeToNanoseconds(ts *float64) (nanos int64, unit Unit, usedFallback bool)`
  - 与 TS 版逻辑完全一致

### 2.3 LRU + TTL 去重
- `internal/dedup/dedup.go`：
  - 用 `hashicorp/golang-lru/v2` 的 `lru.Cache[string, time.Time]`
  - `type MessageDeduplicator struct { cache *lru.Cache[string, time.Time]; ttl time.Duration; enabled bool; hits/misses/evicted atomic.Int64 }`
  - `CheckAndRecord(key string) bool`：true=新消息 / false=重复
  - 惰性过期：取出时检查 `time.Since(entry) > ttl`
  - 周期 sweep：goroutine + ticker（间隔 max(30s, ttl/2)）
  - `GetStats() DedupStats`
  - `ComputeDedupKey(topic string, raw []byte, data map[string]any) (key string, source string)`：
    - 优先查 DedupIDFields（string 或 finite number）
    - fallback: `xxhash.Sum64(topic + "|" + raw)` → base36 编码

### 2.4 sensor writer 升级
- 用 classifier 替换 MVP 的简单遍历
- 集成 timestamp.NormalizeToNanoseconds
- coerced 字段记 warn 日志
- skip 字段记 debug 日志

### 2.5 mqtt consumer 升级
- 集成 dedup（消息回调里先 ComputeDedupKey → CheckAndRecord → 重复则丢弃 + debug 日志）
- 集成 payload 校验（用 validator 或手写：检查 JSON 合法性 + 基本结构）
- Debug 模式（LOG_LEVEL=debug）打印完整 payload + 分类预览快照
- 提取 deviceId：从 topic `sensors/{deviceId}/...` 解析

### 2.6 health /stats 升级
- 加入 dedup 统计（enabled / size / maxSize / ttlMs / hits / misses / hitRate / evicted）

### 2.7 并行运行配置
- `.env.debug`（Go 版专用）：
  - `INFLUX_BUCKET=myHeatTestGo`
  - `MQTT_CLIENT_ID=go-mqtt-consumer`
  - `HEALTH_PORT=9002`
- 确保与 Bun 版（bucket=myHeatTest / clientId=bun-mqtt-consumer / port=9000）完全隔离

## Phase 3：测试 + 验证 + 切换（预计 3-4h）

### 3.1 单元测试移植
- `internal/classifier/classifier_test.go`：移植 47 个 fieldClassifier 测试（表驱动风格）
- `internal/timestamp/normalize_test.go`：移植 12 个时间戳测试
- `internal/dedup/dedup_test.go`：移植 19 个去重测试
- 目标：78+ 个测试全通过
- 用 testify/assert + testify/require

### 3.2 黄金测试（Golden Tests）— 关键验证
- 准备一组真实 payload（20-30 条，覆盖所有分支）：
  - 正常数值 / 字符串数值（白名单强转）/ 布尔 / tag / 嵌套对象 / null
  - 带 messageId / 不带 messageId
  - 各种 timestamp 单位（s / ms / us / ns / 缺失）
  - SKIP_FIELDS 全命中
- 用 Bun 版跑一遍，导出 InfluxDB Line Protocol 作为 golden file
- Go 版跑同样输入，对比输出必须**字节级一致**（除 timestamp 精度外）
- 存放：`testdata/golden/*.lp`

### 3.3 集成测试
- docker-compose（可选）：Mosquitto + InfluxDB + Go consumer + Bun consumer
- 发 100 条测试消息 → 对比两个 bucket 数据完全一致
- 验证 dedup 行为一致（发重复消息，两边都应丢弃）

### 3.4 并行双跑（24-48h）
- 云服务器部署 Go 版（独立 systemd unit `go-mqtt-consumer.service`）
- 两个服务同时跑，各自写各自的 bucket
- 每天对比：
  ```flux
  // Bun 版
  from(bucket: "myHeatTest") |> range(start: -24h) |> count()
  // Go 版
  from(bucket: "myHeatTestGo") |> range(start: -24h) |> count()
  ```
- 关注：数据条数一致 / 字段类型一致 / dedup hitRate 接近 / 无 error 日志

### 3.5 切换生产
- 确认 48h 数据一致后：
  1. 修改 Go 版 `.env`：bucket 改为 `myHeatTest`（生产 bucket）
  2. `sudo systemctl stop bun-mqtt-consumer`
  3. `sudo systemctl start go-mqtt-consumer`
  4. 验证数据继续落库
  5. 保留 Bun 版代码但 disable 服务（`sudo systemctl disable bun-mqtt-consumer`）
  6. 观察 1 周无问题后彻底移除 Bun 版

### 3.6 文档
- `go-mqtt-backend/README.md`：快速开始 + 命令表
- 共享 `PLATFORM.md`（架构/协议/InfluxDB/MQTT 部分通用）+ Go 专属实现章节
- 或独立 `go-mqtt-backend/PLATFORM.md`（从 Bun 版 fork，替换实现细节）

## 关键注意事项

### Go 与 TS 的行为差异（必须对齐）

1. **JSON number 精度**：Go `json.Unmarshal` 到 `any` 时所有数字都是 `float64`，大整数（>2^53）会丢精度。TS 也是 double，行为一致。但如果 payload 有 `json.Number` 需求，要用 `decoder.UseNumber()`
2. **map 遍历顺序**：Go map 无序！`ClassifyPayload` 返回顺序不确定。如果需要稳定顺序（如 golden test），要按 key 排序
3. **字符串 hash**：`Bun.hash()` 是 wyhash，Go 用 xxhash — 两者输出不同！dedup 的 hash fallback key 在两个版本间**不兼容**。并行跑时各自去重互不影响（因为各自有独立 LRU），但 golden test 要排除 hash key 对比
4. **时间戳精度**：Go `time.Time` 有纳秒精度，与 InfluxDB 对齐。TS 的 `Date.now()` 只有毫秒。Go 版 `time.Now().UnixNano()` 更精确
5. **InfluxDB Line Protocol 排序**：Go client 的 Point 序列化可能和 TS client 字段顺序不同。golden test 要按语义对比（parse 后比较），不能纯字符串 diff

### 性能预期

| 指标 | Bun 版 | Go 版预期 |
|---|---|---|
| 内存占用 | ~23 MB | ~8-15 MB（Go 更省） |
| 启动时间 | ~300ms | ~10ms（编译型） |
| 消息吞吐 | ~10k msg/s | ~50k+ msg/s |
| GC 暂停 | 无（Bun JSC） | <1ms（Go GC） |
| 二进制体积 | N/A（需 Bun 运行时） | ~15 MB（静态编译，零依赖部署） |

Go 版最大优势：**单二进制部署**，不需要在服务器装 Bun 运行时。

### 工作量估算

| Phase | 预计时长 | 产出 |
|---|---|---|
| Phase 1 MVP | 3-4h | 可运行的基础管道 |
| Phase 2 特性对齐 | 4-6h | v2.1 全特性 |
| Phase 3 测试+切换 | 3-4h + 48h 等待 | 生产验证 |
| **总计** | **10-14h 开发 + 48h 观察** | 完整替换 |
