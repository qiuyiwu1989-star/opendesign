#!/usr/bin/env bash
# 服务器端「任务执行器」cron —— drain 后台点过的任务队列（升级 / 收录 / 刷新主图）。
#
# 授权模型：入队就是授权。后台是口令保护的，你点「升级/收录」那一下 = 授权那一次花费；
# 这个 runner 只执行你已经点过的东西，不自己发起。跟「全自动 discover→花钱→部署」本质不同。
#
# LOCAL_DEPLOY=1：本脚本就跑在 web 服务器上 → 产物本机 cp 到 /var/www（不 scp）。
# flock：上一轮还没跑完（长 upgrade）就跳过本轮，绝不并发打架。
# env：~/.opendesign-runner.env（chmod 600）需含 SB_URL / SB_ANON_KEY / RUNNER_TOKEN；
#      要跑 升级/收录（mimo）还需 ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL。
set -uo pipefail

REPO="${OPENDESIGN_REPO:-/home/ubuntu/opendesign}"
ENV_FILE="${OPENDESIGN_ENV:-$HOME/.opendesign-runner.env}"
LOG="${OPENDESIGN_JOBS_LOG:-$HOME/jobrunner.log}"

cd "$REPO"
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi
export LOCAL_DEPLOY=1

_STARTED=$(date -Iseconds)
_TMP=$(mktemp /tmp/od-jobrunner-XXXXXX.log)

echo "===== $(date '+%Y-%m-%d %H:%M:%S') jobrunner 开始 =====" >> "$LOG"

# 用 set +e 安全捕获 flock 跳过时的退出码
set +e
flock -n /tmp/od-jobrunner.lock \
  python3 scripts/job_runner.py > "$_TMP" 2>&1
_CODE=$?
set -e

cat "$_TMP" >> "$LOG"

_STATUS=done
if [[ $_CODE -ne 0 ]]; then
  echo "  (被 flock 跳过 或 退出码 $_CODE)" >> "$LOG"
  _STATUS=skipped
fi
echo "" >> "$LOG"

# 提取摘要
_SUMMARY=$(grep -E '完成 [0-9]+ 个任务|no job|队列为空' "$_TMP" 2>/dev/null | tail -1 || true)
[[ -z "$_SUMMARY" && "$_STATUS" == skipped ]] && _SUMMARY="被 flock 跳过（上次仍在运行）"
[[ -z "$_SUMMARY" ]] && _SUMMARY="（队列为空，无任务）"

# 上报到 Supabase run_logs（fire-and-forget，失败不影响 cron 主流程）
python3 scripts/log_run.py \
  "$_STARTED" "jobrunner" "$_STATUS" \
  "$_SUMMARY" \
  "$(tail -c 2800 "$_TMP")" \
  2>/dev/null || true

rm -f "$_TMP"

# 安装（服务器上跑一次）：
#   chmod +x /home/ubuntu/opendesign/scripts/cron-jobrunner.sh
#   ( crontab -l 2>/dev/null; echo '*/10 * * * * /home/ubuntu/opendesign/scripts/cron-jobrunner.sh' ) | crontab -
# 看日志：tail -f ~/jobrunner.log
