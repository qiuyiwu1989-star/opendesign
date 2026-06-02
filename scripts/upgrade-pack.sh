#!/usr/bin/env bash
# 把任意作品升级成 grounded 完整设计系统包（Tier 2 · 对标 apple-design-pack）。
# 一条命令：Playwright 提取真页面 → mimo 处理 → 打包带截图 ZIP → 写 packs-index → 部署。
#
# 用法：
#   export ANTHROPIC_API_KEY=<mimo key>
#   export ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
#   export ANTHROPIC_MODEL=mimo-v2.5
#   bash scripts/upgrade-pack.sh <slug> <url> [extract_dirname]
#
# 例：bash scripts/upgrade-pack.sh vercel https://vercel.com
#     bash scripts/upgrade-pack.sh stripe-press https://press.stripe.com press-stripe-com
set -euo pipefail

SLUG="${1:-}"
URL="${2:-}"
EXNAME="${3:-$SLUG}"          # extract 目录名，默认 = slug
if [[ -z "$SLUG" || -z "$URL" ]]; then
  echo "用法: bash scripts/upgrade-pack.sh <slug> <url> [extract_dirname]"; exit 1
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "✗ 先 export ANTHROPIC_API_KEY（+ ANTHROPIC_BASE_URL / ANTHROPIC_MODEL）"; exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXDIR="extract/extracts/${EXNAME}"
ZIP="extract/extracts/${SLUG}-design-pack.zip"
DEPLOY_HOST="${DEPLOY_HOST:-43.159.171.3}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=publickey,keyboard-interactive,password)
cd "$ROOT"

# SKIP_MIMO=1：该站已 grounded，只重打包 + 部署（不重抓、不重跑 mimo）
if [[ -z "${SKIP_MIMO:-}" ]]; then
  echo "▸ [1/6] Playwright 提取真页面 → ${EXDIR}"
  if [[ -f "${EXDIR}/summary.json" ]]; then
    echo "    （已存在 ${EXDIR}/summary.json，跳过提取。删掉该目录可强制重抓）"
  else
    python3 extract/extract.py "$URL" --out "$EXDIR"
  fi

  echo "▸ [2/6] mimo 处理真实提取 → grounded sites/${SLUG}.json"
  python3 scripts/ingest.py --from-extract "$EXDIR" --slug "$SLUG"
  # mimo 没成功完成（漏字段等）→ 还原该站，干净退出，绝不留 spec=None 的坏状态
  STATUS=$(python3 -c "import json;print(json.load(open('sites/${SLUG}.json')).get('status',''))")
  if [[ "$STATUS" != "completed" ]]; then
    echo "  ✗ mimo 未完成（status=${STATUS}）。还原 sites/${SLUG}.json，跳过此站。"
    git checkout "sites/${SLUG}.json" 2>/dev/null || true
    exit 2
  fi
else
  echo "▸ [1-2/6] SKIP_MIMO：跳过提取 + mimo，直接重打包已 grounded 的 ${SLUG}"
fi

echo "▸ [3/6] 校验（只校本站，避免被其它坏站连累）+ build"
# mimo 完成但产出 schema 不合法 → 还原该站、干净退出，绝不留坏数据
if ! python3 scripts/validate-sites.py --strict "$SLUG"; then
  echo "  ✗ ${SLUG} schema 校验失败。还原 sites/${SLUG}.json，跳过此站。"
  git checkout "sites/${SLUG}.json" 2>/dev/null || true
  exit 3
fi
python3 scripts/build.py >/dev/null

echo "▸ [4/6] 把 grounded 文档写进 extract 目录 + 打包 ZIP"
if [[ -f "dist/packs/${SLUG}/DESIGN_SPEC.en.md" ]]; then
  cp "dist/packs/${SLUG}/DESIGN_SPEC.en.md" "${EXDIR}/DESIGN_SPEC.md"
fi
python3 - "$SLUG" "$EXDIR" <<'PY'
import json, sys, pathlib
slug, exd = sys.argv[1], pathlib.Path(sys.argv[2])
d = json.load(open(f"sites/{slug}.json", encoding="utf-8"))
spec = dict(d.get("spec") or {})
en = d.get("spec_i18n", {}).get("en", {})
for k, v in en.items():
    if k not in spec or not spec.get(k): spec[k] = v
    elif isinstance(spec.get(k), dict) and isinstance(v, dict): spec[k] = {**v, **spec[k]}
entry = {"id": d["id"], "title": d["title"], "url": d["url"], "tags": d.get("tags", []), **spec}
(exd / "sites-entry.json").write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
print("  ✓ sites-entry.json 写入")
PY
bash extract/pack.sh "$EXDIR" "${SLUG}-design-pack.zip" >/dev/null
echo "  ✓ ${ZIP} ($(ls -lh "$ZIP" | awk '{print $5}'))"

echo "▸ [5/6] 写 packs-index.json 条目（让前端显示「下载完整包」）+ 重新 build manifest"
python3 scripts/pack_index_entry.py "$SLUG" "$EXDIR" "$ZIP"
python3 scripts/build.py >/dev/null

echo "▸ [6/6] 部署：ZIP → /packs/${SLUG}/ + 推 grounded 文档/SEO"
if [[ -n "${LOCAL_DEPLOY:-}" ]]; then
  # 脚本就跑在 web 服务器上（job runner）→ 本机 cp，不 scp
  sudo mkdir -p "/var/www/opendesign.cc/packs/${SLUG}"
  sudo cp "$ZIP" "/var/www/opendesign.cc/packs/${SLUG}/${SLUG}-design-pack.zip"
  sudo chown www-data:www-data "/var/www/opendesign.cc/packs/${SLUG}/${SLUG}-design-pack.zip"
else
  scp "${SSH_OPTS[@]}" "$ZIP" "${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/${SLUG}-design-pack.zip"
  ssh "${SSH_OPTS[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" \
    "sudo mkdir -p /var/www/opendesign.cc/packs/${SLUG} && \
     sudo mv /tmp/${SLUG}-design-pack.zip /var/www/opendesign.cc/packs/${SLUG}/${SLUG}-design-pack.zip && \
     sudo chown www-data:www-data /var/www/opendesign.cc/packs/${SLUG}/${SLUG}-design-pack.zip"
fi
SKIP_SEO=1 bash scripts/deploy.sh >/dev/null

echo ""
echo "✓ 完成。${SLUG} 现在是 Tier-2 grounded 完整包："
echo "   折叠页:  https://opendesign.cc/packs/${SLUG}/"
echo "   清单:    https://opendesign.cc/packs/${SLUG}/manifest.json"
echo "   ZIP:     https://opendesign.cc/packs/${SLUG}/${SLUG}-design-pack.zip"
echo "   详情页:  https://opendesign.cc/en/sites/${SLUG}"
