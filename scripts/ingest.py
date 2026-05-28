#!/usr/bin/env python3
"""
OpenDesign · 批量收录流水线（v0.3）

把 URL → sites/<slug>.json 全套数据。幂等、断点续跑、token 计量。

使用：
  # 1. 设环境变量（任意 Anthropic-format endpoint 都行）
  export ANTHROPIC_API_KEY=tp-xxxxxxxxxxxxxx
  export ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
  export ANTHROPIC_MODEL=mimo-v2.5

  # 2. 单站 / 一组
  python3 scripts/ingest.py --url https://linear.app
  python3 scripts/ingest.py --input urls.txt

  # 3. 重跑失败 / 补未完成步骤
  python3 scripts/ingest.py --retry-failed
  python3 scripts/ingest.py --slug vercel --only vision

  # 4. 看预算 / 干跑
  python3 scripts/ingest.py --input urls.txt --budget 10.00 --dry-run

成本预算（mimo-v2.5）：
  vision      ~$0.05   ← 看截图，最贵
  translate*4 ~$0.04   ← desc + spec_i18n 翻 4 语言
  narrative   ~$0.02   ← Prompt #3 写 en 叙事段
  narrate*4   ~$0.04   ← 把 narrative 翻成 4 语言
  ─────────────────
  per site    ~$0.15   ·  1000 站 ≈ $150

详见 docs/data-pipeline.md / docs/prompts.md
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).parent.parent.resolve()
SITES_DIR = ROOT / "sites"
SCHEMA_PATH = ROOT / "docs" / "site-schema.json"

LANGS = ["zh-CN", "zh-TW", "ja", "ko"]
LANG_NATIVE = {"en": "English", "zh-CN": "简体中文", "zh-TW": "繁體中文", "ja": "日本語", "ko": "한국어"}

SCHEMA_VERSION = "0.3"
VISION_PROMPT_VERSION = "0.3"
NARRATIVE_PROMPT_VERSION = "0.3"

# 估算成本（USD per call）。可通过 _meta.*_tokens 后续校准。
COST_ESTIMATE = {
    "vision":      0.05,
    "translate":   0.01,
    "narrative":   0.02,
}

ANSI = {
    "g": "\033[32m", "r": "\033[31m", "y": "\033[33m",
    "dim": "\033[2m", "b": "\033[1m", "x": "\033[0m",
}

# ============================================================
# Anthropic-format API wrapper
# ============================================================

def call_mimo(
    messages: list[dict],
    *,
    system: str | None = None,
    max_tokens: int = 4096,
    timeout: int = 90,
    enable_thinking: bool = False,
) -> dict:
    """
    POST 到任意 Anthropic-format endpoint。返回:
      { content_text, input_tokens, output_tokens, raw }

    重要：mimo-v2.5 默认开 extended thinking，会用掉一半 output token + 增加 JSON 被截风险。
    本函数默认 disable thinking，输出只剩 JSON，省 ~50% output cost。
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    base_url = (os.environ.get("ANTHROPIC_BASE_URL") or "https://api.anthropic.com").rstrip("/")
    model = os.environ.get("ANTHROPIC_MODEL", "mimo-v2.5")

    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set. Export it first.")

    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    if system:
        payload["system"] = system
    if not enable_thinking:
        # mimo 兼容 anthropic extended thinking API；关掉省 token
        payload["thinking"] = {"type": "disabled"}

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url=f"{base_url}/v1/messages",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"API HTTP {e.code}: {err_body[:500]}") from e

    text_chunks = [c.get("text", "") for c in resp.get("content", []) if c.get("type") == "text"]
    return {
        "content_text": "".join(text_chunks).strip(),
        "input_tokens": resp.get("usage", {}).get("input_tokens", 0),
        "output_tokens": resp.get("usage", {}).get("output_tokens", 0),
        "raw": resp,
    }


def parse_json_from_response(text: str) -> dict:
    """
    mimo 经常会用 ```json ... ``` 包；直接 strip 不靠谱，宽松解析。
    """
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    start = s.find("{")
    end = s.rfind("}")
    if start < 0 or end < 0:
        raise ValueError(f"No JSON object found in response: {text[:200]}")
    candidate = s[start:end + 1]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        # 容错：去掉 JSON 中的尾随逗号 ", }" / ", ]" 后再 try 一次
        cleaned = re.sub(r",\s*([}\]])", r"\1", candidate)
        return json.loads(cleaned)


