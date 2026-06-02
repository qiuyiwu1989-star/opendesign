#!/usr/bin/env bash
# 百度搜索资源平台 · 主动推送（加速收录）
# 把 sitemap 里的全部 URL 一次性推给百度。
#
# 用法：
#   BAIDU_PUSH_TOKEN=你的token bash scripts/baidu_push.sh [sitemap.xml]
#
# 注：token 是准入密钥，走环境变量，**不要写进代码 / 提交 git**。
set -euo pipefail

TOKEN="${BAIDU_PUSH_TOKEN:-}"
SITE="${BAIDU_SITE:-https://opendesign.cc}"
SITEMAP="${1:-sitemap.xml}"

[[ -z "$TOKEN" ]] && { echo "✗ 先 export BAIDU_PUSH_TOKEN=你的token"; exit 1; }
[[ -f "$SITEMAP" ]] || { echo "✗ 找不到 $SITEMAP（先跑 build.py 生成）"; exit 1; }

# 从 sitemap 抽取全部 <loc> URL
grep -oE '<loc>[^<]+</loc>' "$SITEMAP" | sed 's#<loc>##; s#</loc>##' > /tmp/baidu_urls.txt
N=$(wc -l < /tmp/baidu_urls.txt | tr -d ' ')
echo "▸ 推送 ${N} 条 URL → 百度（site=${SITE}）..."

curl -s -H 'Content-Type:text/plain' --data-binary @/tmp/baidu_urls.txt \
  "http://data.zz.baidu.com/urls?site=${SITE}&token=${TOKEN}"
echo ""
echo "  字段说明：success=成功推送数 · remain=今日剩余配额 · not_same_site/not_valid=被丢弃的"
