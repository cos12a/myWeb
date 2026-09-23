# DEPLOY — rust-mqtt-backend 编译与部署

覆盖：构建路径、musl 静态产物、部署到 x86_64 服务器、systemd、验证、更新回滚、并行双跑隔离。
对齐 [`HANDOFF.md`](./HANDOFF.md) 第 8 节，并补充在**非 x86_64 构建机 / 无 C 交叉工具链**环境下产出静态二进制的可行路径。

---

## 0. 构建路径总览

| 路径 | 构建机 | 产物 TLS | 依赖 C 工具链 | 适用场景 |
|---|---|---|---|---|
| A. 服务器本机编译 | x86_64 Linux（服务器自身） | ✅ | 需要（gcc） | 最省心，无需交叉编译（HANDOFF 8.3） |
| B. musl 静态（标准） | x86_64 Linux + `musl-tools` | ✅ | 需要 `x86_64-linux-musl-gcc` | 零依赖静态产物，上传即用（HANDOFF 8.2） |
| C. musl 静态（纯 Rust） | 任意架构（含 aarch64） | ❌ 仅 http/明文 mqtt | **不需要** | 无 C 交叉工具链时，用 `rust-lld` 自包含链接 |

> 三条路径产出的二进制**外部可观测行为一致**（去重/分类/归一化/写入参数/端点）。区别仅在 TLS 能力与构建方式。
> 本项目部署目标是**本机** `http://127.0.0.1:8086` InfluxDB + `mqtt://127.0.0.1:1883`（HANDOFF 1.4），路径 C 完全够用。

---

## 1. 前置：安装 Rust 工具链

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustup default stable
```

国内镜像加速（可选，构建机网络受限时）：

```bash
export RUSTUP_DIST_SERVER=https://rsproxy.cn
export RUSTUP_UPDATE_ROOT=https://rsproxy.cn/rustup
# crates.io 镜像写入 ~/.cargo/config.toml（rsproxy sparse 源）
```

---

## 2. 路径 A：服务器本机编译（最省心）

```bash
# 服务器上（Debian/x86_64）
git clone <repo> && cd <repo>/rust-mqtt-backend
cargo build --release
sudo mkdir -p /opt/rust-mqtt-backend
sudo cp target/release/rust-mqtt-consumer /opt/rust-mqtt-backend/
```

优点：无需交叉编译。缺点：2 核小机首次编译约 3–8 分钟，且服务器要装工具链。

---

## 3. 路径 B：musl 静态产物（标准，x86_64 构建机）

与 Go 版静态二进制同思路：零依赖、上传即用、不依赖服务器 glibc。

```bash
rustup target add x86_64-unknown-linux-musl
sudo apt-get install -y musl-tools          # 提供 x86_64-linux-musl-gcc（ring 的 C 编译需要）
cargo build --release --target x86_64-unknown-linux-musl
# 产物：target/x86_64-unknown-linux-musl/release/rust-mqtt-consumer
file target/x86_64-unknown-linux-musl/release/rust-mqtt-consumer
# → ELF 64-bit ... x86-64 ... static-pie linked, stripped
```

或用 Makefile：`make musl`。

> **为何需要 musl-tools**：默认构建启用 rustls，其底层 `ring` 含 C/汇编代码，交叉编译到 musl 时需 `x86_64-linux-musl-gcc`。构建机若为 Windows/macOS，改用 `cross`（依赖 Docker）：`cargo install cross && cross build --release --target x86_64-unknown-linux-musl`。

---

## 4. 路径 C：musl 静态产物（纯 Rust + rust-lld，无需 C 交叉工具链）

当构建机**不是 x86_64**（如 aarch64）或**没有** `musl-gcc` / Docker / cross / zig 时，关闭默认 rustls 特性移除 `ring`，改用 Rust 自带的 `rust-lld` 做全静态自包含链接：

```bash
rustup target add x86_64-unknown-linux-musl
RUSTFLAGS="-C linker=rust-lld" \
  cargo build --release --no-default-features --target x86_64-unknown-linux-musl
file target/x86_64-unknown-linux-musl/release/rust-mqtt-consumer
# → ELF 64-bit LSB pie executable, x86-64, static-pie linked, stripped
readelf -d target/x86_64-unknown-linux-musl/release/rust-mqtt-consumer | grep NEEDED
# → （无输出 = 无动态依赖 = 全静态）
```

或用 Makefile：`make musl-static`。

**原理**：`--no-default-features` 移除 `reqwest/rustls-tls` 与 `rumqttc/use-rustls`，依赖树里不再有 `ring`（已用 `cargo tree --no-default-features | grep ring` 验证为空）。剩余全是纯 Rust，链接只需 Rust 对象 + std + 随 `x86_64-unknown-linux-musl` target 一起安装的 `self-contained` musl `libc.a` / `crt1.o`，`rust-lld` 即可完成，无需任何 C 编译器。

**代价**：产物只支持 `http://` InfluxDB 与明文 `mqtt://`（无 TLS）。对本机部署（HANDOFF 1.4）无影响；若服务器需 https/mqtts，请走路径 A 或 B。

