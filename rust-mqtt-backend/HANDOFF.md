# rust-mqtt-backend 交接文档（HANDOFF）

> 本文件是**自包含**的实现说明书。你在**没有任何历史聊天记录**的情况下，只凭这一份文档，就能从零写出 `bun-mqtt-backend` / `go-mqtt-backend` 的 **Rust 等价版本**，并编译、测试、部署。
>
> 阅读对象：具备 Rust 工具链的远程电脑上的执行者（人类工程师或 AI Agent）。
>
> 对齐基准：仓库里已有的 `go-mqtt-backend`（v2.1，14 个源文件 / 73 个测试函数，已在阿里云 ECS 生产跑通）。**Rust 版必须与 Go 版行为逐条一致**。

---

## 0. 给远程执行者的启动指令（先读这一节）

**一句话任务**：在 `rust-mqtt-backend/` 目录里，按本文档从零实现一个 Rust 版 MQTT→InfluxDB 消费者，逐阶段推进，最终 `cargo build --release` 通过、`cargo test` 全绿（≥73 个测试），并产出可部署到 Linux x86_64 的二进制。

**执行顺序（严格遵守）**：

1. 先读 **第 1 节（背景）** 和 **第 2 节（系统行为规范）**——这是"要做什么"的权威定义，语言无关，必须 1:1 复刻。
2. 读 **第 3 节（技术栈与 Cargo.toml）**，按 **第 4 节（目录结构）** 建好 crate 骨架。
3. 按 **第 5 节（逐模块实现规范）** 一个模块一个模块地写。每写完一个纯逻辑模块（classifier / timestamp / dedup），立刻按 **第 7 节（测试计划）** 补它的单元测试并 `cargo test`。
4. 全部写完后按 **第 8 节（编译与部署）** 出 release 二进制 + musl 静态产物。
5. 全程用 **第 9 节（分阶段执行清单）** 勾选进度；遇到 Rust 特有的坑先查 **第 6 节（行为对齐陷阱）**。

**硬性要求**：

- 不修改 `go-mqtt-backend/` 和 `bun-mqtt-backend/` 的任何文件；只在 `rust-mqtt-backend/` 下新增文件。
- 所有对外可见的行为常量（黑名单字段名、白名单字段名、tag 字段名、时间戳阈值、去重 key 格式、健康端点 JSON 字段、measurement 名、默认端口）**必须与第 2 节表格逐字一致**，不得自行改名或改值。
- 日志字段名、JSON 结构尽量与 Go 版对齐（见 5.2 / 2.8），方便三版并行时统一观察。
- 密钥（MQTT 密码、InfluxDB token）只从环境变量 / `.env` 读取，**绝不硬编码进源码**，`.env` 必须进 `.gitignore`。

**验收标准（全部满足才算完成）**：

- [ ] `cargo build --release` 无 error、无 warning（允许少量无害 warning）。
- [ ] `cargo test` 全绿，测试数 ≥ 73，覆盖 classifier / dedup / timestamp 三个纯逻辑模块。
- [ ] `cargo clippy -- -D warnings` 通过（可选但推荐）。
- [ ] 能加 `x86_64-unknown-linux-musl` 目标并 `cargo build --release --target x86_64-unknown-linux-musl` 产出静态二进制。
- [ ] 提供 `.env.example`、`.env.debug.example`、`.gitignore`、`Makefile`、`deploy/rust-mqtt-consumer.service`、`README.md`、`USAGE.md`、`DEPLOY.md`。

---

## 1. 项目背景与现状快照

### 1.1 这是什么系统

一个**物联网数据管道消费者**：

- 订阅 MQTT Broker 上的传感器主题（`sensors/#`）。
- 每条消息是一个 JSON 对象（某台设备的若干读数，如温度、湿度、电量）。
- 对消息做**去重** → **字段智能分类** → **时间戳归一化**，然后写入 **InfluxDB 2.x** 时序库。
- 暴露 HTTP **健康检查 / 统计端点**。
- 支持**优雅关闭**（收到 SIGINT/SIGTERM 时按依赖顺序刷盘退出）。

### 1.2 版本演进

| 版本 | 语言 | 状态 |
|---|---|---|
| `bun-mqtt-backend` | TypeScript / Bun | v2.1，最初实现，功能基准 |
| `go-mqtt-backend` | Go | v2.1 全特性对齐，**已在阿里云 ECS（Debian 13 / x86_64）生产跑通**，systemd 常驻，写入 InfluxDB 桶 `myHomeDemo`、org `myInfluxDB-org`、MQTT `sensors/#` QoS1 |
| `rust-mqtt-backend` | **Rust（本次任务）** | 待实现 |

### 1.3 Rust 版定位

- **技术储备 / 性能极致**：验证 Rust 在同等逻辑下的资源占用（预期内存比 Go 更低、无 GC 停顿）。
- **与 Go/Bun 并行双跑验证**：用**完全隔离**的 clientId / bucket / 端口，三个版本同时订阅同一个 MQTT 主题各收全量消息、各写各的桶，互不干扰。**Rust 版不立即替换生产**。

### 1.4 已知的真实运行环境（部署目标）

- 阿里云 ECS，**Debian 13，x86_64（= amd64）**，2 核 Intel Xeon，运行用户 `yzluo`。
- InfluxDB：**OSS v2.9.1**，本机 `http://127.0.0.1:8086`。
- MQTT Broker：Mosquitto，本机 `mqtt://127.0.0.1:1883`。
- 真实存在的桶示例：`myHomeDemo`（org `myInfluxDB-org`）。**注意**：`.env.example` 模板里的 `myHeatTest` 只是占位，实际部署要填服务器 InfluxDB 里真实存在的桶名，否则写入报 `404 bucket not found`。

---

## 2. 系统行为规范（必须 1:1 复刻，语言无关）

> 这一节是**权威行为定义**。Rust 实现必须逐条对齐。凡是列了具体字符串/数字的地方，都要**逐字照抄**。

### 2.1 数据流水线（一条 MQTT 消息的完整生命周期）

按顺序执行，任一步失败则丢弃该消息并记日志：

```
MQTT 收包(topic, raw payload)
  → 1) JSON 解析：raw 必须是合法 JSON object；失败 → warn 丢弃
  → 2) 结构校验：object 非空；空对象 → warn 丢弃
  → 3) 去重：ComputeDedupKey(topic, raw, data) → CheckAndRecord(key)；重复 → debug 丢弃
  → 4) 提取 deviceId：从 topic sensors/{deviceId}/... 解析；解析不到再回退 payload.deviceId；再不行用 "unknown"
  → 5) (仅 debug 级别) 打印完整 payload + 字段分类快照
  → 6) 提取 timestamp（可选，payload["timestamp"] 且为数字时）
  → 7) 组装 Point：measurement=sensor_reading，tags，fields，归一化时间戳
  → 8) 入队批量写 InfluxDB
```

### 2.2 MQTT 规范

| 项 | 值 / 行为 |
|---|---|
| 订阅主题 | 环境变量 `MQTT_SUBSCRIBE_TOPIC`，默认 `sensors/#` |
| QoS | **1** |
| topic 格式 | `sensors/{deviceId}/...`（deviceId 是第 2 段） |
| measurement | 固定字符串 **`sensor_reading`** |
| 默认 tag | `app=mqtt-consumer`（固定）+ `device_id={deviceId}` |
| 会话 | **持久会话**：CleanSession=false（MQTT v3）/ clean_start=false（v5） |
| 重连 | 自动重连；重连后**必须重新订阅**（持久会话下 broker 可能保留，但显式重订阅更稳） |
| KeepAlive | 60 秒 |
| 首次连接重试 | 连接失败持续重试，重试间隔 5 秒；最大重连间隔 30 秒 |
| deviceId 解析规则 | `topic.split('/')`，若 `parts[0]=="sensors"` 且 `len>=2` 则取 `parts[1]`，否则空字符串 |

**deviceId 回退链**：topic 解析 → 若为空则取 `payload["deviceId"]`（字符串且非空）→ 若仍无则用字符串 `"unknown"`。

### 2.3 字段分类器：7 层优先级（核心）

对 payload 里每个 `(key, value)` 判定它在 InfluxDB 里应走的路径。**严格按优先级从上到下**，命中即返回：

| 层 | 判定条件 | 结果 Kind | 附加说明 |
|---|---|---|---|
| **0** | `key ∈ SKIP_FIELDS`（黑名单） | **skip** | reason = `"meta field (skip list)"`。**优先级最高**，即使值像 tag 或像数字也一律 skip |
| **1** | `value == null` | **skip** | reason = `"null/undefined"` |
| **2** | `key ∈ TAG_FIELDS` **且** value 是字符串 | **tag** | value 原样作为 tag 字符串。若 key 在 TAG_FIELDS 但值不是字符串，**不在此层返回**，继续往下走（例如 `location=42` 会落到第 3 层变 float） |
| **3** | value 是数字且**有限**（非 NaN/Inf） | **float** | 整数、浮点统一转 f64 |
| **4** | value 是数字但 **NaN 或 ±Inf** | **skip** | reason = `"non-finite number"` |
| **5** | value 是 bool | **boolean** | |
| **6** | value 是字符串 | 见下方 6a/6b/6c | |
| **7** | 其他类型（对象 / 数组 / 等） | **skip** | reason = `"unsupported type"` |

**第 6 层字符串细分**：

| 子层 | 条件 | 结果 |
|---|---|---|
| 6a | `key ∈ NUMERIC_FIELD_HINTS` **且** 字符串能解析成有限数字 | **float**，`coerced=true`，`raw=原始字符串` |
| 6b | `key ∈ NUMERIC_FIELD_HINTS` **但** 无法解析成数字 | **string**，reason = `"numeric-hint but not parseable"` |
| 6c | 其他（key 不在白名单） | **string**，原样 |

