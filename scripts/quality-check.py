#!/usr/bin/env python3
"""
OpenDesign · 质量门校验脚本

跑在 schema validation 之上。Schema 只查"格式合法"，这个查"内容质量"：
- 颜色至少有 bg/ink，不能全 null
- typography display/body 必须填类别（不能是品牌名）
- donts ≥ 6 条，每条 ≥ 30 字符（不是 stub）
- identity.oneLiner / analogy / keywords 长度合规
- 5 语言全齐，narrative 每个 slot 不空

用法:
  python3 scripts/quality-check.py                   # 全部
  python3 scripts/quality-check.py vercel cursor     # 指定
  python3 scripts/quality-check.py --strict          # warning 也算失败
  python3 scripts/quality-check.py --auto-quarantine # 不过的标 status: needs_review

退出码:
  0 = 全部 pass
  1 = 有 site 失败
"""

import json, sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.resolve()
SITES_DIR = ROOT / "sites"
LANGS = ["en", "zh-CN", "zh-TW", "ja", "ko"]

ANSI = {"g": "\033[32m", "r": "\033[31m", "y": "\033[33m", "dim": "\033[2m", "b": "\033[1m", "x": "\033[0m"}

# 已知字体类别（mimo 出这些是好的）
FONT_CATEGORIES = {
    "humanist-sans", "grotesque-sans", "geometric-sans",
    "transitional-serif", "didone-serif", "slab-serif", "modern-serif",
    "old-style-serif", "antiqua-serif",
    "monospace", "mono", "display", "neo-grotesque", "neo-grotesque-sans",
    "serif", "sans-serif", "script", "handwritten"
}

# 这些字符串出现 → 八九不离十是品牌名（要警告）
BRAND_FONT_HINTS = [
    "inter", "söhne", "sohne", "gt america", "gt walsheim", "circular",
    "graphik", "founders grotesk", "neue haas", "helvetica neue", "futura",
    "ibm plex", "sf pro", "geist", "instrument serif", "ivar", "manuka",
    "sodosans", "nouvelr"
]


