#!/usr/bin/env bash
# 上线前完整性闸门 —— 专治「列表看着对、下载却是废的 / 状态对不上现实」这一类 bug。
#
# 全部只读：不写 dist/、不动 sites/、不部署 —— 所以批量在跑时也能安全执行。
# 任一检查失败即以非 0 退出，可挂在任何「完整部署」之前手动跑一遍。
#
# 用法：
#   bash scripts/smoke.sh            # 本地完整性检查（离线、秒级）
#   bash scripts/smoke.sh --remote   # 额外抽查线上若干 pack ZIP 真能下载且非空
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
FAIL=0
section() { echo ""; echo "▸ $1"; }

section "[1/4] schema 校验（sites/*.json）"
if python3 scripts/validate-sites.py; then
  echo "  ✓ schema OK"
else
  echo "  ✗ schema 校验失败"; FAIL=1
fi

section "[2/4] 包渲染质量（extract 的 totalElementsVisible，揪空白/反爬/离线废包）"
if python3 scripts/audit-packs.py; then
  echo "  ✓ 无渲染失败的已发布包"
else
  echo "  ✗ 存在渲染失败的废包"; FAIL=1
fi

section "[3/4] packs-index ↔ sites 一致性 + SEO 落地页渲染健全性"
if python3 - <<'PY'
import json, glob, importlib.util, re, sys
from pathlib import Path

fail = 0
sites = {}
for p in glob.glob("sites/*.json"):
    try:
        d = json.load(open(p, encoding="utf-8"))
        sites[d["id"]] = d
    except Exception as e:
        print(f"  ✗ 解析 {p} 失败: {e}"); fail = 1

packs = json.load(open("packs-index.json", encoding="utf-8")) if Path("packs-index.json").exists() else {}

# 1) 每个 packs-index 条目都要有对应 site，且 status=completed —— 否则「有包却没站 / 站没完成」
for slug in packs:
    if slug not in sites:
        print(f"  ✗ packs-index 有 {slug}，但 sites/{slug}.json 不存在"); fail = 1
    elif sites[slug].get("status") != "completed":
        print(f"  ✗ {slug} 在 packs-index 里，但 status={sites[slug].get('status')!r}（应为 completed）"); fail = 1

# 2) 反向：任何标了 pack.available=true 的站，必须真的在 packs-index 里 —— 否则「显示有包、其实没包」
for slug, d in sites.items():
    if d.get("pack", {}).get("available") and slug not in packs:
        print(f"  ✗ {slug} pack.available=true，但 packs-index 里没有它"); fail = 1

# 3) SEO 落地页渲染健全性：对每个有包的站逐语言渲染，断言不抛异常、无残留 {占位符}
spec = importlib.util.spec_from_file_location("b", "scripts/build.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
ph = re.compile(r"(?<![{])\{[a-z_]+\}(?![}])")  # 单括号小写占位符 = format 漏填
rendered = 0
for slug in packs:
    site = sites.get(slug)
    if not site:
        continue
    for lang in b.LANGS:
        try:
            html = b.render_site_html(site, lang)
        except Exception as e:
            print(f"  ✗ render_site_html({slug}, {lang}) 抛异常: {e}"); fail = 1; continue
        left = ph.findall(html)
        if left:
            print(f"  ✗ {slug}/{lang} SEO 页残留占位符: {sorted(set(left))[:4]}"); fail = 1
        rendered += 1

if not fail:
    print(f"  ✓ 一致性通过；{len(packs)} 个有包站 × {len(b.LANGS)} 语言 = {rendered} 个 SEO 页渲染干净")
sys.exit(1 if fail else 0)
PY
then :; else FAIL=1; fi

if [[ "${1:-}" == "--remote" ]]; then
  section "[4/4] 线上抽查：随机若干 pack ZIP 真能下载且非空"
  BASE="${SMOKE_BASE:-https://opendesign.cc}"
  # 取 packs-index 前若干 slug + 其 zipFile，逐个 curl -sI 看 HTTP 200 + Content-Length 够大
  mapfile -t SAMPLE < <(python3 -c "
import json
p = json.load(open('packs-index.json'))
for slug in list(p)[:6]:
    zf = p[slug].get('zipFile')
    if zf: print(f'{slug}\t/packs/{slug}/{zf}')
")
  for row in "${SAMPLE[@]}"; do
    slug="${row%%$'\t'*}"; path="${row##*$'\t'}"
    hdr=$(curl -sI --max-time 25 "${BASE}${path}" || true)
    code=$(echo "$hdr" | awk 'NR==1{print $2}')
    len=$(echo "$hdr" | awk -F': ' 'tolower($1)=="content-length"{gsub(/\r/,"",$2);print $2}')
    if [[ "$code" == "200" && "${len:-0}" -gt 100000 ]]; then
      echo "  ✓ ${slug}  HTTP ${code}  $((len/1024)) KB"
    else
      echo "  ✗ ${slug}  HTTP ${code:-?}  len=${len:-?}（应 200 且 >100KB）"; FAIL=1
    fi
  done
fi

echo ""
if [[ "$FAIL" -ne 0 ]]; then
  echo "✗ smoke 未通过 —— 先修上面的问题，不要部署。"
  exit 1
fi
echo "✓ smoke 全部通过，可以部署。"