**字符串→数字解析规则（`try_parse_numeric_string`）**：

1. 先 `trim` 首尾空白（空格、`\t`、`\n` 等）。
2. trim 后为空字符串 → 解析失败。
3. 按十进制浮点解析（支持 `25.6`、`-10`、`0`、`1e3`、`3.7`）。
4. 解析结果是 NaN 或 ±Inf → 失败。
5. 形如 `1.2.3`、`25.6abc`、`ok` → 失败。
6. ⚠️ **Rust 注意**：`"NaN"`、`"Infinity"`、`"Inf"` 这些字符串在 Rust `"NaN".parse::<f64>()` 会**成功**解析成 NaN/Inf！必须**额外拦截**：解析成功后再判 `is_finite()`，非有限则视为失败（见第 6 节陷阱）。Go 的 `strconv.ParseFloat` 也会解析 "NaN"，但 Go 代码显式加了 `IsNaN/IsInf` 检查——Rust 必须照做。

### 2.4 SKIP_FIELDS 黑名单（元字段，一律不入库）

共 **8 个** key，逐字照抄：

```
messageId, msgId, message_id, msg_id, uuid, id, timestamp, deviceId
```

- 前 6 个是"去重 ID 字段"（见 2.7），它们只用于服务端去重计算 key，不写库。
- `timestamp`：已由 Point 的时间戳处理（2.6），不作为 field。
- `deviceId`：已由 topic 解析成 `device_id` tag，不作为 field。

### 2.5 TAG_FIELDS 与 NUMERIC_FIELD_HINTS

**TAG_FIELDS（识别为 tag 的 key，必须低基数）**，共 2 个：

```
location, type
```

**NUMERIC_FIELD_HINTS（数值字段白名单，字符串误传时自动强转 float）**，共 **28 个**，逐字照抄：

```
temperature, humidity, pressure, dewPoint,
battery, voltage, current, power, energy,
rssi, snr,
lux, co2, tvoc, pm25, pm10, pm1,
altitude, windSpeed, windDirection, rainfall,
soilMoisture, soilTemperature, waterLevel,
value, count, duration, weight, distance
```

> 分组仅为可读性，实际是一个集合。计数核对：温湿度气压 4 + 电量 5 + 无线 2 + 环境 12 + 通用 5 = **28**。

### 2.6 智能时间戳归一化

payload 可选带 `timestamp` 字段（数字）。按**数量级**判定单位并统一归一化为**纳秒 int64**：

| 判定（ts 为正有限数） | 单位 | 归一化到纳秒 |
|---|---|---|
| `ts <= 0` 或 NaN 或 Inf | **invalid** | 用当前系统时间兜底 |
| `ts < 1e11` | 秒 (s) | `ts * 1_000_000_000` |
| `ts < 1e14` | 毫秒 (ms) | `ts * 1_000_000` |
| `ts < 1e17` | 微秒 (us) | `ts * 1_000` |
| `ts >= 1e17` | 纳秒 (ns) | `ts`（原样） |

- **缺失 timestamp**（payload 没有该字段，或字段不是数字）→ 用**当前系统时间纳秒**兜底，标记 `used_fallback=true`，unit=`invalid`。
- 归一化实现：先 `detect_unit(ts)`，invalid 则兜底；否则 `(ts as i64) * 对应倍率`。
- ⚠️ 关键等值：`1_758_470_400`（秒）、`1_758_470_400_000`（毫秒）、`1_758_470_400_000_000`（微秒）、`1_758_470_400_000_000_000`（纳秒）四种写法归一化后**都等于** `1_758_470_400_000_000_000` 纳秒。这个值能被 f64 精确表示（是 512 的倍数），测试会断言四者相等。

### 2.7 去重算法（LRU + TTL）

**目的**：同一消息在 TTL 窗口内重复到达只入库一次。

**去重 key 计算（`compute_dedup_key(topic, raw, data)`）**：

1. **优先 ID 字段**：按固定优先级顺序遍历 `DEDUP_ID_FIELDS = [messageId, msgId, message_id, msg_id, uuid, id]`：
   - 若 `data` 含该字段且值为**非空字符串** → key = `id:{field}:{value}`，source=`id`，立即返回。
   - 若值为**有限数字** → key = `id:{field}:{format_float(value)}`（用最简十进制表示，如 `42` 而非 `42.0`），source=`id`，立即返回。
   - 空字符串、NaN/Inf 数字 → 跳过该字段，继续找下一个。
2. **回退哈希**：没有任何可用 ID 字段时，`h = xxhash64(topic + "|" + raw)`，key = `h:{base36(h)}`，source=`hash`。
   - `base36`：把 u64 转成 36 进制字符串（字符集 `0-9a-z`）。
   - ⚠️ Rust 的 xxhash 实现（`xxhash-rust`）与 Go（`cespare/xxhash`）、Bun（wyhash）**产生的哈希值可能不同**，所以 fallback key 不跨版本兼容。**这无害**：三版并行时各自独立去重，只要同一版本内自洽即可。测试只断言格式（`h:` 前缀）、幂等性（相同输入相同 key）、区分性（不同 topic/raw 不同 key），**不断言具体哈希值**。

**缓存行为（`MessageDeduplicator`）**：

| 行为 | 规范 |
|---|---|
| `check_and_record(key)` 返回 | `true`=新消息（已记录，应入库）；`false`=重复（应丢弃） |
| 去重关闭时（enabled=false） | 永远返回 `true`，不记录 |
| 命中未过期 | 返回 `false`，`hits += 1`，**并刷新该 key 的 LRU recency**（命中即视为近期使用） |
| 命中已过期（惰性过期） | 移除旧条目，当作新消息处理（走下面新增逻辑） |
| 新消息 | 写入 `key -> now`，`misses += 1`；若因容量满触发淘汰，`evicted += 1` |
| LRU 容量 | `DEDUP_MAX_SIZE`（默认 10000）；构造时若 `maxSize < 1` 强制为 1 |
| TTL | `DEDUP_TTL_MS`（默认 300000 = 5 分钟）；判定过期用 `now - entry >= ttl` |
| 周期 sweep | 后台任务定期清理过期条目，间隔 = `max(30s, ttl/2)`；sweep 返回本次移除数量 |
| 统计 hitRate | `hits / (hits + misses)`，**保留 4 位小数**（`round(x*10000)/10000`）；total=0 时 hitRate=0 |

**统计结构 `Stats`（用于 /stats 端点，JSON 字段名逐字照抄）**：

```json
{
  "enabled": true,
  "size": 64,
  "maxSize": 10000,
  "ttlMs": 300000,
  "hits": 1,
  "misses": 64,
  "hitRate": 0.0154,
  "evicted": 0
}
```

### 2.8 健康端点（HTTP）

监听 `HEALTH_PORT`（默认见 2.9）。三个路由，全部 `GET`，返回 `application/json; charset=utf-8`：

**`GET /`**（服务信息，HTTP 200）：

```json
{ "name": "rust-mqtt-backend", "version": "2.1.0", "endpoints": ["/health", "/stats"] }
```

> `name` 改成 `rust-mqtt-backend`（Go 版是 `go-mqtt-backend`）；其余一致。

**`GET /health`**（存活探针）：

- MQTT 已连接 → HTTP **200**，`status="ok"`。
- MQTT 未连接 → HTTP **503**，`status="degraded"`。

```json
{
  "status": "ok",
  "mqtt": { "connected": true },
  "uptimeSec": 15,
  "timestamp": "2026-09-23T03:39:20.394131879Z"
}
```

- `uptimeSec`：进程启动至今的整数秒。
- `timestamp`：当前 UTC 时间，RFC3339 纳秒精度（结尾 `Z`）。

**`GET /stats`**（运行时统计，HTTP 200）：

```json
{
  "uptimeSec": 15,
  "mqtt": { "connected": true, "clientId": "rust-mqtt-consumer", "subscribeTopic": "sensors/#" },
  "influx": { "url": "http://127.0.0.1:8086", "org": "myInfluxDB-org", "bucket": "myHomeDemoRust" },
  "dedup": { "enabled": true, "size": 6, "maxSize": 10000, "ttlMs": 300000, "hits": 0, "misses": 6, "hitRate": 0, "evicted": 0 }
}
```

### 2.9 配置项（环境变量）全集

| 环境变量 | 必填 | 默认值 | 校验范围 / 说明 |
|---|---|---|---|
| `MQTT_URL` | ✅ | 无 | 如 `mqtt://127.0.0.1:1883` |
| `MQTT_USER` | ✅ | 无 | |
| `MQTT_PASS` | ✅ | 无 | 密钥，脱敏不入日志 |
| `MQTT_CLIENT_ID` | ❌ | `rust-mqtt-consumer` | Go 版默认 `go-mqtt-consumer`；**Rust 版用 `rust-mqtt-consumer`** 以隔离 |
| `MQTT_SUBSCRIBE_TOPIC` | ❌ | `sensors/#` | |
| `INFLUX_URL` | ✅ | 无 | 如 `http://127.0.0.1:8086` |
| `INFLUX_TOKEN` | ✅ | 无 | 密钥，脱敏 |
| `INFLUX_ORG` | ✅ | 无 | |
| `INFLUX_BUCKET` | ✅ | 无 | |
| `LOG_LEVEL` | ❌ | `info` | 只接受 `debug/info/warn/error/fatal`（大小写不敏感，统一转小写） |
| `HEALTH_PORT` | ❌ | `9004` | 范围 `1~65535`。**Rust 版默认 9004**（Go=9002，Bun=9000），三版隔离 |
| `DEDUP_ENABLED` | ❌ | `true` | bool |
| `DEDUP_MAX_SIZE` | ❌ | `10000` | 范围 `100~1000000` |
| `DEDUP_TTL_MS` | ❌ | `300000` | 范围 `1000~3600000` |