def call_mimo_with_retry(messages, *, system=None, max_tokens=4096, retries: int = 2, **kwargs):
    """Wraps call_mimo with 1-shot retry on JSONDecodeError + transient HTTP."""
    last_err = None
    for attempt in range(retries):
        try:
            return call_mimo(messages, system=system, max_tokens=max_tokens, **kwargs)
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                time.sleep(1.5 ** attempt)
                continue
    raise last_err


# ============================================================
# Prompt templates（与 docs/prompts.md 同步，改 prompt 同时 bump 版本号）
# ============================================================

def vision_prompt_system() -> str:
    return """You are a senior visual systems analyst. Look at the provided website screenshot and extract its design DNA into the OpenDesign 11-layer Tokens spec. Output VALID JSON ONLY, no markdown fences, no commentary.

You must be a strict observer. Only describe what you can see in the screenshot. Never invent values that are not visually evident.

Output language: English. Other languages will be translated downstream by a cheaper text-only model.

HARD CONSTRAINTS:
- Colors MUST be hex codes you can defend from the palette. Do not invent unseen colors. If unsure, set to null.
- Typography display/body/mono fields are CATEGORIES (humanist-sans, grotesque-sans, transitional-serif, didone-serif, etc), NEVER brand names like "Inter" or "Söhne".
- donts MUST have at least 6 entries, each reverse-validated against the screenshot. Format: "don't do X — screenshot shows Y instead".
- accent MUST be null if no single dominant high-chroma color exists.
- systemPrompt MUST be 250 words max and include: positioning, key hex colors, font categories, at least 3 critical donts.

OUTPUT FORMAT (return JSON exactly matching this shape):

{
  "spec": {
    "identity":    { "keywords": [...], "analogy": "...", "oneLiner": "..." },
    "colors":      { "bg": "#...", "bgSoft": null, "bgQuiet": null, "ink": "#...", "inkSoft": null, "muted": "#...", "mutedSoft": null, "accent": "#... or null", "line": "rgba(...)", "principle": "..." },
    "typography":  { "display": "...", "body": "...", "mono": "...", "scale": [{"token": "display", "size": 56, "lh": 1.0, "weight": 500, "ls": "-1px", "use": "..."}], "rules": [] },
    "spacing":     { "base": 4, "scale": [4,8,16,24,32,48,64,96], "rhythm": "..." },
    "surfaces":    { "radius": {"sm": 4, "md": 8, "lg": 12, "pill": 999}, "shadows": [...], "borders": "..." },
    "layout":      { "container": 1280, "paragraph": 680, "columns": 12, "gutter": 24, "breakpoints": [768,1024], "skeleton": "..." },
    "components":  { "button": "...", "card": "...", "chip": "...", "input": "...", "hero": "..." },
    "motion":      { "durations": {"micro": 220, "small": 400, "medium": 800}, "easing": "cubic-bezier(...)", "patterns": [...] },
    "interaction": { "hover": "...", "click": "...", "transition": "...", "keyboard": "..." },
    "voice":       { "tone": "...", "headlineStyle": "...", "ctaStyle": "...", "avoid": [...] },
    "donts":       ["...", "...", "...", "...", "...", "..."],
    "systemPrompt": "..."
  },
  "desc": {
    "palette":     "1 sentence",
    "layout":      "1 sentence",
    "interaction": "1 sentence",
    "motion":      "1 sentence",
    "notes":       "1 sentence on why this site is worth including"
  }
}

Refuse any output other than this exact JSON shape."""


