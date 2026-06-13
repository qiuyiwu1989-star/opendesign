#!/usr/bin/env bash
# 一键安装自治系统（在服务器上跑一次）
# 用法：bash ~/opendesign/scripts/install-auto-system.sh
set -euo pipefail

REPO="${OPENDESIGN_REPO:-$HOME/opendesign}"

echo "▸ 设置脚本权限..."
chmod +x "$REPO/scripts/cron-auto-evaluate.sh"
chmod +x "$REPO/scripts/cron-adaptive-rank.sh"
chmod +x "$REPO/scripts/cron-self-optimize.sh"

echo "▸ 安装 crontab（共 6 条）..."
(
  # 保留已有条目（去重后重写）
  crontab -l 2>/dev/null | grep -v "cron-auto-evaluate\|cron-adaptive-rank\|cron-self-optimize"
  echo "0 10 * * *   $REPO/scripts/cron-auto-evaluate.sh"    # 每天 10:00 AI 评估候选站
  echo "0  3 * * *   $REPO/scripts/cron-adaptive-rank.sh"    # 每天 03:00 重排名 + deploy
  echo "0  4 * * 0   $REPO/scripts/cron-self-optimize.sh"    # 每周日 04:00 自检
) | crontab -

echo ""
echo "✓ 安装完成。当前 crontab："
crontab -l
echo ""
echo "查看日志："
echo "  tail -f ~/auto-evaluate.log"
echo "  tail -f ~/adaptive-rank.log"
echo "  tail -f ~/self-optimize.log"
