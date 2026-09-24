# Debian/Ubuntu 常驻运行手册（rust-mqtt-consumer）

本手册讲如何在 **Debian / Ubuntu（systemd）** 上把 `dist/rust-mqtt-consumer`
装成**开机自启、崩溃自愈、后台常驻**的系统服务，并覆盖日常运维、更新、回滚、
卸载与排障。所有命令在云服务器（x86_64）上执行。

> 目录里相关文件：
> - `rust-mqtt-consumer` —— x86-64 全静态二进制（可直接运行）
> - `.env.example` / `.env.debug.example` —— 配置模板（详注每个参数）
> - `run.sh` —— **前台**手动运行（首次验证/排障用）
> - `install-debian.sh` —— **一键**安装为 systemd 常驻服务（推荐）
> - `rust-mqtt-consumer.service` —— systemd 单元参考模板（手动安装时用）

---

## 0. 前置条件

| 项 | 要求 | 检查命令 |
|---|---|---|
| 架构 | x86_64 / amd64 | `uname -m` |
| 系统 | 带 systemd 的 Debian/Ubuntu | `systemctl --version` |
| 权限 | root 或可 sudo | `id -u` |
| 依赖服务 | MQTT Broker、InfluxDB 2.x 已就绪 | `curl -s http://127.0.0.1:8086/ping -I` |
| 可选工具 | curl（健康检查） | `command -v curl` |

> 二进制是**全静态**（static-pie，musl），不依赖服务器 glibc，拷过去即可跑。
> ⚠️ 该产物**不含 TLS**：只支持 `mqtt://` 明文 + `http://` InfluxDB。若你的
> Broker/InfluxDB 走 TLS，请按 [`../DEPLOY.md`](../DEPLOY.md) 路径 A/B 重编。

---

## 1. 方式 A：一键安装（推荐）

最省事。脚本会自动：创建专用系统用户 → 拷贝二进制到 `/opt` → 放置 `.env`
（**绝不覆盖已存在的**）→ 生成 systemd 单元 → 开机自启 → 立即启动 → 打印状态。

```bash
# 1) 拉取最新代码（含 dist 二进制）
cd ~/myWeb && git pull
cd rust-mqtt-backend/dist/

# 2) 先准备真实配置（二选一）
#    (a) 让脚本用模板占位，装完再编辑：跳过这步
#    (b) 现在就把真实 .env 放到 dist/（推荐，密钥不入 git）：
cp .env.example .env && chmod 600 .env && vim .env

# 3) 一键安装（需 root）
sudo ./install-debian.sh
```

安装脚本支持用环境变量覆盖默认值：

```bash
# 自定义安装目录 / 运行用户（用已存在用户则 CREATE_USER=no）
sudo INSTALL_DIR=/srv/rust-mqtt RUN_USER=yzluo CREATE_USER=no ./install-debian.sh

# 只安装+自启，但先不启动（想手动确认配置后再起）
sudo START=no ./install-debian.sh
```

| 变量 | 默认 | 说明 |
|---|---|---|
| `INSTALL_DIR` | `/opt/rust-mqtt-backend` | 安装目录（放二进制 + `.env`） |
| `RUN_USER` | `rustmqtt` | 运行用户；不存在则自动创建系统用户 |
| `SERVICE_NAME` | `rust-mqtt-consumer` | systemd 服务名 |
| `CREATE_USER` | `yes` | 是否创建用户；`no` 则要求用户已存在 |
| `ENABLE` | `yes` | 是否设置开机自启 |
| `START` | `yes` | 是否安装后立即启动 |

> 脚本**幂等**：可反复执行。二进制会被更新，已存在的 `.env`（含密钥）保留不动，
> 服务单元重写后 `daemon-reload` + `restart`。

装完若提示 `.env 里仍有 <占位符>`，先编辑再重启：

```bash
sudo vim /opt/rust-mqtt-backend/.env
sudo systemctl restart rust-mqtt-consumer
```

---

## 2. 方式 B：手动安装（理解每一步）

