#!/usr/bin/env python3
"""完整包内容审计 —— 揪出「列表看着对、下载却是废的」包。

判据：extract 的 summary.json.totalElementsVisible 极低（< 阈值）= headless 没渲染出来
（空白 / 反爬墙 / 离线页）→ 包里截图是废的。真站几百~几千，废页个位~几十。

只看已发布（在 packs-index 里）且本地有 extract 的站。
用法：python3 scripts/audit-packs.py [--min 50]
退出码：发现废包则非 0（可用于 smoke / pre-deploy 门）。
"""
import argparse
import glob
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--min", type=int, default=50, help="totalElementsVisible 低于此判废")
args = ap.parse_args()

packs = set(json.loads((ROOT / "packs-index.json").read_text(encoding="utf-8"))) \
    if (ROOT / "packs-index.json").exists() else set()

bad, ok, nolocal = [], 0, 0
for d in sorted(glob.glob(str(ROOT / "extract" / "extracts" / "*"))):
    slug = os.path.basename(d)
    if slug not in packs:
        continue
    sp = os.path.join(d, "summary.json")
    if not os.path.exists(sp):
        nolocal += 1
        continue
    try:
        vis = json.load(open(sp, encoding="utf-8")).get("totalElementsVisible", 0)
    except Exception:
        vis = 0
    if vis < args.min:
        bad.append((slug, vis))
    else:
        ok += 1

print(f"审计：已发布且本地有 extract 的包 · 合格 {ok} · 无本地 extract {nolocal}")
if bad:
    print(f"\n❌ 渲染失败的废包 {len(bad)} 个（下载开包是空白/反爬/离线，应重抓或剔除）：")
    for s, v in bad:
        print(f"  {s:22} 仅 {v} 个可见元素")
    sys.exit(1)
print("✓ 没有渲染失败的废包。")
