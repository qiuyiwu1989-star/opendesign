#!/usr/bin/env bash
# 把 upgrade-batch 完全托管给 macOS launchd，彻底脱离 Claude / Terminal 会话。
# 关掉 Terminal、Claude 发消息——批量都不会中断。
#
# 用法：
#   bash scripts/batch-start.sh          # 启动（或查看进度）
#   bash scripts/batch-start.sh stop     # 停止
#   bash scripts/batch-start.sh log      # 实时查看日志
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="cc.opendesign.upgrade-batch"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG="/tmp/expand-500.log"

# ---------- 子命令 ----------
if [[ "${1:-}" == "stop" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ 批量已停止"
  exit 0
fi

if [[ "${1:-}" == "log" ]]; then
  tail -f "$LOG"
  exit 0
fi

if [[ "${1:-}" == "status" ]]; then
  python3 -c "
import json, glob
done = set(json.load(open('$ROOT/packs-index.json')))
rem = [json.load(open(p))['id'] for p in sorted(glob.glob('$ROOT/sites/*.json'))
       if json.load(open(p)).get('url') and json.load(open(p))['id'] not in done]
print(f'已发布: {len(done)} 包 | 待处理: {len(rem)} 站')
"
  tail -5 "$LOG" 2>/dev/null || echo "(日志为空)"
  exit 0
fi

# ---------- 检查 env 里有没有 mimo key ----------
source_check=$(bash -c "set -a; . ~/.opendesign-runner.env 2>/dev/null; set +a; echo \${ANTHROPIC_API_KEY:-EMPTY}")
if [[ "$source_check" == "EMPTY" ]]; then
  echo "✗ ~/.opendesign-runner.env 里没有 ANTHROPIC_API_KEY，请先填入"
  exit 1
fi

# ---------- 如果已在跑，只显示状态 ----------
if launchctl list "$LABEL" 2>/dev/null | grep -q PID; then
  echo "▸ 批量已在 launchd 里跑了，无需重启"
  bash "$0" status
  exit 0
fi

# ---------- 生成 plist ----------
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>             <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>set -a; . ~/.opendesign-runner.env; set +a; cd "${ROOT}"; bash scripts/upgrade-batch.sh; launchctl unload ~/Library/LaunchAgents/${LABEL}.plist 2>/dev/null; rm -f ~/Library/LaunchAgents/${LABEL}.plist</string>
  </array>
  <key>StandardOutPath</key>   <string>${LOG}</string>
  <key>StandardErrorPath</key> <string>${LOG}</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <false/>
  <key>ThrottleInterval</key>  <integer>5</integer>
</dict>
</plist>
PLIST

# ---------- 加载启动 ----------
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

sleep 2
echo "✓ 批量已托管给 macOS launchd，完全在后台运行"
echo "  • 关掉 Terminal / Claude 发消息 → 不影响"
echo "  • 查进度：bash scripts/batch-start.sh status"
echo "  • 实时日志：bash scripts/batch-start.sh log"
echo "  • 停止：bash scripts/batch-start.sh stop"
echo ""
bash "$0" status
