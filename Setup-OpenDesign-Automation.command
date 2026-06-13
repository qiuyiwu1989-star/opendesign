#!/bin/bash
# 双击这个文件 → Terminal 自动弹出 → 一键完成服务器全自动化设置
# 设置完成后每天凌晨 3:00 服务器自动运行，完全无人值守
cd "/Volumes/邱懿武/开发项目/网站美学"

echo "╔════════════════════════════════════════════╗"
echo "║   OpenDesign 自动化一键安装                ║"
echo "║   设置完后每天自动跑，不需要再操作         ║"
echo "╚════════════════════════════════════════════╝"
echo ""

# 1. 同步最新脚本和站点数据到服务器
echo "▸ [1/4] 同步脚本到服务器..."
rsync -az scripts/ sites/ packs-index.json \
  ubuntu@43.159.171.3:/home/ubuntu/opendesign/ \
  --exclude="*.pyc" --exclude="__pycache__" 2>/dev/null
echo "  ✓ 完成"

# 2. 在服务器安装依赖 + 写入 env（从本地 env 文件读取）
echo ""
echo "▸ [2/4] 服务器安装依赖 + 写入配置..."
KEY=$(grep "^ANTHROPIC_API_KEY=" ~/.opendesign-runner.env | cut -d= -f2-)
SB_URL=$(grep "^SB_URL=" ~/.opendesign-runner.env | cut -d= -f2-)
SB_KEY=$(grep "^SB_ANON_KEY=" ~/.opendesign-runner.env | cut -d= -f2-)
RUNNER_TOKEN=$(grep "^RUNNER_TOKEN=" ~/.opendesign-runner.env | cut -d= -f2-)

ssh ubuntu@43.159.171.3 bash << REMOTE
set -e
# 写入 env
cat > ~/.opendesign-runner.env << 'EOF'
ANTHROPIC_API_KEY=${KEY}
ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
ANTHROPIC_MODEL=mimo-v2.5
SB_URL=${SB_URL}
SB_ANON_KEY=${SB_KEY}
RUNNER_TOKEN=${RUNNER_TOKEN}
LOCAL_DEPLOY=1
EOF
chmod 600 ~/.opendesign-runner.env
echo "  ✓ env 配置写入"

# 安装 Python 包
pip3 install -q anthropic jsonschema pillow requests --break-system-packages 2>/dev/null
echo "  ✓ Python 依赖安装"

# 确保 playwright chromium 可用
playwright install chromium 2>/dev/null && echo "  ✓ Chromium 就绪" || echo "  (Chromium 已存在)"
REMOTE
echo "  ✓ 完成"

# 3. 设置服务器 cron（每天凌晨 3:00 自动处理新站）
echo ""
echo "▸ [3/4] 设置服务器每日任务..."
ssh ubuntu@43.159.171.3 bash << 'REMOTE'
# 保留已有 cron，追加新的每日管线
EXISTING=$(crontab -l 2>/dev/null | grep -v "opendesign.daily")
NEW_JOB="0 3 * * * cd /home/ubuntu/opendesign && bash scripts/daily-pipeline.sh >> /tmp/opendesign-daily.log 2>&1"
(echo "$EXISTING"; echo "$NEW_JOB") | crontab -
echo "  ✓ Cron 已设置（每天 03:00）"
crontab -l | grep opendesign
REMOTE
echo "  ✓ 完成"

# 4. 立刻开始处理积压站点（nohup 完全后台）
echo ""
echo "▸ [4/4] 立刻开始处理积压站点（后台运行，关掉窗口也不中断）..."
BACKLOG=$(ssh ubuntu@43.159.171.3 "python3 -c \"
import json, glob
done=set(json.load(open('/home/ubuntu/opendesign/packs-index.json')))
rem=[json.load(open(p))['id'] for p in sorted(glob.glob('/home/ubuntu/opendesign/sites/*.json'))
     if json.load(open(p)).get('url') and json.load(open(p))['id'] not in done]
print(len(rem))
\"")
echo "  待处理: ${BACKLOG} 个站点（服务器后台运行，单站约 3-5 分钟）"
ssh ubuntu@43.159.171.3 "nohup bash -c 'cd /home/ubuntu/opendesign && source ~/.opendesign-runner.env && bash scripts/upgrade-batch.sh' >> /tmp/opendesign-daily.log 2>&1 &"
echo "  ✓ 后台批量已启动"

# 完成
echo ""
echo "╔════════════════════════════════════════════╗"
echo "║  ✓ 安装完成！                              ║"
echo "║                                            ║"
echo "║  现在：服务器后台正在处理 ${BACKLOG} 个站点      ║"
echo "║  以后：每天凌晨 3:00 自动运行              ║"
echo "║                                            ║"
echo "║  查看进度：                                ║"
echo "║  ssh ubuntu@43.159.171.3                   ║"
echo "║  tail -f /tmp/opendesign-daily.log         ║"
echo "╚════════════════════════════════════════════╝"
echo ""
echo "5 秒后关闭..."
sleep 5