def check_site(site: dict) -> tuple[list[str], list[str]]:
    """返回 (errors, warnings)。errors 阻止上架。"""
    errors, warnings = [], []
    slug = site.get("id", "?")

    # ---- Colors ----
    colors = site.get("spec", {}).get("colors", {})
    if not colors:
        errors.append("colors block missing entirely")
    else:
        if not colors.get("bg") and not colors.get("ink"):
            errors.append("colors: at least one of bg/ink must be set")
        # 颜色全 null 的话 spec 几乎没用
        filled = sum(1 for v in colors.values() if v)
        if filled < 3:
            errors.append(f"colors: only {filled} non-null tokens (need ≥ 3)")

    # ---- Typography ----
    typo = site.get("spec", {}).get("typography", {})
    for field in ("display", "body"):
        val = (typo.get(field) or "").lower().strip()
        if not val:
            warnings.append(f"typography.{field}: empty")
            continue
        # 是否撞到品牌名黑名单
        for hint in BRAND_FONT_HINTS:
            if hint in val:
                errors.append(f"typography.{field}: '{val}' looks like a brand name (must be a category)")
                break
        # 是否在已知类别白名单
        if val not in FONT_CATEGORIES and not any(c in val for c in FONT_CATEGORIES):
            warnings.append(f"typography.{field}: '{val}' not in canonical category list (curator may want to recheck)")

    scale = typo.get("scale", [])
    if len(scale) < 4:
        warnings.append(f"typography.scale: only {len(scale)} entries (typical: 5-7)")

    # ---- Identity ----
    ident = site.get("spec_i18n", {}).get("en", {}).get("identity", {})
    one_liner = ident.get("oneLiner", "")
    if not one_liner:
        errors.append("identity.oneLiner: empty")
    elif len(one_liner) < 15:
        warnings.append(f"identity.oneLiner: too short ({len(one_liner)} chars)")
    elif len(one_liner) > 200:
        warnings.append(f"identity.oneLiner: too long ({len(one_liner)} chars)")

    analogy = ident.get("analogy", "")
    if not analogy:
        warnings.append("identity.analogy: empty (a specific analogy makes spec memorable)")
    elif len(analogy) < 25:
        warnings.append(f"identity.analogy: too generic / short ({len(analogy)} chars)")

    keywords = ident.get("keywords", [])
    if len(keywords) < 3:
        warnings.append(f"identity.keywords: only {len(keywords)} (typical: 5)")

    # ---- Donts ----
    donts = site.get("spec_i18n", {}).get("en", {}).get("donts", [])
    if len(donts) < 6:
        errors.append(f"donts: only {len(donts)} entries (≥ 6 required per spec)")
    else:
        short_count = sum(1 for d in donts if len(d) < 30)
        if short_count > 1:
            warnings.append(f"donts: {short_count} entries are < 30 chars (likely too vague)")

    # ---- System Prompt ----
    sp = site.get("spec_i18n", {}).get("en", {}).get("systemPrompt", "")
    if not sp:
        errors.append("systemPrompt: empty (the most reusable artifact)")
    elif len(sp) < 200:
        warnings.append(f"systemPrompt: very short ({len(sp)} chars)")
    elif len(sp) > 1500:
        warnings.append(f"systemPrompt: very long ({len(sp)} chars)")

    # ---- 5 lang coverage ----
    desc = site.get("desc", {})
    spec_i18n = site.get("spec_i18n", {})
    narrative = site.get("narrative", {})
    for lang in LANGS:
        if lang not in desc:
            errors.append(f"desc.{lang}: missing")
        elif not desc[lang].get("palette"):
            errors.append(f"desc.{lang}.palette: empty")
        if lang not in spec_i18n:
            errors.append(f"spec_i18n.{lang}: missing")
        if lang not in narrative:
            errors.append(f"narrative.{lang}: missing")
        else:
            n = narrative[lang]
            for slot in ["ch1_intro", "ch2_intro", "ch6_intro", "ch8_outro"]:
                if not n.get(slot) or len(n[slot].strip()) < 20:
                    errors.append(f"narrative.{lang}.{slot}: missing or stub")

    # ---- Tags ----
    if not site.get("tags") or len(site["tags"]) < 2:
        warnings.append(f"tags: only {len(site.get('tags', []))} (curator should add 3-5)")

    # ---- Title sanity ----
    title = site.get("title", "")
    if not title or len(title) < 2:
        errors.append("title: missing or too short")

    return errors, warnings


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    strict = "--strict" in sys.argv
    quarantine = "--auto-quarantine" in sys.argv

    files = sorted(SITES_DIR.glob("*.json"))
    if args:
        wanted = set(args)
        files = [f for f in files if f.stem in wanted]

    if not files:
        print(f"{ANSI['dim']}no site files to check{ANSI['x']}")
        sys.exit(0)

    total_err = 0
    total_warn = 0
    quarantined = []
    passed = []

    for f in files:
        slug = f.stem
        try:
            site = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"{ANSI['r']}✗{ANSI['x']} {slug}  (read error: {e})")
            total_err += 1
            continue

        errs, warns = check_site(site)
        total_err += len(errs)
        total_warn += len(warns)

        if errs:
            print(f"{ANSI['r']}✗{ANSI['x']} {slug}")
            for e in errs: print(f"    {ANSI['r']}error{ANSI['x']}    {e}")
            for w in warns: print(f"    {ANSI['y']}warn{ANSI['x']}     {w}")
            if quarantine and site.get("status") == "completed":
                site["status"] = "needs_review"
                site.setdefault("_meta", {})["quality_errors"] = errs
                f.write_text(json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                quarantined.append(slug)
        elif warns:
            print(f"{ANSI['y']}⚠{ANSI['x']} {slug}")
            for w in warns: print(f"    {ANSI['y']}warn{ANSI['x']}     {w}")
            passed.append(slug)
        else:
            print(f"{ANSI['g']}✓{ANSI['x']} {slug}")
            passed.append(slug)

    print()
    print(f"{len(files)} files · {ANSI['g']}{len(passed)} pass{ANSI['x']} · {ANSI['r']}{total_err} errors{ANSI['x']} · {ANSI['y']}{total_warn} warnings{ANSI['x']}")
    if quarantine and quarantined:
        print(f"\n{ANSI['y']}Quarantined (status → needs_review):{ANSI['x']}")
        for q in quarantined: print(f"  - {q}")
        print(f"\nRerun ingest with --slug {{slug}} to retry, or hand-edit sites/<slug>.json")

    failed = total_err > 0 or (strict and total_warn > 0)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
