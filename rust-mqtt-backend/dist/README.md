# dist/ — 预构建二进制

本目录存放**可直接部署**的预构建产物 + 自包含的运行/安装文件，随仓库提交，
云服务器 `git pull` 后即可取用。

## 目录文件一览

| 文件 | 作用 |
|---|---|
| `rust-mqtt-consumer` | x86-64 全静态可执行二进制（程序本体） |
| `.env.example` | 生产配置模板，**逐个参数详注**（必填/默认/取值范围） |
| `.env.debug.example` | 调试配置模板（与生产并行双跑的隔离三要素） |
| `run.sh` | **前台**手动运行加载脚本（首次验证/排障用） |
| `install-debian.sh` | **一键**安装为 systemd 常驻服务（开机自启+崩溃自愈，推荐） |
| `rust-mqtt-consumer.service` | systemd 单元参考模板（手动安装时用） |
| `INSTALL-DEBIAN.md` | **详细**的 Debian 常驻运行方法与运维手册 |

> 快速上手：`cp .env.example .env && chmod 600 .env && vim .env` → `sudo ./install-debian.sh`。
> 完整步骤/运维/排障见 [`INSTALL-DEBIAN.md`](INSTALL-DEBIAN.md)。

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

**推荐：一键安装为常驻服务**（详见 [`INSTALL-DEBIAN.md`](INSTALL-DEBIAN.md)）

```bash
git pull && cd rust-mqtt-backend/dist/
cp .env.example .env && chmod 600 .env && vim .env   # 填真实值
sudo ./install-debian.sh                              # 建用户+装二进制+装 systemd+自启+启动
curl -s http://localhost:9004/health                  # 验证
```

**或：先前台手动验证**（不装服务，Ctrl-C 优雅退出）

```bash
git pull && cd rust-mqtt-backend/dist/
cp .env.example .env && chmod 600 .env && vim .env
./run.sh                    # 或 ./run.sh .env.debug 用调试配置
```

**或：纯手动 systemd**（逐步理解每一步）

```bash
# 1) 拉取
git pull
# 2) 安装二进制
sudo mkdir -p /opt/rust-mqtt-backend
sudo cp rust-mqtt-backend/dist/rust-mqtt-consumer /opt/rust-mqtt-backend/
sudo chmod +x /opt/rust-mqtt-backend/rust-mqtt-consumer
# 3) 放置配置（密钥，600 权限，绝不入库）
sudo cp rust-mqtt-backend/.env /opt/rust-mqtt-backend/.env && sudo chmod 600 /opt/rust-mqtt-backend/.env
# 4) systemd 托管（unit 见本目录 rust-mqtt-consumer.service，先改 User/Group）
sudo cp rust-mqtt-backend/dist/rust-mqtt-consumer.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now rust-mqtt-consumer
# 5) 验证
curl -s http://localhost:9004/health
journalctl -u rust-mqtt-consumer -f
```

完整部署 / 更新 / 回滚 / 卸载 / 并行双跑隔离 / 排障见 [`INSTALL-DEBIAN.md`](INSTALL-DEBIAN.md) 与 [`../DEPLOY.md`](../DEPLOY.md)。

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