def translate_prompt_system(target_lang: str) -> str:
    name = LANG_NATIVE[target_lang]
    extra = {
        "zh-TW": "Use Taiwan vocabulary (軟體 / 螢幕 / 影片 / 網路 / 程式碼).",
        "zh-CN": "Use Mainland vocabulary (软件 / 屏幕 / 视频 / 网络 / 代码).",
        "ja":    "Use polite editorial register (です/ます). Editorial detachment, not marketing.",
        "ko":    "Use standard polite form (합니다/입니다). Light editorial feel.",
    }.get(target_lang, "")

    return f"""You are a senior copy editor and bilingual designer. Translate the provided design-spec JSON fragment from English to {name}.

Target language: {name} ({target_lang})

CONSTRAINTS:
- Preserve the editorial-minimal voice. Sound like a careful design writer, not literal output.
- NEVER translate these — keep as-is in English:
  - Proper nouns and brand names (Apple, Linear, Stripe, OpenDesign)
  - CSS technical terms: hover, focus, scroll, parallax, gradient, cubic-bezier, padding, etc.
  - File extensions and code values (.png, #F5F5F7, 16px)
  - Industry acronyms: SaaS, AI, 3D, URL, API, MD
- Font categories stay English: humanist-sans, grotesque-sans, etc.
- Hex codes, pixel values, weights, durations: UNCHANGED.
{extra}

OUTPUT FORMAT: return JSON only, exactly matching the input shape. Same keys, translated string values. No commentary, no markdown fences."""


def narrative_prompt_system(target_lang: str) -> str:
    name = LANG_NATIVE[target_lang]
    return f"""You are a senior design writer for a magazine like Eye, Print, or Wallpaper. You're writing a printed-quality design-system migration spec from a JSON spec sheet.

Your output is the NARRATIVE chunks of an 8-chapter design spec. The data tables (color hex grid, type scale, spacing scale, don'ts list) will be templated separately. You only write the prose between them.

Output language: {name} ({target_lang})

Chapter narrative slots:
  Chapter 1 — Identity DNA:           ch1_intro  (2-3 sentences weaving in the analogy)
  Chapter 2 — Color:                  ch2_intro (1-2 sentences), ch2_outro (1 sentence on principle)
  Chapter 3 — Typography:             ch3_intro (1-2 sentences on type voice and category choices)
  Chapter 4 — Spacing:                ch4_intro (1 short sentence on rhythm)
  Chapter 5 — Surfaces:               ch5_intro (1-2 sentences on depth and borders)
  Chapter 6 — Layout:                 ch6_intro (2 sentences sketching skeleton in prose)
  Chapter 7 — Motion & Interaction:   ch7_intro (2 sentences on motion philosophy)
  Chapter 8 — Voice & Don'ts:         ch8_intro (1-2 sentences on editorial voice), ch8_outro (1 sentence on what they DELIBERATELY don't do)

CONSTRAINTS:
- Editorial tone. No "imagine", no "experience", no "elevate". Avoid marketing puffery. Write like you're explaining a beautiful building's construction.
- 1-3 sentences per slot. Total ~600-900 words.
- Never invent specifics not in the JSON.
- Keep proper nouns and font categories as-is.
- Use Markdown bold sparingly, only on critical noun phrases.

OUTPUT FORMAT (JSON only):

{{
  "ch1_intro": "...", "ch2_intro": "...", "ch2_outro": "...",
  "ch3_intro": "...", "ch4_intro": "...", "ch5_intro": "...",
  "ch6_intro": "...", "ch7_intro": "...", "ch8_intro": "...", "ch8_outro": "..."
}}"""


# ============================================================
# Step functions
# ============================================================

def step_screenshot(site: dict) -> dict:
    """如果 image 已经有，跳过。否则用 thum.io 即时合成。"""
    if site.get("image"):
        return site
    url = site["url"]
    # thum.io 不需要 token、即时生成
    site["image"] = f"https://image.thum.io/get/width/1440/{url}"
    site["status"] = "screenshot"
    return site


def fetch_image_base64(url: str, timeout: int = 60) -> tuple[str, str]:
    """返回 (base64_str, media_type)"""
    with urllib.request.urlopen(url, timeout=timeout) as r:
        media = r.headers.get("Content-Type", "image/png").split(";")[0].strip()
        data = r.read()
    return base64.b64encode(data).decode("ascii"), media