**配置校验规则**：

- 必填项为空（trim 后空字符串）→ 收集错误 `"{NAME}: 不能为空"`。
- 范围不合法 → 收集对应错误信息（含当前值）。
- `LOG_LEVEL` 非法 → `LOG_LEVEL: 无效值 "{v}"，可选 debug/info/warn/error/fatal`。
- **一次性返回所有错误**（不是只报第一个），逐行打印到 stderr 后 `exit(1)`。
- `int` 解析失败 → 用默认值（不报错，与 Go 版 `getEnvInt` 行为一致）。
- `bool` 解析：接受 `1/t/T/TRUE/true/True` 为真，`0/f/F/FALSE/false/False` 为假；其他 → 用默认值。

**脱敏快照 `snapshot()`**（启动时打 info 日志用，**不含** password / token）：结构见 Go 版 `config.Snapshot()`，包含 mqtt{url,username,clientId,subscribeTopic,qos:1}、influx{url,org,bucket}、log{level}、health{port}、dedup{enabled,maxSize,ttlMs}。

### 2.10 优雅关闭

收到 `SIGINT` 或 `SIGTERM`：

1. 记 info 日志 `"收到信号，正在关闭..."`（带 signal 名）。
2. 启动 **5 秒兜底定时器**：超时则 warn `"优雅关闭超时，强制退出"` 并 `exit(1)`。
3. 按**依赖顺序**关闭（3 秒超时上下文）：
   - ① 停止健康检查 HTTP 服务器
   - ② 停止去重器 sweep 后台任务
   - ③ 断开 MQTT（发送 DISCONNECT，等待约 1 秒）
   - ④ **刷新 InfluxDB 写入缓冲区**（关键：确保缓冲里的点全部落库）
   - ⑤ 刷新日志缓冲
4. 打印 `"👋 已安全退出"`。

### 2.11 InfluxDB 写入参数

| 参数 | 值 |
|---|---|
| 批量大小 BatchSize | **500** 点 |
| 刷新间隔 FlushInterval | **1000 ms** |
| 重试间隔 RetryInterval | **1000 ms** |
| 最大重试 MaxRetries | **3** |
| 精度 Precision | **纳秒 (ns)** |
| 写入端点 | `POST {INFLUX_URL}/api/v2/write?org={org}&bucket={bucket}&precision=ns` |
| 鉴权头 | `Authorization: Token {INFLUX_TOKEN}` |
| Content-Type | `text/plain; charset=utf-8` |
| 写入错误 | 异步记 error 日志 `"InfluxDB 写入失败"`，不阻塞主流程 |

**Point → Line Protocol 组装规则**：

- 格式：`measurement,tag1=v1,tag2=v2 field1=v1,field2=v2 timestamp_ns`
- measurement = `sensor_reading`。
- tags：`app=mqtt-consumer`、`device_id={deviceId}`，加上分类为 tag 的字段（location/type）。tag 值需转义（空格、逗号、等号）。
- fields：float 直接写数字；bool 写 `t`/`f`（或 `true`/`false`）；string 用双引号包裹并转义内部双引号。
- timestamp：纳秒整数（2.6 归一化结果）。
- ⚠️ 若一个 Point 没有任何 field（全被 skip），InfluxDB 会拒绝该行——应跳过不写（记 debug）。

---

## 3. Rust 技术栈与 Cargo.toml

### 3.1 crate 选型（给出理由）

| 用途 | crate | 版本（写作时） | 说明 |
|---|---|---|---|
| 异步运行时 | `tokio` | `1` (features=`full`) | 事实标准 |
| MQTT 客户端 | `rumqttc` | `0.24` | 异步 `AsyncClient` + `EventLoop`；支持 v3/v5、持久会话、自动重连 |
| HTTP 服务 | `axum` | `0.7` | 健康端点；配 `tokio` |
| 日志 | `tracing` + `tracing-subscriber` | `0.1` / `0.3`(features=`json`,`env-filter`) | JSON 结构化日志，字段对齐 Go/zap |
| 序列化 | `serde` + `serde_json` | `1`(features=`derive`) / `1` | JSON 解析、端点响应 |
| .env 加载 | `dotenvy` | `0.15` | `godotenv` 的 Rust 等价 |
| LRU+TTL 缓存 | `moka` | `0.12`(features=`future`) | 自带 TTL 与 LRU 淘汰；也可用 `lru`+手写 TTL |
| 哈希 | `xxhash-rust` | `0.8`(features=`xxh64`) | fallback dedup key |
| 错误处理 | `anyhow` + `thiserror` | `1` / `1` | anyhow 做应用层，thiserror 做库层 |
| HTTP 客户端（写 InfluxDB） | `reqwest` | `0.12`(features=`json`, 默认 rustls 或 native-tls) | Line Protocol 批量 POST |
| 时间 | `chrono` | `0.4`(features=`serde`) | RFC3339 纳秒格式化；也可纯 std |
| 命令行 | `clap` | `4`(features=`derive`) | `--env-file`；也可用 `std::env::args` 手写 |
| base36 编码 | 手写 | — | 标准库无 base36，自己写 u64→base36（见 5.6） |

> **InfluxDB 写入方案取舍**：
> - **主选（推荐）**：手写 Line Protocol + `reqwest` 批量 POST `/api/v2/write`。依赖风险最低、批量/重试完全可控、无 crate 版本兼容坑。本文档按此方案给规范。
> - **备选**：`influxdb2` crate（API 类似 Go 官方客户端）。若选它，注意其异步 API 与版本差异，批量参数需自行配置。
> - 无论哪种，**外部可观测行为（批量 500 / flush 1s / retry 3 / ns 精度）必须一致**。

### 3.2 完整 Cargo.toml 示例（可直接用）

```toml
[package]
name = "rust-mqtt-backend"
version = "2.1.0"
edition = "2021"
rust-version = "1.75"
description = "Rust rewrite of bun-mqtt-backend: MQTT -> dedup/classify/normalize -> InfluxDB 2.x"

[[bin]]
name = "rust-mqtt-consumer"
path = "src/main.rs"

[dependencies]
tokio = { version = "1", features = ["full"] }
rumqttc = "0.24"
axum = "0.7"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
dotenvy = "0.15"
moka = { version = "0.12", features = ["future"] }
xxhash-rust = { version = "0.8", features = ["xxh64"] }
anyhow = "1"
thiserror = "1"
reqwest = { version = "0.12", features = ["json"] }
chrono = { version = "0.4", features = ["serde"] }
clap = { version = "4", features = ["derive"] }

[dev-dependencies]
tokio = { version = "1", features = ["full", "test-util"] }

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
strip = true
panic = "abort"
```

> 版本号以远程 `cargo add` / crates.io 当时最新兼容版为准；如某 crate 主版本已升级导致 API 变化，以能编译通过 + 行为对齐为准调整。

---

## 4. 项目目录结构

单 crate + 模块化。纯逻辑模块内联 `#[cfg(test)] mod tests`：

```
rust-mqtt-backend/
├── Cargo.toml
├── .gitignore
├── .env.example              # 生产配置模板（占位符，无真实密钥）
├── .env.debug.example        # 调试配置模板（独立 clientId/bucket/port）
├── Makefile                  # build / test / run / musl 等
├── README.md                 # 入口导航
├── USAGE.md                  # 使用说明（本地运行、配置、数据处理规则、端点、FAQ）
├── DEPLOY.md                 # 编译部署（本地/musl/服务器、systemd、更新回滚、并行迁移）
├── HANDOFF.md                # 本文件
├── deploy/
│   └── rust-mqtt-consumer.service   # systemd unit
└── src/
    ├── main.rs               # tokio 装配 + 优雅关闭 + 命令行
    ├── config.rs             # 环境变量结构体 + 校验 + 脱敏快照
    ├── logger.rs             # tracing-subscriber JSON 初始化
    ├── mqtt.rs               # rumqttc AsyncClient + EventLoop 驱动 + 消息流水线
    ├── influx.rs             # 批量 writer（channel + 后台 flush）+ ping
    ├── dedup.rs              # LRU+TTL 去重 + compute_dedup_key + base36 + 统计
    ├── classifier.rs         # 7 层字段分类 + 黑名单/白名单/tag 常量
    ├── timestamp.rs          # detect_unit + normalize_to_nanos
    ├── sensor.rs             # payload -> Line Protocol/Point 组装
    └── health.rs             # axum 路由 / /health /stats + 共享状态
```

**`.gitignore`（照抄要点）**：

```
/target
**/*.rs.bk
.env
.env.debug
.env.local
Cargo.lock   # 二进制项目通常提交 Cargo.lock；如需锁定依赖可保留，二选一并说明
```

> 建议：**二进制应用保留 `Cargo.lock` 入库**（可复现构建）。上面注释掉与否由远程决定，但要在 README 说明。

**`.env.example`（占位符，逐字，无真实密钥）**：

```
# ========== rust-mqtt-backend 生产环境配置模板 ==========
# 复制为 .env 并填入真实值（.env 已被 gitignore，绝不入库）
# cp .env.example .env && chmod 600 .env

# ---------- MQTT ----------
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USER=<MQTT_USER>
MQTT_PASS=<MQTT_PASS>
MQTT_CLIENT_ID=rust-mqtt-consumer
MQTT_SUBSCRIBE_TOPIC=sensors/#

# ---------- InfluxDB ----------
INFLUX_URL=http://127.0.0.1:8086
INFLUX_TOKEN=<INFLUX_TOKEN>
INFLUX_ORG=<INFLUX_ORG>
INFLUX_BUCKET=<INFLUX_BUCKET>

# ---------- 运行时 ----------
LOG_LEVEL=info
HEALTH_PORT=9004

# ---------- 应用层去重 ----------
DEDUP_ENABLED=true
DEDUP_MAX_SIZE=10000
DEDUP_TTL_MS=300000
```

