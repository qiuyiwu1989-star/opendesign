#!/usr/bin/env python3
"""Fail closed on drift in the repository-backed Design Director Skill."""

from __future__ import annotations

import json
import pathlib
import re
import sys


SKILL_ROOT = pathlib.Path(__file__).resolve().parents[1]
REPO_ROOT = SKILL_ROOT.parents[1]


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    guide = (SKILL_ROOT / "references" / "studio-contract.md").read_text(encoding="utf-8")
    compiler_example = (SKILL_ROOT / "references" / "input-package.md").read_text(encoding="utf-8")
    contract_index = (REPO_ROOT / "studio/packages/contracts/src/index.ts").read_text(encoding="utf-8")
    input_schema = json.loads((REPO_ROOT / "studio/packages/design-director/design-director-input.schema.json").read_text(encoding="utf-8"))

    contract_version = re.search(r'STRUCTURED_HTML_CONTRACT_VERSION = "([^"]+)"', contract_index)
    if contract_version is None:
        fail("cannot locate STRUCTURED_HTML_CONTRACT_VERSION")
    if f"contract `{contract_version.group(1)}`" not in guide:
        fail("field guide contract version differs from source")

    pack_dir = REPO_ROOT / "studio/packages/design-packs/packs"
    expected_pins = {
        "executive-proposal-cn": "1.0.0",
        "research-keynote-cn": "1.0.0",
        "editorial-story-graphics-cn": "1.0.0",
    }
    for pack_id, expected_version in expected_pins.items():
        pack = json.loads((pack_dir / f"{pack_id}.json").read_text(encoding="utf-8"))
        if pack.get("id") != pack_id or pack.get("version") != expected_version:
            fail(f"unexpected Design Pack pin for {pack_id}")
        if f"`{pack_id}@{expected_version}`" not in skill:
            fail(f"SKILL.md does not pin {pack_id}@{expected_version}")

    required = input_schema.get("required", [])
    for field in required:
        if f'"{field}"' not in compiler_example:
            fail(f"compiler example omits required input field {field}")

    blocked_promises = ("automatically publish", "auto-publish", "auto deploy")
    normalized = skill.lower()
    if any(value in normalized for value in blocked_promises):
        fail("skill contains an automatic publish/deploy promise")
    for required_phrase in ("never invent", "remote fonts", "remote images", "Human approval is the terminal gate"):
        if required_phrase not in skill:
            fail(f"SKILL.md is missing guardrail: {required_phrase}")

    print("Design Director Skill static checks passed")


if __name__ == "__main__":
    main()
