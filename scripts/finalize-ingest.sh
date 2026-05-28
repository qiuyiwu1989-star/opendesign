#!/usr/bin/env bash
# 跑完 ingest 后的收尾流水线：validate → build → commit → deploy
# 用法: bash scripts/finalize-ingest.sh
#       SKIP_DEPLOY=1 bash scripts/finalize-ingest.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "▸ 1/5 校验 sites/*.json"
if ! python3 scripts/validate-sites.py; then
  echo "  ✗ 有 site 不过 schema，看上面错误。修了再重跑这个脚本。"
  exit 1
fi

echo ""
echo "▸ 2/5 build dist/"
python3 scripts/build.py

echo ""
echo "▸ 3/5 git add + commit"
git add -A
if git diff --staged --quiet; then
  echo "  无变更，跳过 commit"
else
  git commit -m "data: ingest pass — fill spec_i18n + narrative for completed sites

Automated batch run of scripts/ingest.py against current 20 sites,
plus build.py producing dist/ (sites-index, per-site detail, legacy
compat, 5-lang SEO HTML, hreflang sitemap).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
  git push origin main || echo "  ⚠ push failed, do it manually later"
fi

echo ""
echo "▸ 4/5 deploy"
if [[ -n "${SKIP_DEPLOY:-}" ]]; then
  echo "  跳过 (SKIP_DEPLOY=1)"
else
  SKIP_BUILD=1 bash scripts/deploy.sh   # 已经 build 过了
fi

echo ""
echo "▸ 5/5 完成总结"
python3 -c "
import json, os
from collections import Counter
c=Counter()
cost=0
for f in os.listdir('sites'):
    if not f.endswith('.json'): continue
    s=json.load(open(f'sites/{f}'))
    c[s.get('status','?')] += 1
    cost += s.get('_meta',{}).get('total_cost_usd',0)
print(f'  Sites:')
for k,v in sorted(c.items()):
    print(f'    {k:30}  {v}')
print(f'  Total cost: \${cost:.3f}')
print()
print(f'  dist/: {sum(1 for _ in __import__(\"pathlib\").Path(\"dist\").rglob(\"*\") if _.is_file())} files')
"

echo ""
echo "✓ All done. https://opendesign.cc/en/sites/apple should now be Google-indexable."
