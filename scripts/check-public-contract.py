#!/usr/bin/env python3
"""Verify public facts and interface contracts without network or production writes."""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors: list[str] = []


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def load(path: str):
    return json.loads(read(path))


def check(condition: bool, message: str) -> None:
    if condition:
        print(f"  ✓ {message}")
    else:
        print(f"  ✗ {message}")
        errors.append(message)


catalog_doc = load("catalog.json")
designs = (
    catalog_doc
    if isinstance(catalog_doc, list)
    else catalog_doc.get("designs") or catalog_doc.get("sites") or catalog_doc.get("entries") or []
)
packs = load("packs-index.json")
pack_count = len(packs)
design_count = len(designs)
with_completeness = sum(
    1 for item in designs if isinstance(item.get("spec_completeness"), (int, float))
)

print("Public data")
check(design_count >= 1400, f"catalog has at least 1,400 designs ({design_count})")
check(
    with_completeness >= design_count * 0.9,
    f"at least 90% of catalog entries expose spec_completeness ({with_completeness}/{design_count})",
)
check(pack_count > 0, f"packs index is non-empty ({pack_count})")

llms = read("llms.txt")
build = read("scripts/build.py")
positioning = read("docs/positioning.md")

print("\nPublic wording")
for stale in ("545+ 真实设计系统", "YAML + 8 段"):
    check(stale not in llms, f"llms.txt does not contain stale wording: {stale}")
    check(stale not in build, f"build.py does not regenerate stale wording: {stale}")
check("1,400+ 真实设计系统" in llms, "llms.txt uses the stable 1,400+ public threshold")
check("YAML + 最多 9 章" in llms, "llms.txt describes conditional DESIGN.md sections honestly")

pack_match = re.search(r"完整包（(\d+) 个", llms)
check(
    bool(pack_match and int(pack_match.group(1)) == pack_count),
    f"llms.txt pack count matches packs-index.json ({pack_count})",
)

exact_count = f"{design_count:,}"
check(exact_count in read("README.md"), f"README.md contains current exact catalog count ({exact_count})")
check(exact_count in read("README.zh-CN.md"), f"README.zh-CN.md contains current exact catalog count ({exact_count})")

print("\nProduct boundary")
for phrase in ("OpenDesign Library", "OpenDesign Studio", "Scene IR"):
    check(phrase in positioning, f"positioning.md defines {phrase}")

print("\nMCP contract")
core = read("mcp/lib/core.mjs")
required_tools = {
    "search_designs",
    "list_designs",
    "get_design_system",
    "fetch_design_spec_markdown",
    "get_director_protocol",
    "recommend_references",
    "get_critique_rubric",
}
for name in sorted(required_tools):
    check(f'name: "{name}"' in core, f"MCP exports {name}")

print("\n" + "─" * 46)
if errors:
    print(f"✗ public contract failed ({len(errors)} checks)")
    sys.exit(1)
print("✓ public contract passed")
