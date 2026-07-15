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


def _extract_first_balanced_object(s: str) -> str:
    """从第一个 { 开始扫描配对的 }，忽略字符串内的括号。"""
    start = s.find("{")
    if start < 0:
        return ""
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return s[start:i + 1]
    return ""


def parse_json_from_response(text: str) -> dict:
    """
    mimo 经常会用 ```json ... ``` 包；尾部也可能跟评论文本。
    用平衡括号扫描出第一个完整 JSON 对象。
    """
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)

    candidate = _extract_first_balanced_object(s)
    if not candidate:
        # 退路：旧的 first-{ to last-} 切片
        start = s.find("{")
        end = s.rfind("}")
        if start < 0 or end < 0:
            raise ValueError(f"No JSON object found in response: {text[:200]}")
        candidate = s[start:end + 1]

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        # 1) 去尾随逗号
        cleaned = re.sub(r",\s*([}\]])", r"\1", candidate)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            # 2) 去 markdown 引号 “ ” 等
            cleaned = cleaned.replace("“", '"').replace("”", '"')
            cleaned = cleaned.replace("‘", "'").replace("’", "'")
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
- tags: 3-5 strings chosen from this canonical taxonomy (case-sensitive):
  SaaS, Productivity, App UI, Dark Mode, Editorial, Premium, Fintech, Bold Typography,
  Gradient, Developer Tools, Geometric, Monochrome, Bold, Design Tools, Expressive,
  Motion, Playful, Consumer, Warm, Friendly, Product, Hardware, Restraint, Curation,
  Gallery, Photographic, Studio, 3D, Experimental, Portfolio, Developer, Books,
  Typography, Reference, Mobile UI, Library, Grid, Collaboration, Agency, Case Study,
  Clean, AI, Tooling, Calendar, Notes, Calm, Refined.
  Choose tags that match what the screenshot ACTUALLY shows. If none match well, use ["Editorial"] as the safe minimum.

OUTPUT FORMAT (return JSON exactly matching this shape):

{
  "tags": ["...", "...", "..."],
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


def _fetch_url_bytes(url: str, timeout: int = 60) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; OpenDesignBot/0.3; +https://opendesign.cc)"
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        media = r.headers.get("Content-Type", "image/png").split(";")[0].strip()
        data = r.read()
    return data, media


_IMAGE_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", ),
    (b"\xff\xd8\xff", ),          # JPEG
    (b"GIF87a", b"GIF89a"),
    (b"RIFF", ),                   # WebP (RIFF....WEBP — checked loosely below)
    (b"BM", ),                     # BMP
)

def _looks_like_image(data: bytes) -> bool:
    """真图片校验：常见格式 magic bytes + 最小体积。比只挡 HTML 错误页靠谱——
    空响应/JSON错误体/半途截断都会被这个挡住，不会伪装成合法图片发去 mimo。"""
    if len(data) < 500:  # 真截图至少几 KB；错误页/占位响应通常几十到几百字节
        return False
    return any(data.startswith(sig) for sigs in _IMAGE_MAGIC for sig in sigs)


