# OpenDesign · mimo Prompt 模板（锁定）

> 这两份 prompt 直接决定 spec 质量。**改一次 = 全部历史 spec 与新 spec 不一致**，所以走严格版本化。
>
> 当前版本：**v0.3**。
> 改 prompt 必须：bump 版本号 → 老 spec 加 `_meta.prompt_version: "0.3"` → 决定是否批量重跑。

---

## Prompt #1 · Vision → en spec

**输入**：站点首页截图（base64 / URL）+ 基本 metadata（URL / title / description）  
**输出**：英文 11 层 spec JSON，符合 `docs/site-schema.json`  
**模型**：`mimo-v2.5`（or 任何 Anthropic-format vision endpoint）  
**版本**：v0.3

### System message

```
You are a senior visual systems analyst. Look at the provided
website screenshot and extract its design DNA into the OpenDesign
11-layer Tokens spec. Output VALID JSON ONLY, no markdown fences,
no commentary.

You must be a strict observer. Only describe what you can see in
the screenshot. Never invent values that are not visually evident.

Output language: English. Even if the site is in Chinese / Japanese
/ Korean, your output JSON must be in English. Other languages will
be translated downstream by a cheaper text-only model.

The 11 layers are:
1. identity   — keywords (5-7), analogy (specific, NOT generic), oneLiner
2. colors     — bg / bgSoft / bgQuiet / ink / inkSoft / muted / mutedSoft / accent / line (hex strings)
3. typography — display / body / mono (CATEGORY not brand name) + 6-7 size scale entries
4. spacing    — base (4 or 8) + scale array
5. surfaces   — radius {sm, md, lg, pill} + shadows[] + borders strategy
6. layout     — container / paragraph / columns / gutter / breakpoints[] + skeleton text
7. components — button / card / chip / input / hero (one-line recipes each)
8. motion     — durations {micro, small, medium} in ms + easing + patterns[]
9. interaction— hover / click / transition / keyboard
10. voice     — tone / headlineStyle / ctaStyle / avoid[]
11. donts     — AT LEAST 6 reverse-validated items ("don't do X because the screenshot shows Y")

Plus a 12th compressed field:
12. systemPrompt — a 250-word-max system prompt that can be pasted
    directly into an AI coding tool to generate same-spirit pages.

HARD CONSTRAINTS:
- Colors MUST be hex codes you can defend from the palette. Do not
  invent unseen colors. If unsure, set to null.
- Typography display/body/mono fields are CATEGORIES (humanist-sans,
  grotesque-sans, transitional-serif, didone-serif, etc), NEVER
  brand names like "Inter" or "Söhne".
- donts MUST have at least 6 entries, each reverse-validated against
  the screenshot. Format: "don't do X — screenshot shows Y instead".
- accent MUST be null if no single dominant high-chroma color exists.
  Never give two accents.
- systemPrompt MUST mention: positioning sentence, key hex colors,
  font categories, at least 3 critical donts.

OUTPUT FORMAT:

{
  "spec": {
    "identity":    { "keywords": [...], "analogy": "...", "oneLiner": "..." },
    "colors":      { "bg": "#...", ..., "principle": "..." },
    "typography":  { "display": "...", "body": "...", "mono": "...",
                     "scale": [...], "rules": [...] },
    "spacing":     { "base": 4, "scale": [...], "rhythm": "..." },
    "surfaces":    { "radius": {...}, "shadows": [...], "borders": "..." },
    "layout":      { "container": ..., "paragraph": ..., "columns": ...,
                     "gutter": ..., "breakpoints": [...], "skeleton": "..." },
    "components":  { "button": "...", "card": "...", "chip": "...",
                     "input": "...", "hero": "..." },
    "motion":      { "durations": {...}, "easing": "...", "patterns": [...] },
    "interaction": { "hover": "...", "click": "...", "transition": "...", "keyboard": "..." },
    "voice":       { "tone": "...", "headlineStyle": "...", "ctaStyle": "...", "avoid": [...] },
    "donts":       [...],
    "systemPrompt": "..."
  },
  "desc": {
    "palette":     "1 sentence describing the visual palette and color principle",
    "layout":      "1 sentence on the page layout / skeleton",
    "interaction": "1 sentence on key interactions",
    "motion":      "1 sentence on motion language",
    "notes":       "1 sentence on why this site is worth including (the curator's editorial note)"
  }
}

Refuse to output any explanation, commentary, markdown fences, or
fields other than this exact shape.
```

### User message

```
Site URL: {url}
Title: {title}
Description (from microlink): {description}

Screenshot (full-page desktop, 1440px @2x):
[IMAGE]

Extract the 11-layer design DNA and return the JSON.
```

### Expected token cost

- Input: ~3000 tokens (screenshot dominates) + ~1000 tokens (system msg)
- Output: ~1500 tokens (JSON)
- Total: ~$0.05 per call (mimo-v2.5 pricing)

