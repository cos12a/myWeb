#!/usr/bin/env bash
# ==========================================================================
#  rust-mqtt-consumer 前台运行加载脚本（dist 自包含版）
# ==========================================================================
#  作用：定位二进制 + 校验环境 + 加载 .env，在前台启动程序（Ctrl-C 优雅退出）。
#  用法：
#     ./run.sh                 # 默认加载同目录 .env
#     ./run.sh .env.debug      # 指定配置文件（调试）
#     ./run.sh /abs/path/.env  # 绝对路径亦可
#
#  说明：这是「前台/手动」运行方式，适合首次验证与排障。
#        生产环境请改用 systemd 常驻（见 install-debian.sh / INSTALL-DEBIAN.md）。
# ==========================================================================
set -euo pipefail

# --- 解析脚本所在目录（无论从哪里调用都能定位到二进制）---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${SCRIPT_DIR}/rust-mqtt-consumer"

# --- 配置文件：第 1 个参数，缺省用同目录 .env ---
ENV_ARG="${1:-${SCRIPT_DIR}/.env}"
# 相对路径按脚本目录解析
case "${ENV_ARG}" in
  /*) ENV_FILE="${ENV_ARG}" ;;
  *)  ENV_FILE="${SCRIPT_DIR}/${ENV_ARG}" ;;
esac

log()  { printf '[run.sh] %s\n' "$*"; }
die()  { printf '[run.sh] ✖ %s\n' "$*" >&2; exit 1; }

# --- 1) 二进制存在且可执行 ---
[[ -f "${BIN}" ]] || die "找不到二进制：${BIN}"
[[ -x "${BIN}" ]] || chmod +x "${BIN}" 2>/dev/null || die "二进制不可执行且无法 chmod：${BIN}"

# --- 2) 架构匹配检查（dist 产物是 x86-64；不匹配则明确报错）---
ARCH="$(uname -m)"
if [[ "${ARCH}" != "x86_64" && "${ARCH}" != "amd64" ]]; then
  die "本二进制是 x86-64，但当前机器是 ${ARCH}，无法运行。请在 x86_64 机器上部署，或按 ../DEPLOY.md 重编对应架构。"
fi

# --- 3) 配置文件检查 ---
if [[ ! -f "${ENV_FILE}" ]]; then
  die "配置文件不存在：${ENV_FILE}
   请先复制模板并填入真实值：
     cp '${SCRIPT_DIR}/.env.example' '${ENV_FILE}' && chmod 600 '${ENV_FILE}' && vim '${ENV_FILE}'"
fi
# 权限过宽时提醒（含密钥，建议 600）
PERM="$(stat -c '%a' "${ENV_FILE}" 2>/dev/null || echo '???')"
if [[ "${PERM}" != "600" && "${PERM}" != "400" ]]; then
  log "⚠️  ${ENV_FILE} 权限为 ${PERM}，含密钥建议收紧：chmod 600 '${ENV_FILE}'"
fi
# 仍有未替换的 <占位符> 时提醒（不阻断，交给程序做必填校验）
if grep -Eq '=<[^>]+>' "${ENV_FILE}"; then
  log "⚠️  ${ENV_FILE} 里仍有未替换的 <占位符>，程序会因必填项为空而 exit(1)："
  grep -En '=<[^>]+>' "${ENV_FILE}" | sed 's/^/       /'
fi

# --- 4) 前台启动（exec 让信号直达程序，Ctrl-C 触发优雅关闭）---
log "启动：${BIN} --env-file=${ENV_FILE}"
log "（前台运行，Ctrl-C 优雅退出；健康端点见 .env 里的 HEALTH_PORT）"
exec "${BIN}" --env-file="${ENV_FILE}"
