#!/usr/bin/env bash
# 全自动批量升级：把所有还没有完整包的 Tier-1 站，逐个用 MIMO 升成 Tier-2 完整包。
#
# 调用的是 MIMO API（ANTHROPIC_BASE_URL 指向 token-plan-cn.xiaomimimo.com），不是别的模型。
# 单站失败（mimo 输出异常 / 提取失败）自动还原 + 跳过，不中断整批。
#
# 用法：
#   export ANTHROPIC_API_KEY=<mimo key>
#   export ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
#   export ANTHROPIC_MODEL=mimo-v2.5
#   bash scripts/upgrade-batch.sh            # 跑全部剩余
#   bash scripts/upgrade-batch.sh 20         # 只跑前 20 个（可选上限）
set -uo pipefail                  # 不用 -e：单站失败要继续

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
LIMIT="${1:-0}"

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "✗ 先 export ANTHROPIC_API_KEY（mimo key）+ ANTHROPIC_BASE_URL + ANTHROPIC_MODEL"; exit 1
fi
echo "▸ MIMO endpoint: ${ANTHROPIC_BASE_URL:-(默认 anthropic！请改成 mimo)}"
echo "▸ MIMO model:    ${ANTHROPIC_MODEL:-mimo-v2.5}"

# 剩余站点 = sites/*.json 减去 packs-index.json 里已有完整包的（写到临时文件，兼容老 bash）
PAIRS_FILE="/tmp/upgrade_pairs.txt"
python3 - > "$PAIRS_FILE" <<'PY'
import json, glob, os
done = set(json.load(open("packs-index.json")).keys()) if os.path.exists("packs-index.json") else set()
for p in sorted(glob.glob("sites/*.json")):
    d = json.load(open(p, encoding="utf-8"))
    if d["id"] not in done and d.get("url"):
        print(d["id"], d["url"])
PY
TOTAL=$(wc -l < "$PAIRS_FILE" | tr -d ' ')
[[ "$LIMIT" -gt 0 && "$LIMIT" -lt "$TOTAL" ]] && TOTAL="$LIMIT"
echo "▸ 待升级 ${TOTAL} 站 · 单站约 \$0.25 · 失败自动跳过"

ok=0; fail=0; i=0
# 从 FD 3 读，避免 upgrade-pack.sh 里的 ssh 抢走循环的 stdin
while read -r slug url <&3; do
  i=$((i+1))
  [[ "$LIMIT" -gt 0 && "$i" -gt "$LIMIT" ]] && break
  echo ""
  echo "════════ [${i}/${TOTAL}] ${slug}  (${url}) ════════"
  if bash scripts/upgrade-pack.sh "$slug" "$url"; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); echo "  ⏭ ${slug} 失败已跳过（已还原，不留坏数据）"
  fi
done 3< "$PAIRS_FILE"

echo ""
echo "════════ 批量完成 ════════"
echo "  成功 ${ok} · 跳过 ${fail} · 共尝试 ${i}"
echo "  当前完整包总数：$(python3 -c "import json;print(len(json.load(open('packs-index.json'))))")"
