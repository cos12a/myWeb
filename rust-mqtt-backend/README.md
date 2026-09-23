# rust-mqtt-backend

`bun-mqtt-backend` / `go-mqtt-backend` 的 **Rust 等价实现**（v2.1）。
订阅 MQTT 传感器消息 → 去重 / 字段分类 / 时间戳归一化 → 批量写入 InfluxDB 2.x。

外部可观测行为与 Go 版 v2.1 **逐条对齐**（对齐基准见 [`HANDOFF.md`](./HANDOFF.md) 第 2 节）。
三版（Bun / Go / Rust）可通过独立 clientId / bucket / 健康端口**并行双跑、互不干扰**。

---

## 文档导航

| 文档 | 内容 |
|---|---|
| [`README.md`](./README.md) | 本文件：项目总览、快速开始、模块地图、构建测试 |
| [`USAGE.md`](./USAGE.md) | 使用说明：本地运行、配置项、数据处理规则、健康端点、FAQ |
| [`DEPLOY.md`](./DEPLOY.md) | 编译部署：本地 / musl 静态产物 / 服务器、systemd、更新回滚、并行迁移 |
| [`HANDOFF.md`](./HANDOFF.md) | 权威交接文档：行为规范、实现细则、陷阱、测试计划（本项目的实现依据） |

---

## 特性状态

| 能力 | 状态 | 说明 |
|---|---|---|
| MQTT 消费（rumqttc，持久会话，QoS1，自动重连） | ✅ | 重连后显式重订阅；失败 5s 重试 |
| 7 层字段分类器 | ✅ | 黑名单 / tag / 有限数字 / NaN·Inf 拦截 / bool / 字符串强转 / 不支持类型 |
| 智能时间戳归一化 | ✅ | 按数量级判定 s/ms/us/ns → 纳秒 |
| LRU + TTL 去重 | ✅ | ID 字段优先，xxhash64+base36 回退；命中刷新 recency；后台 sweep |
| InfluxDB 批量写入 | ✅ | batch=500 / flush=1s / retry=3 / precision=ns，手写 Line Protocol |
| 结构化 JSON 日志（tracing） | ✅ | 字段对齐 Go/zap |
| 健康端点（axum） | ✅ | `GET /`、`/health`、`/stats` |
| 优雅关闭 | ✅ | SIGINT/SIGTERM，5s 兜底，按依赖顺序关闭并刷缓冲 |
| 单元测试 | ✅ | 88 个（≥73 目标），1:1 映射 Go 测试 |
| x86_64-unknown-linux-musl 静态产物 | ✅ | 见 [`DEPLOY.md`](./DEPLOY.md) |

---

## 快速开始

```bash
# 1) 准备配置（密钥只从 .env / 环境变量读取，绝不入库）
cp .env.example .env
chmod 600 .env
$EDITOR .env                 # 填入 MQTT_USER/PASS、INFLUX_TOKEN/ORG/BUCKET

# 2) 本地运行（debug 构建）
cargo run -- --env-file=.env

# 3) 验证
curl -s http://localhost:9004/health
curl -s http://localhost:9004/stats
```

> 若 InfluxDB / MQTT 都在本机且用明文（`http://` + `mqtt://`），可用纯 Rust 构建，见下「构建变体」。

---

## 构建与测试

```bash
cargo build                  # debug 构建（含 rustls）
cargo test                   # 全部单测（期望 ≥73 全绿，当前 88）
cargo clippy --all-targets -- -D warnings   # 质量门禁（零警告）
cargo build --release        # 生产构建 → target/release/rust-mqtt-consumer
```

也可直接用 Makefile：`make build` / `make test` / `make clippy` / `make musl` / `make musl-static`。

### 构建变体（TLS 特性门控）

本 crate 用 cargo feature 控制 TLS，以适配不同部署与交叉编译环境：

