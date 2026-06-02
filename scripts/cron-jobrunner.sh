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
set -euo pipefail

REPO="${OPENDESIGN_REPO:-/home/ubuntu/opendesign}"
ENV_FILE="${OPENDESIGN_ENV:-$HOME/.opendesign-runner.env}"
LOG="${OPENDESIGN_JOBS_LOG:-$HOME/jobrunner.log}"

cd "$REPO"
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi
export LOCAL_DEPLOY=1

echo "===== $(date '+%Y-%m-%d %H:%M:%S') jobrunner 开始 =====" >> "$LOG"
flock -n /tmp/od-jobrunner.lock python3 scripts/job_runner.py >> "$LOG" 2>&1 \
  || echo "  (被 flock 跳过 或 退出码 $?)" >> "$LOG"
echo "" >> "$LOG"

# 安装（服务器上跑一次）：
#   chmod +x /home/ubuntu/opendesign/scripts/cron-jobrunner.sh
#   ( crontab -l 2>/dev/null; echo '*/10 * * * * /home/ubuntu/opendesign/scripts/cron-jobrunner.sh' ) | crontab -
# 看日志：tail -f ~/jobrunner.log