```bash
# --- 变量 ---
INSTALL_DIR=/opt/rust-mqtt-backend
RUN_USER=rustmqtt
SERVICE=rust-mqtt-consumer

# 1) 创建专用系统用户（无家目录、禁止登录，最小权限）
sudo useradd --system --no-create-home --shell /usr/sbin/nologin "$RUN_USER"

# 2) 安装目录 + 二进制
sudo mkdir -p "$INSTALL_DIR"
sudo install -m 0755 ./rust-mqtt-consumer "$INSTALL_DIR/rust-mqtt-consumer"

# 3) 配置文件（密钥，600 权限，属主为运行用户）
sudo cp .env.example "$INSTALL_DIR/.env"
sudo vim "$INSTALL_DIR/.env"                 # 填真实值，替换所有 <...>
sudo chown "$RUN_USER:$RUN_USER" "$INSTALL_DIR/.env"
sudo chmod 600 "$INSTALL_DIR/.env"

# 4) 安装 systemd 单元（用模板，先改里面的 User/Group 为 $RUN_USER）
sudo cp rust-mqtt-consumer.service /etc/systemd/system/$SERVICE.service
sudo sed -i "s/^User=.*/User=$RUN_USER/; s/^Group=.*/Group=$RUN_USER/" \
  /etc/systemd/system/$SERVICE.service

# 5) 加载 + 自启 + 启动
sudo systemctl daemon-reload
sudo systemctl enable --now $SERVICE
```

---

## 3. 验证是否成功

```bash
# 服务状态（应为 active (running)）
sudo systemctl status rust-mqtt-consumer --no-pager

# 实时日志（应看到「启动 rust-mqtt-backend」「已连接 MQTT Broker」「已订阅主题」）
sudo journalctl -u rust-mqtt-consumer -f

# 健康端点（端口见 .env 的 HEALTH_PORT，默认 9004）
curl -s http://localhost:9004/          # 服务信息 + 端点列表
curl -s http://localhost:9004/health    # {"status":"ok","mqtt":{"connected":true},...}
curl -s http://localhost:9004/stats     # 运行统计（uptime / mqtt / influx / dedup）
```

- `/health` 返回 `status:ok`（HTTP 200）表示 MQTT 已连接；
  若 `degraded`（HTTP 503）表示 MQTT 未连上，看日志排查。
- 三个端点都是**只读**，不改动任何状态。

---

## 4. 日常运维操作

```bash
sudo systemctl start    rust-mqtt-consumer   # 启动
sudo systemctl stop     rust-mqtt-consumer   # 停止（发 SIGTERM，程序优雅关闭：flush 缓冲后退出）
sudo systemctl restart  rust-mqtt-consumer   # 重启
sudo systemctl status   rust-mqtt-consumer   # 状态
sudo systemctl enable   rust-mqtt-consumer   # 开机自启
sudo systemctl disable  rust-mqtt-consumer   # 取消自启

# 日志
sudo journalctl -u rust-mqtt-consumer -f              # 实时跟随
sudo journalctl -u rust-mqtt-consumer -n 100          # 最近 100 行
sudo journalctl -u rust-mqtt-consumer --since "10 min ago"
sudo journalctl -u rust-mqtt-consumer -p err          # 只看 error 及以上
```

**改配置后必须重启**（程序只在启动时读 `.env`）：

```bash
sudo vim /opt/rust-mqtt-backend/.env
sudo systemctl restart rust-mqtt-consumer
```

---

## 5. 更新二进制（拉取新版本）

```bash
cd ~/myWeb && git pull                       # 取到新的 dist/rust-mqtt-consumer
cd rust-mqtt-backend/dist/
sudo ./install-debian.sh                     # 幂等：更新二进制 + 重启服务，.env 不动
# 或手动：
#   sudo install -m 0755 ./rust-mqtt-consumer /opt/rust-mqtt-backend/rust-mqtt-consumer
#   sudo systemctl restart rust-mqtt-consumer
```

---

## 6. 回滚到上一版

`git` 里保留了历史二进制，回退到上一个提交再重装即可：

```bash
cd ~/myWeb
git log --oneline -- rust-mqtt-backend/dist/rust-mqtt-consumer | head   # 找目标 commit
git checkout <上一个commit> -- rust-mqtt-backend/dist/rust-mqtt-consumer
cd rust-mqtt-backend/dist/
sudo ./install-debian.sh
git checkout main -- rust-mqtt-backend/dist/rust-mqtt-consumer          # 恢复工作区（可选）
```

> 建议每次更新前先备份：`sudo cp /opt/rust-mqtt-backend/rust-mqtt-consumer{,.bak}`，
> 回滚时 `sudo mv ...bak` 覆盖再 `systemctl restart` 亦可。

