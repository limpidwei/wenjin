#!/usr/bin/env bash
# 问津 Wenjin 一键安装（macOS / Linux）
# 用法: curl -fsSL https://raw.githubusercontent.com/limpidwei/wenjin/main/install.sh | bash
# 自定义目标: bash install.sh <技能目录>   （默认 ~/.claude/skills）
set -euo pipefail

TARGET="${1:-$HOME/.claude/skills}"
REPO="limpidwei/wenjin"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "正在下载 $REPO ..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" -o "$TMP/repo.tar.gz"
tar -xzf "$TMP/repo.tar.gz" -C "$TMP"

SRC="$TMP/wenjin-main"
[ -f "$SRC/SKILL.md" ] || { echo "下载内容不完整：未找到 SKILL.md" >&2; exit 1; }

mkdir -p "$TARGET"
rm -rf "$TARGET/wenjin"
cp -R "$SRC" "$TARGET/wenjin"

echo ""
echo "[OK] 问津（wenjin）已安装到 $TARGET/wenjin"
echo "研究主流程零依赖，装完即可用：对 Agent 说「深度调研 + 你的问题」。"
echo "（可选）HTML/PDF 出版链: cd \"$TARGET/wenjin\" && npm ci && ./node_modules/.bin/playwright install chromium"
