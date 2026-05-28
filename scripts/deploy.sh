#!/usr/bin/env bash
# 增量部署：把 OpenDesign 静态站推到生产
# 用法: ./scripts/deploy.sh
#       SKIP_BUILD=1 ./scripts/deploy.sh    # 不重跑 build.py
#       SKIP_SEO=1 ./scripts/deploy.sh      # 跳过 SEO 静态页（debug 用）
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_HOST="${DEPLOY_HOST:-43.159.171.3}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/opendesign.cc}"
DEPLOY_URL="${DEPLOY_URL:-https://opendesign.cc}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=publickey,keyboard-interactive,password)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="/tmp/opendesign-deploy.tar.gz"

# Step 1: build dist/（可跳过加速调试）
if [[ -z "${SKIP_BUILD:-}" ]]; then
  echo "▸ Building dist/"
  python3 "${ROOT_DIR}/scripts/build.py"
fi

# Step 2: build.py 出的 legacy 三件套同步回根目录（前端目前还读根目录）
echo "▸ Sync built legacy files → root"
cp "${ROOT_DIR}/dist/legacy/sites.js"          "${ROOT_DIR}/sites.js"
cp "${ROOT_DIR}/dist/legacy/sites-specs.json"  "${ROOT_DIR}/sites-specs.json"
cp "${ROOT_DIR}/dist/legacy/sites-i18n.json"   "${ROOT_DIR}/sites-i18n.json"
cp "${ROOT_DIR}/dist/sitemap.xml"              "${ROOT_DIR}/sitemap.xml"

# 网站运行所需的前端资源
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

echo "▸ Packing files"
MANIFEST=()
for f in "${FILES[@]}"; do
  if [[ ! -f "${ROOT_DIR}/${f}" ]]; then
    echo "  ✕ missing: ${f}" >&2
    exit 1
  fi
  echo "  • ${f}"
  MANIFEST+=("${f}")
done

# 把 dist/seo/ 内容也加进去（5000 个静态 HTML 给 SEO 用）
if [[ -z "${SKIP_SEO:-}" && -d "${ROOT_DIR}/dist/seo" ]]; then
  echo "  • dist/seo (multilang static pages)"
  MANIFEST+=("dist/seo")
fi

tar --no-xattrs --disable-copyfile -czf "${ARCHIVE}" -C "${ROOT_DIR}" "${MANIFEST[@]}"

echo "▸ Uploading to ${DEPLOY_USER}@${DEPLOY_HOST}"
scp "${SSH_OPTS[@]}" "${ARCHIVE}" "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/opendesign-deploy.tar.gz"

echo "▸ Extracting on server"
ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "
  sudo mkdir -p '${DEPLOY_PATH}' &&
  sudo tar -xzf /tmp/opendesign-deploy.tar.gz -C '${DEPLOY_PATH}' &&
  if [[ -d '${DEPLOY_PATH}/dist/seo' ]]; then
    # 把 dist/seo/<lang>/ 内容铺到 <DEPLOY_PATH>/<lang>/ 让 nginx 直接 serve
    for lang in en zh-CN zh-TW ja ko; do
      if [[ -d '${DEPLOY_PATH}/dist/seo/'\$lang ]]; then
        sudo mkdir -p '${DEPLOY_PATH}/'\$lang &&
        sudo cp -r '${DEPLOY_PATH}/dist/seo/'\$lang'/'* '${DEPLOY_PATH}/'\$lang'/'
      fi
    done
  fi &&
  sudo chown -R www-data:www-data '${DEPLOY_PATH}' &&
  sudo find '${DEPLOY_PATH}' -name '._*' -delete &&
  rm /tmp/opendesign-deploy.tar.gz
"

rm "${ARCHIVE}"

echo ""
echo "✓ Done. Visit:"
echo "   SPA:    ${DEPLOY_URL}"
echo "   SEO en: ${DEPLOY_URL}/en/sites/apple"
echo "   SEO ja: ${DEPLOY_URL}/ja/sites/apple"