| 变体 | 命令 | TLS | 依赖 ring（C/asm） | 适用 |
|---|---|---|---|---|
| 默认 | `cargo build --release` | ✅ rustls（https + mqtts） | 是 | x86_64 构建机 / 服务器本机编译 |
| 纯 Rust | `cargo build --release --no-default-features` | ❌ 仅 http + 明文 mqtt | 否 | 本机 `http://127.0.0.1:8086` + `mqtt://127.0.0.1:1883`；从非 x86_64 主机交叉编译 |

> **为何门控**：`ring`（rustls 的 C 依赖）交叉编译到 musl 需要 `x86_64-linux-musl-gcc`。
> 关闭默认特性即移除 `ring`，可用 Rust 自带的 `rust-lld` 完成全静态链接，无需任何 C 交叉工具链。
> 详见 [`DEPLOY.md`](./DEPLOY.md)「musl 静态产物」。

---

## 模块地图

单 crate + 模块化，纯逻辑模块内联 `#[cfg(test)] mod tests`：

```
src/
├── main.rs        # tokio 装配 + 优雅关闭 + 命令行（--env-file）
├── config.rs      # 环境变量结构体 + 校验（一次性返回所有错误）+ 脱敏快照
├── logger.rs      # tracing-subscriber JSON 初始化
├── mqtt.rs        # rumqttc AsyncClient + EventLoop 驱动 + 消息流水线
├── influx.rs      # 批量 writer（channel + 后台 flush）+ ping
├── dedup.rs       # LRU+TTL 去重 + compute_dedup_key + base36 + 统计
├── classifier.rs  # 7 层字段分类 + 黑名单/白名单/tag 常量
├── timestamp.rs   # detect_unit + normalize_to_nanos
├── sensor.rs      # payload → Line Protocol 组装（含转义）
└── health.rs      # axum 路由 / /health /stats + 共享状态
```

与 Go 版的模块对应关系见 [`HANDOFF.md`](./HANDOFF.md) 文末「附：与 Go 版的模块对应表」。

---

## 行为常量（逐字对齐 HANDOFF 第 2 节）

- **measurement**：`sensor_reading`（固定）
- **默认 tag**：`app=mqtt-consumer` + `device_id={deviceId}`
- **SKIP_FIELDS（黑名单，8 项）**：`messageId, msgId, message_id, msg_id, uuid, id, timestamp, deviceId`
- **TAG_FIELDS（2 项）**：`location, type`
- **NUMERIC_FIELD_HINTS（数值白名单）**：见下方「已知文档差异」
- **时间戳阈值**：`<1e11` 秒 / `<1e14` 毫秒 / `<1e17` 微秒 / `>=1e17` 纳秒
- **去重 key**：ID 优先 `id:{field}:{value}`；回退 `h:{base36(xxh64(topic+"|"+raw))}`
- **InfluxDB**：batch=500 / flush=1000ms / retry=1000ms×3 / precision=ns
- **默认端口**：`HEALTH_PORT=9004`（Bun=9000，Go=9002，三版隔离）
- **默认 clientId**：`rust-mqtt-consumer`

### 已知文档差异（NUMERIC_FIELD_HINTS 计数）

`HANDOFF.md` §2.5 概述行写「共 **28** 个」，但其**逐字清单实际列了 29 项**——
概述的分组核对把「环境」组算成 12，实际是 13（`lux, co2, tvoc, pm25, pm10, pm1` 6 项
+ `altitude, windSpeed, windDirection, rainfall` 4 项 + `soilMoisture, soilTemperature, waterLevel` 3 项 = 13）。
按文档「凡是列了具体字符串的地方都要逐字照抄」的最高优先级要求，实现以**逐字清单（29 项）为准**，
并与 Go 源码保持一致。`src/classifier.rs` 中已就地注释说明。

---

## 许可证与出处

Rust 重写自 `go-mqtt-backend`（v2.1）与 `bun-mqtt-backend`。行为规范以 [`HANDOFF.md`](./HANDOFF.md) 为准。
