#!/usr/bin/env python3
"""
把一个 extract 目录 + 打好的 ZIP，写成 packs-index.json 里该 slug 的条目。
这是让前端从「请求生成」翻成「下载完整包」的关键一步。

用法：
  python3 scripts/pack_index_entry.py <slug> <extract_dir> <zip_path> [iso_timestamp]
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent.resolve()
INDEX = ROOT / "packs-index.json"

# desc 用 canonical 中文串（前端 i18n.packDesc() 据此翻译）。必须与 PACK_DESC_I18N 的 key 对齐。
DESC = {
    "DESIGN_SPEC.md": ("spec", "8 章 magazine 风格规范 · :root CSS 变量可直接粘"),
    "sites-entry.json": ("spec", "11 层 Tokens spec JSON · 可粘进 sites.js"),
    "summary.json": ("data", "全部元素 computed styles 按频次聚合（真 token 数据源）"),
    "fonts.json": ("data", "真实加载的字体文件清单 + 完整 fallback chain"),
    "01_desktop_full.png": ("shot", "1440 桌面全页截图 (@2x retina)"),
    "02_desktop_hero.png": ("shot", "桌面首屏（hero）"),
    "04_mobile_full.png": ("shot", "390 移动全页截图 (@3x retina)"),
    "05_mobile_hero.png": ("shot", "移动首屏"),
}


def describe(name: str):
    if name in DESC:
        return DESC[name]
    if name.startswith("03_desktop_section_"):
        return ("shot", "桌面滚动分段（90% viewport 步进，作为视觉证据）")
    if name.endswith(".png"):
        return ("shot", "截图")
    if name.endswith(".json"):
        return ("data", "结构化数据")
    return ("spec", "")


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)
    slug, ex_dir, zip_path = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    ts = sys.argv[4] if len(sys.argv) > 4 else datetime.now(timezone.utc).isoformat(timespec="seconds")

    # 收集进包的文件（与 pack.sh 一致：DESIGN_SPEC.md + sites-entry.json + summary.json + fonts.json + *.png）
    wanted = ["DESIGN_SPEC.md", "sites-entry.json", "summary.json", "fonts.json"]
    files = []
    for name in wanted:
        p = ex_dir / name
        if p.exists():
            cat, desc = describe(name)
            files.append({"name": name, "size": p.stat().st_size, "category": cat, "desc": desc})
    for p in sorted(ex_dir.glob("*.png")):
        cat, desc = describe(p.name)
        files.append({"name": p.name, "size": p.stat().st_size, "category": cat, "desc": desc})

    if not files:
        print(f"✗ {ex_dir} 里没有可打包文件")
        sys.exit(1)

    entry = {
        "zipFile": zip_path.name,
        "zipSize": zip_path.stat().st_size if zip_path.exists() else sum(f["size"] for f in files),
        "folderUrl": f"/packs/{slug}/",
        "agentUrl": f"/packs/{slug}/",
        "specPreviewUrl": f"/packs/{slug}/DESIGN_SPEC.md",
        "generatedAt": ts,
        "fileCount": len(files),
        "files": files,
    }

    idx = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {}
    idx[slug] = entry
    INDEX.write_text(json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ packs-index.json[{slug}] · {len(files)} files · {entry['zipSize']/1024/1024:.1f} MB")


if __name__ == "__main__":
    main()
