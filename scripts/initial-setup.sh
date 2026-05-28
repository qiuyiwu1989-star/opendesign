#!/usr/bin/env bash
# 一次性服务器初始化：创建目录 / 装 nginx 配置 / 跑 certbot
# 用法（本地）: ./scripts/initial-setup.sh
# 完成后正常用 ./scripts/deploy.sh 增量推送
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_HOST="${DEPLOY_HOST:-43.159.171.3}"
DOMAIN="${DOMAIN:-opendesign.cc}"
DEPLOY_PATH="/var/www/${DOMAIN}"
NGINX_CONF_LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/deploy/nginx-${DOMAIN}.conf"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=publickey,keyboard-interactive,password)

if [[ ! -f "${NGINX_CONF_LOCAL}" ]]; then
  echo "✕ nginx 配置文件不存在: ${NGINX_CONF_LOCAL}" >&2
  exit 1
fi

echo "▸ 上传 nginx 配置到 ${DEPLOY_HOST}"
scp "${SSH_OPTS[@]}" "${NGINX_CONF_LOCAL}" "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/${DOMAIN}.conf"

echo "▸ 在服务器上执行初始化"
ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "
  set -e

  echo '  → 装依赖（如未安装）'
  sudo apt-get update -qq
  sudo apt-get install -y -qq nginx certbot python3-certbot-nginx

  echo '  → 创建 web root'
  sudo mkdir -p '${DEPLOY_PATH}'
  sudo chown -R www-data:www-data '${DEPLOY_PATH}'

  echo '  → 放置占位首页'
  if [ ! -f '${DEPLOY_PATH}/index.html' ]; then
    echo '<h1>${DOMAIN} ready, run deploy.sh next</h1>' | sudo tee '${DEPLOY_PATH}/index.html' >/dev/null
    sudo chown www-data:www-data '${DEPLOY_PATH}/index.html'
  fi

  echo '  → 安装 nginx site'
  sudo mv '/tmp/${DOMAIN}.conf' '/etc/nginx/sites-available/${DOMAIN}'
  sudo ln -sf '/etc/nginx/sites-available/${DOMAIN}' '/etc/nginx/sites-enabled/${DOMAIN}'

  echo '  → 测试 nginx 配置'
  sudo nginx -t

  echo '  → 重载 nginx'
  sudo systemctl reload nginx

"

echo ""
echo "✓ 初始化完成"
echo ""
echo "下一步："
echo "  1. 确认 DNS 已生效（apex + www 都要）"
echo "       dig +short ${DOMAIN}        应返回 ${DEPLOY_HOST}"
echo "       dig +short www.${DOMAIN}    应返回 ${DEPLOY_HOST}"
echo "  2. 申请 HTTPS 证书："
echo "       ssh ubuntu@${DEPLOY_HOST} 'sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN} --non-interactive --agree-tos -m hi@${DOMAIN} --redirect'"
echo "  3. 推送站点：./scripts/deploy.sh"
