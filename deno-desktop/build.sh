#!/usr/bin/env bash
# deno-desktop 构建脚本：用 deno compile 把「Hono 服务 + 静态资源」编译成独立可执行文件。
#
# 用法：
#   ./build.sh                      # 编译当前平台（产物 bin/deno-desktop）
#   ./build.sh <target-triple>      # 交叉编译到指定平台，例如：
#       ./build.sh x86_64-unknown-linux-gnu
#       ./build.sh x86_64-pc-windows-msvc     # 产物自动加 .exe
#       ./build.sh aarch64-apple-darwin
#
# 说明：
#   编译产物为「可执行文件 + 同级 static/ 资源目录」的桌面应用形态；
#   main.ts 会基于可执行文件位置解析 static 绝对路径，故从任意目录启动均可用；
#   --allow-* 权限在编译期固化，运行时无需再加参数；
#   交叉编译时 Deno 会自动下载对应目标平台的运行时。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

command -v deno >/dev/null 2>&1 || {
  echo "❌ 未找到 deno，请先安装或执行： source /root/.deno/env" >&2
  exit 1
}

TARGET="${1:-}"
COMMON=(--allow-net --allow-read --allow-env --allow-run)
mkdir -p bin

if [[ -z "${TARGET}" ]]; then
  OUT="bin/deno-desktop"
  echo "▶ 编译当前平台 → ${OUT}"
  deno compile "${COMMON[@]}" --output "${OUT}" desktop.ts
else
  OUT="bin/deno-desktop-${TARGET}"
  [[ "${TARGET}" == *windows* ]] && OUT="${OUT}.exe"
  echo "▶ 交叉编译 ${TARGET} → ${OUT}"
  deno compile "${COMMON[@]}" --target "${TARGET}" --output "${OUT}" desktop.ts
fi

echo ""
echo "✅ 构建完成："
ls -lh "${OUT}"
file "${OUT}" 2>/dev/null || true
echo ""
echo "📦 分发提示：把可执行文件与同级 static/ 目录一起拷贝即可（见 README）。"