---

## 7. 卸载

```bash
sudo systemctl disable --now rust-mqtt-consumer      # 停止 + 取消自启
sudo rm -f /etc/systemd/system/rust-mqtt-consumer.service
sudo systemctl daemon-reload
sudo rm -rf /opt/rust-mqtt-backend                   # ⚠️ 会删掉 .env（含密钥），确认无需保留
sudo userdel rustmqtt                                # 删除专用用户（若安装时创建）
```

---

## 8. 与 Go/Bun 生产进程并行双跑（隔离）

想在同一台机器上让 Rust 版与既有 Go/Bun 版**同时跑、互不干扰**，用
`.env.debug.example` 的隔离三要素：

| 冲突点 | 隔离手段 | 生产 | 调试(Rust) |
|---|---|---|---|
| MQTT clientId | 不同 ID，避免 Broker 互踢 | `go-mqtt-consumer` | `rust-mqtt-consumer-debug` |
| InfluxDB bucket | 不同 bucket，避免数据混写 | 生产 bucket | 独立 debug bucket |
| 健康端口 | 不同端口，避免占用 | `9004` | `9005` |

```bash
cp .env.debug.example .env.debug && chmod 600 .env.debug && vim .env.debug
# 临时前台跑调试版：
./run.sh .env.debug
# 或装成第二个服务：
sudo INSTALL_DIR=/opt/rust-mqtt-debug SERVICE_NAME=rust-mqtt-debug \
     RUN_USER=rustmqttdebug ./install-debian.sh
```

---

## 9. 排障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动即退出，日志 `❌ 环境变量校验失败` 并列出缺失项 | `.env` 必填项为空/占位符没替换 | 编辑 `.env` 填真实值后 `restart` |
| `status=degraded`，`/health` 返回 503 | MQTT 没连上 | 查 `MQTT_URL`/账号密码；`journalctl` 看「MQTT 连接断开」；确认 Broker 在跑 |
| 日志有 `InfluxDB 写入失败` + status 4xx | token/org/bucket 错或无写权限 | 核对 `INFLUX_*`；`curl -I http://127.0.0.1:8086/ping` |
| `cannot execute binary file: Exec format error` | 机器不是 x86_64 | 换 x86_64 机器，或按 `../DEPLOY.md` 重编对应架构 |
| 端口被占用，服务起不来 | `HEALTH_PORT` 与别的进程冲突 | 改 `.env` 里的 `HEALTH_PORT` 后 restart；`ss -ltnp \| grep 9004` 查占用 |
| 服务反复重启 | 崩溃或配置错 | `journalctl -u rust-mqtt-consumer -n 200` 看退出原因 |
| 需要 TLS（mqtts/https） | dist 二进制不含 TLS | 按 `../DEPLOY.md` 路径 A/B 用默认特性重编 |

**先决排查三板斧：**

```bash
sudo systemctl status rust-mqtt-consumer --no-pager   # 1. 服务活着吗
sudo journalctl -u rust-mqtt-consumer -n 100 --no-pager  # 2. 日志说什么
curl -s http://localhost:9004/stats                   # 3. 内部状态如何
```

---

## 10. 附：程序行为要点（便于对照日志）

- **启动顺序**：加载 `.env` → 校验配置（失败一次性报全部缺失项并 `exit(1)`）→
  初始化日志 → 建 InfluxDB 写入器 → 连通性检查 → 去重器 → 连 MQTT 订阅 → 起健康端点。
- **数据流水线**：MQTT 收包 → JSON 解析 → 结构校验（须为非空 object）→ 去重 →
  提取 deviceId → 字段分类（黑名单跳过/白名单数值/tag/字符串/布尔）→ 时间戳归一化为纳秒 →
  组装 Line Protocol → 批量写 InfluxDB（batch=500 / flush=1s / retry=3）。
- **优雅关闭**：收到 `SIGINT`/`SIGTERM` → 停健康端点 → 停去重 → 断 MQTT →
  flush InfluxDB 缓冲 → 刷日志 → 打印 `👋 已安全退出`；5s 兜底强制退出。
- **日志**：结构化 JSON 打到 stdout，由 journald 收集；级别由 `LOG_LEVEL` 控制。

更完整的构建/部署说明见 [`../DEPLOY.md`](../DEPLOY.md) 与 [`../README.md`](../README.md)。
