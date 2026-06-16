#!/usr/bin/env bash
# 「发布器」cron —— 把 job runner 攒下的新站（已出包、已写 packs-index 条目、已写 sites/<slug>.json）
# 统一 build + deploy 一次。和 job runner 解耦：runner 每站只出包（轻），publisher 定时整站发布（重）。
#
# 为什么：以前每处理 1 个站就全量 build（2700+ 文件）+ deploy，把小服务器压垮、网站打不开。
# 现在 runner 设 SKIP_PUBLISH=1 只出包，publisher 每 30 分钟把累积的新站一次性发布，负载大降。
#
# flock：和自己不重入；只有真有新内容才 build（靠 git/mtime 粗判可省，这里每轮都 build，幂等）。
set -uo pipefail

REPO="${OPENDESIGN_REPO:-/home/ubuntu/opendesign}"
ENV_FILE="${OPENDESIGN_ENV:-$HOME/.opendesign-runner.env}"
LOG="${OPENDESIGN_PUB_LOG:-$HOME/publisher.log}"

cd "$REPO" || exit 1
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi
export LOCAL_DEPLOY=1

_STARTED=$(date '+%Y-%m-%d %H:%M:%S')
_TMP=$(mktemp /tmp/od-publisher-XXXXXX.log)

echo "===== ${_STARTED} publisher 开始 =====" >> "$LOG"

# 整个尾段都关掉 errexit/pipefail —— 心跳上报绝不能因为某行非零退出被跳过
set +e +o pipefail
flock -n /tmp/od-publisher.lock bash -c '
  python3 scripts/build.py && bash scripts/deploy.sh
' > "$_TMP" 2>&1
_CODE=$?

tail -c 1500 "$_TMP" >> "$LOG" 2>/dev/null
[[ $_CODE -ne 0 ]] && echo "  (publisher 退出码 $_CODE 或被 flock 跳过)" >> "$LOG"
echo "" >> "$LOG"

# 心跳上报到 Supabase run_logs（预算好变量，避免内联 $() 在严格模式下踩坑）
_STATUS=done; [[ $_CODE -ne 0 ]] && _STATUS=error
_SUM=$(grep -E "live:|站$|Done|sites-index" "$_TMP" 2>/dev/null | tail -1)
[[ -z "$_SUM" ]] && _SUM="publish run"
_DETAIL=$(tail -c 2000 "$_TMP" 2>/dev/null)
python3 scripts/log_run.py "$_STARTED" "publisher" "$_STATUS" "$_SUM" "$_DETAIL" >/dev/null 2>&1

rm -f "$_TMP"
