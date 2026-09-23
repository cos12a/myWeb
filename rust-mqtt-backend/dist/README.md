# dist/ — 预构建二进制

本目录存放**可直接部署**的预构建产物，随仓库提交，云服务器 `git pull` 后即可取用。

## `rust-mqtt-consumer`

| 属性 | 值 |
|---|---|
| 架构 | **x86-64**（阿里云 ECS / 主流 Linux 服务器） |
| 链接 | `static-pie`，**全静态、无动态依赖**（不依赖服务器 glibc/musl） |
| libc | musl（`x86_64-unknown-linux-musl`） |
| TLS | ❌ **不含**（纯 Rust 构建，`--no-default-features`）——仅支持 `http://` InfluxDB + 明文 `mqtt://` |
| 大小 | ~3.0 MB（已 strip） |

> ⚠️ 该产物为纯 Rust 构建，**不支持 https/mqtts**。本项目部署目标是本机
> `http://127.0.0.1:8086` + `mqtt://127.0.0.1:1883`（见 `../HANDOFF.md` 1.4），完全够用。
> 若服务器需 TLS，请在 x86_64 机上按默认特性重编（见 `../DEPLOY.md` 路径 A/B）。

## 云服务器部署（x86_64）

```bash
# 1) 拉取
git pull
# 2) 安装二进制
sudo mkdir -p /opt/rust-mqtt-backend
sudo cp rust-mqtt-backend/dist/rust-mqtt-consumer /opt/rust-mqtt-backend/
sudo chmod +x /opt/rust-mqtt-backend/rust-mqtt-consumer
# 3) 放置配置（密钥，600 权限，绝不入库）
sudo cp rust-mqtt-backend/.env /opt/rust-mqtt-backend/.env && sudo chmod 600 /opt/rust-mqtt-backend/.env
# 4) systemd 托管（unit 见 ../deploy/rust-mqtt-consumer.service）
sudo cp rust-mqtt-backend/deploy/rust-mqtt-consumer.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now rust-mqtt-consumer
# 5) 验证
curl -s http://localhost:9004/health
journalctl -u rust-mqtt-consumer -f
```

完整部署 / 更新 / 回滚 / 并行双跑隔离见 [`../DEPLOY.md`](../DEPLOY.md)。

## 如何重新生成本二进制

在任意架构、**无需 C 交叉工具链**的机器上：

```bash
cd ..    # 回到 rust-mqtt-backend/
rustup target add x86_64-unknown-linux-musl
RUSTFLAGS="-C linker=rust-lld" \
  cargo build --release --no-default-features --target x86_64-unknown-linux-musl
cp target/x86_64-unknown-linux-musl/release/rust-mqtt-consumer dist/rust-mqtt-consumer
# 或直接：make musl-static && cp target/x86_64-unknown-linux-musl/release/rust-mqtt-consumer dist/
```
