# USAGE — rust-mqtt-backend 使用说明

本文件覆盖：本地运行、配置项、数据处理规则、健康端点、FAQ。
行为规范权威来源是 [`HANDOFF.md`](./HANDOFF.md) 第 2 节；本文件是面向使用者的提炼。

---

## 1. 本地运行

```bash
# 准备配置
cp .env.example .env && chmod 600 .env
$EDITOR .env                      # 填入密钥

# debug 构建运行（默认 .env）
cargo run -- --env-file=.env

# 调试运行（独立 clientId / bucket / 端口，可与生产并行）
cp .env.debug.example .env.debug && chmod 600 .env.debug
cargo run -- --env-file=.env.debug
```

命令行参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--env-file=<PATH>` | `.env` | 指定 dotenv 文件路径。文件不存在只告警不退出（仍可用真实环境变量） |

> 密钥只从 `.env` / 环境变量读取，绝不硬编码。`.env`、`.env.debug`、`.env.local` 已在 `.gitignore` 中。

---

## 2. 配置项（环境变量全集）

| 环境变量 | 必填 | 默认值 | 校验范围 / 说明 |
|---|---|---|---|
| `MQTT_URL` | ✅ | 无 | 如 `mqtt://127.0.0.1:1883` |
| `MQTT_USER` | ✅ | 无 | |
| `MQTT_PASS` | ✅ | 无 | 密钥，脱敏不入日志 |
| `MQTT_CLIENT_ID` | ❌ | `rust-mqtt-consumer` | 必须与 Bun/Go 版不同，否则 Broker 互踢 |
| `MQTT_SUBSCRIBE_TOPIC` | ❌ | `sensors/#` | |
| `INFLUX_URL` | ✅ | 无 | 如 `http://127.0.0.1:8086` |
| `INFLUX_TOKEN` | ✅ | 无 | 密钥，脱敏 |
| `INFLUX_ORG` | ✅ | 无 | |
| `INFLUX_BUCKET` | ✅ | 无 | Rust 版建议独立桶（如 `myHomeDemoRust`） |
| `LOG_LEVEL` | ❌ | `info` | 仅 `debug/info/warn/error/fatal`（大小写不敏感） |
| `HEALTH_PORT` | ❌ | `9004` | 范围 `1~65535`（Bun=9000，Go=9002） |
| `DEDUP_ENABLED` | ❌ | `true` | bool |
| `DEDUP_MAX_SIZE` | ❌ | `10000` | 范围 `100~1000000` |
| `DEDUP_TTL_MS` | ❌ | `300000` | 范围 `1000~3600000` |

**校验规则**：

- 必填项 trim 后为空 → 错误 `"{NAME}: 不能为空"`。
- 范围不合法 → 错误信息含当前值。
- `LOG_LEVEL` 非法 → `LOG_LEVEL: 无效值 "{v}"，可选 debug/info/warn/error/fatal`。
- **一次性收集并打印所有错误**（不是只报第一个）到 stderr，然后 `exit(1)`。
- 整数解析失败 → 静默用默认值（不报错）；bool 非法 → 用默认值。

启动成功会打一条脱敏 `snapshot` info 日志（不含 password / token）。

---

## 3. 数据处理规则

### 3.1 一条 MQTT 消息的生命周期

```
MQTT 收包(topic, raw payload)
  → 1) JSON 解析：必须是合法 JSON object；失败 → warn 丢弃
  → 2) 结构校验：object 非空；空对象 → warn 丢弃
  → 3) 去重：compute_dedup_key → check_and_record；重复 → debug 丢弃
  → 4) 提取 deviceId：topic sensors/{id}/... → 回退 payload.deviceId → "unknown"
  → 5) (仅 debug) 打印完整 payload + 字段分类快照
  → 6) 提取 timestamp（可选，payload["timestamp"] 且为数字时）
  → 7) 组装 Line Protocol：measurement=sensor_reading + tags + fields + 归一化时间戳
  → 8) 入队批量写 InfluxDB
```