**`.env.debug.example`（隔离三要素：clientId / bucket / port）**：与生产模板相同结构，但：

```
MQTT_CLIENT_ID=rust-mqtt-consumer-debug
INFLUX_BUCKET=<DEBUG_BUCKET>       # 独立桶，避免与生产混写
LOG_LEVEL=debug                     # debug 会打印完整 payload + 分类快照
HEALTH_PORT=9005                    # 独立端口
```

---

## 5. 逐模块 Rust 实现规范

> 每个模块给出：**职责** · **公开 API 签名草案** · **关键逻辑** · **陷阱**。代码片段是「规范草案」，据此实现即可，不必逐字照抄（但要保证签名语义与外部行为一致）。

### 5.1 `config.rs` — 配置加载与校验

**职责**：从环境变量解析全量配置，校验必填/范围，提供脱敏快照。

**API 草案**：

```rust
#[derive(Debug, Clone)]
pub struct Config {
    // MQTT
    pub mqtt_url: String,
    pub mqtt_user: String,
    pub mqtt_pass: String,
    pub mqtt_client_id: String,
    pub mqtt_subscribe_topic: String,
    // InfluxDB
    pub influx_url: String,
    pub influx_token: String,
    pub influx_org: String,
    pub influx_bucket: String,
    // 运行时
    pub log_level: String,
    pub health_port: u16,
    // 去重
    pub dedup_enabled: bool,
    pub dedup_max_size: usize,
    pub dedup_ttl_ms: u64,
}

impl Config {
    /// 从环境变量加载并校验；返回所有错误（不是只第一个）
    pub fn load() -> Result<Self, Vec<String>> { /* ... */ }
    /// 脱敏快照（不含 password / token），用于启动日志
    pub fn snapshot(&self) -> serde_json::Value { /* ... */ }
}

// 内部工具
fn get_env(key: &str, fallback: &str) -> String;
fn get_env_int<T: std::str::FromStr>(key: &str, fallback: T) -> T;   // 解析失败用 fallback
fn get_env_bool(key: &str, fallback: bool) -> bool;
```

**关键逻辑**：

- 默认值：`mqtt_client_id="rust-mqtt-consumer"`、`mqtt_subscribe_topic="sensors/#"`、`log_level="info"`（转小写）、`health_port=9004`、`dedup_enabled=true`、`dedup_max_size=10000`、`dedup_ttl_ms=300000`。
- 必填 7 项：`MQTT_URL/MQTT_USER/MQTT_PASS/INFLUX_URL/INFLUX_TOKEN/INFLUX_ORG/INFLUX_BUCKET`，trim 后为空 → 收集 `"{NAME}: 不能为空"`。
- 范围：`health_port` 1~65535；`dedup_max_size` 100~1000000；`dedup_ttl_ms` 1000~3600000；`log_level ∈ {debug,info,warn,error,fatal}`。
- 错误信息文案与 2.9 逐字一致。
- `get_env_int` 解析失败**静默用默认值**（对齐 Go `getEnvInt`）。

**陷阱**：

- `health_port` 用 `u16` 天然限制范围，但仍要显式校验（因为默认值路径 + 解析失败路径要一致）。若用 `u32`/`i64` 解析再校验范围，注意 `HEALTH_PORT=99999` 会溢出 u16——建议解析成 `i64` 后校验 `1..=65535` 再 `as u16`。
- `get_env_bool` 要接受大小写变体（`TRUE/True/true/1` 等），对齐 Go `strconv.ParseBool`。

### 5.2 `logger.rs` — 结构化日志

**职责**：初始化全局 `tracing` 订阅器，输出 JSON，字段与 Go/zap 对齐。

**API 草案**：

```rust
/// 按日志级别初始化全局 tracing subscriber（JSON 格式，输出 stdout）
pub fn init(level: &str);
```

**关键逻辑**：

- 用 `tracing_subscriber::fmt()`：`.json()`、`.with_target(false)`、按 `level` 设 `EnvFilter`（`debug/info/warn/error/fatal` → 对应 `LevelFilter`）。
- 输出字段尽量对齐 Go 版 zap：`level`、`time`（ISO8601）、`msg`。tracing 默认字段名是 `level`/`timestamp`/`fields.message`，可用 `.flatten_event(true)` + 自定义 `FormatFields` 尽量贴近；**至少保证是合法 JSON、含级别与时间戳、人能看懂**。三版并行时字段名不完全一致可接受（不影响功能）。
- 追加固定字段 `app="rust-mqtt-backend"`（Go 版是 `go-mqtt-backend`）：可用 `tracing_subscriber` 的 `with_current_span(false)` + 在每条日志手动带 `app` 字段，或用全局字段层。

**陷阱**：

- `tracing` 的日志宏（`info!`/`warn!`/`debug!`）字段语法：`info!(field = %value, "message")`。字符串用 `%`（Display）或 `?`（Debug）。
- 全局 subscriber 只能设一次；`main` 里最先调用 `logger::init(&cfg.log_level)`。

### 5.3 `influx.rs` — 批量写入客户端

**职责**：把 Line Protocol 批量、异步、带重试地 POST 到 InfluxDB `/api/v2/write`；优雅关闭时刷盘；提供 ping。

**API 草案**：

```rust
pub struct InfluxWriter {
    tx: tokio::sync::mpsc::UnboundedSender<String>, // 发送单行 Line Protocol
    // 保存 join handle 供关闭时 flush
}

impl InfluxWriter {
    /// 启动后台批量写入任务（batch=500 / flush=1s / retry=3 / ns）
    pub fn new(cfg: &Config) -> Self;
    /// 把一行 Line Protocol 入队（非阻塞）
    pub fn write_line(&self, line: String);
    /// 优雅关闭：通知后台任务 flush 剩余并等待完成
    pub async fn close(self);
    /// 连通性检查（GET /ping 或 /health），3s 超时
    pub async fn ping(&self) -> anyhow::Result<()>;
}
```

**关键逻辑**：

- 后台任务用 `tokio::spawn`，内部 `tokio::select!`：
  - 从 `rx.recv()` 收行，累积到 `Vec<String>`；
  - 满 500 行 **或** `tokio::time::interval(1s)` tick → 触发 flush；
  - flush：把 buffer 用 `\n` 拼接，`reqwest` POST 到 `{url}/api/v2/write?org={org}&bucket={bucket}&precision=ns`，头 `Authorization: Token {token}`、`Content-Type: text/plain; charset=utf-8`；
  - 失败重试最多 3 次，每次间隔 1s；仍失败 → `error!("InfluxDB 写入失败", error = %e)`，丢弃该批（不无限堆积）。
- `close()`：drop 掉 `tx`（或发关闭信号），让后台任务把剩余 buffer flush 完再退出，`await` 其 join handle。记 info `"InfluxDB 缓冲区已刷出，连接已关闭"`。
- 启动时记 info `"InfluxDB writeAPI 已就绪"`（带 url/org/bucket/batchSize=500/flushIntervalMs=1000）。

**陷阱**：

- `reqwest::Client` 要**复用**（内部连接池），在 `new()` 里建一次，`Arc` 传进后台任务。
- 后台任务持有 `Client` 与配置克隆，避免生命周期问题。
- 关闭顺序：必须先停 MQTT（不再产生新点），再 flush InfluxDB（见 2.10）。
- `panic="abort"` 下不要在后台任务里 `unwrap` 网络结果，用 `match`/`?` + 日志。

### 5.4 `mqtt.rs` — MQTT 消费者与消息流水线

**职责**：连接 Broker、持久会话、自动重连、订阅、驱动 EventLoop、把每条消息跑完 2.1 流水线。

**API 草案**：

```rust
pub struct MqttConsumer {
    client: rumqttc::AsyncClient,
    // 连接状态用 Arc<AtomicBool> 共享给 health
}

impl MqttConsumer {
    /// 建连 + 订阅 + spawn EventLoop 驱动任务；返回自身与状态句柄
    pub async fn start(
        cfg: Arc<Config>,
        dedup: Arc<MessageDeduplicator>,
        influx: Arc<InfluxWriter>,
    ) -> anyhow::Result<(Self, Arc<AtomicBool>)>;
    /// 优雅断开
    pub async fn stop(&self);
}

/// 从 topic 解析 deviceId：sensors/{id}/... -> id，否则 ""
pub fn parse_device_id_from_topic(topic: &str) -> String;
```

**关键逻辑**：

- `rumqttc::MqttOptions::new(client_id, host, port)`；从 `MQTT_URL` 解析出 host/port（`mqtt://127.0.0.1:1883`）。
- `mqttoptions.set_credentials(user, pass)`；`set_clean_session(false)`（持久会话）；`set_keep_alive(Duration::from_secs(60))`。
- `AsyncClient::new(mqttoptions, cap)` 得到 `(client, mut eventloop)`。
- `client.subscribe(topic, QoS::AtLeastOnce)`（QoS1）。
- **spawn 一个任务持续 `eventloop.poll().await`**：
  - `Ok(Event::Incoming(Packet::ConnAck(_)))` → 记 info `"已连接 MQTT Broker"`，设 connected=true，（重连后）重新 subscribe，记 info `"已订阅主题"`。
  - `Ok(Event::Incoming(Packet::Publish(p)))` → 调 `handle_message(p.topic, p.payload)` 跑流水线。
  - `Err(e)` → 记 warn `"MQTT 连接断开，将自动重连"`，设 connected=false（rumqttc 会自动重连，继续 poll）。
