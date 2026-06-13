#!/usr/bin/env bash
# 每日自适应排名 · 由服务器 crontab 调用
# 03:00 daily · 凌晨低峰重排名 + build + deploy
#
# 逻辑：
#   读 Supabase likes/saves → rank_score → 更新 sites/*.json
#   → 自动归档 0 互动超期站 → 重建 dist/ → 本机 cp 到 /var/www
#
# 安装（服务器上跑一次）：
#   chmod +x /home/ubuntu/opendesign/scripts/cron-adaptive-rank.sh
#   ( crontab -l 2>/dev/null; echo '0 3 * * * /home/ubuntu/opendesign/scripts/cron-adaptive-rank.sh' ) | crontab -
# 查日志：tail -f ~/adaptive-rank.log
set -uo pipefail

REPO="${OPENDESIGN_REPO:-/home/ubuntu/opendesign}"
ENV_FILE="${OPENDESIGN_ENV:-$HOME/.opendesign-runner.env}"
LOG="${OPENDESIGN_RANK_LOG:-$HOME/adaptive-rank.log}"

cd "$REPO"
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi
export LOCAL_DEPLOY=1

_STARTED=$(date -Iseconds)
_TMP=$(mktemp /tmp/od-rank-XXXXXX.log)

echo "===== $(date '+%Y-%m-%d %H:%M:%S') adaptive-rank 开始 =====" >> "$LOG"

set +e
flock -n /tmp/od-rank.lock \
  python3 scripts/adaptive-rank.py > "$_TMP" 2>&1
_CODE=$?
set -e

cat "$_TMP" >> "$LOG"

_STATUS=done
if [[ $_CODE -ne 0 ]]; then
  echo "  (被 flock 跳过 或 退出码 $_CODE)" >> "$LOG"
  _STATUS=skipped
fi
echo "" >> "$LOG"

# 提取摘要（"更新: N 个站" 或 "无变化" 那行）
_SUMMARY=$(grep -E '更新: [0-9]+|无变化|排名更新完成|互动数据' "$_TMP" 2>/dev/null | tail -2 | tr '\n' '  ' || true)
[[ -z "$_SUMMARY" && "$_STATUS" == skipped ]] && _SUMMARY="被 flock 跳过（上次仍在运行）"
[[ -z "$_SUMMARY" ]] && _SUMMARY="（无输出）"

python3 scripts/log_run.py \
  "$_STARTED" "adaptive-rank" "$_STATUS" \
  "$_SUMMARY" \
  "$(tail -c 2800 "$_TMP")" \
  2>/dev/null || true

rm -f "$_TMP"
