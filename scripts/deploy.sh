#!/usr/bin/env bash
# 增量部署：把静态站推到 style.qiuyiwu.com
# 用法: ./scripts/deploy.sh
# 覆盖默认值: DEPLOY_USER=other ./scripts/deploy.sh
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_HOST="${DEPLOY_HOST:-43.159.171.3}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/opendesign.cc}"
DEPLOY_URL="${DEPLOY_URL:-https://opendesign.cc}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=publickey,keyboard-interactive,password)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="/tmp/opendesign-deploy.tar.gz"

# 网站运行所需的全部前端资源（注意：sites.js / supabase-config.js 是必须的）
FILES=(
  index.html
  styles.css
  app.js
  i18n.js
  sites.js
  sites-specs.json
  sites-i18n.json
  supabase-config.js
  favicon.svg
  og-cover.png
  sitemap.xml
  robots.txt
  llms.txt
  packs-index.json
)

echo "▸ Packing files for ${DEPLOY_URL}"
for f in "${FILES[@]}"; do
  if [[ ! -f "${ROOT_DIR}/${f}" ]]; then
    echo "  ✕ missing: ${f}" >&2
    exit 1
  fi
  echo "  • ${f}"
done

tar --no-xattrs --disable-copyfile -czf "${ARCHIVE}" -C "${ROOT_DIR}" "${FILES[@]}"

echo "▸ Uploading to ${DEPLOY_USER}@${DEPLOY_HOST}"
scp "${SSH_OPTS[@]}" "${ARCHIVE}" "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/opendesign-deploy.tar.gz"

echo "▸ Extracting on server"
ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "
  sudo mkdir -p '${DEPLOY_PATH}' &&
  sudo tar -xzf /tmp/opendesign-deploy.tar.gz -C '${DEPLOY_PATH}' &&
  sudo chown -R www-data:www-data '${DEPLOY_PATH}' &&
  sudo find '${DEPLOY_PATH}' -name '._*' -delete &&
  rm /tmp/opendesign-deploy.tar.gz
"

rm "${ARCHIVE}"

echo ""
echo "✓ Done. Visit: ${DEPLOY_URL}"
