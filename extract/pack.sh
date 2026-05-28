#!/usr/bin/env bash
# 打包一个提取目录成可下载的 .zip 素材包
# 用法: ./pack.sh extracts/lusion-co  [可选输出文件名]
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "用法: $0 <extract-dir> [output.zip]"
  exit 1
fi

src="${1%/}"
if [ ! -d "$src" ]; then
  echo "✗ 目录不存在: $src"; exit 1
fi

basename=$(basename "$src")
out="${2:-${basename}-design-pack.zip}"

# 创建 ZIP（排除原始 elements.json / requests.json / dom.html —— 它们是中间产物
# 真正给开发者用的：DESIGN_SPEC.md + sites-entry.json + 所有 PNG + summary.json）
cd "$src"
zip -q -X "../${out}" \
    DESIGN_SPEC.md \
    sites-entry.json \
    summary.json \
    fonts.json \
    *.png 2>&1 || true
cd - >/dev/null

size=$(ls -lh "$(dirname "$src")/$out" | awk '{print $5}')
echo "✓ 打包完成"
echo "  · ${src%/*}/${out}"
echo "  · 大小: $size"
echo ""
echo "可以直接上传到 R2 / Supabase Storage / 任意 CDN，作为该条目的'设计素材包下载'链接。"
