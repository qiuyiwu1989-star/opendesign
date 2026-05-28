#!/usr/bin/env python3
"""
OpenDesign · sites/<slug>.json 校验脚本

用法:
  python3 scripts/validate-sites.py                    # 校验全部
  python3 scripts/validate-sites.py linear stripe      # 校验指定的几个
  python3 scripts/validate-sites.py --strict           # 严格模式（warnings 也算失败）
  python3 scripts/validate-sites.py --json             # 输出 JSON 给 CI 用

退出码:
  0 = 全部 schema-valid
  1 = 至少一个失败
  2 = 配置 / IO 错误
"""

import json
import sys
from pathlib import Path

try:
    import jsonschema
    from jsonschema import Draft202012Validator
except ImportError:
    print("✗ jsonschema not installed. Run: pip3 install jsonschema", file=sys.stderr)
    sys.exit(2)


ROOT = Path(__file__).parent.parent.resolve()
SCHEMA_PATH = ROOT / "docs" / "site-schema.json"
SITES_DIR = ROOT / "sites"

ANSI_GREEN = "\033[32m"
ANSI_RED = "\033[31m"
ANSI_YELLOW = "\033[33m"
ANSI_DIM = "\033[2m"
ANSI_RESET = "\033[0m"


def load_schema():
    if not SCHEMA_PATH.exists():
        print(f"✗ Schema not found: {SCHEMA_PATH}", file=sys.stderr)
        sys.exit(2)
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def discover_sites(filter_slugs=None):
    if not SITES_DIR.exists():
        return []
    files = sorted(SITES_DIR.glob("*.json"))
    if filter_slugs:
        wanted = set(filter_slugs)
        files = [f for f in files if f.stem in wanted]
    return files


def soft_checks(site, slug):
    """非 schema 但实际危险的检查"""
    issues = []
    if site.get("id") != slug:
        issues.append(f"id ({site.get('id')!r}) != filename ({slug!r})")
    desc = site.get("desc", {})
    if "en" not in desc:
        issues.append("desc.en missing — en is canonical, required")
    for lang in ["zh-CN", "zh-TW", "en", "ja", "ko"]:
        if lang in desc:
            block = desc[lang]
            for field in ["palette", "layout", "interaction", "motion", "notes"]:
                if field not in block or not block[field]:
                    issues.append(f"desc.{lang}.{field} empty/missing")
    spec_i18n = site.get("spec_i18n", {})
    if site.get("spec") and "en" not in spec_i18n:
        issues.append("spec exists but spec_i18n.en missing")
    return issues


def main():
    args = sys.argv[1:]
    strict = "--strict" in args
    as_json = "--json" in args
    filter_slugs = [a for a in args if not a.startswith("--")]

    schema = load_schema()
    validator = Draft202012Validator(schema)

    files = discover_sites(filter_slugs or None)
    if not files:
        if filter_slugs:
            print(f"✗ No matching site files found for: {filter_slugs}", file=sys.stderr)
        else:
            print(f"{ANSI_DIM}(sites/ is empty — nothing to validate yet.){ANSI_RESET}")
        sys.exit(0 if not filter_slugs else 2)

    results = []
    total_errs = 0
    total_warns = 0

    for fpath in files:
        slug = fpath.stem
        try:
            site = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception as e:
            results.append({"slug": slug, "errors": [f"JSON parse error: {e}"], "warnings": []})
            total_errs += 1
            continue

        errs = [
            f"{'/'.join(map(str, e.absolute_path))}: {e.message}"
            for e in validator.iter_errors(site)
        ]
        warns = soft_checks(site, slug)
        results.append({"slug": slug, "errors": errs, "warnings": warns})
        total_errs += len(errs)
        total_warns += len(warns)

    if as_json:
        print(json.dumps({
            "total_files": len(files),
            "total_errors": total_errs,
            "total_warnings": total_warns,
            "results": results,
        }, indent=2, ensure_ascii=False))
    else:
        for r in results:
            slug = r["slug"]
            errs, warns = r["errors"], r["warnings"]
            if not errs and not warns:
                print(f"{ANSI_GREEN}✓{ANSI_RESET} {slug}")
            else:
                badge = (
                    f"{ANSI_RED}✗{ANSI_RESET}" if errs
                    else f"{ANSI_YELLOW}⚠{ANSI_RESET}"
                )
                print(f"{badge} {slug}")
                for e in errs:
                    print(f"    {ANSI_RED}error{ANSI_RESET}    {e}")
                for w in warns:
                    print(f"    {ANSI_YELLOW}warn{ANSI_RESET}     {w}")

        print()
        print(f"{len(files)} files · {ANSI_RED}{total_errs} errors{ANSI_RESET} · {ANSI_YELLOW}{total_warns} warnings{ANSI_RESET}")

    failed = total_errs > 0 or (strict and total_warns > 0)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