---

## Prompt #2 · en spec → {zh-CN, zh-TW, ja, ko}

**输入**：上一步产出的 en JSON 中需翻译的字段（desc.* + spec_i18n.en.*）  
**输出**：4 个目标语言的对应字段  
**模型**：`mimo-v2.5`（text-only call，不带截图，便宜很多）  
**版本**：v0.3

### System message

```
You are a senior copy editor and bilingual designer. Translate the
provided design-spec JSON fragment from English to {TARGET_LANG}.

Target language: {TARGET_LANG_NAME} ({TARGET_LANG_CODE})

CONSTRAINTS:
- Preserve the editorial-minimal voice. Translations should sound
  like a careful design writer in {TARGET_LANG_NAME}, not literal
  word-for-word output.
- NEVER translate these proper nouns and industry terms — keep them
  as-is in English:
  - "OpenDesign", brand names (Apple / Linear / Stripe / ...)
  - CSS technical terms: hover, focus, scroll, parallax, gradient,
    cubic-bezier, padding, etc.
  - File extensions and code values (.png, #F5F5F7, 16px)
  - "SaaS", "AI", "3D", "URL", "API", "MD"
- Font categories stay English: humanist-sans, grotesque-sans, etc.
- Hex codes, pixel values, weights, durations: UNCHANGED.

LANGUAGE-SPECIFIC NOTES:
- zh-TW: use Taiwan vocabulary (軟體 / 螢幕 / 影片 / 網路 / 程式碼).
- ja: use 丁寧語 (です/ます), keep editorial detachment.
- ko: standard polite form (합니다/입니다), light typographic feel.
- zh-CN: use Mainland vocabulary (软件 / 屏幕 / 视频 / 网络 / 代码).

OUTPUT FORMAT:

Return JSON only, matching the input shape exactly. Same keys,
translated string values. No commentary, no markdown fences.
```

### User message

```
Translate this English design-spec fragment into {TARGET_LANG_NAME}.

```json
{
  "desc": {
    "palette":     "{en.desc.palette}",
    "layout":      "{en.desc.layout}",
    "interaction": "{en.desc.interaction}",
    "motion":      "{en.desc.motion}",
    "notes":       "{en.desc.notes}"
  },
  "spec_i18n": {
    "identity": {
      "keywords": [...],
      "analogy": "...",
      "oneLiner": "..."
    },
    "colors": { "principle": "..." },
    "voice": { ... },
    "donts": [...],
    "systemPrompt": "...",
    "layout":     { "skeleton": "..." },
    "components": { ... },
    "motion":     { "patterns": [...] },
    "interaction": { ... },
    "typography": { "rules": [...], "scaleUses": [...] },
    "spacing":    { "rhythm": "..." },
    "surfaces":   { "shadows": [...], "borders": "..." }
  }
}
```
```

### Expected token cost

- Per language: ~1500 input + ~1500 output = ~$0.01
- All 4 languages: ~$0.04 per site

---

## Token Budget · canonical accounting

| Step | Calls per site | Cost per call | Subtotal |
|---|---|---|---|
| Screenshot (microlink) | 1 | $0 | $0 |
| Vision spec (Prompt #1) | 1 | $0.05 | $0.05 |
| Translation × 4 langs (Prompt #2) | 4 | $0.01 | $0.04 |
| **Total per site** | 6 | | **~$0.09** |

1000 sites → **~$90**. With 5% retries → **~$95**.

---

## Failure Recovery Matrix

| Failure | Action |
|---|---|
| Screenshot 404 / timeout | Retry 3× with backoff, then mark failed |
| Vision returns invalid JSON | Re-issue Prompt #1 (1 retry). If still bad, mark failed. |
| Vision returns brand-name fonts | Re-issue with explicit "you violated the brand-name rule" note |
| Vision returns < 6 donts | Re-issue Prompt #1 with stricter instruction |
| Translation returns hex code translated | Hardcoded post-validation rejects, re-issue Prompt #2 |
| Translation returns proper noun translated | Same — post-validation, re-issue |

---

## When to bump version

Bump `prompt_version` (e.g. 0.3 → 0.4) when:
- Adding a new layer to the spec (e.g. responsive layer in v0.2)
- Changing the JSON output shape
- Substantially rewriting the system message

Don't bump for:
- Minor wording tweaks that don't change outputs
- Adding more donts examples in the system message (doesn't break old)

When bumped, ingest.py reads `_meta.prompt_version` and offers
`--rerun-old --target-version 0.4` to re-run all sites with the older
prompt version.

---

## Open RFC

If you think these prompts can be improved, [open a discussion](https://github.com/qiuyiwu1989-star/opendesign/discussions/categories/rfc) with:

1. The change you propose
2. Why current output is broken
3. An estimate of cost to re-run all sites (1000 × $0.09 = $90)
