#!/usr/bin/env python3
"""Tag 词表归一化 · 检索精准度的地基

为什么存在：mimo 批量生成 tags 时大小写/写法不稳定，同一个概念裂成
好几个 tag（Editorial(309)/editorial(23)、AI(40)/ai(36)、SaaS/saas、
dev/devtools/Developer Tools…共 30+ 组变体）。前端筛选 chips 出现重复项、
检索时信号被稀释——这是检索精准度最直接的地基问题。

用法：
  from tag_canon import canon                # ingest.py 在生成时调用
  python3 scripts/tag_canon.py --rewrite     # 一次性重写 sites/*.json
  python3 scripts/tag_canon.py --dry-run     # 只看会改什么
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent.parent.resolve()
SITES_DIR = ROOT / "sites"

# 高置信语义合并（保守：只合并确定是同一概念的）。key 是 normkey（小写去空格连字符）。
SEMANTIC = {
    "dev": "Developer Tools",
    "devtools": "Developer Tools",
    "devtool": "Developer Tools",
    "tool": "Tooling",
    "tools": "Tooling",
    "type": "Typography",
    "ecommerce": "E-commerce",
    "e-commerce": "E-commerce",
}

# 全小写 tag 转 Title Case 时的缩写例外
ACRONYMS = {
    "ai": "AI", "3d": "3D", "saas": "SaaS", "webgl": "WebGL", "ui": "UI",
    "ux": "UX", "nft": "NFT", "api": "API", "seo": "SEO", "css": "CSS",
    "cms": "CMS", "b2b": "B2B", "vr": "VR", "ar": "AR", "iot": "IoT",
    "db": "DB", "ide": "IDE", "sdk": "SDK", "llm": "LLM", "gpu": "GPU",
}

_canon_map = None  # normkey → canonical form，惰性构建


def _normkey(tag: str) -> str:
    return re.sub(r"[\s_-]+", "", tag.strip().lower())


def _titlecase(tag: str) -> str:
    words = tag.strip().split()
    out = []
    for w in words:
        lw = w.lower()
        out.append(ACRONYMS.get(lw, w[:1].upper() + w[1:] if w else w))
    return " ".join(out)


def _build_map() -> dict:
    """扫全库统计每个变体组的最高频写法作为 canonical，再叠加语义合并。"""
    freq = Counter()
    if SITES_DIR.exists():
        for f in SITES_DIR.glob("*.json"):
            try:
                s = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                continue
            for t in s.get("tags", []) or []:
                if isinstance(t, str) and t.strip():
                    freq[t.strip()] += 1

    groups: dict = {}
    for tag, n in freq.items():
        groups.setdefault(_normkey(tag), []).append((n, tag))

    m = {}
    for key, variants in groups.items():
        if key in SEMANTIC:
            m[key] = SEMANTIC[key]
            continue
        variants.sort(reverse=True)          # 最高频写法赢
        winner = variants[0][1]
        if winner == winner.lower():          # 全小写的赢家 → Title Case 统一门面
            winner = _titlecase(winner)
        m[key] = winner
    for key, val in SEMANTIC.items():         # 语义映射对没出现过的 key 也生效
        m.setdefault(key, val)
    return m


def canon(tag: str) -> str:
    """单个 tag → canonical 形式。ingest.py 生成新站时调用。"""
    global _canon_map
    if not isinstance(tag, str) or not tag.strip():
        return tag
    if _canon_map is None:
        _canon_map = _build_map()
    key = _normkey(tag)
    if key in _canon_map:
        return _canon_map[key]
    # 没见过的新 tag：小写则 Title Case，其余保持原样
    t = tag.strip()
    return _titlecase(t) if t == t.lower() else t


def canon_list(tags: list) -> list:
    """整组归一化 + 去重（保序）。"""
    seen, out = set(), []
    for t in tags or []:
        c = canon(t)
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def main():
    dry = "--dry-run" in sys.argv
    if "--rewrite" not in sys.argv and not dry:
        print(__doc__)
        return
    changed = 0
    for f in sorted(SITES_DIR.glob("*.json")):
        try:
            s = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        old = s.get("tags", []) or []
        new = canon_list(old)
        if new != old:
            changed += 1
            if dry:
                print(f"{f.stem}: {old} → {new}")
            else:
                s["tags"] = new
                f.write_text(json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{'将' if dry else '已'}修改 {changed} 个站的 tags")


if __name__ == "__main__":
    main()