### 3.2 字段分类器（7 层优先级，命中即返回）

| 层 | 条件 | 结果 | 说明 |
|---|---|---|---|
| 0 | `key ∈ SKIP_FIELDS` | skip | 优先级最高，reason=`meta field (skip list)` |
| 1 | `value == null` | skip | reason=`null/undefined` |
| 2 | `key ∈ TAG_FIELDS` 且值为字符串 | tag | 值非字符串则**不在此层返回**，继续下探（如 `location=42` → float） |
| 3 | 数字且有限 | float | 整数/浮点统一 f64 |
| 4 | 数字但 NaN/±Inf | skip | reason=`non-finite number` |
| 5 | bool | boolean | |
| 6 | 字符串 | 见 6a/6b/6c | |
| 7 | 其他（对象/数组） | skip | reason=`unsupported type` |

第 6 层细分：

- **6a**：`key ∈ NUMERIC_FIELD_HINTS` 且能解析成有限数字 → **float**，`coerced=true`，`raw=原始字符串`（记 warn 提示修固件）。
- **6b**：在白名单但无法解析 → **string**，reason=`numeric-hint but not parseable`（记 warn）。
- **6c**：不在白名单 → **string**，原样。

`try_parse_numeric_string`：trim → 空则失败 → 解析 f64 → **解析成功后必须再判 `is_finite()`**（因 Rust `"NaN".parse::<f64>()` 会成功）。

**常量集合**：

- `SKIP_FIELDS`（8）：`messageId, msgId, message_id, msg_id, uuid, id, timestamp, deviceId`
- `TAG_FIELDS`（2）：`location, type`
- `NUMERIC_FIELD_HINTS`：`temperature, humidity, pressure, dewPoint, battery, voltage, current, power, energy, rssi, snr, lux, co2, tvoc, pm25, pm10, pm1, altitude, windSpeed, windDirection, rainfall, soilMoisture, soilTemperature, waterLevel, value, count, duration, weight, distance`
  （逐字清单共 **29** 项；`HANDOFF.md` §2.5 概述误计为 28，见 [`README.md`](./README.md)「已知文档差异」）

### 3.3 时间戳归一化

按数量级判定单位，统一归一化为纳秒 int64：

| 判定（ts 为正有限数） | 单位 | 归一化 |
|---|---|---|
| `ts <= 0` / NaN / Inf | invalid | 用当前系统时间兜底 |
| `ts < 1e11` | 秒 | `× 1_000_000_000` |
| `ts < 1e14` | 毫秒 | `× 1_000_000` |
| `ts < 1e17` | 微秒 | `× 1_000` |
| `ts >= 1e17` | 纳秒 | 原样 |

缺失 timestamp（无该字段或非数字）→ 用当前系统时间纳秒兜底，`used_fallback=true`，unit=`invalid`。

### 3.4 去重（LRU + TTL）

**key 计算**：

1. **ID 字段优先**：按 `messageId, msgId, message_id, msg_id, uuid, id` 顺序找第一个可用值：
   - 非空字符串 → `id:{field}:{value}`
   - 有限数字 → `id:{field}:{最简十进制}`（`42` 而非 `42.0`）
   - 空串 / NaN / Inf → 跳过继续
2. **回退哈希**：`h:{base36(xxhash64(topic + "|" + raw))}`
   - 三版（Bun/Go/Rust）哈希算法不同，回退 key 不跨版本兼容——**无害**，各自独立去重。

**缓存行为**：`check_and_record` 返回 `true`=新消息（入库）/ `false`=重复（丢弃）；命中未过期刷新 LRU recency；命中已过期当新消息；新增写 `key→now`，容量满触发淘汰则 `evicted+1`；`enabled=false` 时永远返回 `true` 且不记录；后台 sweep 间隔 `max(30s, ttl/2)`。

### 3.5 Line Protocol 组装

