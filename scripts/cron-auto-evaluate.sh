#!/usr/bin/env bash
# 每日自动评估候选站 · 由服务器 crontab 调用
# 10:00 daily，在 discover (09:30) 之后 30 分钟跑
#
# 逻辑：
#   1. cron-discover.sh (09:30) → 抓 HN 候选站 → discoveries 表
#   2. cron-auto-evaluate.sh (10:00) → AI 评分 → 高分站自动创建 collect job
#   3. cron-jobrunner.sh (每10分钟) → 领 collect job → Playwright+mimo → 上线
#
# 安装（服务器上跑一次）：
#   chmod +x /home/ubuntu/opendesign/scripts/cron-auto-evaluate.sh
#   ( crontab -l 2>/dev/null; echo '0 10 * * * /home/ubuntu/opendesign/scripts/cron-auto-evaluate.sh' ) | crontab -
# 查日志：tail -f ~/auto-evaluate.log
set -uo pipefail

REPO="${OPENDESIGN_REPO:-/home/ubuntu/opendesign}"
ENV_FILE="${OPENDESIGN_ENV:-$HOME/.opendesign-runner.env}"
LOG="${OPENDESIGN_EVAL_LOG:-$HOME/auto-evaluate.log}"

cd "$REPO"
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi

_STARTED=$(date -Iseconds)
_TMP=$(mktemp /tmp/od-evaluate-XXXXXX.log)

echo "===== $(date '+%Y-%m-%d %H:%M:%S') auto-evaluate 开始 =====" >> "$LOG"

set +e
python3 scripts/auto-evaluate.py > "$_TMP" 2>&1
_CODE=$?
set -e

cat "$_TMP" >> "$LOG"

_STATUS=done
if [[ $_CODE -ne 0 ]]; then
  echo "  ! auto-evaluate 退出码 $_CODE" >> "$LOG"
  _STATUS=error
fi
echo "" >> "$LOG"

# 提取摘要（"完成：✓ N 收录  ✗ M 忽略  ~ K 存疑" 那行）
_SUMMARY=$(grep -E '完成：|✓.*收录|评估.*站' "$_TMP" 2>/dev/null | tail -1 || true)
[[ -z "$_SUMMARY" ]] && _SUMMARY="（无输出）"

python3 scripts/log_run.py \
  "$_STARTED" "auto-evaluate" "$_STATUS" \
  "$_SUMMARY" \
  "$(tail -c 2800 "$_TMP")" \
  2>/dev/null || true

rm -f "$_TMP"
