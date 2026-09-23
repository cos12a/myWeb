# 使用说明（USAGE）

本文档面向**使用者 / 运维**：如何在本地跑起来、如何配置、数据如何被处理、如何验证与排错。

> 编译与上线部署请看 [DEPLOY.md](DEPLOY.md)；项目概览与文档导航请看 [README.md](README.md)。

---

## 目录

1. [环境要求](#1-环境要求)
2. [快速开始（本地运行）](#2-快速开始本地运行)
3. [配置：环境变量](#3-配置环境变量)
4. [命令表（Makefile）](#4-命令表makefile)
5. [运行与验证](#5-运行与验证)
6. [数据处理规则（核心）](#6-数据处理规则核心)
7. [健康端点 API](#7-健康端点-api)
8. [测试](#8-测试)
9. [常见问题（FAQ）](#9-常见问题faq)

---

## 1. 环境要求

- Go **1.22+**（开发环境验证于 1.27.1）
- 可访问的 **MQTT Broker**（如 Mosquitto）
- 可访问的 **InfluxDB 2.x**

---

## 2. 快速开始（本地运行）

```bash
# 1) 准备配置（二选一或都建）
cp .env.example .env               # 生产配置
cp .env.debug.example .env.debug   # 调试配置（独立 bucket/clientId/port）
chmod 600 .env .env.debug          # Linux 下收紧权限（含密钥）

# 2) 拉依赖 + 跑测试
make tidy
make test

# 3) 启动
make run           # 生产模式（读 .env）
make run-debug     # 调试模式（读 .env.debug，LOG_LEVEL=debug，打印完整 payload + 字段分类）
```

> `.env` / `.env.debug` 已被 gitignore，**绝不入库**。仓库里只有 `.example` 模板。

---

## 3. 配置：环境变量

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `MQTT_URL` | ✅ | — | 如 `mqtt://127.0.0.1:1883` |
| `MQTT_USER` | ✅ | — | MQTT 用户名 |
| `MQTT_PASS` | ✅ | — | MQTT 密码 |
| `MQTT_CLIENT_ID` | | `go-mqtt-consumer` | **并行跑时必须与其它实例不同**，否则 Broker 互踢 |
| `MQTT_SUBSCRIBE_TOPIC` | | `sensors/#` | 订阅主题 |
| `INFLUX_URL` | ✅ | — | 如 `http://127.0.0.1:8086` |
| `INFLUX_TOKEN` | ✅ | — | InfluxDB API Token |
| `INFLUX_ORG` | ✅ | — | 组织名 |
| `INFLUX_BUCKET` | ✅ | — | **并行跑时必须与其它实例不同** |
| `LOG_LEVEL` | | `info` | `debug/info/warn/error/fatal` |
| `HEALTH_PORT` | | `9002` | 健康端点端口 |
| `DEDUP_ENABLED` | | `true` | 是否启用去重 |
| `DEDUP_MAX_SIZE` | | `10000` | LRU 最大条目（100~1000000） |
| `DEDUP_TTL_MS` | | `300000` | 去重窗口毫秒（1000~3600000） |

启动时会校验必填项与取值范围；任一不合法会**一次性列出所有错误**并退出（exit 1）。

---

## 4. 命令表（Makefile）

| 命令 | 作用 |
|---|---|
| `make run` | 用 `.env` 启动 |
| `make run-debug` | 用 `.env.debug` 启动（调试） |
| `make test` | 运行全部单元测试（`-v -count=1`） |
| `make test-cover` | 测试 + 生成 HTML 覆盖率报告 |
| `make lint` | `golangci-lint`（需先安装） |
| `make tidy` | `go mod tidy` 整理依赖 |
| `make build` | 交叉编译 Linux amd64 生产二进制 |
| `make build-local` | 编译本机开发二进制 |
| `make clean` | 清理编译产物 |

> 编译细节见 [DEPLOY.md](DEPLOY.md#1-编译)。

---

## 5. 运行与验证

启动后，另开一个终端：

```bash
# 健康检查（200=正常 / 503=MQTT 未连接）
curl http://localhost:9002/health

# 运行时统计（uptime / mqtt / influx / dedup）
curl http://localhost:9002/stats

# 发一条测试消息，确认能落库
mosquitto_pub -h 127.0.0.1 -p 1883 -u <user> -P <pass> \
  -t "sensors/ESP32-TEST/data" \
  -m '{"messageId":"t-001","temperature":25.6,"humidity":"60.2","location":"lab","online":true}'
```

`LOG_LEVEL=debug` 时，日志会打印收到的完整 payload 与字段分类快照，便于确认每个字段被如何入库。

---

## 6. 数据处理规则（核心）

### 6.1 MQTT 消息格式

- **Topic**：`sensors/{deviceId}/...`，其中第 2 段被解析为 `deviceId`，永远写入 tag `device_id`。
  - 解析不到时回退 payload 里的 `deviceId` 字段，再回退 `"unknown"`。
- **Payload**：必须是 **JSON object** 且非空；否则记 warn 并丢弃。
- **Measurement**：固定为 `sensor_reading`。
- **默认 tag**：`app=mqtt-consumer`、`device_id=<deviceId>`。

示例：
```json
{
  "messageId": "7C2C6751DA00-42",
  "timestamp": 1758470400000,
  "temperature": 25.6,
  "humidity": "60.2",
  "location": "living-room",
  "online": true,
  "status": "ok"
}
```

### 6.2 字段分类器（7 层优先级）

每个 `(key, value)` 按以下优先级决定去向：

| 优先级 | 条件 | 结果 |
|---|---|---|
| 0 | `key ∈ SKIP_FIELDS` | **skip**（元字段黑名单，不入库） |
| 1 | `value == null` | skip |
| 2 | `key ∈ TAG_FIELDS` 且值是字符串 | **tag**（索引，低基数） |
| 3 | 有限数值（float/int） | **float** field |
| 4 | NaN / ±Inf | skip（非有限数） |
| 5 | bool | **boolean** field |
| 6 | string 且 `key ∈ NUMERIC_FIELD_HINTS` 且可解析 | **float** field（`coerced=true` + warn） |
| 6 | string 且 `key ∈ NUMERIC_FIELD_HINTS` 但不可解析 | **string** field（reason 标注） |
| 6 | 其它 string | **string** field |
| 7 | 其它类型（object / array 等） | skip |

- `TAG_FIELDS`：`location`、`type`（低基数、常用作过滤；高基数字段切勿加进来，会导致 series 爆炸）。

### 6.3 SKIP_FIELDS 元字段黑名单

以下字段**无论值类型一律不写入 InfluxDB**（仅用于路由 / 去重 / 时间戳）：

| 字段 | 原因 |
|---|---|
| `messageId` `msgId` `message_id` `msg_id` `uuid` `id` | 仅用于服务端 LRU 去重计算 key |
| `timestamp` | 已由 Point 时间戳处理，再存字段是冗余 |
| `deviceId` | 已由 topic 解析为 `device_id` tag |

> 存这些元字段每个点约浪费 ~50 字节，还会污染 field 类型空间。

### 6.4 数值白名单强转（NUMERIC_FIELD_HINTS）

当下列字段被传感器**误传成字符串**时，自动强转为 float，避免 InfluxDB 中该字段被永久锁死为 string 类型：

```
temperature humidity pressure dewPoint
battery voltage current power energy
rssi snr
lux co2 tvoc pm25 pm10 pm1 altitude
windSpeed windDirection rainfall
soilMoisture soilTemperature waterLevel
value count duration weight distance
```

强转时会记一条 **warn** 日志（提示应修传感器固件）。不在白名单的字符串（如 `status="ok"`、`firmware="1.2.3"`）保持 string。

### 6.5 智能时间戳归一化

payload 里的 `timestamp`（若有）按数量级自动识别单位并统一为**纳秒**：

| 数量级 | 判定单位 | 阈值 |
|---|---|---|
| `< 1e11` | 秒 (s) | 10 位数 |
| `< 1e14` | 毫秒 (ms) | 13 位数 |
| `< 1e17` | 微秒 (us) | 16 位数 |
| `>= 1e17` | 纳秒 (ns) | 19 位数 |

- `timestamp` 缺失 / 非法（0、负数、NaN、Inf）→ 用**服务器当前时间**兜底（debug 日志提示）。

### 6.6 消息去重（LRU + TTL）

- **去重键**优先级：
  1. payload 里第一个命中的显式 ID 字段（`messageId` > `msgId` > `message_id` > `msg_id` > `uuid` > `id`），键形如 `id:messageId:<值>`；
  2. 无 ID 字段时回退 `xxhash(topic + "|" + rawPayload)`，键形如 `h:<base36>`。
- **判定**：键在 TTL 窗口内已存在 → 判为重复，丢弃 + debug 日志；否则记录并放行。
- **惰性过期** + **周期清扫**（间隔 `max(30s, ttl/2)`）防止内存泄漏。
- `DEDUP_ENABLED=false` 时所有消息都放行。

> ⚠️ **慢变化数据（如 voltage）务必让传感器带 `messageId`**：否则相同 payload 会算出相同 hash，在 TTL 窗口内被误判为重复而丢弃，表现为"数据间歇性中断"。

---

## 7. 健康端点 API

| 端点 | 方法 | 返回 |
|---|---|---|
| `/` | GET | 服务名 / 版本 / 可用端点 |
| `/health` | GET | `200 {"status":"ok"}`（MQTT 已连）或 `503 {"status":"degraded"}` |
| `/stats` | GET | uptime + mqtt（connected/clientId/topic）+ influx（url/org/bucket）+ dedup 统计 |

`/stats` 里 dedup 统计字段：`enabled / size / maxSize / ttlMs / hits / misses / hitRate / evicted`。

---

## 8. 测试

```bash
make test          # 73 个测试函数，覆盖 classifier / dedup / timestamp
make test-cover    # 覆盖率：classifier 80% / dedup 97% / timestamp 100%
```

测试用例从 `bun-mqtt-backend/tests/*.test.ts` 逐条移植，行为语义对齐。

---

## 9. 常见问题（FAQ）

| 现象 | 原因 | 解决 |
|---|---|---|
| 启动即退出，报环境变量校验失败 | `.env` 缺必填项 / 取值越界 | 按报错列表补齐 7 个必填项，检查端口/去重范围 |
| `/health` 返回 503 `degraded` | MQTT 未连接 | 查 `MQTT_URL` / 账号密码 / Broker 是否在跑 |
| 数据没进 InfluxDB | bucket/org/token 不对，或被去重误杀 | 看日志有无 `InfluxDB 写入失败`；确认传感器带 `messageId` |
| 某数值字段查出来是字符串 | 该字段曾以 string 写入，类型被锁死 | 确保字段在 `NUMERIC_FIELD_HINTS` 白名单里；已锁死需迁移 series |
| 慢变化数据间歇性丢失 | 无 `messageId` 时相同 payload 被去重 | 传感器固件加 `messageId`（见 6.6） |
| 与另一实例互相掉线 | `MQTT_CLIENT_ID` 撞了 | 每个实例用不同 clientId |
| 某字段没入库 | 命中 SKIP_FIELDS 或被分类为 skip | debug 日志看 `跳过字段` 的 reason |
