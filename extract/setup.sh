#!/usr/bin/env bash
# OpenDesign · extract 工具一键安装
# 用法: ./setup.sh
set -euo pipefail

echo "▸ 装 Playwright Python（用清华镜像避免国内 PyPI 抽风）"
pip3 install playwright -i https://pypi.tuna.tsinghua.edu.cn/simple --quiet --upgrade 2>&1 | tail -3

echo "▸ 装 Chromium 浏览器（~150MB，首次约 1-2 min）"
python3 -m playwright install chromium

echo ""
echo "✓ 装好了。试一下："
echo "    python3 extract.py https://linear.app"
echo "    python3 synthesize.py extracts/linear-app"
echo "    ./pack.sh extracts/linear-app          # 打包成 ZIP 可下载"
