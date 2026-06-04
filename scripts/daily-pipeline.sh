#!/usr/bin/env bash
# OpenDesign 每日自动化管线
# 功能：只处理新增（未入库的）站点，完成后自动 smoke + deploy
# 设计目标：无人值守，每天凌晨跑，单次 30min~2hr（取决于新增量）
#
# 触发方式：
#   直接运行：bash scripts/daily-pipeline.sh
#   launchd 托管：bash scripts/daily-pipeline.sh install   (安装每日自动任务)
#              bash scripts/daily-pipeline.sh uninstall (卸载)
#              bash scripts/daily-pipeline.sh status    (查状态/日志)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOG="/tmp/opendesign-daily.log"
LABEL="cc.opendesign.daily"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

# ───── 子命令 ─────────────────────────────────────────────────────
if [[ "${1:-}" == "install" ]]; then
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
    <string>${ROOT}/scripts/daily-pipeline.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>   <integer>3</integer>
    <key>Minute</key> <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>   <string>${LOG}</string>
  <key>StandardErrorPath</key> <string>${LOG}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key> <string>${HOME}</string>
    <key>PATH</key> <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
PLIST
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load   "$PLIST"
  echo "✓ 每日管线已安装 (每天 03:00 自动运行)"
  echo "  提示：System Settings → Battery → 勾选 'Prevent sleep' 或设置不休眠"
  echo "  查日志：bash scripts/daily-pipeline.sh status"
  exit 0
fi

if [[ "${1:-}" == "uninstall" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ 已卸载每日管线"
  exit 0
fi

if [[ "${1:-}" == "status" ]]; then
  echo "=== launchd 状态 ==="
  launchctl list "$LABEL" 2>/dev/null || echo "(未安装)"
  echo ""
  echo "=== 包数量 ==="
  python3 -c "
import json, glob
done=set(json.load(open('packs-index.json')))
rem=[json.load(open(p))['id'] for p in sorted(glob.glob('sites/*.json'))
     if json.load(open(p)).get('url') and json.load(open(p))['id'] not in done]
print(f'  已发布: {len(done)} 包 | 待处理: {len(rem)} 站')
"
  echo ""
  echo "=== 最近日志 (末50行) ==="
  tail -50 "$LOG" 2>/dev/null || echo "(暂无日志)"
  exit 0
fi

if [[ "${1:-}" == "run-now" ]]; then
  # 立刻触发一次（launchctl kickstart）
  launchctl kickstart -k "gui/$(id -u)/${LABEL}" 2>/dev/null \
    || bash "$0"
  exit 0
fi

# ───── 正式管线 ─────────────────────────────────────────────────
echo "╔══════════════════════════════════════════════════════╗"
echo "║  OpenDesign Daily Pipeline  $(date '+%Y-%m-%d %H:%M:%S')  ║"
echo "╚══════════════════════════════════════════════════════╝"

# 加载 mimo key
set -a; . ~/.opendesign-runner.env 2>/dev/null; set +a
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "✗ ANTHROPIC_API_KEY 未设置（~/.opendesign-runner.env 里没有）"
  exit 1
fi

# 1. 统计新增待处理站点
NEW_COUNT=$(python3 -c "
import json, glob
done=set(json.load(open('packs-index.json')))
rem=[json.load(open(p))['id'] for p in sorted(glob.glob('sites/*.json'))
     if json.load(open(p)).get('url') and json.load(open(p))['id'] not in done]
print(len(rem))
")
echo ""
echo "▸ 待处理新增站: ${NEW_COUNT}"

if [[ "$NEW_COUNT" -eq 0 ]]; then
  echo "  今天没有新站要处理，跳过批量。"
else
  # 2. 跑批量（只处理新站，已完成的自动跳过）
  echo ""
  echo "▸ [批量] 开始处理 ${NEW_COUNT} 个新站..."
  START_PACKS=$(python3 -c "import json; print(len(json.load(open('packs-index.json'))))")

  bash scripts/upgrade-batch.sh

  END_PACKS=$(python3 -c "import json; print(len(json.load(open('packs-index.json'))))")
  ADDED=$((END_PACKS - START_PACKS))
  echo ""
  echo "  批量完成：新增 ${ADDED} 个包 (共 ${END_PACKS})"
fi

# 3. Smoke 完整性检查
echo ""
echo "▸ [smoke] 完整性检查..."
if bash scripts/smoke.sh > /tmp/smoke-daily.log 2>&1; then
  echo "  ✓ smoke 通过"
else
  echo "  ✗ smoke 失败，取消部署。详情："
  cat /tmp/smoke-daily.log
  exit 1
fi

# 4. 服务器解压新包（让截图画廊可访问）
echo ""
echo "▸ [解压] 服务器同步新包文件..."
bash scripts/extract-packs-server.sh 2>/dev/null || echo "  (解压跳过或失败，不影响部署)"

# 5. 完整部署（含 SEO 富页）
echo ""
echo "▸ [部署] 推送到 opendesign.cc..."
bash scripts/deploy.sh

DONE_PACKS=$(python3 -c "import json; print(len(json.load(open('packs-index.json'))))")
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✓ 每日管线完成  $(date '+%Y-%m-%d %H:%M:%S')          ║"
echo "║  当前总包数: ${DONE_PACKS}                               ║"
echo "╚══════════════════════════════════════════════════════╝"