def fetch_image_base64(url: str, timeout: int = 60, original_url: str | None = None) -> tuple[str, str]:
    """
    返回 (base64_str, media_type).
    若 thum.io 返回 403/429（rate-limit），自动换 microlink / Google Pagespeed.
    """
    sources = [url]
    # 推断原 URL 用于 fallback 截图服务
    if original_url is None and "thum.io/get/width/" in url:
        try:
            original_url = url.split("thum.io/get/width/")[1].split("/", 1)[1]
            if not original_url.startswith("http"):
                original_url = "https://" + original_url
        except IndexError:
            original_url = None
    if original_url:
        # microlink 是 anthropic 兼容的，免费 50/day
        sources.append(f"https://api.microlink.io/?url={urllib.parse.quote(original_url)}&screenshot=true&embed=screenshot.url")
        # Google Pagespeed Insights 截图 endpoint（公开 + 无限制）
        sources.append(f"https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url={urllib.parse.quote(original_url)}&category=performance")

    last_err = None
    for src in sources:
        try:
            data, media = _fetch_url_bytes(src, timeout=timeout)
            # microlink 在 embed=screenshot.url 模式直接返回图片 bytes ✓
            # Pagespeed 返回 JSON 含 finalScreenshot.data；这里跳过它（复杂解析）
            if "googleapis.com" in src:
                # 解析 Pagespeed 响应中的 base64 截图
                import json as _json
                resp = _json.loads(data.decode("utf-8"))
                shot = (resp.get("lighthouseResult", {})
                            .get("audits", {})
                            .get("final-screenshot", {})
                            .get("details", {})
                            .get("data", ""))
                if shot.startswith("data:image/"):
                    media = shot.split(";")[0].replace("data:", "")
                    b64 = shot.split(",", 1)[1]
                    return b64, media
                continue
            if not _looks_like_image(data):
                # 不只 HTML 错误页会漏网——空响应/JSON错误体/半途截断的数据都会通过旧的
                # "startswith(b'<!')" 检查，base64 编码永远不会报错，于是把垃圾字节当图
                # 发给 mimo，对方拿真正的图片校验拒收（"base64 data is not valid"），
                # 白打一次 API 调用。改成认真检查常见图片格式的 magic bytes + 最小体积。
                last_err = f"not a valid image ({len(data)}B) from {src[:60]}"; continue
            return base64.b64encode(data).decode("ascii"), media
        except Exception as e:
            last_err = f"{type(e).__name__}: {str(e)[:120]}"
            continue
    raise RuntimeError(f"all screenshot sources failed; last: {last_err}")


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

    # mimo 建议的 tags（curator 可后续编辑），仅在 site.tags 为空时填
    if not site.get("tags") and isinstance(parsed.get("tags"), list):
        site["tags"] = [t for t in parsed["tags"] if isinstance(t, str) and t.strip()][:5]

    meta = site.setdefault("_meta", {})
    meta["vision_model"] = os.environ.get("ANTHROPIC_MODEL", "mimo-v2.5")
    meta["vision_prompt_version"] = VISION_PROMPT_VERSION
    meta["vision_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta["vision_tokens"] = result["input_tokens"] + result["output_tokens"]
    meta["vision_cost_usd"] = round(estimate_cost("vision", result), 4)

    site["status"] = "vision_done"
    return site


# ─────────────────────────────────────────────────────────────
# from-extract：用 mimo 处理 *真实* Playwright 提取（多截图 + 真 computed styles）
# 取代模板 synthesize.py 的 __待补__ 占位，让 ZIP 里的规范是 mimo 真生成、且 grounded 在事实上。
# ─────────────────────────────────────────────────────────────

def _fmt_tok(v) -> str:
    if isinstance(v, (list, tuple)) and len(v) >= 2:
        return f"{v[0]} ×{v[1]}"
    if isinstance(v, (list, tuple)) and v:
        return str(v[0])
    return str(v)


def summary_facts_block(summary: dict) -> str:
    """把 summary.json 的真实 computed styles 压成一段 ground-truth 文本，注入 vision prompt。"""
    lines = [
        "GROUND-TRUTH FACTS extracted from the live page (real computed styles — "
        "use these EXACT hex/px/font values, do NOT invent colors or sizes):",
        f"- URL: {summary.get('url')}",
        f"- visible elements analyzed: {summary.get('totalElementsVisible')}",
    ]
    fonts = summary.get("fonts") or []
    fam = []
    for f in fonts:
        name = f.get("family") if isinstance(f, dict) else (f[0] if isinstance(f, (list, tuple)) and f else f)
        if name and name not in fam:
            fam.append(str(name))
    if fam:
        lines.append(f"- @font-face families declared: {'; '.join(fam[:10])}")
    tokens = summary.get("tokens") or {}
    for key, val in tokens.items():
        sample = None
        if isinstance(val, list) and val:
            sample = ", ".join(_fmt_tok(v) for v in val[:6])
        elif isinstance(val, dict) and val:
            items = sorted(val.items(), key=lambda kv: -(kv[1] if isinstance(kv[1], (int, float)) else 0))[:6]
            sample = ", ".join(f"{k} ×{v}" for k, v in items)
        if sample:
            lines.append(f"- {key}: {sample}")
    cssv = summary.get("cssVariables") or {}
    if cssv:
        lines.append(f"- :root CSS variables defined: {len(cssv)}")
    return "\n".join(lines)


def pick_extract_images(extract_dir: Path) -> list[Path]:
    """选 2-3 张最具代表性的真实截图喂 mimo（控制 input token）：桌面首屏 + 中段 + 移动首屏。"""
    picks = []
    hero = extract_dir / "02_desktop_hero.png"
    if hero.exists():
        picks.append(hero)
    sections = sorted(extract_dir.glob("03_desktop_section_*.png"))
    if sections:
        picks.append(sections[len(sections) // 2])  # 取中段，避开纯 hero/footer
    mob = extract_dir / "05_mobile_hero.png"
    if mob.exists():
        picks.append(mob)
    if not picks:  # 兜底：任意整页图
        picks = sorted(extract_dir.glob("0*_*full*.png"))[:1]
    return picks[:3]


def step_vision_from_extract(site: dict, extract_dir: Path, *, dry_run: bool = False) -> dict:
    """Prompt #1（增强版）：真实多截图 + summary.json 事实 → grounded 11 层 spec + en desc"""
    summary_path = extract_dir / "summary.json"
    if not summary_path.exists():
        raise FileNotFoundError(f"no summary.json in {extract_dir}")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    facts = summary_facts_block(summary)
    images = pick_extract_images(extract_dir)
    if not images:
        raise FileNotFoundError(f"no screenshots found in {extract_dir}")

    if dry_run:
        print(f"  [dry] from-extract vision for {site['id']}")
        print(f"        images ({len(images)}): {', '.join(p.name for p in images)}")
        print(f"        facts block ({len(facts)} chars):")
        for ln in facts.splitlines():
            print(f"          {ln}")
        return site

    print(f"  ▸ from-extract vision call (mimo) · {len(images)} real screenshots + computed-style facts")
    content = []
    for p in images:
        b = p.read_bytes()
        content.append({"type": "image", "source": {
            "type": "base64", "media_type": "image/png",
            "data": base64.b64encode(b).decode("ascii")}})
    content.append({"type": "text", "text":
        f"Site URL: {site['url']}\nTitle: {site['title']}\nTags: {', '.join(site.get('tags', []))}\n\n"
        f"{facts}\n\n"
        f"The images are real captures of this site (desktop hero, a mid section, mobile hero). "
        f"Extract the 11-layer design DNA and return the exact JSON shape. "
        f"Ground every color/font/size in the GROUND-TRUTH FACTS above."})

    msgs = [{"role": "user", "content": content}]
    parsed = None
    tokens_used = 0
    cost_used = 0.0
    # mimo 输出偶尔漏 desc/spec —— 重试一次再判失败（成本可控的保险）
    for attempt in range(2):
        result = call_mimo(messages=msgs, system=vision_prompt_system(), max_tokens=6000)
        tokens_used += result["input_tokens"] + result["output_tokens"]
        cost_used += estimate_cost("vision", result)
        try:
            cand = parse_json_from_response(result["content_text"])
        except Exception:
            cand = {}
        if "spec" in cand and "desc" in cand:
            parsed = cand
            break
        if attempt == 0:
            print(f"    ⚠ 输出缺 {[k for k in ('spec','desc') if k not in cand]}，重试一次…")
    if not parsed:
        raise ValueError(f"vision output missing spec/desc after retry: {list((cand or {}).keys())}")

    neutral, relative = split_spec(parsed["spec"])
    site["spec"] = neutral
    site.setdefault("spec_i18n", {})["en"] = relative
    site.setdefault("desc", {})["en"] = parsed["desc"]
    if not site.get("tags") and isinstance(parsed.get("tags"), list):
        site["tags"] = [t for t in parsed["tags"] if isinstance(t, str) and t.strip()][:5]

    meta = site.setdefault("_meta", {})
    meta["vision_model"] = os.environ.get("ANTHROPIC_MODEL", "mimo-v2.5")
    meta["vision_prompt_version"] = VISION_PROMPT_VERSION
    meta["vision_source"] = f"playwright-extract:{extract_dir.name}"
    meta["vision_grounded"] = True
    meta["vision_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta["vision_tokens"] = tokens_used
    meta["vision_cost_usd"] = round(cost_used, 4)
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


def normalize_surfaces(site: dict) -> None:
    """修复 mimo 偶发的 shape 偏差，让输出过 schema：
    - surfaces.shadows: {token,value} 对象 → 'token: value' 字符串
    - 几个 schema 要 array 的字段（motion.patterns / motion.principles / donts …）若给成 string → 包成单元素 list
    - voice.{tone,headlineStyle,ctaStyle} 偶尔给 null（schema 要字符串）→ 兜底成 "default"
    - typography.scale[].token 偶尔给 camelCase（schema 要 kebab-case）→ 转换
    - typography.scale[].weight 偶尔给 >900（CSS font-weight 上限）→ clamp
    这几条踩过坑：批量收录时一个站过不了 schema 会挡住整批发布（run_auto_publish
    现在把有问题的站单独摘出去重置成 pending，但源头顺手清理掉更省事，不用等下一轮）。
    """
    import re as _re

    LIST_FIELDS = {
        "motion": ["patterns", "principles"],
        "interaction": ["patterns"],
        "voice": ["doList", "dontList", "do", "avoid", "prefer"],  # schema 要 array；mimo 偶尔给 string
    }
    blocks = [site.get("spec")] + list((site.get("spec_i18n") or {}).values())
    for b in blocks:
        if not isinstance(b, dict):
            continue
        # shadows 对象 → 字符串
        if isinstance(b.get("surfaces"), dict):
            sh = b["surfaces"].get("shadows")
            if isinstance(sh, list):
                b["surfaces"]["shadows"] = [
                    (f'{x.get("token")}: {x.get("value")}'.strip(": ") if isinstance(x, dict) else x)
                    for x in sh
                ]
        # string → [string] for known array fields
        for layer, fields in LIST_FIELDS.items():
            if isinstance(b.get(layer), dict):
                for f in fields:
                    v = b[layer].get(f)
                    if isinstance(v, str) and v.strip():
                        b[layer][f] = [v.strip()]
        # 顶层 donts 若给成 string
        if isinstance(b.get("donts"), str) and b["donts"].strip():
            b["donts"] = [b["donts"].strip()]
        # voice.{tone,headlineStyle,ctaStyle} null → "default"（schema 要字符串，
        # 这几个都是纯描述性字段，值本身不影响视觉，兜底不掉质量）
        voice = b.get("voice")
        if isinstance(voice, dict):
            for f in ("tone", "headlineStyle", "ctaStyle"):
                if f in voice and voice.get(f) is None:
                    voice[f] = "default"

    # typography.scale 只存在 neutral spec（split_spec 没按语言拆它）
    scale = (site.get("spec") or {}).get("typography", {}).get("scale", [])
    for entry in scale:
        if not isinstance(entry, dict):
            continue
        tok = entry.get("token")
        if isinstance(tok, str) and not _re.match(r"^[a-z][a-z0-9-]*$", tok):
            entry["token"] = _re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", tok).lower()
        w = entry.get("weight")
        if isinstance(w, (int, float)) and w > 900:
            entry["weight"] = 900


_SCHEMA_CACHE = None

def _load_schema():
    global _SCHEMA_CACHE
    if _SCHEMA_CACHE is None:
        _SCHEMA_CACHE = json.loads((ROOT / "docs" / "site-schema.json").read_text(encoding="utf-8"))
    return _SCHEMA_CACHE


def _resolve_ref(ref: str, root_schema: dict) -> dict:
    # 只处理本文件用到的简单形式：本地 "#/$defs/Xxx"
    name = ref.split("/")[-1]
    return root_schema.get("$defs", {}).get(name, {})


def prune_to_schema(data, schema, root_schema=None):
    """按 schema 递归砍掉 additionalProperties:false 处不认识的 key。

    mimo 偶尔往这类对象里塞进翻译串味的中文键名(把 'donts'/'layout' 这种结构性
    字段名也当值翻译了，比如 layout 对象里混进 '骨架' 键)、打错字的键名
    (analogogy/borners/browsers)、带冒号的畸形键(donts:)。这类错误花样太多，
    没法一个个枚举字段名去修——按 schema 白名单过滤，不在允许列表里的 key
    直接丢，比一个个猜漏网之鱼靠谱。丢弃的数据本来就是格式错的，没法用。
    """
    if root_schema is None:
        root_schema = schema
    if "$ref" in schema:
        schema = _resolve_ref(schema["$ref"], root_schema)

    if isinstance(data, dict) and schema.get("type") == "object":
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False and props:
            data = {k: v for k, v in data.items() if k in props}
        for k in list(data.keys()):
            if k in props:
                data[k] = prune_to_schema(data[k], props[k], root_schema)
        return data
    if isinstance(data, list) and schema.get("type") == "array":
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            return [prune_to_schema(x, item_schema, root_schema) for x in data]
        return data
    return data


def finalize(site: dict) -> dict:
    """所有步骤都完成 → status=completed，汇总 total_cost。"""
    normalize_surfaces(site)
    site = prune_to_schema(site, _load_schema())
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
        # mimo 有时对"没有显式 letter-spacing"的字号给 ls: null——schema 要求 ls 是字符串
        # （这是个真实 design token，得能直接引用），null 会在 --auto-publish 时炸 schema
        # 校验，且是全批一起炸（一个站的坏数据挡住同批其它站发布）。CSS 的 "normal" 就是
        # letter-spacing 未显式设置时的实际语义，比空字符串更诚实。
        clean_scale = [
            {k: (v if k != "ls" or isinstance(v, str) else "normal") for k, v in s.items() if k != "use"}
            for s in scale
        ]
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
    """从 URL 推 slug。先扫 sites/ 找已注册的 URL（不同 URL 形态 → 同一 slug），
    没有再 derive 新 slug。"""
    # 1) 优先：现有 sites/<slug>.json 里有匹配 URL 的，复用 slug
    if SITES_DIR.exists():
        try:
            target_host = urllib.parse.urlparse(url).netloc.lower().replace("www.", "")
            for p in SITES_DIR.glob("*.json"):
                try:
                    s = json.loads(p.read_text(encoding="utf-8"))
                    existing_host = urllib.parse.urlparse(s.get("url", "")).netloc.lower().replace("www.", "")
                    if existing_host and existing_host == target_host:
                        return p.stem  # 复用现有 slug（如 atlascard.com → atlas）
                except Exception:
                    continue
        except Exception:
            pass

    # 2) 新 URL：从 host 派生 slug
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower().replace("www.", "")
    # 去 TLD（多 TLD 优雅处理）
    for tld in (".com.cn", ".co.uk", ".co.jp",
                ".com", ".io", ".net", ".app", ".so", ".dev", ".co", ".ai",
                ".org", ".tech", ".cloud", ".global", ".world", ".design"):
        if host.endswith(tld):
            host = host[:-len(tld)]
            break
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

def run_pipeline(site: dict, *, only: str | None = None, dry_run: bool = False,
                 extract_dir: Path | None = None) -> dict:
    if only in (None, "screenshot") and not extract_dir:
        site = step_screenshot(site); save_site(site)
    if only in (None, "vision"):
        if extract_dir:
            # 用真实 Playwright 提取（多截图 + 真 computed styles）走 mimo
            if not dry_run:
                site["spec"] = None  # 强制重跑 vision（覆盖旧模板/旧 spec）
                site.pop("spec_i18n", None)
            site = step_vision_from_extract(site, extract_dir, dry_run=dry_run)
        else:
            site = step_vision(site, dry_run=dry_run)
        if not dry_run:
            save_site(site)
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
    ap.add_argument("--from-extract", metavar="DIR",
                    help="用真实 Playwright 提取目录（含 summary.json + 截图）走 mimo 生成 grounded 规范；需配 --slug")
    ap.add_argument("--dry-run", action="store_true", help="show what would be called, don't hit API")
    ap.add_argument("--budget", type=float, default=999.0, help="stop when cumulative cost exceeds this (USD)")
    ap.add_argument("--limit", type=int, help="cap number of sites processed in this run")
    ap.add_argument("--title", help="override site title (default: derived from slug)")
    ap.add_argument("--tags", help="comma-separated tags override (e.g. 'SaaS,Productivity'). Default: mimo auto-suggests")
    ap.add_argument("--auto-publish", action="store_true",
                    help="after ingest: validate → build → commit → push → deploy. From URL to live site in one command.")
    return ap.parse_args()


def run_auto_publish(processed_slugs: list[str]):
    """ingest 完成后跑 validate → build → commit → push → deploy。"""
    import subprocess

    print(f"\n{ANSI['b']}▸ auto-publish · {len(processed_slugs)} site(s){ANSI['x']}")

    def run(cmd, desc):
        print(f"  · {desc}")
        r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True)
        if r.returncode != 0:
            tail = (r.stderr or r.stdout or "")[-500:]
            print(f"    {ANSI['r']}✗ {desc} failed:{ANSI['x']} {tail}")
            return False
        return True

    # 只查这批刚处理的 slug，不查全库——sites/ 里几百个 pending/failed 桩条目本来就不完整，
    # 不该因为它们的历史错误挡住这批新处理站的发布（quality-check.py 下面已经这么做了，这里是漏了）。
    #
    # 一个站 schema 有错不该拖累整批——build.py 是按全库 status=completed 发布的，不是按
    # processed_slugs，所以真正需要的只是：把有 schema 错的站排除出这批、退回 pending 等下次
    # 修好再进（不留一个"completed 但从没验证通过"的悬空态），剩下干净的站正常发布。
    print(f"  · validate schema")
    vr = subprocess.run(
        ["python3", "scripts/validate-sites.py", "--strict", "--json", *processed_slugs],
        cwd=str(ROOT), capture_output=True, text=True
    )
    try:
        vdata = json.loads(vr.stdout)
        bad_slugs = {r["slug"] for r in vdata.get("results", []) if r.get("errors")}
    except Exception:
        bad_slugs = set(processed_slugs)  # 解析不出来就保守地当全批有问题

    if bad_slugs:
        print(f"    {ANSI['y']}⚠ {len(bad_slugs)} site(s) failed schema, excluded + reset to pending: {sorted(bad_slugs)}{ANSI['x']}")
        for slug in bad_slugs:
            fp = SITES_DIR / f"{slug}.json"
            try:
                s = json.loads(fp.read_text(encoding="utf-8"))
                s["status"] = "pending"
                s.setdefault("_meta", {})["schema_error_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
                fp.write_text(json.dumps(s, ensure_ascii=False, indent=2))
            except Exception as e:
                print(f"    {ANSI['r']}✗ couldn't reset {slug}: {e}{ANSI['x']}")
        processed_slugs = [s for s in processed_slugs if s not in bad_slugs]

    if not processed_slugs:
        print(f"  {ANSI['r']}Stopped: every site in this batch failed schema — nothing left to publish.{ANSI['x']}")
        return False

    # 质量门 —— 比 schema 严：颜色 / donts / 字体类别 / 5 lang 齐 等
    # 失败的 site 自动 quarantine 成 needs_review，不阻止其它 site 上架
    print(f"  · quality check (auto-quarantine bad ones)")
    qc = subprocess.run(
        ["python3", "scripts/quality-check.py", "--auto-quarantine", *processed_slugs],
        cwd=str(ROOT), capture_output=True, text=True
    )
    if qc.stdout:
        # 只打印失败行（包含 ✗）
        for line in qc.stdout.splitlines():
            if "✗" in line or "needs_review" in line or "error" in line.lower():
                print(f"    {line}")
    # qc 退出非 0 是 expected（有 site 失败质量门），但不阻止 publish 其它的

    if not run(["python3", "scripts/build.py"], "build dist/ (SEO HTML + downloadable MD)"):
        return False

    # Git add + commit (only sites/<new>.json + dist/legacy/* + sitemap.xml)
    subprocess.run(["git", "add", "-A"], cwd=str(ROOT))
    diff = subprocess.run(["git", "diff", "--staged", "--quiet"], cwd=str(ROOT))
    if diff.returncode == 0:
        print(f"  · git: no changes to commit (already up to date)")
    else:
        slug_list = ", ".join(processed_slugs)
        commit_msg = (
            f"data: ingest {slug_list}\n\n"
            f"Automated via scripts/ingest.py --auto-publish.\n\n"
            f"Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
        )
        r = subprocess.run(["git", "commit", "-m", commit_msg], cwd=str(ROOT), capture_output=True, text=True)
        if r.returncode == 0:
            print(f"  · git commit ✓")
            push = subprocess.run(["git", "push", "origin", "main"], cwd=str(ROOT), capture_output=True, text=True)
            if push.returncode == 0:
                print(f"  · git push ✓")
            else:
                print(f"  {ANSI['y']}⚠ git push failed (will retry next time):{ANSI['x']} {push.stderr[-200:]}")

    # Sync built legacy files to root + deploy
    for f in ["sites.js", "sites-specs.json", "sites-i18n.json"]:
        src = ROOT / "dist" / "legacy" / f
        if src.exists():
            (ROOT / f).write_bytes(src.read_bytes())
    src = ROOT / "dist" / "sitemap.xml"
    if src.exists():
        (ROOT / "sitemap.xml").write_bytes(src.read_bytes())

    env = os.environ.copy()
    env["SKIP_BUILD"] = "1"  # 已经 build 过了
    print(f"  · deploy to nginx...")
    r = subprocess.run(["bash", "scripts/deploy.sh"], cwd=str(ROOT), env=env, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"    {ANSI['r']}✗ deploy failed:{ANSI['x']} {r.stderr[-500:]}")
        return False
    print(f"  · deploy ✓")

    print(f"\n{ANSI['g']}{ANSI['b']}✓ Published:{ANSI['x']}")
    for slug in processed_slugs:
        print(f"  https://opendesign.cc/en/sites/{slug}")
        print(f"  https://opendesign.cc/ja/sites/{slug}")
    return True


def main():
    args = parse_args()

    extract_dir = None
    if args.from_extract:
        if not args.slug:
            print(f"{ANSI['r']}✗ --from-extract 需要同时指定 --slug <slug>{ANSI['x']}")
            sys.exit(1)
        extract_dir = Path(args.from_extract)
        if not (extract_dir / "summary.json").exists():
            print(f"{ANSI['r']}✗ {extract_dir} 里没有 summary.json（先跑 extract/extract.py）{ANSI['x']}")
            sys.exit(1)

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
    newly_completed: list[str] = []

    for i, (slug, url) in enumerate(targets, 1):
        try:
            site = load_or_init_site(slug, url)
        except Exception as e:
            print(f"{ANSI['r']}✗{ANSI['x']} {slug}: {e}")
            summary["failed"] += 1
            continue

        # 命令行覆盖
        if args.title and (not site.get("title") or site.get("title") == slug.replace("-", " ").title()):
            site["title"] = args.title
        if args.tags:
            site["tags"] = [t.strip() for t in args.tags.split(",") if t.strip()]

        prev_status = site.get("status", "pending")
        print(f"\n{ANSI['b']}[{i}/{len(targets)}] {slug}{ANSI['x']} ({prev_status}) → {site['url']}")

        try:
            site = run_pipeline(site, only=args.only, dry_run=args.dry_run, extract_dir=extract_dir)
        except Exception as e:
            meta = site.setdefault("_meta", {})
            meta["last_error"] = str(e)[:500]
            # 连续失败太多次的站(比如域名彻底不通)会被 --all-incomplete/--input 每轮
            # 反复重试，白占批次名额还可能撞上"人工标 broken 后又被这轮的失败结果覆盖回去"
            # 的竞态。数够次数就直接认输标 broken，别再排队——真恢复了 self-optimize.py
            # 的探活会捞回来。
            retries = meta.get("retry_count", 0) + 1
            meta["retry_count"] = retries
            if retries >= 3:
                site["status"] = "broken"
                site["broken_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                meta["broken_reason"] = f"gave up after {retries} ingest attempts, last: {type(e).__name__}: {str(e)[:200]}"
                print(f"  {ANSI['r']}✗ {type(e).__name__}: {e} — {retries} 次失败，标 broken 不再重试{ANSI['x']}")
            else:
                site["status"] = f"failed:{type(e).__name__}"
                print(f"  {ANSI['r']}✗ {type(e).__name__}: {e} ({retries}/3){ANSI['x']}")
            save_site(site)
            summary["failed"] += 1
            continue

        cost = site.get("_meta", {}).get("total_cost_usd", 0.0)
        cumulative_cost += cost
        st = site.get("status", "?")
        summary[st] = summary.get(st, 0) + 1
        color = ANSI["g"] if st == "completed" else ANSI["y"]
        print(f"  {color}✓ {st}{ANSI['x']}  · ${cost:.4f}  · cumulative ${cumulative_cost:.2f}")

        if st == "completed":
            newly_completed.append(slug)

        if cumulative_cost >= args.budget:
            print(f"\n{ANSI['y']}⚠ budget ${args.budget:.2f} reached, stopping.{ANSI['x']}")
            break

    elapsed = time.time() - started_at
    print(f"\n{ANSI['b']}Summary{ANSI['x']}  · {elapsed:.1f}s · ${cumulative_cost:.4f} spent")
    for k, v in summary.items():
        if v:
            print(f"  {k}: {v}")

    # 3) --auto-publish: validate → build → commit → push → deploy
    if args.auto_publish and newly_completed and not args.dry_run:
        run_auto_publish(newly_completed)


if __name__ == "__main__":
    main()
