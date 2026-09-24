#!/usr/bin/env bash
# ==========================================================================
#  rust-mqtt-consumer — Debian/Ubuntu 一键安装为常驻服务（systemd）
# ==========================================================================
#  作用：把 dist 里的二进制安装到系统目录，创建专用运行用户，生成并启用
#        systemd 服务，实现「开机自启 + 崩溃自愈 + 后台常驻」。
#
#  用法（需 root）：
#     sudo ./install-debian.sh
#
#  可选覆盖（环境变量）：
#     INSTALL_DIR   安装目录        默认 /opt/rust-mqtt-backend
#     RUN_USER      运行用户        默认 rustmqtt（不存在则自动创建系统用户）
#     SERVICE_NAME  systemd 服务名  默认 rust-mqtt-consumer
#     CREATE_USER   是否创建用户    默认 yes（设 no 则用已存在用户）
#     ENABLE        是否开机自启    默认 yes
#     START         是否立即启动    默认 yes
#  例：
#     sudo INSTALL_DIR=/srv/mqtt RUN_USER=yzluo CREATE_USER=no ./install-debian.sh
#
#  幂等：可重复执行——二进制会被更新，已存在的 .env（含密钥）绝不被覆盖，
#        服务单元会重写并 daemon-reload + restart。
# ==========================================================================
set -euo pipefail

# ---------- 可配置项 ----------
INSTALL_DIR="${INSTALL_DIR:-/opt/rust-mqtt-backend}"
RUN_USER="${RUN_USER:-rustmqtt}"
SERVICE_NAME="${SERVICE_NAME:-rust-mqtt-consumer}"
CREATE_USER="${CREATE_USER:-yes}"
ENABLE="${ENABLE:-yes}"
START="${START:-yes}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_SRC="${SCRIPT_DIR}/rust-mqtt-consumer"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

log()  { printf '\033[1;32m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install] ⚠️  %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m[install] ✖ %s\033[0m\n' "$*" >&2; exit 1; }

# ---------- 0) 前置检查 ----------
[[ "$(id -u)" -eq 0 ]] || die "请用 root 运行：sudo ./install-debian.sh"
command -v systemctl >/dev/null 2>&1 || die "未找到 systemctl，本脚本仅适用于 systemd 系统（Debian/Ubuntu 等）"

ARCH="$(uname -m)"
[[ "${ARCH}" == "x86_64" || "${ARCH}" == "amd64" ]] \
  || die "dist 二进制是 x86-64，但本机是 ${ARCH}。请在 x86_64 机器安装，或按 ../DEPLOY.md 重编。"

[[ -f "${BIN_SRC}" ]] || die "找不到二进制：${BIN_SRC}"

# ---------- 1) 创建运行用户（专用系统用户，无登录权限）----------
if [[ "${CREATE_USER}" == "yes" ]]; then
  if id "${RUN_USER}" >/dev/null 2>&1; then
    log "运行用户已存在：${RUN_USER}"
  else
    log "创建系统用户：${RUN_USER}（无家目录、禁止登录）"
    useradd --system --no-create-home --shell /usr/sbin/nologin "${RUN_USER}"
  fi
else
  id "${RUN_USER}" >/dev/null 2>&1 || die "CREATE_USER=no 但用户 ${RUN_USER} 不存在"
  log "使用已存在用户：${RUN_USER}"
fi

# ---------- 2) 安装目录 + 二进制 ----------
log "安装目录：${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
install -m 0755 "${BIN_SRC}" "${INSTALL_DIR}/rust-mqtt-consumer"
log "已安装二进制：${INSTALL_DIR}/rust-mqtt-consumer"

# ---------- 3) 配置文件 .env（绝不覆盖已存在的）----------
ENV_DST="${INSTALL_DIR}/.env"
if [[ -f "${ENV_DST}" ]]; then
  log "已存在配置，保留不动（含密钥）：${ENV_DST}"
else
  if [[ -f "${SCRIPT_DIR}/.env" ]]; then
    log "从 dist/.env 复制配置"
    install -m 0600 "${SCRIPT_DIR}/.env" "${ENV_DST}"
  else
    warn "未找到真实 .env，先用模板占位（安装后务必编辑填真实值！）"
    install -m 0600 "${SCRIPT_DIR}/.env.example" "${ENV_DST}"
  fi
fi
chown "${RUN_USER}:${RUN_USER}" "${ENV_DST}"
chmod 600 "${ENV_DST}"
if grep -Eq '=<[^>]+>' "${ENV_DST}"; then
  warn "${ENV_DST} 里仍有 <占位符>，服务会因必填项为空而启动失败。请编辑："
  warn "    sudo vim ${ENV_DST}"
fi

# ---------- 4) 生成 systemd 单元 ----------
log "写入服务单元：${UNIT_PATH}"
cat > "${UNIT_PATH}" <<UNIT
[Unit]
Description=Rust MQTT Consumer (rust-mqtt-backend)
Documentation=https://github.com/cos12a/myWeb
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
Group=${RUN_USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${INSTALL_DIR}/rust-mqtt-consumer --env-file=${ENV_DST}
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
KillSignal=SIGTERM
TimeoutStopSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
UNIT

# ---------- 5) 加载 + 自启 + 启动 ----------
log "systemctl daemon-reload"
systemctl daemon-reload

if [[ "${ENABLE}" == "yes" ]]; then
  log "设置开机自启：systemctl enable ${SERVICE_NAME}"
  systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
fi

if [[ "${START}" == "yes" ]]; then
  log "启动/重启服务：systemctl restart ${SERVICE_NAME}"
  systemctl restart "${SERVICE_NAME}"
  sleep 2
  echo
  log "当前状态："
  systemctl --no-pager --lines=0 status "${SERVICE_NAME}" || true
fi

# ---------- 6) 收尾提示 ----------
HEALTH_PORT="$(grep -E '^HEALTH_PORT=' "${ENV_DST}" 2>/dev/null | head -1 | cut -d= -f2 || true)"
HEALTH_PORT="${HEALTH_PORT:-9004}"
cat <<TIPS

==========================================================================
 ✅ 安装完成
--------------------------------------------------------------------------
 服务名    : ${SERVICE_NAME}
 安装目录  : ${INSTALL_DIR}
 运行用户  : ${RUN_USER}
 配置文件  : ${ENV_DST}  (chmod 600)
 服务单元  : ${UNIT_PATH}

 常用操作：
   查看状态 : sudo systemctl status ${SERVICE_NAME}
   实时日志 : sudo journalctl -u ${SERVICE_NAME} -f
   重启     : sudo systemctl restart ${SERVICE_NAME}
   停止     : sudo systemctl stop ${SERVICE_NAME}
   取消自启 : sudo systemctl disable ${SERVICE_NAME}
   健康检查 : curl -s http://localhost:${HEALTH_PORT}/health

 详细运维手册见同目录 INSTALL-DEBIAN.md
==========================================================================
TIPS