- `handle_message`（对齐 2.1）：
  1. `serde_json::from_slice::<serde_json::Value>(&raw)`；失败或非 object → warn 丢弃。
  2. object 为空 → warn `"payload 为空对象，丢弃"`。
  3. `compute_dedup_key(topic, &raw, &obj)` → `dedup.check_and_record(key)`；false → debug `"重复消息已丢弃"`。
  4. `parse_device_id_from_topic` → 回退 `obj["deviceId"]` 字符串 → `"unknown"`。
  5. `log_level=="debug"` 时打印 payload + 分类快照（见 2.1 第 5 步字段）。
  6. 取 `obj["timestamp"]`（若是数字）为 `Option<f64>`。
  7. `sensor::write_sensor_data(device_id, obj, ts, &influx)`。

**陷阱**：

- **EventLoop 必须持续 poll**，否则不收发也不重连——这是 rumqttc 最常见的坑。
- rumqttc 0.24 用 `Event`/`Packet` 枚举（旧版叫 `Notification`）；以实际版本文档为准。
- `publish.payload` 是 `Bytes`；转 `&[u8]` 用 `&p.payload`。
- 持久会话下重连后 broker 可能自动恢复订阅，但**显式重订阅**更稳妥（对齐 Go `SetResumeSubs(true)` + OnConnect 重订阅）。
- 消息处理里不要长时间阻塞 poll 任务；重活（分类/写库入队）要快，InfluxDB 写入已是异步入队。

### 5.5 `dedup.rs` — LRU+TTL 去重

**职责**：`compute_dedup_key` + `MessageDeduplicator`（缓存/统计/sweep）+ base36 编码。

**API 草案**：

```rust
pub const DEDUP_ID_FIELDS: [&str; 6] =
    ["messageId", "msgId", "message_id", "msg_id", "uuid", "id"];

#[derive(Debug, Clone, PartialEq)]
pub struct DedupKeyResult { pub key: String, pub source: String } // source: "id" | "hash"

pub fn compute_dedup_key(topic: &str, raw: &[u8], data: &serde_json::Map<String, Value>) -> DedupKeyResult;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub enabled: bool, pub size: usize, pub max_size: usize, pub ttl_ms: u64,
    pub hits: u64, pub misses: u64, pub hit_rate: f64, pub evicted: u64,
}

pub struct MessageDeduplicator { /* moka future cache 或 Arc<Mutex<lru>> + 原子计数 */ }

impl MessageDeduplicator {
    pub fn new(enabled: bool, max_size: usize, ttl_ms: u64) -> Self;
    /// true=新消息（已记录）；false=重复
    pub fn check_and_record(&self, key: &str) -> bool;
    pub fn get_stats(&self) -> Stats;
    pub fn stop(&self);          // 停 sweep 后台任务
    pub fn clear(&self);         // 测试用
    pub(crate) fn sweep(&self) -> usize; // 返回移除数量（测试直接调）
}

fn to_base36(mut n: u64) -> String; // 手写，字符集 0-9a-z；n==0 返回 "0"
```

**关键逻辑**：

- `compute_dedup_key`：按 `DEDUP_ID_FIELDS` 顺序遍历；值是非空字符串 → `id:{field}:{value}`；值是有限数字 → `id:{field}:{format_number(value)}`（**整数不带小数点**，如 `42`；对齐 Go `strconv.FormatFloat(v,'f',-1,64)`）；否则继续。都无 → `h:{base36(xxhash64(topic+"|"+raw))}`，source=`hash`。
- **数字格式化陷阱**：serde_json 的 `Value::Number`，取 `as_i64()`/`as_u64()` 优先（得到整数字符串），否则 `as_f64()`。Go 测试断言 `id:id:42`（不是 `42.0`），所以整数必须输出 `42`。
- `check_and_record`：
  - `!enabled` → 直接 `true`（不记录）。
  - 命中且未过期（`now - entry < ttl`）→ `hits+=1`，返回 `false`，**刷新 recency**（moka 的 `get` 自动刷新；若用 `lru` crate 用 `get`/`get_mut` 而非 `peek`）。
  - 命中但已过期 → 移除，当新消息。
  - 新消息 → 写入 `key->now`，`misses+=1`；若因容量满淘汰 → `evicted+=1`，返回 `true`。
- `get_stats`：`hit_rate = round(hits/(hits+misses)*10000)/10000`（total=0 时为 0）。
- `sweep`：遍历所有条目，`now - entry >= ttl` 的移除，返回移除数。sweep 后台任务间隔 `max(30s, ttl/2)`。

**陷阱**：

- **moka 自带 TTL 与 LRU**：若用 `moka::future::Cache`，设 `.max_capacity(max_size)` + `.time_to_live(Duration::from_millis(ttl_ms))`，它会自动过期/淘汰。但 moka 的自动过期是惰性的，`size`（`entry_count`）可能不即时反映；且 moka 不直接暴露「evicted 计数」与「手动 sweep 返回移除数」。**为了能精确对齐 Go 测试（尤其 `TestDedup_SweepRemovesExpired` 断言 sweep 返回 2、`TestDedup_LRUEviction`、`TestDedup_HitRefreshesRecency`），更推荐手写方案**：`Arc<Mutex<lru::LruCache<String, Instant>>>`（`lru` crate）+ 自己判 TTL + 自己数 evicted + 自己写 sweep。这样行为与 Go 的 `hashicorp/golang-lru` 完全一致，测试可 1:1 移植。
- 若手写：`lru::LruCache::new(NonZeroUsize::new(max_size).unwrap())`；`max_size<1` 时强制为 1（对齐 Go 守卫）。`put` 返回 `Option<(K,V)>`（被淘汰的旧条目）→ 有则 `evicted+=1`。`get`（`&mut`）刷新 recency；`peek` 不刷新——**命中路径必须用 `get`**。
- 计数用 `AtomicU64`（跨线程）；缓存用 `Mutex`，**不要跨 await 持锁**（check_and_record 是同步方法，无 await，安全）。
- base36：标准库无，手写 `while n>0 { digit = n%36; ... n/=36 }`，逆序拼接；字符集 `b"0123456789abcdefghijklmnopqrstuvwxyz"`。

### 5.6 `classifier.rs` — 7 层字段分类

**职责**：常量集合 + `classify_field` + `classify_payload` + `try_parse_numeric_string`。

