#!/usr/bin/env bash
# 每周自我优化 · 由服务器 crontab 调用
# 周日 04:00 · 检测失效 URL（连续两周探活失败才标 broken，避免误杀）
# + 超期 spec 排队升级（默认 OPTIMIZE_REFRESH_CAP=0 关闭，纯健康检查不烧 mimo）
#
# 检测完 status 变了的话，直接 build+deploy 发布——不依赖 publisher timer
# （publisher/jobrunner/cos-sync 现在都暂停着，这个探活闭环得自己发布）。
#
# 安装（服务器上跑一次）：
#   chmod +x /home/ubuntu/opendesign/scripts/cron-self-optimize.sh
#   ( crontab -l 2>/dev/null; echo '0 4 * * 0 /home/ubuntu/opendesign/scripts/cron-self-optimize.sh' ) | crontab -
# 查日志：tail -f ~/self-optimize.log
set -uo pipefail

REPO="${OPENDESIGN_REPO:-/home/ubuntu/opendesign}"
ENV_FILE="${OPENDESIGN_ENV:-$HOME/.opendesign-runner.env}"
LOG="${OPENDESIGN_OPTIMIZE_LOG:-$HOME/self-optimize.log}"

cd "$REPO" || exit 1
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi
export LOCAL_DEPLOY=1

_STARTED=$(date '+%Y-%m-%d %H:%M:%S')
_TMP=$(mktemp /tmp/od-self-optimize-XXXXXX.log)

echo "===== ${_STARTED} self-optimize 开始 =====" >> "$LOG"

# 整段关掉 errexit —— 心跳上报绝不能因为某一步非零退出被跳过
set +e +o pipefail
flock -n /tmp/od-self-optimize.lock bash -c '
  python3 scripts/self-optimize.py &&
  python3 scripts/build.py &&
  bash scripts/deploy.sh
' > "$_TMP" 2>&1
_CODE=$?

tail -c 2000 "$_TMP" >> "$LOG" 2>/dev/null
[[ $_CODE -ne 0 ]] && echo "  (self-optimize 退出码 $_CODE 或被 flock 跳过)" >> "$LOG"
echo "" >> "$LOG"

_STATUS=done; [[ $_CODE -ne 0 ]] && _STATUS=error
_SUM=$(grep -E "新增失效|恢复在线|超期排队" "$_TMP" 2>/dev/null | tr '\n' ' ')
[[ -z "$_SUM" ]] && _SUM="self-optimize run"
_DETAIL=$(tail -c 2000 "$_TMP" 2>/dev/null)
python3 scripts/log_run.py "$_STARTED" "self-optimize" "$_STATUS" "$_SUM" "$_DETAIL" >/dev/null 2>&1

rm -f "$_TMP"
