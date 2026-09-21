# IoT 传感器数据平台文档

> **版本**：v2.0（生产级重构版）
> **最后更新**：2026-09-21
> **维护者**：yzluo
> **重构说明**：本版本对应 `bun-mqtt-backend` 生产级重构后的架构（Zod 校验 + Pino 结构化日志 + 健康检查端点 + LRU 消息去重 + 智能时间戳单位识别）。
> **凭据说明**：⚠️ 本文档中所有密码 / Token 均已用占位符遮蔽，实际值请从本地 `.env`（不入库）读取。

---

## 目录

1. [系统概述](#1-系统概述)
2. [系统架构](#2-系统架构)
3. [组件清单](#3-组件清单)
4. [Mosquitto 配置](#4-mosquitto-配置)
5. [InfluxDB 配置](#5-influxdb-配置)
6. [Bun MQTT 消费者（重构版）](#6-bun-mqtt-消费者重构版)
7. [systemd 服务](#7-systemd-服务)
8. [MQTT 协议规范](#8-mqtt-协议规范)
9. [ESP32 端实现](#9-esp32-端实现)
10. [数据流与时序](#10-数据流与时序)
11. [运维命令速查](#11-运维命令速查)
12. [故障排查](#12-故障排查)
13. [安全注意事项](#13-安全注意事项)
14. [并行调试环境](#14-并行调试环境)
- [附录 A：快速部署清单](#附录-a快速部署清单)
- [附录 B：关键参数速查](#附录-b关键参数速查)
- [附录 C：健康检查端点](#附录-c健康检查端点)
- [附录 D：环境变量总表](#附录-d环境变量总表)

---

## 1. 系统概述

本系统用于接收 ESP32 传感器通过 MQTT 上报的数据，经过 Bun 后端消费后写入 InfluxDB，供后续查询和可视化使用。

### 核心设计原则

- **数据流与 Web 层解耦**：MQTT 消费者独立进程运行，改前端页面不影响数据接收。
- **权限最小化**：不同账号只能操作各自需要的 Topic。
- **持久会话**：消费者和传感器都用 `clean_session = 0` + QoS 1，断连期间消息不丢失。
- **TLS 加密**：外部连接经 Nginx TLS 代理，Broker 只监听本机。
- **配置即校验**（v2.0 新增）：Zod schema 在启动时验证所有环境变量与 payload，非法数据立即拒绝。
- **可观测性**（v2.0 新增）：Pino 结构化日志 + `/health` `/stats` HTTP 端点，可对接 systemd / Docker / Prometheus。
- **应用层去重**（v2.0 新增）：LRU + TTL 缓存拦截 MQTT 重投与传感器重发，即使 payload 无 timestamp 也能防重复入库。

---

## 2. 系统架构

```text
┌─────────────┐     MQTTS (8883)      ┌──────────────┐
│   ESP32     │ ─────────────────────▶│    Nginx     │
│  传感器设备 │                       │  TLS 终止    │
└─────────────┘                       └──────┬───────┘
                                             │ MQTT (1883, 明文)
                                             ▼
                                      ┌──────────────┐
                                      │  Mosquitto   │
                                      │  127.0.0.1   │
                                      └──────┬───────┘
                                             │ MQTT (1883, 明文)
                                             ▼
                                      ┌──────────────────────────┐
                                      │  Bun MQTT 消费者          │
                                      │  (systemd, src/index.ts)  │
                                      │  ├─ Zod payload 校验      │
                                      │  ├─ LRU 去重              │
                                      │  ├─ Pino 结构化日志       │
                                      │  └─ HTTP /health /stats   │
                                      └──────┬───────────────────┘
                                             │ HTTP API (batch write)
                                             ▼
                                      ┌──────────────┐
                                      │  InfluxDB    │
                                      │  127.0.0.1   │
                                      └──────────────┘

┌─────────────┐     WSS (8083)        ┌──────────────┐
│  Web 前端   │ ─────────────────────▶│  Mosquitto   │
│ (mqttuser)  │                       │  WebSocket   │
└─────────────┘                       └──────────────┘
```

---

## 3. 组件清单

| 组件 | 版本 / 路径 | 说明 |
|---|---|---|
| 操作系统 | Linux (Ubuntu/Debian) | 服务器 |
| Mosquitto | 2.x | MQTT Broker |
| InfluxDB | 2.9.1 (OSS) | 时序数据库 |
| Bun | 1.4+ | JavaScript 运行时（原生 TS + 原生 test） |
| Nginx | 1.18+ | TLS 反向代理（含 stream 模块） |
| ESP-IDF | 5.x | ESP32 开发框架 |
| zod | ^3.23 | Schema 校验（v2.0 新增） |
| pino | ^9.5 | 结构化日志（v2.0 新增） |

### 关键路径

| 项目 | 路径 |
|---|---|
| 项目根目录 | `/home/yzluo/myWeb/bun-mqtt-backend` |
| Bun 可执行文件 | `/home/yzluo/.bun/bin/bun` |
| Mosquitto 配置 | `/etc/mosquitto/conf.d/wss.conf` |
| Mosquitto ACL | `/etc/mosquitto/acl` |
| Mosquitto 密码文件 | `/etc/mosquitto/passwd` |
| systemd 服务 | `/etc/systemd/system/bun-mqtt-consumer.service` |

---

## 4. Mosquitto 配置

### 4.1 监听配置

`/etc/mosquitto/conf.d/wss.conf`：

```conf
allow_anonymous false
password_file /etc/mosquitto/passwd
acl_file /etc/mosquitto/acl

# WebSocket（未加密），供 Nginx 代理
listener 8083 127.0.0.1
protocol websockets

# MQTT 直连（TLS 由 Nginx 终止）
listener 1883 127.0.0.1
protocol mqtt

# log_type all
```

**要点**：
- 所有 listener 只绑定 `127.0.0.1`，外部无法直连
- 外部访问必须经过 Nginx（TLS 终止后转发到本机）
- `allow_anonymous false` 禁用匿名连接

### 4.2 密码文件

`/etc/mosquitto/passwd` 包含三个用户：

| 用户名 | 权限 | 用途 |
|---|---|---|
| `mqttuser` | readwrite `#` + read `$SYS/#` | Web 前端（WSS），全权限 |
| `bun_backend` | read `sensors/#` + write `commands/#` | Bun 后台，收数据发指令 |
| `sensor_device` | write `sensors/#` + read `commands/#` | ESP32 传感器，发数据收指令 |

**创建 / 修改密码**：

```bash
# 新建用户（不加 -c，避免覆盖整个文件）
sudo mosquitto_passwd /etc/mosquitto/passwd <用户名>

# 修改密码（同上，交互式输入新密码）
sudo mosquitto_passwd /etc/mosquitto/passwd <用户名>

# 列出所有用户
sudo cat /etc/mosquitto/passwd | cut -d: -f1
```

> ⚠️ **绝对不要重复用 `-c`**，`-c` 会覆盖整个文件。

### 4.3 ACL 文件

`/etc/mosquitto/acl`：

```conf
# ================================
# 原有账号：保留所有主题的完整权限（WSS 也用这个）
# ================================
user mqttuser
topic readwrite #
topic read $SYS/#

# ================================
# Bun 后台：读传感器数据 + 发布指令
# ================================
user bun_backend
topic read sensors/#
topic write commands/#

# ================================
# 传感器设备：写数据 + 订阅指令
# ================================
user sensor_device
topic write sensors/#
topic read commands/#
```

**要点**：
- ACL 里没有匹配规则的用户 → **全部拒绝**
- `#` 通配符**不匹配** `$` 开头的系统主题，`$SYS/#` 要单独写
- 修改后**必须重启** Mosquitto

**权限矩阵**：

| 账号 | 可写 | 可读 | 用途 |
|---|---|---|---|
| `mqttuser` | `#` | `#` + `$SYS/#` | WSS 前端 |
| `bun_backend` | `commands/#` | `sensors/#` | 后台服务 |
| `sensor_device` | `sensors/#` | `commands/#` | 传感器 |

### 4.4 文件权限

```bash
sudo chown root:mosquitto /etc/mosquitto/acl /etc/mosquitto/passwd
sudo chmod 640 /etc/mosquitto/acl
sudo chmod 600 /etc/mosquitto/passwd
```

### 4.5 持久化配置

确保 Broker 重启后保留持久会话和消息：

```conf
persistence true
persistence_location /var/lib/mosquitto/
max_queued_messages 1000
```

### 4.6 管理命令

```bash
sudo systemctl restart mosquitto
sudo systemctl status mosquitto --no-pager
sudo journalctl -u mosquitto -n 50 --no-pager
sudo journalctl -u mosquitto -f          # 实时日志
```

---

## 5. InfluxDB 配置

### 5.1 连接信息

| 项 | 值 |
|---|---|
| URL | `http://127.0.0.1:8086` |
| Org | `UNITO-ORG` |
| Bucket（生产） | `myHeatDemo` |
| Bucket（调试） | `myHeatDemoDebug` |
| Token | `<INFLUX_TOKEN_已隐藏>` （见 `.env`，不入库） |
| Measurement | `sensor_reading` |

### 5.2 数据模型（v2.0 更新）

**Tag（索引字段，用于查询过滤）**：

| Tag | 来源 | 示例 |
|---|---|---|
| `device_id` | 从 MQTT topic 提取（`sensors/{deviceId}/...`） | `ESP32-001` |
| `location` | payload 里的 `location` 字段（可选） | `living-room` |
| `type` | payload 里的 `type` 字段（可选） | `dht22` |
| `app` | 客户端默认标签（`writeApi.useDefaultTags`） | `mqtt-consumer` |

**Field（数值 / 状态，不索引，按 JS 类型自动映射）**：

| JS 类型 | InfluxDB Field 类型 | 示例 |
|---|---|---|
| `number` | `float` | `temperature=23.5` |
| `boolean` | `boolean` | `online=true` |
| `string`（非 tag 字段） | `string` | `status="ok"` |
| `object` / `array` | 跳过，仅记 debug 日志 | — |
| `null` / `undefined` | 跳过 | — |

**时间戳（v2.0 智能单位识别）**：

| 输入范围 | 识别为 | 处理 |
|---|---|---|
| `< 1e11` | 秒 (s) | × 1e9 转纳秒 |
| `< 1e14` | 毫秒 (ms) | × 1e6 转纳秒 |
| `< 1e17` | 微秒 (μs) | × 1e3 转纳秒 |
| `≥ 1e17` | 纳秒 (ns) | 直接使用 |
| 缺失 / 非法 | — | 用服务器当前时间 `Date.now() * 1_000_000` |

> **v1.0 的旧警告已作废**：之前"不要传毫秒 timestamp"的限制已经通过 `src/utils/timestamp.ts` 的智能识别彻底解决，传感器可以传任意单位。

### 5.3 Line Protocol 示例

一条完整的 Point 写入长这样：

```text
sensor_reading,app=mqtt-consumer,device_id=ESP32-001,location=living-room,type=dht22 battery=3.7,humidity=60,online=t,temperature=25.6 1758470400000000000
```

### 5.4 查询示例

```bash
# 查最近 5 分钟所有数据
influx query 'from(bucket:"myHeatDemo") |> range(start: -5m)' \
  --org UNITO-ORG --token '<INFLUX_TOKEN_已隐藏>'

# 查特定设备的温度
influx query 'from(bucket:"myHeatDemo")
  |> range(start: -1h)
  |> filter(fn:(r) => r._measurement == "sensor_reading")
  |> filter(fn:(r) => r.device_id == "ESP32-001")
  |> filter(fn:(r) => r._field == "temperature")' \
  --org UNITO-ORG --token '<INFLUX_TOKEN_已隐藏>'

# 求最近 1 小时平均温度
influx query 'from(bucket:"myHeatDemo")
  |> range(start: -1h)
  |> filter(fn:(r) => r._measurement == "sensor_reading" and r._field == "temperature")
  |> mean()' \
  --org UNITO-ORG --token '<INFLUX_TOKEN_已隐藏>'

# 列出所有活跃过的设备
influx query 'import "influxdata/influxdb/schema"
  schema.tagValues(bucket: "myHeatDemo", tag: "device_id")' \
  --org UNITO-ORG --token '<INFLUX_TOKEN_已隐藏>'
```

### 5.5 常用管理命令

```bash
influx org list
influx bucket list
influx auth list

# 创建 debug 用 bucket（7 天自动清理）
influx bucket create --name myHeatDemoDebug --retention 7d --org UNITO-ORG

# 查看服务状态
sudo systemctl status influxdb
```

---

## 6. Bun MQTT 消费者（重构版）

### 6.1 项目结构

```text
/home/yzluo/myWeb/bun-mqtt-backend/
├── src/
│   ├── index.ts              # 统一入口：装配 + 优雅关闭
│   ├── config.ts             # Zod 校验环境变量
│   ├── logger.ts             # Pino 结构化日志实例
│   ├── schema.ts             # MQTT payload Zod schema + topic 解析
│   ├── consumer.ts           # MQTT 消费者（startConsumer 函数）
│   ├── dedup.ts              # LRU + TTL 消息去重（v2.0 新增）
│   ├── influx.ts             # InfluxDB WriteApi 单例（批量写入）
│   ├── health.ts             # Bun.serve() /health /stats 端点
│   ├── services/
│   │   └── sensorData.ts     # payload → Point 转换逻辑
│   └── utils/
│       └── timestamp.ts      # 智能时间戳单位识别（v2.0 新增）
├── tests/
│   ├── timestamp.test.ts     # 12 个单测
│   └── dedup.test.ts         # 19 个单测
├── .env                      # 生产配置（gitignore，权限 600）
├── .env.debug                # 调试配置（gitignore，权限 600）
├── .env.debug.example        # 调试配置模板（入库）
├── package.json              # 含 start/dev/start:debug/dev:debug/test/typecheck 脚本
└── tsconfig.json
```

### 6.2 环境变量（Zod 校验）

`.env`（权限 `600`，**不入库**）：

```env
# ---------- MQTT ----------
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_USER=bun_backend
MQTT_PASS=<MQTT_PASS_已隐藏>
MQTT_CLIENT_ID=bun-mqtt-consumer
# MQTT_SUBSCRIBE_TOPIC=sensors/#    # 可选，默认 sensors/#

# ---------- InfluxDB ----------
INFLUX_URL=http://127.0.0.1:8086
INFLUX_TOKEN=<INFLUX_TOKEN_已隐藏>
INFLUX_ORG=UNITO-ORG
INFLUX_BUCKET=myHeatDemo

# ---------- 运行时 ----------
LOG_LEVEL=info                       # fatal/error/warn/info/debug/trace/silent
HEALTH_PORT=9000

# ---------- 应用层去重 ----------
DEDUP_ENABLED=true
DEDUP_MAX_SIZE=10000
DEDUP_TTL_MS=300000
```

**启动时校验行为**：任何必填字段缺失或格式非法，会立即打印每一条错误路径并 `process.exit(1)`：

```text
❌ 环境变量校验失败:
   - MQTT_PASS: Required
   - HEALTH_PORT: Expected number, received nan
```

### 6.3 核心模块

| 模块 | 职责 |
|---|---|
| `config.ts` | Zod schema 校验环境变量，导出 `config` 常量 + `configSnapshot()`（脱敏后可写日志） |
| `logger.ts` | Pino 实例，JSON 结构化输出，level 由 `LOG_LEVEL` 控制 |
| `schema.ts` | `SensorPayloadSchema`（Zod，`.passthrough()`）+ `parseDeviceIdFromTopic()` |
| `dedup.ts` | `MessageDeduplicator` 类（LRU+TTL）+ `computeDedupKey()`（优先用 payload ID，否则 `Bun.hash`） |
| `utils/timestamp.ts` | `normalizeToNanoseconds()` 智能识别 s/ms/μs/ns |
| `consumer.ts` | `startConsumer()` 装配 MQTT 事件回调，导出全局 `deduplicator` 单例 |
| `services/sensorData.ts` | `writeSensorData()` 把 payload 转成 InfluxDB Point |
| `influx.ts` | `writeApi` 单例（batchSize 500 / flushInterval 1s / maxRetries 3） |
| `health.ts` | `startHealthServer()` 提供 `/`、`/health`、`/stats` |
| `index.ts` | 装配所有模块 + 注册 SIGINT/SIGTERM 优雅关闭 |

### 6.4 消息处理流水线（9 步）

```text
MQTT 消息到达
    ↓
① JSON.parse 失败          → warn 日志，丢弃
    ↓
② Zod schema 校验失败      → warn 日志（含 issues），丢弃
    ↓
③ 计算 dedup key
   - payload.messageId / msgId / uuid / id  → "id:xxx:yyy"
   - 否则 Bun.hash(topic + "|" + raw)       → "h:xxx"
    ↓
④ LRU 缓存命中？
   ├─ 是 → debug 日志，丢弃 ⭐ v2.0 新增
   └─ 否 → 加入缓存（TTL 5 分钟）
    ↓
⑤ 提取 deviceId
   - 优先从 topic: sensors/{deviceId}/...
   - 其次 payload.deviceId
   - 兜底 "unknown"（记 warn）
    ↓
⑥ 智能识别 timestamp 单位（s/ms/μs/ns）并归一化为纳秒 ⭐ v2.0 新增
   - 缺失或非法 → 用服务器当前时间
    ↓
⑦ 构造 InfluxDB Point
   - Tag: device_id + location + type + app
   - Field: 按 JS 类型自动映射
    ↓
⑧ writeApi.writePoint() 入批量缓冲
    ↓
⑨ 缓冲区满 500 条 或 1 秒定时到 → HTTP 批量写入 InfluxDB
```

### 6.5 MQTT 客户端关键配置（保持不变）

| 配置项 | 值 | 说明 |
|---|---|---|
| `clientId` | `bun-mqtt-consumer` | 固定，配合持久会话 |
| `clean` | `false` | **持久会话**，断连期间 Broker 暂存消息 |
| `reconnectPeriod` | `5000` | 断线 5 秒自动重连 |
| `connectTimeout` | `10000` | 连接超时 10 秒 |
| 订阅 Topic | `sensors/#` | 通配符接收所有传感器 |
| QoS | `1` | 至少一次投递 |

### 6.6 启动命令

```bash
cd /home/yzluo/myWeb/bun-mqtt-backend

# 生产模式（读 .env）
bun run start

# 开发模式（读 .env，热重载）
bun run dev

# 调试模式（读 .env.debug，与生产版并行不冲突）
bun run start:debug
bun run dev:debug

# 类型检查
bun run typecheck

# 单元测试（31 个 case）
bun run test
```

底层等价命令：

```bash
bun --env-file=.env run src/index.ts
bun --env-file=.env --watch run src/index.ts
```

### 6.7 优雅关闭流程

`src/index.ts` 中 `shutdown()` 函数按顺序执行：

1. `healthServer.stop(true)` — 停止接受新的健康检查请求
2. `stopConsumerTimers()` — 停止去重缓存清扫定时器
3. `mqttClient.end(true, cb)` — 立即断开 MQTT（不等待发送队列）
4. `shutdownInflux()` — 刷出 InfluxDB 批量缓冲区
5. `process.exit(0)`

**兜底**：5 秒内未完成 → `process.exit(1)` 强制退出，防止进程僵死。

**触发信号**：`SIGINT`（Ctrl+C）/ `SIGTERM`（systemctl stop）/ `uncaughtException`。

### 6.8 单元测试

`bun test` 输出：

```text
tests/dedup.test.ts:      19 pass
tests/timestamp.test.ts:  12 pass
────────────────────────────────
Total:                    31 pass / 0 fail / 81 expect() calls
```

覆盖场景：
- 时间戳四种单位识别与归一化
- LRU 淘汰、TTL 过期、命中率统计、disabled 模式
- dedup key 生成的 ID 优先级、hash 幂等性

---

## 7. systemd 服务

### 7.1 服务文件（v2.0 更新入口路径）

`/etc/systemd/system/bun-mqtt-consumer.service`：

```ini
[Unit]
Description=Bun MQTT Consumer (v2.0 production-ready)
After=network.target mosquitto.service influxdb.service
Wants=mosquitto.service influxdb.service

[Service]
Type=simple
User=yzluo
WorkingDirectory=/home/yzluo/myWeb/bun-mqtt-backend
ExecStart=/home/yzluo/.bun/bin/bun --env-file=/home/yzluo/myWeb/bun-mqtt-backend/.env run /home/yzluo/myWeb/bun-mqtt-backend/src/index.ts
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 让 systemd 感知"进程活着但 MQTT 断了"的僵死状态（可选）
# ExecStartPost=/bin/sh -c 'until curl -fsS http://localhost:9000/health; do sleep 1; done'

[Install]
WantedBy=multi-user.target
```

> ⚠️ **v1.0 → v2.0 迁移**：`ExecStart` 末尾从 `src/consumer.ts` 改为 `src/index.ts`。

### 7.2 启用与管理

```bash
# 首次启用
sudo systemctl daemon-reload
sudo systemctl enable --now bun-mqtt-consumer

# 状态
sudo systemctl status bun-mqtt-consumer --no-pager

# 重启（改代码后）
sudo systemctl restart bun-mqtt-consumer

# 停止
sudo systemctl stop bun-mqtt-consumer

# 实时日志（Pino JSON 格式）
sudo journalctl -u bun-mqtt-consumer -f

# 最近 50 行
sudo journalctl -u bun-mqtt-consumer -n 50 --no-pager

# 检查开机自启
sudo systemctl is-enabled bun-mqtt-consumer
```

### 7.3 前台残留检查

如果曾在前台跑过消费者，务必确认没有残留进程，否则会和 systemd 服务用同一 clientId 抢连接：

```bash
ps aux | grep 'bun.*src/index.ts' | grep -v grep
```

有输出就 `kill <PID>`。

---

## 8. MQTT 协议规范

### 8.1 Topic 规范

| 方向 | Topic 格式 | 示例 |
|---|---|---|
| 传感器上报数据 | `sensors/{deviceId}/data` | `sensors/ESP32-001/data` |
| 后台下发指令 | `commands/{deviceId}/set` | `commands/ESP32-001/set` |
| 设备状态（可选） | `status/{deviceId}` | `status/ESP32-001` |

> ⚠️ `deviceId` 必须在 `sensors/` 或 `commands/` 后的**第一段**。消费者用 `parseDeviceIdFromTopic()` 提取设备 ID。

### 8.2 上报数据 JSON 格式（v2.0 更新）

**推荐结构**：

```json
{
  "temperature": 23.5,
  "humidity": 60.2,
  "pressure": 1013.25,
  "status": "ok",
  "online": true,
  "location": "living-room",
  "type": "dht22",
  "messageId": "a1b2c3d4",
  "timestamp": 1758470400000
}
```

**字段规则**：

| 字段 | 类型 | 处理方式 | 备注 |
|---|---|---|---|
| `temperature` 等数值 | number | `floatField` | 自动 |
| `online` 等布尔 | boolean | `booleanField` | 自动 |
| `status` 等字符串 | string | `stringField` | 自动 |
| `location` / `type` | string | **Tag**（索引） | 低基数字符串才适合当 tag |
| `messageId` / `msgId` / `uuid` / `id` | string \| number | **去重键**（不入库） | v2.0 新增，强烈建议携带 |
| `timestamp` | number | 时间戳（智能识别单位） | v2.0：秒/毫秒/微秒/纳秒都支持 |
| `deviceId` | string | 备用 deviceId | topic 无法解析时才用 |

**去重行为**：

| payload 情况 | 去重效果 |
|---|---|
| 带 `messageId` | 5 分钟内相同 ID 只入库一次 ✅ |
| 无 ID 但内容完全相同 | `Bun.hash(topic+raw)` 相同 → 只入库一次 ✅ |
| 无 ID 且内容每次不同 | 依赖 InfluxDB series+timestamp 内置去重（要求 payload 带 timestamp） |

> **v1.0 旧警告已作废**：之前"不要传毫秒 timestamp"的限制在 v2.0 已通过智能单位识别解决，可放心传毫秒。

### 8.3 指令 JSON 格式

后台发布到 `commands/{deviceId}/set`：

```json
{
  "interval": 10000,
  "reboot": false
}
```

传感器解析后按需处理。

### 8.4 发布参数

| 参数 | 建议值 | 说明 |
|---|---|---|
| QoS | `1` | 至少一次，配合持久会话不丢数据 |
| Retain | `false` | 传感器数据是时序流，不需要保留 |
| ClientId | `esp32-{deviceId}` | 唯一，避免互相踢下线 |
| Keep Alive | `60` 秒 | 心跳间隔 |

### 8.5 测试命令

```bash
# 上报数据（模拟传感器）
mosquitto_pub -h 127.0.0.1 -u sensor_device -P '<传感器密码_已隐藏>' \
  -t 'sensors/ESP32-001/data' \
  -m '{"temperature":23.5,"humidity":60.2,"messageId":"test-001"}'

# 订阅数据（模拟消费者）
mosquitto_sub -h 127.0.0.1 -u bun_backend -P '<MQTT_PASS_已隐藏>' \
  -t 'sensors/#' -v

# 下发指令
mosquitto_pub -h 127.0.0.1 -u bun_backend -P '<MQTT_PASS_已隐藏>' \
  -t 'commands/ESP32-001/set' \
  -m '{"interval":10000}'

# 订阅指令（模拟传感器）
mosquitto_sub -h 127.0.0.1 -u sensor_device -P '<传感器密码_已隐藏>' \
  -t 'commands/#' -v

# 查看 $SYS 系统信息（mqttuser）
mosquitto_sub -h 127.0.0.1 -u mqttuser -P '<mqttuser密码_已隐藏>' \
  -t '$SYS/#' -v
```

---

## 9. ESP32 端实现

### 9.1 配置参数

```c
#define WIFI_SSID       "<WiFi名称_已隐藏>"
#define WIFI_PASSWORD   "<WiFi密码_已隐藏>"
#define MQTT_BROKER_URI "mqtts://<你的域名>:8883"
#define MQTT_USERNAME   "sensor_device"
#define MQTT_PASSWORD   "<传感器密码_已隐藏>"
#define DEVICE_ID       "ESP32-001"   // 每台设备唯一
```

**服务器上创建对应账号**（一次性操作）：

```bash
sudo mosquitto_passwd /etc/mosquitto/passwd bun_backend
# 交互式输入：<MQTT_PASS_已隐藏>

sudo mosquitto_passwd /etc/mosquitto/passwd sensor_device
# 交互式输入：<传感器密码_已隐藏>
```

### 9.2 TLS 证书

从 Let's Encrypt 下载 CA 证书，嵌入代码：

```c
static const char *ROOT_CA = "-----BEGIN CERTIFICATE-----\n"
                             "MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcN\n"
                             // ... 完整证书内容 ...
                             "-----END CERTIFICATE-----\n";
```

> ⚠️ **不要用 `setInsecure()`**，生产环境必须验证证书。

### 9.3 MQTT 客户端配置

```c
const esp_mqtt_client_config_t mqtt_cfg = {
    .broker.address.uri = MQTT_BROKER_URI,
    .credentials.username = MQTT_USERNAME,
    .credentials.authentication.password = MQTT_PASSWORD,
    .credentials.client_id = "esp32-" DEVICE_ID,
    .session.clean_session = 0,          // 持久会话
    .broker.verification.certificate = ROOT_CA,
    .session.keepalive = 60,
    .session.last_will.topic = "status/" DEVICE_ID,
    .session.last_will.msg = "offline",
    .session.last_will.qos = 1,
    .session.last_will.retain = 1,
};
```

### 9.4 上报数据（cJSON，v2.0 建议带 messageId）

```c
static uint32_t s_msg_seq = 0;

static void publish_sensor_data(void) {
    cJSON *root = cJSON_CreateObject();
    cJSON_AddNumberToObject(root, "temperature", read_temperature());
    cJSON_AddNumberToObject(root, "humidity",    read_humidity());
    cJSON_AddStringToObject(root, "status",      "ok");
    cJSON_AddStringToObject(root, "location",    "living-room");
    cJSON_AddStringToObject(root, "type",        "dht22");

    // ⭐ v2.0 推荐：加唯一 messageId，服务端 LRU 去重更精准
    char msg_id[32];
    snprintf(msg_id, sizeof(msg_id), "%s-%lu", DEVICE_ID, ++s_msg_seq);
    cJSON_AddStringToObject(root, "messageId", msg_id);

    // 可选：设备侧 timestamp（毫秒即可，服务端会自动识别单位）
    cJSON_AddNumberToObject(root, "timestamp",
                            (double)(esp_timer_get_time() / 1000));

    char *json_str = cJSON_PrintUnformatted(root);
    if (json_str) {
        esp_mqtt_client_publish(s_mqtt_client, s_topic_data,
                                json_str, 0, 1, 0);  // QoS 1
        free(json_str);
    }
    cJSON_Delete(root);
}
```

### 9.5 接收指令

```c
case MQTT_EVENT_DATA: {
    cJSON *root = cJSON_ParseWithLength(event->data, event->data_len);
    if (root) {
        cJSON *interval = cJSON_GetObjectItem(root, "interval");
        if (cJSON_IsNumber(interval)) {
            // 更新上报周期
        }
        cJSON_Delete(root);
    }
    break;
}
```

### 9.6 sdkconfig 关键项

```ini
CONFIG_MQTT_PROTOCOL_311=y
CONFIG_MQTT_TRANSPORT_SSL=y
CONFIG_CJSON_ENABLE=y
CONFIG_MQTT_BUFFER_SIZE=2048
```

### 9.7 常见问题

| 问题 | 原因 | 解决 |
|---|---|---|
| TLS 握手失败 | CA 证书不对 | 嵌入正确的 CA 证书 |
| 连接被拒 | 用户名 / 密码错 | 检查 `sensor_device` 密码 |
| 发布失败 | ACL 不允许 | 确认 topic 是 `sensors/#` |
| 收不到指令 | 未订阅或 ACL 不对 | 确认订阅 `commands/#` |
| 消息被截断 | 缓冲区太小 | 增大 `CONFIG_MQTT_BUFFER_SIZE` |
| 两台设备互相踢 | ClientId 重复 | 每台设备用唯一 `DEVICE_ID` |

---

## 10. 数据流与时序

### 10.1 正常上报流程

```text
1.  ESP32 采集传感器数据
2.  构造 JSON: {"temperature":23.5,"humidity":60.2,"messageId":"ESP32-001-42"}
3.  发布到 sensors/ESP32-001/data，QoS 1
4.  Nginx TLS 终止，转发到 Mosquitto 127.0.0.1:1883
5.  Mosquitto 检查 ACL: sensor_device 有 write sensors/# 权限 ✓
6.  Mosquitto 投递给订阅者 bun_backend
7.  Bun 消费者收到消息
    ├─ JSON.parse → Zod 校验 → 计算 dedup key
    ├─ LRU 缓存查重（首次未命中）
    ├─ 提取 deviceId="ESP32-001"
    └─ 智能识别 timestamp 单位（如缺失则用 Date.now()）
8.  转换为 InfluxDB Point，调用 writeApi.writePoint()
9.  客户端批量写入 InfluxDB（500 条 / 1 秒 flush）
10. 数据持久化到 myHeatDemo bucket
```

### 10.2 断连恢复流程（持久会话）

```text
1. Bun 消费者进程停止
2. Mosquitto 保留 bun-mqtt-consumer 的会话
3. 传感器继续发布 QoS 1 消息
4. Mosquitto 将消息暂存到队列（最多 max_queued_messages 条）
5. 消费者重启，用相同 clientId 连接
6. Mosquitto 补发离线期间的消息
7. 消费者处理后写入 InfluxDB
   ⭐ v2.0：LRU 去重会自动拦截 Broker 重投的重复消息
```

### 10.3 指令下发流程

```text
1. Web 前端或 HTTP API 请求下发指令
2. 后台发布到 commands/ESP32-001/set
3. Mosquitto 检查 ACL: bun_backend 有 write commands/# 权限 ✓
4. Mosquitto 投递给订阅了 commands/# 的传感器
5. ESP32 在 MQTT_EVENT_DATA 回调中收到
6. 用 cJSON 解析，执行对应操作
```

---

## 11. 运维命令速查

### 11.1 服务管理

```bash
# Mosquitto
sudo systemctl restart mosquitto
sudo systemctl status mosquitto --no-pager
sudo journalctl -u mosquitto -f

# Bun 消费者
sudo systemctl restart bun-mqtt-consumer
sudo systemctl status bun-mqtt-consumer --no-pager
sudo journalctl -u bun-mqtt-consumer -f

# InfluxDB
sudo systemctl status influxdb

# Nginx
sudo systemctl restart nginx
sudo nginx -t                    # 测试配置
```

### 11.2 端口检查

```bash
ss -tlnp | grep 1883     # Mosquitto MQTT
ss -tlnp | grep 8083     # Mosquitto WebSocket
ss -tlnp | grep 8086     # InfluxDB
ss -tlnp | grep 8883     # Nginx MQTTS
ss -tlnp | grep 9000     # Bun 健康检查（v2.0 新增）
```

### 11.3 日志查看

Pino 输出 JSON 格式日志，配合 `jq` 更易读：

```bash
# 实时跟踪消费者（原始 JSON）
sudo journalctl -u bun-mqtt-consumer -f

# 用 jq 美化（推荐）
sudo journalctl -u bun-mqtt-consumer -f -o cat | jq .

# 最近 100 行
sudo journalctl -u bun-mqtt-consumer -n 100 --no-pager

# 只看错误级别
sudo journalctl -u bun-mqtt-consumer -p err

# 过滤特定 deviceId 的日志
sudo journalctl -u bun-mqtt-consumer -f -o cat | jq 'select(.deviceId=="ESP32-001")'

# Mosquitto 拒绝记录
sudo journalctl -u mosquitto -n 50 --no-pager | grep -i denied
```

### 11.4 健康检查（v2.0 新增）

```bash
# 存活探测（200=ok / 503=degraded）
curl -fsS http://localhost:9000/health | jq

# 详细统计（含去重命中率）
curl -fsS http://localhost:9000/stats | jq
```

### 11.5 数据验证

```bash
# 发测试数据
mosquitto_pub -h 127.0.0.1 -u sensor_device -P '<传感器密码_已隐藏>' \
  -t 'sensors/ESP32-001/data' \
  -m '{"temperature":23.5,"messageId":"manual-test-001"}'

# 查 InfluxDB
influx query 'from(bucket:"myHeatDemo") |> range(start: -5m)' \
  --org UNITO-ORG --token '<INFLUX_TOKEN_已隐藏>'

# 检查 MQTT 连接数
mosquitto_sub -h 127.0.0.1 -u mqttuser -P '<mqttuser密码_已隐藏>' \
  -t '$SYS/broker/clients/connected' -C 1
```

### 11.6 更新部署

```bash
cd /home/yzluo/myWeb/bun-mqtt-backend
git pull
bun install --frozen-lockfile
bun run typecheck                # ⭐ v2.0 新增：类型检查
bun run test                     # ⭐ v2.0 新增：单元测试
sudo systemctl restart bun-mqtt-consumer
sudo journalctl -u bun-mqtt-consumer -n 20 --no-pager
curl -fsS http://localhost:9000/health | jq
```

---

## 12. 故障排查

### 12.1 MQTT 连接问题

| 症状 | 排查 | 修复 |
|---|---|---|
| `Connection refused` | `ss -tlnp \| grep 1883` | 启动 Mosquitto |
| `Not authorized` | 检查密码 | `mosquitto_passwd` 重设 |
| `Denied SUBSCRIBE` | 查 Mosquitto 日志 | ACL 加 `read` 权限 |
| `Denied PUBLISH` | 查 Mosquitto 日志 | ACL 加 `write` 权限 |
| WSS 连不上 | 查 Nginx | 检查 stream 配置 |
| 两个进程互踢 | clientId 重复 | 检查生产版和 debug 版是否用了同一个 clientId |

### 12.2 InfluxDB 写入问题

| 症状 | 原因 | 修复 |
|---|---|---|
| `organization name "xxx" not found` | `INFLUX_ORG` 错 | `influx org list` 查真实值 |
| `bucket "xxx" not found` | `INFLUX_BUCKET` 错 | `influx bucket list` |
| `401 Unauthorized` | Token 无效 | 重新生成 Token |
| 数据查不到 | 批处理未 flush | 等 1~2 秒再查 |
| 数据落在 1970 年 | timestamp 单位错 | v2.0 已自动修复；若仍存在检查 `src/utils/timestamp.ts` |

### 12.3 数据丢失 / 重复问题

| 症状 | 排查 | 修复 |
|---|---|---|
| 断连期间数据丢失 | 检查 `clean_session` | 设为 `false` |
| 重启后丢数据 | 检查 `clientId` | 固定为 `bun-mqtt-consumer` |
| 传感器重启丢数据 | 检查 ESP32 `clean_session` | 设为 `0` |
| 消息被截断 | 检查 JSON 长度 | 增大 `CONFIG_MQTT_BUFFER_SIZE` |
| **数据翻倍（v2.0）** | 查 `/stats` 的 `dedup.hitRate` | 传感器 payload 加 `messageId` 字段 |
| **payload 校验失败被丢弃** | 查 warn 日志的 `issues` | 修正传感器 payload 结构 |

### 12.4 Zod 校验失败（v2.0 新增）

启动时立即退出，日志：

```text
❌ 环境变量校验失败:
   - MQTT_PASS: Required
   - HEALTH_PORT: Expected number, received nan
```

**修复**：按提示补齐或修正 `.env` 中的字段。

运行时 payload 校验失败会记 warn 日志但**不影响进程**：

```json
{"level":"warn","topic":"sensors/x/data","issues":[{"path":["timestamp"],"message":"Expected number, received string"}],"msg":"payload 校验失败，已丢弃"}
```

### 12.5 systemd 服务问题

```bash
# 服务启动失败
sudo systemctl status bun-mqtt-consumer --no-pager -l
sudo journalctl -xeu bun-mqtt-consumer --no-pager | tail -30

# 常见原因
# 1. bun 路径错   → which bun 确认
# 2. .env 权限    → chmod 600
# 3. 工作目录不存在 → 检查 WorkingDirectory
# 4. ExecStart 仍指向旧的 src/consumer.ts → 改为 src/index.ts
```

### 12.6 排查工具

```bash
# 查看 Mosquitto 日志（实时）
sudo journalctl -u mosquitto -f

# 查看 ACL 拒绝记录
sudo journalctl -u mosquitto -f | grep -i "denied\|not authorised"

# 查看当前 MQTT 连接
mosquitto_sub -h 127.0.0.1 -u mqttuser -P '<mqttuser密码_已隐藏>' \
  -t '$SYS/broker/clients/connected' -v

# 测试端口连通性
nc -zv 127.0.0.1 1883
nc -zv 127.0.0.1 9000    # 健康检查端口

# 查看进程占用
sudo lsof -i :9000
```

---

## 13. 安全注意事项

### 13.1 凭证管理

- ✅ `.env` / `.env.debug` 权限设为 `600`，只允许所有者读写
- ✅ `.env*` 不提交 Git，已加入 `.gitignore`（**v2.0 强化**：`.env` 已从 git 索引中 `rm --cached`）
- ✅ `.env.debug.example` 只包含占位符（如 `<MQTT_PASS_已隐藏>`），可安全入库
- ✅ Token 和密码不要出现在日志、对话、截图中
- ✅ 定期更换 Token 和密码
- ⚠️ 如果 Token 曾泄露（如贴到聊天），**立即**在 InfluxDB 重新生成并作废旧的
- ⚠️ 一旦密钥进入 Git 历史，即使后续删除也**永久留存**，务必轮换

### 13.2 网络暴露

- ✅ Mosquitto 只监听 `127.0.0.1`，外部无法直连
- ✅ 外部连接经 Nginx TLS 代理
- ✅ InfluxDB 只监听 `127.0.0.1`，不暴露公网
- ✅ 防火墙只开放必要端口（443、8883）
- ⚠️ **健康检查端口（9000/9001）建议仅本机可访问**：如需限制，在 `src/health.ts` 的 `Bun.serve` 中加 `hostname: "127.0.0.1"`

### 13.3 ACL 权限

- ✅ 每个账号权限最小化
- ✅ 传感器只能写自己的数据主题
- ✅ 传感器只能读指令主题
- ✅ 后台只能读数据、写指令
- ✅ 只有 `mqttuser` 有全权限（WSS 前端）

### 13.4 TLS 配置

- ✅ 使用 Let's Encrypt 证书
- ✅ 禁用 TLS 1.0 / 1.1
- ✅ ESP32 必须验证服务器证书，不用 `setInsecure()`
- ✅ 定期续期证书（`certbot renew`）

### 13.5 容器化注意（如使用）

- ✅ 敏感值用 `${}` 从宿主机环境读，不写死 compose
- ✅ 内部服务用 `expose`，不映射端口到宿主机
- ✅ 容器内用非 root 用户运行
- ✅ `.dockerignore` 排除 `.env*` 和 `node_modules`
- ✅ Dockerfile 加 `HEALTHCHECK CMD curl -fsS http://localhost:9000/health || exit 1`

---

## 14. 并行调试环境

v2.0 引入了独立的调试环境，可与生产版**在同一台云服务器上并行运行**、互不干扰。

### 14.1 三处冲突隔离

| 资源 | 生产版 | Debug 版 | 隔离方式 |
|---|---|---|---|
| MQTT clientId | `bun-mqtt-consumer` | `bun-mqtt-consumer-debug` | Broker 侧唯一 |
| InfluxDB bucket | `myHeatDemo` | `myHeatDemoDebug` | 独立 bucket |
| 健康检查端口 | `9000` | `9001` | 端口错开 |

### 14.2 快速搭建

```bash
# 1) 复制项目目录
cd /home/yzluo/myWeb
cp -r bun-mqtt-backend bun-mqtt-backend-debug
cd bun-mqtt-backend-debug

# 2) 生成 debug 配置
cp .env.debug.example .env.debug
nano .env.debug                 # 填入真实密钥（该文件已 gitignore）

# 3) 创建 debug bucket（7 天自动清理）
influx bucket create --name myHeatDemoDebug --retention 7d --org UNITO-ORG

# 4) 启动
bun run dev:debug
```

### 14.3 验证并行

```bash
# 生产版健康检查
curl http://localhost:9000/health | jq

# Debug 版健康检查
curl http://localhost:9001/health | jq

# Mosquitto 日志应能看到两个 clientId 同时在线
sudo tail -f /var/log/mosquitto/mosquitto.log | grep -E 'bun-mqtt-consumer'
```

---

## 附录 A：快速部署清单

从零搭建的完整顺序：

- [ ] 安装 Mosquitto、InfluxDB、Bun、Nginx
- [ ] 配置 Mosquitto 监听 `127.0.0.1:1883` 和 `127.0.0.1:8083`
- [ ] 创建密码文件，添加 `mqttuser` / `bun_backend` / `sensor_device`
- [ ] 创建 ACL 文件，分配权限
- [ ] 配置 Nginx stream TLS 代理
- [ ] 配置 InfluxDB，获取 Token、Org、Bucket
- [ ] 克隆项目到 `/home/yzluo/myWeb/bun-mqtt-backend`
- [ ] `cd bun-mqtt-backend && bun install`
- [ ] 创建 `.env`（参考 `.env.debug.example`），权限 `chmod 600`
- [ ] `bun run typecheck` 确认代码无类型错误
- [ ] `bun run test` 确认单测全绿（31 个 case）
- [ ] 前台测试 `bun run start`
- [ ] 发测试数据，验证 InfluxDB 写入
- [ ] `curl http://localhost:9000/health` 验证健康检查
- [ ] 创建 systemd 服务并启用（`ExecStart` 指向 `src/index.ts`）
- [ ] ESP32 烧录，配置 WiFi、MQTTS、证书、`messageId`
- [ ] 验证端到端数据流

---

## 附录 B：关键参数速查

| 参数 | 值 |
|---|---|
| Mosquitto MQTT | `127.0.0.1:1883` |
| Mosquitto WebSocket | `127.0.0.1:8083` |
| Nginx MQTTS | `0.0.0.0:8883` |
| InfluxDB | `127.0.0.1:8086` |
| InfluxDB Org | `UNITO-ORG` |
| InfluxDB Bucket（生产） | `myHeatDemo` |
| InfluxDB Bucket（调试） | `myHeatDemoDebug` |
| Measurement | `sensor_reading` |
| 数据 Topic | `sensors/{deviceId}/data` |
| 指令 Topic | `commands/{deviceId}/set` |
| 消费者 ClientId（生产） | `bun-mqtt-consumer` |
| 消费者 ClientId（调试） | `bun-mqtt-consumer-debug` |
| 传感器 ClientId | `esp32-{deviceId}` |
| QoS | `1` |
| 持久会话 | `clean_session = false` |
| InfluxDB 批量大小 | `500` 条 / `1000` ms |
| InfluxDB 重试 | 最多 `3` 次，最大间隔 `30s` |
| 去重缓存上限 | `10000` 条 |
| 去重 TTL | `5` 分钟 |
| 健康检查端口（生产） | `9000` |
| 健康检查端口（调试） | `9001` |

---

## 附录 C：健康检查端点

### C.1 `GET /`

服务自我介绍。

```bash
curl http://localhost:9000/
```

```json
{
  "name": "bun-mqtt-backend",
  "endpoints": ["/health", "/stats"]
}
```

### C.2 `GET /health`

存活探测（供 Docker / systemd / Prometheus blackbox 使用）。

**MQTT 已连接**（HTTP 200）：

```json
{
  "status": "ok",
  "mqtt": { "connected": true },
  "uptimeSec": 3600,
  "timestamp": "2026-09-21T10:30:15.123Z"
}
```

**MQTT 未连 / 掉线**（HTTP 503）：

```json
{
  "status": "degraded",
  "mqtt": { "connected": false },
  "uptimeSec": 3600,
  "timestamp": "2026-09-21T10:30:15.123Z"
}
```

### C.3 `GET /stats`

详细运行时统计。

```bash
curl http://localhost:9000/stats | jq
```

```json
{
  "uptimeSec": 3600,
  "mqtt": {
    "connected": true,
    "clientId": "bun-mqtt-consumer",
    "subscribeTopic": "sensors/#"
  },
  "influx": {
    "url": "http://127.0.0.1:8086",
    "org": "UNITO-ORG",
    "bucket": "myHeatDemo"
  },
  "dedup": {
    "enabled": true,
    "size": 847,
    "maxSize": 10000,
    "ttlMs": 300000,
    "hits": 23,
    "misses": 12450,
    "hitRate": 0.0018,
    "evicted": 0
  }
}
```

### C.4 Docker HEALTHCHECK 集成

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD curl -fsS http://localhost:9000/health || exit 1
```

---

## 附录 D：环境变量总表

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `MQTT_URL` | ✅ | — | MQTT Broker URL，如 `mqtt://127.0.0.1:1883` |
| `MQTT_USER` | ✅ | — | MQTT 用户名（`bun_backend`） |
| `MQTT_PASS` | ✅ | — | MQTT 密码 |
| `MQTT_CLIENT_ID` | ❌ | `bun-mqtt-consumer` | 客户端 ID，必须全局唯一 |
| `MQTT_SUBSCRIBE_TOPIC` | ❌ | `sensors/#` | 订阅主题 |
| `INFLUX_URL` | ✅ | — | InfluxDB URL |
| `INFLUX_TOKEN` | ✅ | — | InfluxDB API Token |
| `INFLUX_ORG` | ✅ | — | InfluxDB 组织名 |
| `INFLUX_BUCKET` | ✅ | — | InfluxDB Bucket 名 |
| `LOG_LEVEL` | ❌ | `info` | Pino 日志级别 |
| `HEALTH_PORT` | ❌ | `9000` | 健康检查 HTTP 端口 |
| `DEDUP_ENABLED` | ❌ | `true` | 是否启用应用层去重 |
| `DEDUP_MAX_SIZE` | ❌ | `10000` | LRU 缓存最大条目（100 ~ 1000000） |
| `DEDUP_TTL_MS` | ❌ | `300000` | 单条记录存活毫秒数（1000 ~ 3600000） |

---

**文档结束。** 如有更新，请修改开头的版本号和日期。

**变更历史**：
- **v2.0**（2026-09-21）：生产级重构。新增 Zod 校验、Pino 日志、`/health` `/stats` 端点、LRU 消息去重、智能时间戳单位识别；入口从 `src/consumer.ts` 迁移至 `src/index.ts`；新增 debug 并行环境；补齐 31 个单元测试；`.env` 从 Git 索引中移除；文档格式从 txt 迁移至 Markdown。
- **v1.0**（2026-09-18）：初版。