- 格式：`sensor_reading,app=mqtt-consumer,device_id={id}[,location=..][,type=..] {fields} {ts_ns}`
- tags 按 key 排序保证确定性；tag key/value 转义空格、逗号、等号。
- fields：float 用 `{}`（`42` 而非 `42.0`）；bool 写 `t`/`f`；string 用双引号包裹并转义内部 `\` 与 `"`。
- **无任何 field（全被 skip）→ 跳过不写**（记 debug），否则 InfluxDB 会拒绝该行。

### 3.6 InfluxDB 写入参数

batch=**500** / flush=**1000ms** / retry=**1000ms × 3** / precision=**ns**；
`POST {INFLUX_URL}/api/v2/write?org={org}&bucket={bucket}&precision=ns`，
头 `Authorization: Token {INFLUX_TOKEN}` + `Content-Type: text/plain; charset=utf-8`；
写入失败异步记 error，不阻塞主流程。

---

## 4. 健康端点（HTTP，`HEALTH_PORT` 默认 9004）

**`GET /`**（200）：

```json
{ "name": "rust-mqtt-backend", "version": "2.1.0", "endpoints": ["/health", "/stats"] }
```

**`GET /health`**（MQTT 已连接 → 200 `ok`；未连接 → 503 `degraded`）：

```json
{ "status": "ok", "mqtt": { "connected": true }, "uptimeSec": 15, "timestamp": "2026-09-23T03:39:20.394131879Z" }
```

**`GET /stats`**（200）：

```json
{
  "uptimeSec": 15,
  "mqtt": { "connected": true, "clientId": "rust-mqtt-consumer", "subscribeTopic": "sensors/#" },
  "influx": { "url": "http://127.0.0.1:8086", "org": "myInfluxDB-org", "bucket": "myHomeDemoRust" },
  "dedup": { "enabled": true, "size": 6, "maxSize": 10000, "ttlMs": 300000, "hits": 0, "misses": 6, "hitRate": 0, "evicted": 0 }
}
```

`hitRate = hits/(hits+misses)`，保留 4 位小数；total=0 时为 0。

---

## 5. 优雅关闭

收到 `SIGINT` / `SIGTERM`：记 info `"收到信号，正在关闭..."` → 启动 **5s 兜底**（超时 warn `"优雅关闭超时，强制退出"` 并 exit(1)）→ 按依赖顺序关闭：① 健康 HTTP ② 去重 sweep ③ 断开 MQTT（发 DISCONNECT）④ **刷 InfluxDB 缓冲**（确保落库）⑤ 刷日志 → 打印 `"👋 已安全退出"`。

---

## 6. FAQ

**Q：启动即退出，报一堆 `XXX: 不能为空`？**
A：`.env` 没被读到或必填项为空。确认 `--env-file` 路径正确、7 个必填项都填了。程序会一次性列出所有缺失项。

**Q：`/health` 一直返回 503 degraded？**
A：MQTT 未连上。检查 `MQTT_URL/USER/PASS`、Broker 是否可达、clientId 是否与 Bun/Go 版冲突（相同 clientId 会被 Broker 互踢，日志会反复出现「MQTT 连接断开，将自动重连」）。

**Q：日志刷屏「MQTT 连接断开」？**
A：已在 Err 分支加 5s 重试延迟并降级为 debug，只在状态跃迁/首次失败打 warn。若仍刷屏说明 Broker 持续拒连，检查凭据。

**Q：数据没进 InfluxDB？**
A：① `/stats` 看 `dedup.misses` 是否增长（不涨说明没收到新消息或被去重）；② 检查 `INFLUX_TOKEN/ORG/BUCKET`；③ 看是否有 `InfluxDB 写入失败` error 日志；④ 确认 bucket 已创建。

**Q：同一 messageId 连发 3 条，入库几条？**
A：TTL 窗口内 1 条（去重生效）。可用 §HANDOFF 8.7 的 `mosquitto_pub` 验证。

**Q：能用 https / mqtts 吗？**
A：默认构建含 rustls，支持 TLS。若用 `--no-default-features` 的纯 Rust 构建，则仅支持 `http://` + 明文 `mqtt://`（适合本机部署）。
