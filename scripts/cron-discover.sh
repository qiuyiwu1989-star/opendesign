#!/usr/bin/env bash
# 服务器每日「发现」cron —— 只发现，不收录。
#
# benign：只读 HN API + 写 discoveries 队列。不花钱、不跑 mimo、不部署。
# 收录（花钱的 mimo 完整包）永远人工：后台点「收录」→ 入 jobs → 人工 drain。
#
# 装法见文件尾。env 放 ~/.opendesign-runner.env（chmod 600，含 SB_URL/SB_ANON_KEY/RUNNER_TOKEN）。
set -uo pipefail

REPO="${OPENDESIGN_REPO:-/home/ubuntu/opendesign}"
ENV_FILE="${OPENDESIGN_ENV:-$HOME/.opendesign-runner.env}"
LOG="${OPENDESIGN_DISCOVER_LOG:-$HOME/discover.log}"

cd "$REPO"
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi

_STARTED=$(date -Iseconds)
_TMP=$(mktemp /tmp/od-discover-XXXXXX.log)

echo "===== $(date '+%Y-%m-%d %H:%M:%S') discover 开始 =====" >> "$LOG"

set +e
python3 scripts/discover.py --source hn --limit 30 > "$_TMP" 2>&1
_CODE=$?
set -e

cat "$_TMP" >> "$LOG"

_STATUS=done
if [[ $_CODE -ne 0 ]]; then
  echo "  ! discover 退出码 $_CODE（0006 没应用 / 网络？看上面）" >> "$LOG"
  _STATUS=error
fi
echo "" >> "$LOG"

# 提取摘要（"写入发现队列：新增 N，已存在 M" 那行）
_SUMMARY=$(grep -E '写入发现队列|新增|发现' "$_TMP" 2>/dev/null | tail -1 || true)
[[ -z "$_SUMMARY" ]] && _SUMMARY="（无输出）"

python3 scripts/log_run.py \
  "$_STARTED" "discover" "$_STATUS" \
  "$_SUMMARY" \
  "$(tail -c 2800 "$_TMP")" \
  2>/dev/null || true

rm -f "$_TMP"

# 安装（在服务器上跑一次）：
#   chmod +x /home/ubuntu/opendesign/scripts/cron-discover.sh
#   ( crontab -l 2>/dev/null; echo '30 9 * * * /home/ubuntu/opendesign/scripts/cron-discover.sh' ) | crontab -
# 看日志：tail -f ~/discover.log
