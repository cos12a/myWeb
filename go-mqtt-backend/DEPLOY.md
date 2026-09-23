# 编译与部署（DEPLOY）

本文档面向**构建 / 上线 / 运维**：如何编译二进制、如何部署到云服务器、如何注册常驻服务、如何更新与回滚、如何从 Bun 版平滑迁移。

> 本地运行与数据处理规则请看 [USAGE.md](USAGE.md)；项目概览请看 [README.md](README.md)。

---

## 目录

1. [编译](#1-编译)
2. [云端部署（git 拉取式，推荐）](#2-云端部署git-拉取式推荐)
3. [systemd 常驻服务](#3-systemd-常驻服务)
4. [更新流程与回滚](#4-更新流程与回滚)
5. [并行双跑迁移（Bun → Go）](#5-并行双跑迁移bun--go)
6. [从 Bun 版切换生产](#6-从-bun-版切换生产)
7. [备选：交叉编译上传（服务器不装 Go）](#7-备选交叉编译上传服务器不装-go)
8. [与 Bun 版的行为差异（迁移须知）](#8-与-bun-版的行为差异迁移须知)
9. [部署常见坑](#9-部署常见坑)

---

## 1. 编译

产物是 `CGO_ENABLED=0` 的**纯静态二进制**：零运行时依赖，不依赖目标机 glibc 版本，拷过去 `chmod +x` 即可运行。

### 1.1 本地编译（开发机）

```bash
make build-local    # 本机二进制 → bin/go-mqtt-consumer(.exe)
```

### 1.2 交叉编译 Linux 二进制

```bash
make build          # Linux amd64 → bin/go-mqtt-consumer（-s -w 去符号，约 8.7MB）
```

手动指定架构（如 ARM 服务器）：
```powershell
# Windows PowerShell
$env:CGO_ENABLED="0"; $env:GOOS="linux"; $env:GOARCH="arm64"
go build -ldflags="-s -w" -o bin/go-mqtt-consumer ./cmd/consumer
```
```bash
# Linux / macOS
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o bin/go-mqtt-consumer ./cmd/consumer
```

> 先在目标服务器 `uname -m` 确认架构：`x86_64` → `amd64`；`aarch64` → `arm64`。

### 1.3 服务器上编译

服务器本身是 linux 时，装好 Go 后直接 `make build` 即可（无需交叉编译），见下一节。

---

## 2. 云端部署（git 拉取式，推荐）

> 目标环境示例：阿里云 ECS / Debian 13 / x86_64。
>
> git 拉取式部署的好处：版本可追溯、更新一条命令、可 `git checkout` 回滚、多台机器统一。

### 第 0 步：让服务器能拉私有仓库

远端是 SSH 地址 `git@github.com:cos12a/myWeb.git`，服务器需要 GitHub 访问权限，二选一：

```bash
# 方案① SSH key（推荐，长期免密）
ssh-keygen -t ed25519 -C "alibaba-ecs"     # 一路回车
cat ~/.ssh/id_ed25519.pub                    # 复制输出
#   → GitHub: Settings → SSH and GPG keys → New SSH key
ssh -T git@github.com                        # 出现 "Hi <user>" 即成功

# 方案② HTTPS + Fine-grained PAT（临时/简单）
#   clone 时用 https 地址，用户名填 PAT
```

### 第 1 步：安装 Go 工具链

apt 自带的 Go 版本可能低于 `go.mod` 要求，建议用官方 tarball 装匹配版本：

```bash
cd /tmp
wget https://go.dev/dl/go1.27.1.linux-amd64.tar.gz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.27.1.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc && source ~/.bashrc
go version                                     # 确认版本

# ⭐ 国内服务器务必设代理，否则拉依赖会超时
go env -w GOPROXY=https://goproxy.cn,direct
```

### 第 2 步：拉代码 + 编译

```bash
mkdir -p ~/src && cd ~/src
git clone git@github.com:cos12a/myWeb.git
cd myWeb/go-mqtt-backend
make build                                     # → bin/go-mqtt-consumer
```

### 第 3 步：部署到运行目录 + 配置

```bash
sudo mkdir -p /opt/go-mqtt-backend && sudo chown $USER:$USER /opt/go-mqtt-backend
cp bin/go-mqtt-consumer .env.example deploy/go-mqtt-consumer.service /opt/go-mqtt-backend/
cd /opt/go-mqtt-backend
chmod +x go-mqtt-consumer
cp .env.example .env && nano .env              # 填真实密钥；首次用 INFLUX_BUCKET=myHeatTestGo
chmod 600 .env                                 # 含密钥，收紧权限
```

### 第 4 步：前台试跑验证

```bash
cd /opt/go-mqtt-backend
./go-mqtt-consumer --env-file=.env
# 另开一个窗口：
#   curl http://localhost:9002/health   → {"status":"ok",...}
#   curl http://localhost:9002/stats    → mqtt.connected=true
# 确认无误后 Ctrl+C 停掉
```

### 第 5 步：注册 systemd 常驻

见下一节。

---

## 3. systemd 常驻服务

仓库已提供加固好的 unit 文件 [`deploy/go-mqtt-consumer.service`](deploy/go-mqtt-consumer.service)：`User` / `WorkingDirectory` / `ExecStart` 已按 `/opt/go-mqtt-backend` 配好，含 `NoNewPrivileges` / `ProtectSystem=strict` / `PrivateTmp` 等安全加固，`Restart=always` 崩溃自愈。

> 若运行用户或路径不同，先改该文件里的 `User=` / `Group=` 与 `WorkingDirectory` / `ExecStart` 路径。

```bash
cd /opt/go-mqtt-backend
sudo cp go-mqtt-consumer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now go-mqtt-consumer   # 开机自启 + 立即启动
sudo systemctl status go-mqtt-consumer
journalctl -u go-mqtt-consumer -f              # 实时日志（JSON）
```

---

## 4. 更新流程与回滚

本地改完代码 `git push` 后，服务器上一条龙更新：

```bash
cd ~/src/myWeb && git pull
cd go-mqtt-backend && make build
cp bin/go-mqtt-consumer /opt/go-mqtt-backend/
sudo systemctl restart go-mqtt-consumer
journalctl -u go-mqtt-consumer -n 20           # 看启动日志确认
```

> `/opt/go-mqtt-backend/.env` 不在 git 里，更新代码不会覆盖它，密钥安全。

**回滚**到旧版本：
```bash
cd ~/src/myWeb && git checkout <旧commit>
cd go-mqtt-backend && make build
cp bin/go-mqtt-consumer /opt/go-mqtt-backend/
sudo systemctl restart go-mqtt-consumer
```

**常用运维命令**：
```bash
sudo systemctl status  go-mqtt-consumer        # 运行状态
sudo systemctl restart go-mqtt-consumer        # 改 .env 后重启生效
sudo systemctl stop    go-mqtt-consumer        # 停止
journalctl -u go-mqtt-consumer --since "10 min ago"
```

---

## 5. 并行双跑迁移（Bun → Go）

Go 版首次上线**先别抢生产 bucket**，用独立 bucket + 独立 clientId + 独立端口与 Bun 版并行跑，零数据风险：

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

## 6. 从 Bun 版切换生产

确认 48h 数据一致后：

1. 改 `/opt/go-mqtt-backend/.env`：`INFLUX_BUCKET` 改为生产 bucket（`myHeatTest`）、`MQTT_CLIENT_ID` 改为生产值、`LOG_LEVEL` 改回 `info`
2. `sudo systemctl restart go-mqtt-consumer`
3. `sudo systemctl stop bun-mqtt-consumer`
4. 验证数据继续落库 → `sudo systemctl disable bun-mqtt-consumer`
5. 观察 1 周无问题后彻底移除 Bun 版

---

## 7. 备选：交叉编译上传（服务器不装 Go）

若不想在服务器装 Go，可在本地交叉编译后上传静态二进制：

```powershell
# 本地 Windows PowerShell
$env:CGO_ENABLED="0"; $env:GOOS="linux"; $env:GOARCH="amd64"
go build -ldflags="-s -w" -o bin/go-mqtt-consumer ./cmd/consumer
scp bin/go-mqtt-consumer .env.example deploy/go-mqtt-consumer.service user@server:/opt/go-mqtt-backend/
```
之后从 [第 3 步](#第-3-步部署到运行目录--配置) 继续即可。

| 对比 | git 拉取式（推荐） | 交叉编译上传 |
|---|---|---|
| 服务器需装 Go | 是（一次性） | 否 |
| 更新方式 | `git pull && make build` | 每次本地编译 + scp |
| 版本追踪 / 回滚 | ✅ git 天然支持 | ❌ 靠手动管理二进制 |
| 适用场景 | 长期运维、多机 | 一次性、离线、极小机器 |

---

## 8. 与 Bun 版的行为差异（迁移须知）

1. **dedup hash 不兼容**：Bun 用 `wyhash`，Go 用 `xxhash` — 无 ID 时的 fallback hash key 两边不同。并行跑各自独立去重，互不影响，但**跨版本对比 hash key 无意义**。带 `messageId` 时两边 key 一致（`id:messageId:xxx`）。
2. **map 遍历顺序**：Go map 无序，`ClassifyPayload` 已按 key 字典序排序以保证稳定输出。
3. **JSON number**：Go `json.Unmarshal` 到 `any` 时数字统一为 `float64`（与 TS `number` 行为一致）。
4. **时间戳精度**：Go fallback 用 `time.Now().UnixNano()`（纳秒），比 Bun 的 `Date.now()`（毫秒）更精确。

---

## 9. 部署常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `go build` 拉依赖卡住/超时 | 默认 proxy 在国内慢 | `go env -w GOPROXY=https://goproxy.cn,direct` |
| `go: go.mod requires go >= 1.27.1` | 服务器 Go 版本过低 | 用官方 tarball 装匹配版本（见第 1 步） |
| `permission denied` 执行二进制 | 没加可执行权限 | `chmod +x go-mqtt-consumer` |
| systemd 启动失败 `status=203/EXEC` | 路径错 / 无执行权限 / 架构不符 | 核对 `ExecStart` 绝对路径、`chmod +x`、`uname -m` |
| 服务起来但连不上 MQTT | 安全组/防火墙 / Broker 未放行 | 检查 ECS 安全组、Broker 监听地址与账号 |
| 和 Bun 版互相掉线 | `MQTT_CLIENT_ID` 撞了 | 两版 clientId 必须不同 |
| 数据没进 InfluxDB | bucket/org/token 不对 | `journalctl` 看 `InfluxDB 写入失败`，核对 `.env` |
