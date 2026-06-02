#!/usr/bin/env bash
# IndexNow 提交（Bing / Yandex / DuckDuckGo 等一次覆盖，无每日小配额）
# 把 sitemap 里的全部 URL 提交给 IndexNow。
#
# 前置：密钥文件已部署在站点根 https://opendesign.cc/<key>.txt（内容 = key）
#       key 存在 deploy/indexnow.key
# 用法：bash scripts/indexnow.sh [sitemap.xml]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="${ROOT}/deploy/indexnow.key"
HOST="${INDEXNOW_HOST:-opendesign.cc}"
SITEMAP="${1:-${ROOT}/sitemap.xml}"

[[ -f "$KEY_FILE" ]] || { echo "✗ 缺 ${KEY_FILE}（IndexNow 密钥）"; exit 1; }
[[ -f "$SITEMAP" ]]  || { echo "✗ 找不到 $SITEMAP"; exit 1; }
KEY="$(cat "$KEY_FILE")"

python3 - "$KEY" "$HOST" "$SITEMAP" > /tmp/indexnow.json <<'PY'
import json, re, sys
key, host, sm_path = sys.argv[1], sys.argv[2], sys.argv[3]
urls = re.findall(r"<loc>([^<]+)</loc>", open(sm_path, encoding="utf-8").read())
print(json.dumps({
    "host": host, "key": key,
    "keyLocation": f"https://{host}/{key}.txt",
    "urlList": urls,
}))
PY

N=$(python3 -c "import json;print(len(json.load(open('/tmp/indexnow.json'))['urlList']))")
echo "▸ 提交 ${N} 条 URL → IndexNow（host=${HOST}）"
code=$(curl -s -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data @/tmp/indexnow.json -w "%{http_code}" -o /tmp/indexnow.resp)
echo "  HTTP ${code}  $(cat /tmp/indexnow.resp)"
case "$code" in
  200|202) echo "  ✓ 已接受" ;;
  403) echo "  ⚠ 密钥验证未完成，过几分钟再跑一次本脚本" ;;
  *) echo "  ✗ 失败，看上面响应" ;;
esac