---

## 5. 上传与部署到阿里云 ECS（x86_64）

```bash
scp target/x86_64-unknown-linux-musl/release/rust-mqtt-consumer yzluo@<server>:/home/yzluo/mqttBackends/
# 服务器上
sudo mkdir -p /opt/rust-mqtt-backend
sudo cp /home/yzluo/mqttBackends/rust-mqtt-consumer /opt/rust-mqtt-backend/
sudo chmod +x /opt/rust-mqtt-backend/rust-mqtt-consumer
# 放置配置（密钥，600 权限，绝不入库）
sudo cp .env /opt/rust-mqtt-backend/.env && sudo chmod 600 /opt/rust-mqtt-backend/.env
```

---

## 6. systemd 托管

unit 草案见 [`deploy/rust-mqtt-consumer.service`](./deploy/rust-mqtt-consumer.service)（含安全加固：`NoNewPrivileges` / `ProtectSystem=strict` / `ProtectHome=read-only` 等）。

```bash
sudo cp deploy/rust-mqtt-consumer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rust-mqtt-consumer
systemctl status rust-mqtt-consumer
journalctl -u rust-mqtt-consumer -f          # 实时 JSON 日志
```

> 部署前请按需修改 unit 里的 `User` / `Group` / `WorkingDirectory` / `ExecStart` 路径。

---

## 7. 部署后验证

```bash
curl -s http://localhost:9004/health    # 期望 {"status":"ok","mqtt":{"connected":true},...}
curl -s http://localhost:9004/stats     # 看 dedup.misses 是否随消息增长

# 发一条测试消息
mosquitto_pub -h 127.0.0.1 -u <user> -P '<pass>' \
  -t "sensors/ESP32-TEST/data" \
  -m '{"messageId":"rust-verify-001","temperature":25.6,"location":"lab"}'
# 连发 3 条相同 messageId → InfluxDB 应只有 1 条（验证去重）
```

预期落库 Line Protocol：

```
sensor_reading,app=mqtt-consumer,device_id=ESP32-TEST,location=lab temperature=25.6 <ts_ns>
```

---

## 8. 并行双跑隔离（关键）

Rust 版必须与 Bun/Go 版**完全隔离**，三者可同时订阅同一主题各收全量、各写各桶：

| 隔离项 | Bun | Go | **Rust** |
|---|---|---|---|
| MQTT clientId | (默认) | go-mqtt-consumer | **rust-mqtt-consumer** |
| InfluxDB bucket | myHomeData | myHomeDemo | **myHomeDemoRust** |
| Health 端口 | 9000 | 9002 | **9004** |

> clientId 必须唯一，否则同一 Broker 会互踢（两个相同 clientId 的连接反复断开）。
> 调试实例再加一层隔离：clientId `-debug` 后缀、独立 debug bucket、端口 9005（见 `.env.debug.example`）。

---

## 9. 更新与回滚

**更新**（静态产物替换式，秒级）：

```bash
# 备份当前二进制
sudo cp /opt/rust-mqtt-backend/rust-mqtt-consumer /opt/rust-mqtt-backend/rust-mqtt-consumer.bak
# 上传新产物并覆盖
sudo cp <new>/rust-mqtt-consumer /opt/rust-mqtt-backend/rust-mqtt-consumer
sudo systemctl restart rust-mqtt-consumer
journalctl -u rust-mqtt-consumer -f          # 确认「已连接 MQTT Broker」「InfluxDB writeAPI 已就绪」
```

**回滚**：

```bash
sudo cp /opt/rust-mqtt-backend/rust-mqtt-consumer.bak /opt/rust-mqtt-backend/rust-mqtt-consumer
sudo systemctl restart rust-mqtt-consumer
```

> 优雅关闭会刷空 InfluxDB 缓冲（HANDOFF 2.10），`systemctl restart` 不会丢缓冲里的点。
> 因三版并行、各写各桶，Rust 版更新/回滚期间 Bun/Go 版仍在写库，数据不中断。

---

## 10. 本次构建环境说明（可复现性备注）

本项目交付时的构建机为 **aarch64 Linux**（无 `apt`、无 Docker、无 `x86_64-linux-musl-gcc`、PyPI 不可达），因此：

- 路径 B（`musl-tools`）与 `cross`/`zig` 均不可用；
- 采用**路径 C**：`--no-default-features` + `RUSTFLAGS="-C linker=rust-lld"` 成功产出
  `x86_64-unknown-linux-musl` 全静态二进制（`static-pie linked, stripped`，无 `NEEDED` 条目，约 3.0 MB）；
- 默认构建（含 rustls）在**本机 aarch64** 下 `cargo build --release` 正常（`ring` 用本机 gcc 编译）；
  仅**交叉**到 x86_64 时 `ring` 才需要 `x86_64-linux-musl-gcc`，故交叉走路径 C。

在 x86_64 构建机或服务器上，路径 A / B 均可直接产出**含 TLS** 的产物，无需 `--no-default-features`。