def step_vision(site: dict, *, dry_run: bool = False) -> dict:
    """Prompt #1: 截图 → en spec + en desc"""
    if site.get("spec") and site.get("spec_i18n", {}).get("en"):
        return site  # 已完成 vision

    if dry_run:
        print(f"  [dry] vision call for {site['id']}")
        return site

    print(f"  ▸ vision call (mimo)...")
    img_b64, media_type = fetch_image_base64(site["image"])
    user_msg = [
        {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": img_b64}},
        {"type": "text",  "text": f"Site URL: {site['url']}\nTitle: {site['title']}\nTags: {', '.join(site.get('tags', []))}\n\nExtract the 11-layer design DNA and return the exact JSON shape."}
    ]
    result = call_mimo(
        messages=[{"role": "user", "content": user_msg}],
        system=vision_prompt_system(),
        max_tokens=6000,  # vision JSON ~1500 token + mimo thinking ~3000 token，留头
    )
    parsed = parse_json_from_response(result["content_text"])

    if "spec" not in parsed or "desc" not in parsed:
        raise ValueError(f"vision output missing spec/desc keys: {list(parsed.keys())}")

    # 把 spec 拆成 lang-neutral 和 lang-relative
    neutral, relative = split_spec(parsed["spec"])
    site["spec"] = neutral
    site.setdefault("spec_i18n", {})["en"] = relative
    site.setdefault("desc", {})["en"] = parsed["desc"]

    meta = site.setdefault("_meta", {})
    meta["vision_model"] = os.environ.get("ANTHROPIC_MODEL", "mimo-v2.5")
    meta["vision_prompt_version"] = VISION_PROMPT_VERSION
    meta["vision_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta["vision_tokens"] = result["input_tokens"] + result["output_tokens"]
    meta["vision_cost_usd"] = round(estimate_cost("vision", result), 4)

    site["status"] = "vision_done"
    return site


def step_translate_spec(site: dict, *, dry_run: bool = False) -> dict:
    """
    Prompt #2: en (desc + spec_i18n) → 4 langs
    只发送当前 lang 缺失的部分（节省 token —— 迁移过来的站 desc 已齐，只缺 spec_i18n）
    """
    desc = site.setdefault("desc", {})
    spec_i18n = site.setdefault("spec_i18n", {})
    if not desc.get("en") and not spec_i18n.get("en"):
        return site  # 没有 canonical en source，跳过

    total_tokens = 0
    total_cost = 0.0

    for lang in LANGS:
        needs_desc      = bool(desc.get("en")) and not desc.get(lang)
        needs_spec_i18n = bool(spec_i18n.get("en")) and not spec_i18n.get(lang)
        if not needs_desc and not needs_spec_i18n:
            continue  # 这个 lang 全都有了

        missing = ", ".join([n for n, v in [("desc", needs_desc), ("spec_i18n", needs_spec_i18n)] if v])
        if dry_run:
            print(f"  [dry] translate ({missing}) → {lang}")
            continue

        print(f"  ▸ translate ({missing}) → {lang}...")
        payload = {}
        if needs_desc:      payload["desc"] = desc["en"]
        if needs_spec_i18n: payload["spec_i18n"] = spec_i18n["en"]

        result = call_mimo(
            messages=[{"role": "user", "content": f"Translate this English design-spec fragment into {LANG_NATIVE[lang]}.\n\n```json\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n```"}],
            system=translate_prompt_system(lang),
            max_tokens=4500,  # mimo extended thinking 占输出预算大头
        )
        parsed = parse_json_from_response(result["content_text"])
        # 严格：只在我们请求了的字段写回
        if needs_desc      and "desc"      in parsed: desc[lang] = parsed["desc"]
        if needs_spec_i18n and "spec_i18n" in parsed: spec_i18n[lang] = parsed["spec_i18n"]
        total_tokens += result["input_tokens"] + result["output_tokens"]
        total_cost   += estimate_cost("translate", result)

    if total_tokens:
        meta = site.setdefault("_meta", {})
        meta["translation_model"] = os.environ.get("ANTHROPIC_MODEL", "mimo-v2.5")
        meta["translation_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        meta["translation_tokens"] = meta.get("translation_tokens", 0) + total_tokens
        meta["translation_cost_usd"] = round(meta.get("translation_cost_usd", 0.0) + total_cost, 4)

    if all(desc.get(l) for l in ["en"] + LANGS) and all(spec_i18n.get(l) for l in ["en"] + LANGS):
        site["status"] = "translated"
    return site


def step_narrative(site: dict, *, dry_run: bool = False) -> dict:
    """Prompt #3: en spec → en narrative，然后翻译 4 langs"""
    if not site.get("spec_i18n", {}).get("en"):
        return site

    narrative = site.setdefault("narrative", {})

    # 1) en 叙事
    if not narrative.get("en"):
        if dry_run:
            print(f"  [dry] narrative en")
        else:
            print(f"  ▸ narrative en (mimo)...")
            user_text = f"Site: {site['title']}  ({site['url']})\nTags: {', '.join(site.get('tags', []))}\n\n11-layer spec:\n```json\n{json.dumps({**site.get('spec', {}), **site['spec_i18n']['en']}, ensure_ascii=False, indent=2)}\n```\n\nDescription (en):\n```json\n{json.dumps(site['desc']['en'], ensure_ascii=False, indent=2)}\n```\n\nWrite the 10 narrative slots."
            result = call_mimo(
                messages=[{"role": "user", "content": user_text}],
                system=narrative_prompt_system("en"),
                max_tokens=3500,  # mimo 内部 thinking + JSON 输出，预留头部
            )
            narrative["en"] = normalize_narrative(parse_json_from_response(result["content_text"]))
            meta = site.setdefault("_meta", {})
            meta["narrative_model"] = os.environ.get("ANTHROPIC_MODEL", "mimo-v2.5")
            meta["narrative_prompt_version"] = NARRATIVE_PROMPT_VERSION
            meta["narrative_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            meta["narrative_tokens"] = result["input_tokens"] + result["output_tokens"]
            meta["narrative_cost_usd"] = round(estimate_cost("narrative", result), 4)
            meta["narrative_status"] = "ok"

    # 2) 翻译 narrative 到 4 langs
    if narrative.get("en"):
        for lang in LANGS:
            if narrative.get(lang):
                continue
            if dry_run:
                print(f"  [dry] translate narrative en → {lang}")
                continue
            print(f"  ▸ narrative {lang}...")
            result = call_mimo(
                messages=[{"role": "user", "content": f"Translate this narrative JSON to {LANG_NATIVE[lang]}.\n\n```json\n{json.dumps(narrative['en'], ensure_ascii=False, indent=2)}\n```"}],
                system=translate_prompt_system(lang),
                max_tokens=3500,
            )
            narrative[lang] = normalize_narrative(parse_json_from_response(result["content_text"]))
            meta = site.setdefault("_meta", {})
            meta["translation_tokens"] = meta.get("translation_tokens", 0) + result["input_tokens"] + result["output_tokens"]
            meta["translation_cost_usd"] = round(meta.get("translation_cost_usd", 0.0) + estimate_cost("translate", result), 4)

    if all(narrative.get(l) for l in ["en"] + LANGS):
        site["status"] = "narrated"
    return site


def finalize(site: dict) -> dict:
    """所有步骤都完成 → status=completed，汇总 total_cost。"""
    meta = site.setdefault("_meta", {})
    total = (meta.get("vision_cost_usd", 0.0)
             + meta.get("translation_cost_usd", 0.0)
             + meta.get("narrative_cost_usd", 0.0))
    meta["total_cost_usd"] = round(total, 4)

    done = (
        site.get("spec")
        and all(site.get("desc", {}).get(l) for l in ["en"] + LANGS)
        and all(site.get("spec_i18n", {}).get(l) for l in ["en"] + LANGS)
        and all(site.get("narrative", {}).get(l) for l in ["en"] + LANGS)
    )
    if done:
        site["status"] = "completed"
    return site


# ============================================================
# spec 拆分 / cost 估算
# ============================================================

def split_spec(spec: dict) -> tuple[dict, dict]:
    """同 scripts/migrate-to-v0.3.mjs 的 splitSpec()"""
    neutral, relative = {}, {}
    if "identity" in spec: relative["identity"] = spec["identity"]
    if "colors" in spec:
        c = dict(spec["colors"])
        principle = c.pop("principle", None)
        neutral["colors"] = c
        if principle: relative["colors"] = {"principle": principle}
    if "typography" in spec:
        ty = dict(spec["typography"])
        rules = ty.pop("rules", [])
        scale = ty.pop("scale", [])
        clean_scale = [{k: v for k, v in s.items() if k != "use"} for s in scale]
        ty["scale"] = clean_scale
        neutral["typography"] = ty
        relative["typography"] = {"rules": rules, "scaleUses": [s.get("use", "") for s in scale]}
    if "spacing" in spec:
        sp = dict(spec["spacing"])
        rhythm = sp.pop("rhythm", None)
        neutral["spacing"] = sp
        if rhythm: relative["spacing"] = {"rhythm": rhythm}
    if "surfaces" in spec:
        sf = dict(spec["surfaces"])
        shadows = sf.pop("shadows", [])
        borders = sf.pop("borders", "")
        neutral["surfaces"] = sf
        if isinstance(borders, list): borders = "；".join(x for x in borders if x)
        relative["surfaces"] = {"shadows": shadows, "borders": borders}
    if "layout" in spec:
        ly = dict(spec["layout"])
        skeleton = ly.pop("skeleton", None)
        neutral["layout"] = ly
        if skeleton: relative["layout"] = {"skeleton": skeleton}
    if "components" in spec:  relative["components"] = spec["components"]
    if "motion" in spec:
        mo = dict(spec["motion"])
        patterns = mo.pop("patterns", [])
        neutral["motion"] = mo
        if patterns: relative["motion"] = {"patterns": patterns}
    if "interaction" in spec: relative["interaction"] = spec["interaction"]
    if "voice" in spec:       relative["voice"] = spec["voice"]
    if "donts" in spec:       relative["donts"] = spec["donts"]
    if "systemPrompt" in spec: relative["systemPrompt"] = spec["systemPrompt"]
    return neutral, relative


_NARRATIVE_KEYS = {"ch1_intro","ch2_intro","ch2_outro","ch3_intro","ch4_intro",
                   "ch5_intro","ch6_intro","ch7_intro","ch8_intro","ch8_outro"}

def normalize_narrative(n: dict) -> dict:
    """mimo 偶尔拼错 key（c8_outro / chapter1_intro 等），尽量纠正。"""
    if not isinstance(n, dict): return n
    fixed = {}
    for k, v in n.items():
        nk = k
        if nk in _NARRATIVE_KEYS:
            fixed[nk] = v; continue
        # c8_outro → ch8_outro
        if nk.startswith("c") and not nk.startswith("ch"):
            candidate = "ch" + nk[1:]
            if candidate in _NARRATIVE_KEYS:
                fixed[candidate] = v; continue
        # chapter1_intro → ch1_intro
        m = re.match(r"^chapter(\d+)_(intro|outro)$", nk)
        if m:
            candidate = f"ch{m.group(1)}_{m.group(2)}"
            if candidate in _NARRATIVE_KEYS:
                fixed[candidate] = v; continue
        # 其它 key 保留（schema 用 additionalProperties: false 会兜底）
        fixed[nk] = v
    return fixed


def estimate_cost(step: str, result: dict) -> float:
    """基于 token 数估算成本。mimo 没公开标价，先用粗估值乘以 token 比例。"""
    # 简化估算：用 COST_ESTIMATE 表为基线，按实际 token 量缩放
    baseline = COST_ESTIMATE[step]
    actual_total = result["input_tokens"] + result["output_tokens"]
    nominal_total = {"vision": 4500, "translate": 3000, "narrative": 3000}[step]
    if nominal_total <= 0:
        return baseline
    return baseline * (actual_total / nominal_total)


# ============================================================
# Site I/O
# ============================================================

def slug_from_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower().replace("www.", "").replace(".com", "").replace(".io", "").replace(".net", "").replace(".app", "").replace(".so", "").replace(".dev", "").replace(".co", "")
    host = re.sub(r"[^a-z0-9-]+", "-", host).strip("-")
    return host or "unknown"


def load_or_init_site(slug: str, url: str | None = None) -> dict:
    p = SITES_DIR / f"{slug}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    if not url:
        raise FileNotFoundError(f"sites/{slug}.json doesn't exist and no --url provided")
    title_guess = slug.replace("-", " ").title()
    return {
        "id": slug,
        "schema_version": SCHEMA_VERSION,
        "url": url,
        "title": title_guess,
        "image": "",
        "tags": [],
        "status": "pending",
        "added_at": datetime.now().strftime("%Y-%m-%d"),
        "added_by": "ingest",
        "_meta": {}
    }


def save_site(site: dict) -> None:
    SITES_DIR.mkdir(exist_ok=True)
    p = SITES_DIR / f"{site['id']}.json"
    p.write_text(json.dumps(site, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


# ============================================================
# Main
# ============================================================

def run_pipeline(site: dict, *, only: str | None = None, dry_run: bool = False) -> dict:
    if only in (None, "screenshot"):  site = step_screenshot(site); save_site(site)
    if only in (None, "vision"):      site = step_vision(site, dry_run=dry_run); save_site(site)
    if only in (None, "translate"):   site = step_translate_spec(site, dry_run=dry_run); save_site(site)
    if only in (None, "narrative"):   site = step_narrative(site, dry_run=dry_run); save_site(site)
    site = finalize(site); save_site(site)
    return site


def parse_args():
    ap = argparse.ArgumentParser(description="OpenDesign v0.3 ingest pipeline")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--url", help="single URL to ingest")
    g.add_argument("--input", help="txt file with one URL per line")
    g.add_argument("--slug", help="re-process an existing sites/<slug>.json")
    g.add_argument("--retry-failed", action="store_true", help="re-run all sites whose status starts with 'failed:' or != completed")
    g.add_argument("--all-incomplete", action="store_true", help="re-run all sites where status != completed")
    ap.add_argument("--only", choices=["screenshot", "vision", "translate", "narrative"], help="only run this step")
    ap.add_argument("--dry-run", action="store_true", help="show what would be called, don't hit API")
    ap.add_argument("--budget", type=float, default=999.0, help="stop when cumulative cost exceeds this (USD)")
    ap.add_argument("--limit", type=int, help="cap number of sites processed in this run")
    return ap.parse_args()


def main():
    args = parse_args()

    # 1) 决定要处理哪些站
    if args.url:
        slug = slug_from_url(args.url)
        targets = [(slug, args.url)]
    elif args.input:
        urls = [l.strip() for l in Path(args.input).read_text().splitlines() if l.strip() and not l.startswith("#")]
        targets = [(slug_from_url(u), u) for u in urls]
    elif args.slug:
        targets = [(args.slug, None)]
    elif args.retry_failed or args.all_incomplete:
        targets = []
        for p in sorted(SITES_DIR.glob("*.json")):
            site = json.loads(p.read_text(encoding="utf-8"))
            status = site.get("status", "")
            if args.retry_failed and not status.startswith("failed:") and status == "completed":
                continue
            if args.all_incomplete and status == "completed":
                continue
            targets.append((p.stem, site.get("url")))
    else:
        print(__doc__)
        sys.exit(1)

    if args.limit:
        targets = targets[:args.limit]

    # 2) 跑
    started_at = time.time()
    cumulative_cost = 0.0
    summary = {"completed": 0, "narrated": 0, "translated": 0, "vision_done": 0, "failed": 0}

    for i, (slug, url) in enumerate(targets, 1):
        try:
            site = load_or_init_site(slug, url)
        except Exception as e:
            print(f"{ANSI['r']}✗{ANSI['x']} {slug}: {e}")
            summary["failed"] += 1
            continue

        prev_status = site.get("status", "pending")
        print(f"\n{ANSI['b']}[{i}/{len(targets)}] {slug}{ANSI['x']} ({prev_status}) → {site['url']}")

        try:
            site = run_pipeline(site, only=args.only, dry_run=args.dry_run)
        except Exception as e:
            site.setdefault("_meta", {})["last_error"] = str(e)[:500]
            site["status"] = f"failed:{type(e).__name__}"
            save_site(site)
            print(f"  {ANSI['r']}✗ {type(e).__name__}: {e}{ANSI['x']}")
            summary["failed"] += 1
            continue

        cost = site.get("_meta", {}).get("total_cost_usd", 0.0)
        cumulative_cost += cost
        st = site.get("status", "?")
        summary[st] = summary.get(st, 0) + 1
        color = ANSI["g"] if st == "completed" else ANSI["y"]
        print(f"  {color}✓ {st}{ANSI['x']}  · ${cost:.4f}  · cumulative ${cumulative_cost:.2f}")

        if cumulative_cost >= args.budget:
            print(f"\n{ANSI['y']}⚠ budget ${args.budget:.2f} reached, stopping.{ANSI['x']}")
            break

    elapsed = time.time() - started_at
    print(f"\n{ANSI['b']}Summary{ANSI['x']}  · {elapsed:.1f}s · ${cumulative_cost:.4f} spent")
    for k, v in summary.items():
        if v:
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
