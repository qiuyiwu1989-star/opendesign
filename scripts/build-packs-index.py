#!/usr/bin/env python3
"""把服务器拉来的文件清单（/tmp/pack-files.txt）+ zip 本地体积，编译成富 packs-index.json。

输出 schema:
  {
    "apple": {
      "zipFile": "apple-design-pack.zip",
      "zipSize": 40764214,
      "folderUrl": "/packs/apple/",
      "agentUrl": "/packs/apple/DESIGN_SPEC.md",     ← AI agent 直接读这个
      "specPreviewUrl": "/packs/apple/DESIGN_SPEC.md",
      "generatedAt": "2026-05-28",
      "files": [
        { "name": "DESIGN_SPEC.md", "size": 8283, "category": "spec", "desc": "8 章 magazine 规范 + :root CSS 可粘" },
        { "name": "01_desktop_full.png", "size": 8582532, "category": "shot", "desc": "1440 桌面全页" },
        ...
      ]
    }
  }
"""
import json
import re
from pathlib import Path
from collections import OrderedDict

LISTING = Path("/tmp/pack-files.txt").read_text(encoding="utf-8")

# 给每个文件名分类 + 中文描述
def classify(name):
    if name == "DESIGN_SPEC.md":
        return ("spec", "8 章 magazine 风格规范 · :root CSS 变量可直接粘")
    if name == "sites-entry.json":
        return ("data", "11 层 Tokens spec JSON · 可粘进 sites.js")
    if name == "summary.json":
        return ("data", "全部元素 computed styles 按频次聚合（真 token 数据源）")
    if name == "fonts.json":
        return ("data", "真实加载的字体文件清单 + 完整 fallback chain")
    if name == "01_desktop_full.png":
        return ("shot", "1440 桌面全页截图 (@2x retina)")
    if name == "02_desktop_hero.png":
        return ("shot", "桌面首屏（hero）")
    if name == "04_mobile_full.png":
        return ("shot", "390 移动全页截图 (@3x retina)")
    if name == "05_mobile_hero.png":
        return ("shot", "移动首屏")
    if re.match(r"03_desktop_section_(\d+)\.png", name):
        return ("shot", "桌面滚动分段（90% viewport 步进）")
    return ("other", "")

# 解析清单
current_slug = None
data = OrderedDict()
for line in LISTING.splitlines():
    if not line.strip():
        continue
    m = re.match(r"^===(.+)===$", line)
    if m:
        current_slug = m.group(1)
        data[current_slug] = []
        continue
    if "|" in line and current_slug:
        name, size = line.rsplit("|", 1)
        data[current_slug].append((name.strip(), int(size.strip())))

# 装载现有 packs-index.json 拿 zipSize
ROOT = Path(__file__).parent.parent
existing = {}
if (ROOT / "packs-index.json").exists():
    existing = json.loads((ROOT / "packs-index.json").read_text(encoding="utf-8"))

# 组装富 manifest
out = OrderedDict()
for slug, files in data.items():
    files_sorted = sorted(files, key=lambda x: x[0])
    file_entries = []
    for name, size in files_sorted:
        cat, desc = classify(name)
        file_entries.append({
            "name": name,
            "size": size,
            "category": cat,
            "desc": desc
        })
    out[slug] = {
        "zipFile": f"{slug}-design-pack.zip",
        "zipSize": existing.get(slug, {}).get("size", sum(f["size"] for f in file_entries)),
        "folderUrl": f"/packs/{slug}/",
        # agentUrl 指向文件夹（nginx 自动 serve DESIGN_SPEC.md），让 AI agent 拿到整个上下文而非单文件
        "agentUrl": f"/packs/{slug}/",
        "specPreviewUrl": f"/packs/{slug}/DESIGN_SPEC.md",
        "generatedAt": "2026-05-28",
        "fileCount": len(file_entries),
        "files": file_entries
    }

# 写出
target = ROOT / "packs-index.json"
target.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"✓ 写入 {target}")
print(f"  · {len(out)} 个 pack · 每个 ~{len(file_entries)} 文件")
print(f"  · 总尺寸: {sum(p['zipSize'] for p in out.values()) // 1024 // 1024} MB（ZIP 体积之和）")
