#!/usr/bin/env bash
# 一键 drain —— 把后台点过的任务队列（升级 / 收录 / 刷新主图）一次性跑完并上线。
#
# 模型：你在后台审完点「收录 / 升级」→ 任务进队列 → 你本地跑这一行 → 全部跑完上线。
#   本地跑 → scp 部署到服务器 → 本地仓库保持 canonical（不像 prod cron 那样让服务器数据分叉）。
#   人在环、不碰 prod 自动 cron、不踩"无人值守花钱"红线。
#
# 用法：bash scripts/drain.sh
# 前置：~/.opendesign-runner.env（chmod 600，本脚本会自动 source）含——
#   SB_URL / SB_ANON_KEY / RUNNER_TOKEN                          # 必须（领队列里的活）
#   ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL     # 跑 升级/收录(mimo) 才需要
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${OPENDESIGN_ENV:-$HOME/.opendesign-runner.env}"
cd "$ROOT"
if [[ -f "$ENV_FILE" ]]; then set -a; . "$ENV_FILE"; set +a; fi

miss=0
for v in SB_URL SB_ANON_KEY RUNNER_TOKEN; do
  if [[ -z "${!v:-}" ]]; then echo "✗ 缺 $v（写进 $ENV_FILE 或先 export）"; miss=1; fi
done
[[ $miss == 1 ]] && exit 1

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "⚠ 没配 ANTHROPIC_API_KEY：刷新主图能跑；升级/收录(mimo)会失败。"
  echo "  轮换 mimo key 后把新 key 写进 $ENV_FILE 即可解锁。"
  echo ""
fi

echo "▸ drain 任务队列（本地跑 → scp 部署到服务器）…"
python3 scripts/job_runner.py
echo ""
echo "完成。回后台「任务队列」看状态，或刷新广场看新站。"
