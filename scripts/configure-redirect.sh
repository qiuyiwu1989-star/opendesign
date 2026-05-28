#!/usr/bin/env bash
# 把服务器上 style.qiuyiwu.com 的 nginx config 换成 301 跳转到 opendesign.cc
# 用法: ./scripts/configure-redirect.sh
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_HOST="${DEPLOY_HOST:-43.159.171.3}"
CONF_LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy/nginx-style.qiuyiwu.com-redirect.conf"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=publickey,keyboard-interactive,password)

if [[ ! -f "${CONF_LOCAL}" ]]; then
  echo "✕ redirect config 不存在: ${CONF_LOCAL}" >&2
  exit 1
fi

echo "▸ 上传 redirect 配置"
scp "${SSH_OPTS[@]}" "${CONF_LOCAL}" "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/style-redirect.conf"

echo "▸ 备份原配置 + 替换 + reload"
ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "
  set -e
  sudo cp /etc/nginx/sites-available/style.qiuyiwu.com /etc/nginx/sites-available/style.qiuyiwu.com.bak.\$(date +%Y%m%d-%H%M%S)
  sudo mv /tmp/style-redirect.conf /etc/nginx/sites-available/style.qiuyiwu.com
  sudo nginx -t
  sudo systemctl reload nginx
"

echo ""
echo "✓ Done. 验证:"
echo "  curl -sI https://style.qiuyiwu.com/  应返回 301 + Location: https://opendesign.cc/"
