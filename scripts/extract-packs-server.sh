#!/usr/bin/env bash
# 在服务器上把所有已部署的 pack ZIP 解压到同目录，让截图/文档单文件可直接访问。
# 解决「文件列在 packs-index、点开却 404」的 gap：
#   /packs/<slug>/<slug>-design-pack.zip  ← ZIP（已有）
#   /packs/<slug>/02_desktop_hero.png     ← 解压后才能直接访问（SEO 富页画廊需要）
#
# 幂等：已解压的文件 unzip -n 跳过，ZIP 本身保留。
# 用法：bash scripts/extract-packs-server.sh
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-43.159.171.3}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/opendesign.cc}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=publickey,keyboard-interactive,password)

echo "▸ 在服务器上解压所有 pack ZIP → /packs/<slug>/"
echo "  (幂等：已解压文件跳过，ZIP 保留)"
echo ""

ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" bash <<'REMOTE'
set -euo pipefail
PACKS_DIR="/var/www/opendesign.cc/packs"
ok=0; skip=0; fail=0

for zip in "$PACKS_DIR"/*/*.zip; do
  [[ -f "$zip" ]] || continue
  dir="$(dirname "$zip")"
  slug="$(basename "$dir")"
  # 检查是否已有截图文件（说明已解压）
  if ls "$dir"/*.png 2>/dev/null | head -1 | grep -q .; then
    skip=$((skip+1)); continue
  fi
  echo "  解压 $slug"
  if sudo unzip -n -q "$zip" -d "$dir" 2>/dev/null; then
    sudo chown -R www-data:www-data "$dir" 2>/dev/null || true
    ok=$((ok+1))
  else
    echo "    ✗ 解压失败: $zip"; fail=$((fail+1))
  fi
done

echo ""
echo "✓ 解压完成 · 新解压 $ok · 已跳过 $skip · 失败 $fail"
echo "  已有文件数: $(find "$PACKS_DIR" -name "*.png" | wc -l) PNG · $(find "$PACKS_DIR" -name "*.md" | wc -l) MD"
REMOTE
