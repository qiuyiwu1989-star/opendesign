#!/usr/bin/env bash
# 服务器每日「发现」cron —— 只发现，不收录。
#
# benign：只读 HN API + 写 discoveries 队列。不花钱、不跑 mimo、不部署。
# 收录（花钱的 mimo 完整包）永远人工：后台点「收录」→ 入 jobs → 人工 drain。
#
# 装法见文件尾。env 放 ~/.opendesign-runner.env（chmod 600，含 SB_URL/SB_ANON_KEY/RUNNER_TOKEN）。
set -euo pipefail

REPO="${OPENDESIGN_REPO:-/home/ubuntu/opendesign}"
ENV_FILE="${OPENDESIGN_ENV:-$HOME/.opendesign-runner.env}"
LOG="${OPENDESIGN_DISCOVER_LOG:-$HOME/discover.log}"

cd "$REPO"
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi

echo "===== $(date '+%Y-%m-%d %H:%M:%S') discover 开始 =====" >> "$LOG"
python3 scripts/discover.py --source hn --limit 30 >> "$LOG" 2>&1 || \
  echo "  ! discover 退出码 $?（0006 没应用 / 网络？看上面）" >> "$LOG"
echo "" >> "$LOG"

# 安装（在服务器上跑一次）：
#   chmod +x /home/ubuntu/opendesign/scripts/cron-discover.sh
#   ( crontab -l 2>/dev/null; echo '30 9 * * * /home/ubuntu/opendesign/scripts/cron-discover.sh' ) | crontab -
# 看日志：tail -f ~/discover.log