**API 草案**：

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FieldKind { Skip, Tag, Float, Boolean, String }
impl FieldKind { pub fn as_str(&self) -> &'static str } // "skip"/"tag"/"float"/"boolean"/"string"

#[derive(Debug, Clone)]
pub struct ClassifiedField {
    pub kind: FieldKind,
    pub key: String,
    pub value: Option<serde_json::Value>, // Float->Number, Tag/String->String, Boolean->Bool, Skip->None
    pub coerced: bool,
    pub raw: String,     // 强转前原始字符串
    pub reason: String,  // skip / 特殊情况原因
}

pub fn try_parse_numeric_string(s: &str) -> Option<f64>;
pub fn classify_field(key: &str, value: &serde_json::Value) -> ClassifiedField;
pub fn classify_payload(data: &serde_json::Map<String, Value>) -> Vec<ClassifiedField>; // 按 key 排序

// 常量（用 once_cell/LazyLock 或 phf 或 match）
pub fn is_skip_field(k: &str) -> bool;      // 8 个
pub fn is_tag_field(k: &str) -> bool;       // 2 个
pub fn is_numeric_hint(k: &str) -> bool;    // 28 个
```

**关键逻辑**：

- `classify_field` 严格按 2.3 的 7 层优先级。`serde_json::Value` 匹配：
  - `Value::Null` → skip（reason `"null/undefined"`）。但**黑名单优先于 null 判定**（第 0 层在最前）。
  - `Value::Bool(b)` → boolean。
  - `Value::Number(n)` → 取 `n.as_f64()`；非有限 → skip(`"non-finite number"`)；否则 float。（JSON 数字不会是 NaN/Inf，但保留判定以对齐）。
  - `Value::String(s)` → 第 6 层：`is_numeric_hint(key)` 且 `try_parse_numeric_string(s)` 成功 → float+coerced+raw=s；hint 但解析失败 → string+reason `"numeric-hint but not parseable"`；非 hint → string。
  - `Value::Array`/`Value::Object` → skip(`"unsupported type"`)。
  - **第 2 层 tag**：`is_tag_field(key)` 且 value 是 `Value::String` → tag；若 tag key 但值非字符串，**不返回**，继续走 3-7 层。
- `try_parse_numeric_string`：trim → 空则 None → `s.parse::<f64>()` → 失败 None → 成功但 `!is_finite()` None → 否则 Some。
- `classify_payload`：收集 keys **排序**（字典序），逐个 `classify_field`，保证稳定输出顺序。

**陷阱**：

- **黑名单最优先**：`classify_field` 第一行就判 `is_skip_field(key)`，命中直接返回 skip(reason 含 `"meta field"`)，**不看 value 类型**。
- **`"NaN"`/`"Infinity"` 字符串**：Rust `"NaN".parse::<f64>()` 返回 `Ok(NaN)`！必须在 parse 成功后加 `if !v.is_finite() { return None }`（对齐 Go 测试 `TestTryParseNumericString_NaNInfinity`）。
- **HashMap 无序**：`classify_payload` 必须显式按 key 排序（对齐 `TestClassifyPayload_SortedOrder`）。
- 常量集合用 `match k { "temperature"|"humidity"|... => true, _ => false }` 最省依赖；或 `LazyLock<HashSet<&str>>`。
- `FieldKind` 若用作 HashMap key 需 `#[derive(Hash, Eq)]`。

### 5.7 `timestamp.rs` — 时间戳归一化

**API 草案**：

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Unit { Second, Millisecond, Microsecond, Nanosecond, Invalid }
impl Unit { pub fn as_str(&self) -> &'static str } // "s"/"ms"/"us"/"ns"/"invalid"

#[derive(Debug, Clone)]
pub struct NormalizeResult { pub nanos: i64, pub unit: Unit, pub used_fallback: bool }

pub fn detect_unit(ts: f64) -> Unit;
pub fn normalize_to_nanos(ts: Option<f64>) -> NormalizeResult;
```

**关键逻辑**：

- `detect_unit`：`ts.is_nan() || ts.is_infinite() || ts <= 0` → Invalid；`<1e11`→Second；`<1e14`→Millisecond；`<1e17`→Microsecond；else Nanosecond。
- `normalize_to_nanos`：`fallback = 当前系统时间纳秒`（`SystemTime::now().duration_since(UNIX_EPOCH).as_nanos() as i64`）。`None` → fallback+Invalid+used_fallback=true。`Some(ts)` → `detect_unit`；Invalid → fallback；否则按单位乘倍率（`ts as i64 * 倍率`）。

**陷阱**：

- 倍率用 i64 常量：秒 `1_000_000_000`、毫秒 `1_000_000`、微秒 `1_000`、纳秒 `1`。先 `ts as i64` 再乘，避免 f64 精度丢失。
- `used_fallback` 测试会断言 nanos 落在 `[before, after]` 区间（调用前后各取一次 now），所以 fallback 必须真取当前时间。

### 5.8 `sensor.rs` — payload → Line Protocol 组装

**API 草案**：

```rust
/// 把 payload 组装成 Line Protocol 并入队写入
pub fn write_sensor_data(device_id: &str, data: &serde_json::Map<String, Value>, ts: Option<f64>, influx: &InfluxWriter);
```

**关键逻辑**：

- `classify_payload(data)` 得到分类结果，按 kind 分派：
  - Tag → 加入 tags（`app=mqtt-consumer`、`device_id` 之外，再加 location/type）。
  - Float → field（数字）；若 `coerced` → warn `"字段本应是数值但收到字符串，已自动转为 float（建议修传感器固件）"`（带 deviceId/field/raw/coercedTo）。
  - Boolean → field（`t`/`f`）。
  - String → field（双引号包裹）；若 reason==`"numeric-hint but not parseable"` → warn `"字段在数值白名单里但无法解析成数字，已按字符串写入"`。
  - Skip → debug `"跳过字段"`（带 deviceId/field/reason）。
- 时间戳：`normalize_to_nanos(ts)`；used_fallback → debug `"payload 未提供 timestamp，使用服务器当前时间"`；unit!=ns → debug `"已自动将时间戳转换为纳秒"`（带 unit）。
- 组装 Line Protocol：`sensor_reading,app=mqtt-consumer,device_id={id}[,{tag}...] {field}... {nanos}`；调 `influx.write_line(line)`。

**陷阱**：

- **Line Protocol 转义**：tag key/value 与 field key 中的空格、逗号、等号要用 `\` 转义；string field value 用双引号包裹且内部双引号转义。device_id 可能含特殊字符。
- **无 field 则不写**：若所有字段都被 skip（只剩 tag），该行无 field，InfluxDB 会拒——应跳过不写（记 debug），避免整批 400。
- float 格式化：用 Rust 默认 `{}`（如 `25.6`、`42`）；注意整数 float 会输出 `42` 而非 `42.0`（Rust `{}` 对 `42.0f64` 输出 `42`），符合 Line Protocol。
- bool 写 `t`/`f`（Line Protocol 合法值还有 `true/false/T/F/TRUE/FALSE`，任选一种但全项目一致）。

### 5.9 `health.rs` — HTTP 端点

**API 草案**：

```rust
#[derive(Clone)]
pub struct AppState {           // axum 共享状态，必须 Clone + Send + Sync
    pub start: std::time::Instant,
    pub cfg: Arc<Config>,
    pub connected: Arc<AtomicBool>,
    pub dedup: Arc<MessageDeduplicator>,
}
pub async fn serve(state: AppState) -> anyhow::Result<()>;  // 绑定 :health_port
pub async fn shutdown(/* 优雅关闭句柄 */);
```

**关键逻辑**：

- axum `Router::new().route("/", get(root)).route("/health", get(health)).route("/stats", get(stats)).with_state(state)`。
- `root` → 2.8 的 `{name,version,endpoints}`。
- `health` → 读 `connected.load()`；true→(200,"ok")，false→(503,"degraded")；带 `uptimeSec`（`start.elapsed().as_secs()`）与 `timestamp`（UTC RFC3339 纳秒）。
- `stats` → `uptimeSec` + mqtt{connected,clientId,subscribeTopic} + influx{url,org,bucket} + dedup（`get_stats()` 序列化）。
- 用 `axum::Json(serde_json::Value)` 返回，自动设 `application/json`。

**陷阱**：

- 共享状态用 `Arc` + `AtomicBool`/原子计数，保证 `Send+Sync`；`AppState` 要 `Clone`（axum 要求）。
- 优雅关闭：用 `axum::serve(...).with_graceful_shutdown(signal)`，或 `tokio::select!` 配合关闭通道（见 5.10）。
- `timestamp` 用 `chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Nanos, true)`（结尾 `Z`）。

### 5.10 `main.rs` — 装配与优雅关闭

**API 草案**：

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()>;
```

**关键逻辑**（对齐 Go `main.go`）：

1. 解析命令行 `--env-file`（默认 `.env`）：clap `#[derive(Parser)]` 或手写 `std::env::args`。
2. `dotenvy::from_filename(&env_file).ok()`——文件不存在**不 fatal**（可能走系统环境变量），仅 eprintln 警告。
3. `Config::load()`：有错 → 逐行打印 stderr `"❌ 环境变量校验失败:"` + `"   - {e}"`，`exit(1)`。
4. `logger::init(&cfg.log_level)`。
5. `info!("启动 rust-mqtt-backend", config = %snapshot)`。
6. 建 `InfluxWriter`、`MessageDeduplicator`（`Arc` 共享）。
7. 建 `MqttConsumer::start(...)`，拿到 `connected: Arc<AtomicBool>`。
8. 建 `AppState`，`tokio::spawn(health::serve(state))`。
9. `info!("健康检查端点已启动", port, hostname="localhost")`。
10. 等 `tokio::signal::ctrl_c()` 或 `signal(SignalKind::terminate())`。
11. 收到信号 → `info!("收到信号，正在关闭...", signal=...)`。
12. `tokio::time::timeout(Duration::from_secs(5), graceful_shutdown())`：超时 → warn `"优雅关闭超时，强制退出"` + `exit(1)`。
13. `graceful_shutdown()` 按 2.10 顺序：health → dedup.stop → mqtt.stop → influx.close().await → 刷新日志。
14. `println!("👋 已安全退出")`。

**陷阱**：

- 模块装配顺序：logger 最先；InfluxDB 在 MQTT 之前建（MQTT 产生点要写 InfluxDB）；关闭时反序。
- `influx.close()` 是 `async`，要在 mqtt.stop 之后 `await`，确保不再有新点入队后才 flush。
- 5s 兜底用 `timeout` 包裹整个关闭流程，避免某一步卡死导致进程不退出。
- 各组件用 `Arc` 共享；`AppState` 与 mqtt 任务共享同一个 `Arc<AtomicBool>` connected。

---

## 6. 关键行为对齐陷阱（Rust 特有，务必逐条检查）

| # | 陷阱 | 后果 | 规避 |
|---|---|---|---|
| 1 | `"NaN".parse::<f64>()` / `"inf".parse::<f64>()` 在 Rust **会成功** | 字符串 `"NaN"` 被误当数字写入 | `try_parse_numeric_string` 在 parse 成功后**必须**再判 `v.is_finite()`，非有限返回 None |
| 2 | `serde_json::Number` 区分 i64/u64/f64 | 分类或 dedup key 格式不一致 | 分类统一 `as_f64()` 判有限；dedup ID 数字优先 `as_i64()/as_u64()` 得整数字符串（`42` 而非 `42.0`） |
| 3 | `HashMap`/`serde_json::Map` 无序 | `classify_payload` 输出顺序不稳定，golden test 失败 | 显式收集 keys 并 `sort()` 后再分类 |
| 4 | xxhash 实现与 Go/Bun 不同 | fallback dedup key 跨版本不一致 | **无害**：三版并行各自独立去重。测试只断言格式/幂等/区分性，不断言具体哈希值 |
| 5 | `SystemTime::now()` 精度 | 时间戳兜底不是纳秒 | `duration_since(UNIX_EPOCH).as_nanos() as i64`（as_nanos 是 u128，转 i64 注意 2262 年前不溢出） |
| 6 | rumqttc EventLoop 不 poll | 不收发、不重连，程序假死 | 必须 `tokio::spawn` 一个任务 `loop { eventloop.poll().await }` |
| 7 | 跨 `await` 持 `MutexGuard` | 死锁 / `Send` 编译失败 | 同步方法（check_and_record）内完成加锁与计算；异步路径不持锁跨 await |
| 8 | `panic="abort"` + 后台任务 `unwrap` | 一处网络错误整个进程 abort | 后台任务用 `match`/`?` + 日志，不 `unwrap` 外部结果 |
| 9 | Line Protocol 未转义 | 含空格/逗号/等号的 tag/field 导致 400 | tag key/value、field key 转义 `空格 , =`；string field value 双引号包裹并转义内部 `"` |
| 10 | 无 field 的 Point | InfluxDB 拒收整批 | 组装后若无 field 则跳过不写（记 debug） |
| 11 | float 格式化 | `42.0` 写成 `42.0` 而非 `42` | Rust `{}` 对 `42.0f64` 输出 `42`，符合预期；若用 `{:?}` 会输出 `42.0`——**用 `{}`** |
| 12 | 整数 float 精度 | 大整数 `as i64` 溢出 | 时间戳乘法前确认在 i64 范围（ns 级 ~2262 年前安全） |

---

## 7. 测试计划（73 用例 1:1 映射）

> Go 版共 **73 个测试函数**：classifier 43 + dedup 18 + timestamp 12。Rust 用 `#[test]`（同步）或 `#[tokio::test]`（异步）逐个移植。下面按模块列出**每个 Go 测试 → Rust 测试**的映射与断言要点。测试内联在各模块 `#[cfg(test)] mod tests`。

### 7.1 classifier（43 个）

**SKIP_FIELDS 黑名单（10）**：

| Go 测试 | Rust 断言要点 |
|---|---|
| `skip_fields_contains_all_dedup_id_fields` | 6 个 DEDUP_ID_FIELDS 都 `is_skip_field` |
| `skip_fields_contains_timestamp_and_device_id` | `timestamp`/`deviceId` 在黑名单 |
| `skip_fields_id_fields_always_skip` | 6 个 ID key，值为字符串/数字/null 都 → Skip，reason 含 `meta field` |
| `skip_fields_timestamp` | `classify_field("timestamp", Number(1758470400000))` → Skip + reason 含 `meta field` |
| `skip_fields_device_id` | `classify_field("deviceId", String(...))` → Skip |
| `skip_fields_priority_over_tag_fields` | `classify_field("id", "living-room")` → Skip（黑名单优先 tag） |
| `skip_fields_priority_over_numeric_hints` | `classify_field("id", "12345")` → Skip（不强转） |
| `skip_fields_non_blacklist_unaffected` | voltage→Float, status→String, location→Tag, online→Boolean |
| `skip_fields_mixed_payload` | 混合 payload，逐 key 断言 kind |
| `skip_fields_size` | 黑名单 ≥ 8 项 |

**try_parse_numeric_string（5）**：

| Go 测试 | Rust 断言要点 |
|---|---|
| `normal` | `25.6/-10/0/1e3` 解析成功且值相等 |
| `trim` | `"  25.6  "`、`"\t42\n"` 解析成功 |
| `empty` | `""`、`"   "` → None |
| `non_numeric` | `ok`/`1.2.3`/`25.6abc` → None |
| `nan_infinity` | `NaN`/`Infinity`/`-Infinity`/`Inf`/`+Inf` → None（**陷阱 1**） |

**classify_field nil/tag（5）**：

| Go 测试 | Rust 断言要点 |
|---|---|
| `nil` | `Value::Null` → Skip + reason `null/undefined` |
| `tag_location` | `location="living-room"` → Tag, value 相等 |
| `tag_type` | `type="dht22"` → Tag |
| `tag_numeric_falls_to_float` | `location=Number(42)` → Float（tag key 但非字符串值落到数值层） |
| `tag_fields_content` | location/type 是 tag，status 不是 |

**classify_field 数值（6）**：

| Go 测试 | Rust 断言要点 |
|---|---|
| `float` | `temperature=25.6` → Float, coerced=false |
| `integer` | `count=Number(42)` → Float, value=42 |
| `negative` | `-5.5` → Float |
| `zero` | `0` → Float |
| `nan` | NaN → Skip + reason `non-finite number`（构造 `Value::Number` 无法表示 NaN，可直接测 `classify` 内部 f64 路径或跳过；**建议**单测 `try_parse`/内部数值判定） |
| `infinity` | Inf → Skip |

> ⚠️ NaN/Inf 说明：`serde_json::Value::Number` **不能**持有 NaN/Inf（JSON 无此字面量）。Go 测试直接传 `math.NaN()` 给 `any`。Rust 对应做法：把「数值有限性判定」抽成一个接受 `f64` 的内部函数（如 `classify_number(key, f64) -> ClassifiedField`）并对其测 NaN/Inf；或测 `try_parse_numeric_string("NaN")` 已在上面覆盖。保证「非有限数 → Skip(reason=non-finite number)」这条逻辑被测到即可。

**classify_field 布尔/字符串（10）**：

| Go 测试 | Rust 断言要点 |
|---|---|
| `bool` | true/false → Boolean, value 相等 |
| `string_non_hint` | `status="ok"` → String, coerced=false |
| `string_version_like` | `firmware="1.2.3"` → String |
| `string_numeric_but_not_hint` | `someRandomField="25.6"` → String（非白名单不强转） |
| `coerce_temperature` | `temperature="25.6"` → Float, coerced=true, raw="25.6" |
| `coerce_with_whitespace` | `humidity=" 60.2 "` → Float=60.2, coerced=true |
| `coerce_battery` | `battery="3.7"` → Float=3.7, coerced=true |
| `coerce_negative` | `rssi="-65"` → Float=-65 |
| `coerce_integer_string` | `pm25="35"` → Float=35 |
| `hint_but_not_parseable` | `temperature="error"` → String + reason `numeric-hint but not parseable` |

**classify_field 白名单内容/复杂类型（4）**：

| Go 测试 | Rust 断言要点 |
|---|---|
| `hint_empty_string` | `temperature=""` → String + reason `numeric-hint but not parseable` |
| `numeric_hints_content` | temperature/humidity/pressure/battery/rssi/co2/pm25 在白名单；status/firmware/name/messageId 不在 |
| `object` | `Value::Object` → Skip + reason 含 `unsupported type` |
| `array` | `Value::Array` → Skip |

**classify_payload（3）**：

| Go 测试 | Rust 断言要点 |
|---|---|
| `full` | 9 字段混合 payload，逐 key 断言 kind/coerced/value；timestamp/messageId → Skip + reason 含 meta field |
| `empty` | 空 map → 空 Vec |
| `sorted_order` | `{a,b,c}` → 输出 keys 顺序 `[a,b,c]` |

### 7.2 dedup（18 个）

**MessageDeduplicator（10）**：

| Go 测试 | Rust 断言要点 |
|---|---|
| `first_seen_returns_true` | 新 key → true |
| `second_same_key_returns_false` | 同 key 第 2/3 次 → false |
| `different_keys_independent` | k1/k2/k3 都 true；再 k1/k2 → false |
| `lru_eviction` | cap=3，插 k1/k2/k3，插 k4 淘汰 k1；k1/k2 再插 → true |
| `hit_refreshes_recency` | cap=3，k1/k2/k3；命中 k1（false）刷新；插 k4 淘汰 k2；k1 仍 false，k2 → true（**陷阱：命中必须用 get 刷新**） |
| `ttl_expiry` | ttl=50ms，k1 true→false；sleep 80ms；k1 → true |
| `disabled_always_true` | enabled=false，同 key 多次都 true |
| `sweep_removes_expired` | ttl=30ms，插 k1/k2，size=2；sleep 60ms；`sweep()` 返回 2，size=0 |
| `stats_hit_rate` | k1 miss,hit,hit + k2 miss → hits=2,misses=2,hit_rate≈0.5 |
| `clear` | 插入后 clear，size=0,hits=0,misses=0，再插 k1 → true |

**compute_dedup_key（8）**：

| Go 测试 | Rust 断言要点 |
|---|---|
| `prefer_message_id` | `{messageId:"abc123"}` → source=id, key=`id:messageId:abc123` |
| `multiple_id_fields` | msgId/uuid/id(数字42)/message_id 各自 key 格式正确（`id:id:42`） |
| `message_id_priority_over_msg_id` | 同时有 msgId/messageId → 取 messageId（优先级） |
| `fallback_to_hash` | 无 ID 字段 → source=hash, key 以 `h:` 开头且长度>2 |
| `hash_idempotent` | 相同 topic+raw → 相同 key |
| `different_topic_or_raw` | 不同 topic 或不同 raw → 不同 key |
| `nil_or_empty_payload_uses_hash` | 空 map → source=hash |
| `empty_string_id_ignored` | `{messageId:""}` → source=hash（空字符串 ID 忽略） |

> TTL/sleep 测试用 `std::thread::sleep` 即可（dedup 是同步逻辑）。若用 moka future cache 需 `#[tokio::test]` + `tokio::time::sleep`；手写 Mutex+lru 方案用同步 `#[test]` 更简单。

### 7.3 timestamp（12 个）

| Go 测试 | Rust 断言要点 |
|---|---|
| `detect_unit_second` | 1758470400 / 1 / 9.9e10 → Second |
| `detect_unit_millisecond` | 1758470400000 / now_millis / 1e11 → Millisecond |
| `detect_unit_microsecond` | 1758470400000000 / 1e14 → Microsecond |
| `detect_unit_nanosecond` | 1758470400000000000 / 1e17 → Nanosecond |
| `detect_unit_invalid` | 0 / -1 / NaN / Inf → Invalid |
| `normalize_second` | 1758470400 → unit=Second, used_fallback=false, nanos=1758470400000000000 |
| `normalize_millisecond` | 1758470400000 → nanos 同上 |
| `normalize_microsecond` | 1758470400000000 → nanos 同上 |
| `normalize_nanosecond` | 1758470400000000000 → nanos 同上 |
| `normalize_nil_fallback` | None → used_fallback=true, unit=Invalid, nanos ∈ [before, after] |
| `normalize_negative_fallback` | Some(-100) → used_fallback=true |
| `normalize_all_units_equal` | 秒/毫秒/微秒/纳秒四种写法归一化后都 = 1758470400000000000 |

> 辅助函数：Rust 用 `fn fp(v: f64) -> Option<f64> { Some(v) }` 对应 Go 的 `fp`。

### 7.4 覆盖率目标

- classifier / dedup / timestamp 三个纯逻辑模块覆盖率与 Go 版相当（Go：classifier 80% / dedup 97% / timestamp 100%）。
- 用 `cargo tarpaulin` 或 `cargo llvm-cov` 测覆盖率（可选）。

---

## 8. 编译与部署

### 8.1 远程本机（开发/构建机）

```bash
# 装 rustup + stable（若未装）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup default stable

cd rust-mqtt-backend
cargo build                # debug 构建，验证能编译
cargo test                 # 跑全部单测（期望 ≥73 全绿）
cargo build --release      # 生产构建（产物在 target/release/rust-mqtt-consumer）
```

### 8.2 部署到阿里云 ECS（x86_64）——主选：musl 静态产物

与 Go 版静态二进制同思路：产出零依赖二进制，上传即用，不依赖服务器 glibc。

```bash
# 构建机（若为 Linux x86_64）：
rustup target add x86_64-unknown-linux-musl
# 装 musl 工具链（Debian/Ubuntu）：
sudo apt-get install -y musl-tools
# 静态编译：
cargo build --release --target x86_64-unknown-linux-musl
# 产物：target/x86_64-unknown-linux-musl/release/rust-mqtt-consumer
# scp 上传到服务器：
scp target/x86_64-unknown-linux-musl/release/rust-mqtt-consumer yzluo@<server>:/home/yzluo/mqttBackends/
```

> 若构建机是 **Windows/macOS**，交叉编译到 musl 需额外 linker（推荐用 `cross`，依赖 Docker）：`cargo install cross && cross build --release --target x86_64-unknown-linux-musl`。

### 8.3 备选：直接在服务器编译（git 拉取式）

服务器装 Rust 工具链，`git pull && cargo build --release`。优点：无需交叉编译；缺点：2 核服务器首次编译 3-8 分钟，且服务器要装工具链。

```bash
# 服务器上（Debian 13）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env"
git clone git@github.com:cos12a/myWeb.git && cd myWeb/rust-mqtt-backend
cargo build --release
cp target/release/rust-mqtt-consumer /opt/rust-mqtt-backend/
```

### 8.4 并行双跑隔离（关键）

Rust 版必须与 Bun/Go 版**完全隔离**，三者可同时订阅同一 MQTT 主题各收全量消息、各写各的桶：

| 隔离项 | Bun | Go | **Rust** |
|---|---|---|---|
| MQTT clientId | (默认) | go-mqtt-consumer | **rust-mqtt-consumer** |
| InfluxDB bucket | myHomeData | myHomeDemo | **myHomeDemoRust**（或服务器真实存在的独立桶） |
| Health 端口 | 9000 | 9002 | **9004** |

> clientId 必须唯一，否则同一 Broker 会互踢（两个相同 clientId 的连接会反复断开）。

### 8.5 systemd unit 草案（`deploy/rust-mqtt-consumer.service`）

```ini
[Unit]
Description=Rust MQTT Consumer (rust-mqtt-backend)
Documentation=https://github.com/cos12a/myWeb
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=yzluo
Group=yzluo
WorkingDirectory=/opt/rust-mqtt-backend
ExecStart=/opt/rust-mqtt-backend/rust-mqtt-consumer --env-file=/opt/rust-mqtt-backend/.env
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rust-mqtt-consumer
# ---------- 安全加固 ----------
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
```

部署：

```bash
sudo cp deploy/rust-mqtt-consumer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rust-mqtt-consumer
systemctl status rust-mqtt-consumer
journalctl -u rust-mqtt-consumer -f     # 看实时日志
```

### 8.6 Makefile 草案

```makefile
.PHONY: build build-local test run run-debug musl clean

build:
	cargo build --release --target x86_64-unknown-linux-musl
build-local:
	cargo build --release
test:
	cargo test
run:
	cargo run -- --env-file=.env
run-debug:
	cargo run -- --env-file=.env.debug
musl:
	rustup target add x86_64-unknown-linux-musl
	cargo build --release --target x86_64-unknown-linux-musl
clean:
	cargo clean
```

### 8.7 验证（部署后）

```bash
curl -s http://localhost:9004/health    # 期望 {"status":"ok","mqtt":{"connected":true},...}
curl -s http://localhost:9004/stats     # 看 dedup.misses 会不会涨
mosquitto_pub -h 127.0.0.1 -u <user> -P '<pass>' \
  -t "sensors/ESP32-TEST/data" \
  -m '{"messageId":"rust-verify-001","temperature":25.6,"location":"lab"}'
# 连发 3 条相同 messageId → InfluxDB 应只有 1 条（验证去重）
```

---

## 9. 分阶段执行清单（可勾选）

### Phase 0：环境与骨架

- [ ] 装 rustup + stable（`rustc --version` / `cargo --version` 有输出）。
- [ ] `cargo init --bin rust-mqtt-backend`（或手写 Cargo.toml + src/main.rs）。
- [ ] 按 3.2 填好 Cargo.toml 依赖；`cargo build` 空壳（`fn main(){}`）通过。
- **验收**：`cargo build` exit 0。

### Phase 1：MVP（能收一条消息落库）

- [ ] `config.rs`：环境变量加载 + 必填校验 + 脱敏快照。
- [ ] `logger.rs`：tracing JSON 初始化。
- [ ] `influx.rs`：简化版（先同步单条 POST 能写通，批量后置）。
- [ ] `sensor.rs`：简化版（先不分类，直接把数字字段写为 field）。
- [ ] `mqtt.rs`：rumqttc 连接 + 订阅 + EventLoop + 收消息 → 调 sensor。
- [ ] `health.rs`：axum `/` `/health` `/stats`。
- [ ] `main.rs`：tokio 装配 + 优雅关闭。
- **验收**：`cargo run -- --env-file=.env` 启动，发一条测试消息，InfluxDB 能查到；`/health` 返回 ok。

### Phase 2：特性对齐（v2.1 全量）

- [ ] `classifier.rs`：7 层分类 + SKIP_FIELDS 黑名单 + TAG_FIELDS + NUMERIC_FIELD_HINTS（28 项）+ try_parse_numeric_string。
- [ ] `timestamp.rs`：detect_unit + normalize_to_nanos。
- [ ] `dedup.rs`：LRU+TTL + compute_dedup_key + base36 + 统计 + sweep 后台任务。
- [ ] `sensor.rs`：接入完整分类器（tag/float/bool/string/skip）+ 时间戳归一化 + coerced warn + skip debug。
- [ ] `influx.rs`：升级为批量（channel + 后台 flush，batch=500/flush=1s/retry=3/ns）。
- [ ] `mqtt.rs`：debug 模式打印 payload + 分类快照；接入去重。
- **验收**：手动发各类 payload（带字符串数字/黑名单字段/嵌套对象/各种 timestamp 单位），行为与 2.3~2.7 一致。

### Phase 3：测试 + 编译 + 文档

- [ ] 移植 73 个测试（classifier 43 / dedup 18 / timestamp 12）；`cargo test` 全绿。
- [ ] `cargo build --release` 无 error。
- [ ] `cargo clippy -- -D warnings`（推荐）。
- [ ] musl 静态产物：`cargo build --release --target x86_64-unknown-linux-musl`。
- [ ] 写 `README.md`（入口导航）、`USAGE.md`（使用）、`DEPLOY.md`（编译部署），结构对齐 go-mqtt-backend 的三文档。
- [ ] `.env.example` / `.env.debug.example` / `.gitignore` / `Makefile` / `deploy/rust-mqtt-consumer.service` 齐备。
- **验收**：上述全勾；产物可上传服务器跑通并写入独立桶。

---

## 10. 待决策项（本文档已采用推荐默认值，远程可直接执行）

| 决策点 | 默认（本文档采用） | 备选 |
|---|---|---|
| 构建部署路径 | 远程本机 cargo 编译 + **musl 静态产物**上传云 | 服务器直接 `cargo build --release`（git 拉取式） |
| InfluxDB 写入 | **手写 Line Protocol + reqwest** 批量 POST | `influxdb2` crate |
| 去重缓存 | **手写 `Arc<Mutex<lru>>` + TTL**（最贴合 Go 测试） | `moka` future cache |
| 范围 | **全特性对齐 + 并行双跑** | 仅 MVP |
| 命令行解析 | `clap` derive | `std::env::args` 手写 |
| 日志字段名 | 尽量对齐 zap（level/time/msg/app） | tracing 默认字段名 |

> 以上默认值都是为了「远程零上下文也能直接开工」；若远程有更强理由可换备选，但**外部可观测行为（2 节）必须不变**。

---

## 附：与 Go 版的模块对应表

| Go 文件 | Rust 文件 | 职责 |
|---|---|---|
| `internal/config/config.go` | `src/config.rs` | 配置加载/校验/快照 |
| `internal/logger/logger.go` | `src/logger.rs` | 结构化日志 |
| `internal/influx/writer.go` | `src/influx.rs` | 批量写入 |
| `internal/mqtt/consumer.go` | `src/mqtt.rs` | MQTT 消费 + 流水线 |
| `internal/dedup/dedup.go` | `src/dedup.rs` | 去重 |
| `internal/classifier/{classifier,fields}.go` | `src/classifier.rs` | 字段分类 |
| `internal/timestamp/normalize.go` | `src/timestamp.rs` | 时间戳归一化 |
| `internal/sensor/writer.go` | `src/sensor.rs` | Point 组装 |
| `internal/health/server.go` | `src/health.rs` | HTTP 端点 |
| `cmd/consumer/main.go` | `src/main.rs` | 装配 + 优雅关闭 |

—— 完 ——
