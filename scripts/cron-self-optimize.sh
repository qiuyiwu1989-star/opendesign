#!/usr/bin/env bash
# 每周自我优化 · 由服务器 crontab 调用
# 周日 04:00 · 检测失效 URL + 超期 spec 排队升级
#
# 安装（服务器上跑一次）：
#   chmod +x /home/ubuntu/opendesign/scripts/cron-self-optimize.sh
#   ( crontab -l 2>/dev/null; echo '0 4 * * 0 /home/ubuntu/opendesign/scripts/cron-self-optimize.sh' ) | crontab -
# 查日志：tail -f ~/self-optimize.log
set -euo pipefail

REPO="${OPENDESIGN_REPO:-/home/ubuntu/opendesign}"
ENV_FILE="${OPENDESIGN_ENV:-$HOME/.opendesign-runner.env}"
LOG="${OPENDESIGN_OPTIMIZE_LOG:-$HOME/self-optimize.log}"

cd "$REPO"
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi

echo "===== $(date '+%Y-%m-%d %H:%M:%S') self-optimize 开始 =====" >> "$LOG"
python3 scripts/self-optimize.py >> "$LOG" 2>&1 \
  || echo "  ! self-optimize 退出码 $?" >> "$LOG"
echo "" >> "$LOG"
