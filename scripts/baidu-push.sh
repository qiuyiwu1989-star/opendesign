#!/usr/bin/env bash
# 百度站长平台主动推送 —— 加速百度收录新加的条目
# 用法: ./scripts/baidu-push.sh
#
# 一次性准备（首次跑前）：
#   1. 去 https://ziyuan.baidu.com → 添加网站 opendesign.cc → 验证（HTML 文件 / CNAME 任选）
#   2. 进入站点 → 普通收录 → API 提交 → 复制完整的 token，形如 abc123def456
#   3. 把 token 填进下面 BAIDU_TOKEN 变量，或写进 .env
set -euo pipefail

BAIDU_TOKEN="${BAIDU_TOKEN:-填你的百度站长 token}"
SITE="opendesign.cc"

if [[ "$BAIDU_TOKEN" == *"填你的"* ]]; then
  echo "✕ 还没填 BAIDU_TOKEN"
  echo "  先去 https://ziyuan.baidu.com 验证站点，拿到 token 后："
  echo "    export BAIDU_TOKEN=你拿到的token"
  echo "    ./scripts/baidu-push.sh"
  exit 1
fi

# 把所有 site 详情页 URL 凑一起推
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URLS=$(node -e "
const vm = require('vm');
const fs = require('fs');
const code = fs.readFileSync('$ROOT/sites.js', 'utf8');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
ctx.window.STYLE_ATLAS_SITES.forEach(s => console.log('https://$SITE/#/sites/' + s.id));
")

# 主页 + 主要 view 也带上
URLS="https://$SITE/
https://$SITE/#/library
https://$SITE/#/about
$URLS"

count=$(echo "$URLS" | wc -l | tr -d ' ')
echo "▸ 推送 $count 个 URL 到百度"

RESPONSE=$(curl -s -X POST -H 'Content-Type:text/plain' \
  --data-binary "$URLS" \
  "http://data.zz.baidu.com/urls?site=$SITE&token=$BAIDU_TOKEN")

echo "▸ 百度响应:"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""
echo "字段说明："
echo "  success    本次成功推送数"
echo "  remain     今日剩余配额（每日 500-2000 个）"
echo "  not_same_site 域名不匹配（应为 0）"
echo "  not_valid     URL 格式不合法（应为 0）"
