#!/usr/bin/env python3
"""
OpenDesign · DESIGN_SPEC.md 合成器
─────────────────────────────────────────────────────────────────────────
读 extract.py 产出的 summary.json，合成两份文档：

  DESIGN_SPEC.md      8 章 magazine 风格设计规范（可直接给开发用 / 上传到 OpenDesign）
  sites-entry.json    sites.js 用的 11 层 spec 对象（id、tags 字段你手动补）

可选：--with-ai  调 OpenDesign Edge Function 用 vision 补语义层（identity / voice / donts）。
不开 AI 也能跑，会留 TODO 占位。

用法：
  python3 synthesize.py extracts/lusion-co
  python3 synthesize.py extracts/lusion-co --with-ai --screenshot-url https://...
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path


# ───── 工具 ─────
def hex_from_rgba(s: str) -> str | None:
    """rgba(r,g,b,a) → #RRGGBB；半透明保留 a 用 8 位 hex"""
    m = re.match(r"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)", s)
    if not m:
        return None
    r, g, b = int(float(m.group(1))), int(float(m.group(2))), int(float(m.group(3)))
    a = float(m.group(4)) if m.group(4) else 1.0
    if a >= 0.999:
        return f"#{r:02X}{g:02X}{b:02X}"
    return f"#{r:02X}{g:02X}{b:02X}{int(a*255):02X}"


def luminance(rgba_str: str) -> float:
    m = re.match(r"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)", rgba_str)
    if not m:
        return 0
    r, g, b = float(m.group(1)), float(m.group(2)), float(m.group(3))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def chroma(rgba_str: str) -> float:
    m = re.match(r"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)", rgba_str)
    if not m:
        return 0
    r, g, b = float(m.group(1)), float(m.group(2)), float(m.group(3))
    return max(r, g, b) - min(r, g, b)


def pick_top(counter_list, n=10, min_count=2):
    return [(v, c) for v, c in counter_list[:n] if c >= min_count]


def font_category(family: str) -> str:
    """根据字体族名推断字体类别。只看第一个 family（后面都是 fallback chain）。"""
    # 取首个 family，去引号
    f = family.split(",")[0].strip().strip('"').strip("'").lower()
    # 优先级 1: mono
    if any(s in f for s in ["mono", "consolas", "menlo", "courier", " code"]):
        return "mono"
    # 优先级 2: 显式 sans（包括 sans-serif） —— 必须先于 serif 判断
    if "sans" in f:
        if "geometric" in f or "futura" in f or "avenir" in f:
            return "geometric-sans"
        if any(s in f for s in ["grotesque", "söhne", "sohne", "neue haas", "helvetica", "akzidenz", "graphik", "söhn"]):
            return "grotesque-sans"
        if any(s in f for s in ["inter", "system-ui", "-apple-system", "segoe", "roboto", "open sans"]):
            return "humanist-sans"
        return "humanist-sans"
    # 优先级 3: 衬线变体
    if any(s in f for s in ["didot", "bodoni", "modern no"]):
        return "didone-serif"
    if any(s in f for s in ["ivar", "garamond", "caslon", "baskerville", "sectra"]):
        return "transitional-serif"
    if "slab" in f or "rockwell" in f:
        return "slab-serif"
    if any(s in f for s in ["serif", "georgia", "times", "cambria"]):
        return "serif"
    # 优先级 4: display 字体
    if any(s in f for s in ["display", "instrument", "fraunces"]):
        return "display"
    return "humanist-sans"


def color_alpha(rgba_str: str) -> float:
    m = re.match(r"rgba?\([\d.]+,\s*[\d.]+,\s*[\d.]+(?:,\s*([\d.]+))?\)", rgba_str)
    if not m:
        return 1.0
    return float(m.group(1)) if m.group(1) else 1.0


# ───── 颜色 token 分配 ─────
def assign_color_tokens(top_colors: list[tuple[str, int]]) -> dict:
    """按出现频次 + 明度/饱和度推断 bg / ink / accent 等。
    过滤：bg / ink / accent 基础 token 只用 alpha >= 0.9 的颜色（基础色应不透明）。
    半透明色 (0.5-0.9) 走 muted / inkSoft 类次级 token。
    """
    if not top_colors:
        return {}
    # 基础色（bg / ink / accent）只用近不透明
    base = [(c, n) for c, n in top_colors if color_alpha(c) >= 0.9]
    # 次级色（muted / inkSoft 等）允许半透明
    secondary = [(c, n) for c, n in top_colors if 0.5 <= color_alpha(c) < 0.9]
    if not base:
        base = top_colors  # 真的全半透明退回

    sorted_raw = sorted([(c, n, luminance(c)) for c, n in base], key=lambda x: -x[2])
    seen = set()
    by_lum = []
    for c, n, l in sorted_raw:
        if c not in seen:
            seen.add(c)
            by_lum.append((c, n, l))

    if not by_lum:
        return {}

    lightest = by_lum[0]
    darkest = by_lum[-1]
    mids = by_lum[1:-1] if len(by_lum) > 2 else []

    # accent：高彩度 + 不是 lightest/darkest + alpha >= 0.8（accent 通常不透明）
    accent = None
    for c, n, l in by_lum:
        if c == lightest[0] or c == darkest[0]:
            continue
        if color_alpha(c) < 0.8:
            continue
        if chroma(c) > 32:
            accent = c
            break

    # muted 应该是中明度的低饱和色（灰），不该是彩色（那是 accent 的事）
    gray_mids = [(c, n, l) for c, n, l in mids if chroma(c) < 30]
    muted_pick = gray_mids[len(gray_mids)//2][0] if gray_mids else None

    bg_hex = hex_from_rgba(lightest[0])
    ink_hex = hex_from_rgba(darkest[0])
    bgsoft_hex = hex_from_rgba(mids[0][0]) if mids and mids[0][0] != lightest[0] else None
    inksoft_hex = hex_from_rgba(mids[-1][0]) if len(mids) > 1 and mids[-1][0] != darkest[0] else None
    muted_hex = hex_from_rgba(muted_pick) if muted_pick else None
    accent_hex = hex_from_rgba(accent) if accent else None

    # 去掉跟别的 token 重复的 muted（避免显示俩一样的）
    used = {bg_hex, ink_hex, bgsoft_hex, inksoft_hex, accent_hex}
    if muted_hex in used:
        muted_hex = None

    tokens = {
        "bg": bg_hex,
        "bgSoft": bgsoft_hex,
        "ink": ink_hex,
        "inkSoft": inksoft_hex,
        "muted": muted_hex,
        "accent": accent_hex,
    }
    return {k: v for k, v in tokens.items() if v}


# ───── DESIGN_SPEC.md 合成 ─────
def synthesize_md(summary: dict, out_dir: Path) -> str:
    url = summary["url"]
    tokens = summary["tokens"]
    fonts = summary["fonts"]
    vars_ = summary["cssVariables"]
    today = date.today().isoformat()

    # 提颜色
    bg_colors = pick_top(tokens["backgroundColor"], 6)
    fg_colors = pick_top(tokens["color"], 8)
    all_colors = list(dict.fromkeys([c for c, _ in bg_colors + fg_colors]))[:8]
    color_tokens = assign_color_tokens([(c, dict(bg_colors + fg_colors).get(c, 1)) for c in all_colors])

    # 字体
    font_families = pick_top(tokens["fontFamily"], 4)
    primary_family = font_families[0][0].strip('"').split(",")[0].strip() if font_families else "—"
    body_family = font_families[1][0].strip('"').split(",")[0].strip() if len(font_families) > 1 else primary_family
    primary_cat = font_category(primary_family)
    body_cat = font_category(body_family)

    # 字号阶
    size_top = pick_top(tokens["fontSize"], 8)
    weight_top = pick_top(tokens["fontWeight"], 5)
    lh_top = pick_top(tokens["lineHeight"], 5)
    ls_top = pick_top(tokens["letterSpacing"], 5)

    # 间距 / 圆角 / 阴影
    padding_top = pick_top(tokens["padding"], 5)
    gap_top = pick_top(tokens["gap"], 5)
    radius_top = pick_top(tokens["borderRadius"], 5)
    shadow_top = pick_top(tokens["boxShadow"], 5)
    transition_top = pick_top(tokens["transition"], 4)

    # CSS variables 块（可粘进 :root）
    css_lines = []
    if color_tokens.get("bg"):       css_lines.append(f"  --bg: {color_tokens['bg']};")
    if color_tokens.get("bgSoft"):   css_lines.append(f"  --bg-soft: {color_tokens['bgSoft']};")
    if color_tokens.get("ink"):      css_lines.append(f"  --ink: {color_tokens['ink']};")
    if color_tokens.get("inkSoft"):  css_lines.append(f"  --ink-soft: {color_tokens['inkSoft']};")
    if color_tokens.get("muted"):    css_lines.append(f"  --muted: {color_tokens['muted']};")
    if color_tokens.get("accent"):   css_lines.append(f"  --accent: {color_tokens['accent']};")
    css_lines.append("")
    css_lines.append(f"  --font-display: {font_families[0][0] if font_families else 'serif'};")
    if len(font_families) > 1:
        css_lines.append(f"  --font-body: {font_families[1][0]};")
    css_lines.append("")
    # 字号 token —— 按 px 数值降序排，分配 display/h1/h2/h3/body/small/caption
    sized_for_css = []
    for size, _ in size_top[:10]:
        m = re.match(r"([\d.]+)px", size)
        if m:
            sized_for_css.append((float(m.group(1)), size))
    sized_for_css.sort(key=lambda x: -x[0])
    role_names = ["display", "h1", "h2", "h3", "body", "small", "caption"]
    # 倒序输出（display 在最后），让阅读时从大到小
    for i, (px, size) in enumerate(sized_for_css[:len(role_names)]):
        css_lines.append(f"  --fs-{role_names[i]}: {size};")

    md = f"""# {urllib.parse.urlparse(url).hostname} · 设计系统迁移规范

> 来源：{url}
> 抓取日期：{today}
> 可见元素分析样本：{summary['totalElementsVisible']} 个

## 0. 风格基调

> ⚠️ 这一节需要人工 / AI vision 看图填写。
> 关键词（5 个）：__待补__
> 类比：__待补__
> 一句话定位：__待补__

---

## 1. Design Tokens

### 1.1 颜色

按出现频次自动分配语义角色（**真实 computed style 数据**）：

| Token | Hex | 出现次数 | 用法建议 |
|---|---|---|---|
"""
    color_counts = dict(bg_colors + fg_colors)
    for name, value_rgba in [
        ("--bg",        color_tokens.get("bg")),
        ("--bg-soft",   color_tokens.get("bgSoft")),
        ("--ink",       color_tokens.get("ink")),
        ("--ink-soft",  color_tokens.get("inkSoft")),
        ("--muted",     color_tokens.get("muted")),
        ("--accent",    color_tokens.get("accent")),
    ]:
        if not value_rgba:
            continue
        # 找原始 rgba 看出现次数
        orig = next((c for c in all_colors if hex_from_rgba(c) == value_rgba), None)
        n = color_counts.get(orig, "—") if orig else "—"
        usage = {
            "--bg": "主页面背景",
            "--bg-soft": "次级表面 / 卡片底",
            "--ink": "正文 / 标题",
            "--ink-soft": "次级文字",
            "--muted": "metadata / 占位",
            "--accent": "唯一强调色（hover / 信号）"
        }.get(name, "")
        md += f"| `{name}` | `{value_rgba}` | {n} | {usage} |\n"

    md += "\n### 1.2 字体\n\n"
    md += f"- **Display 字体**: `{primary_family}`（类别推断：**{primary_cat}**）\n"
    md += f"- **Body 字体**: `{body_family}`（类别：**{body_cat}**）\n\n"
    if fonts:
        md += "实际加载的字体文件（来自 `document.fonts`）：\n\n"
        for f in fonts[:10]:
            md += f"- `{f.get('family','?')}` · {f.get('style','normal')} · weight {f.get('weight','—')} · {f.get('status','—')}\n"

    md += "\n### 1.3 字号阶（按 px 降序 + 出现频次）\n\n"
    md += "| Size | 出现次数 | 推断角色 |\n|---|---|---|\n"
    # 按 px 数值排序后分配 display→caption
    sized = []
    for size, n in size_top[:10]:
        m = re.match(r"([\d.]+)px", size)
        if m:
            sized.append((float(m.group(1)), size, n))
    sized.sort(key=lambda x: -x[0])
    role_seq = ["display", "h1", "h2", "h3", "body", "small", "caption", "micro"]
    for i, (px, size, n) in enumerate(sized[:len(role_seq)]):
        md += f"| {size} | {n} | {role_seq[i]} |\n"

    md += "\n### 1.4 字重 / 行高 / 字距\n\n"
    md += "**Font weights:** " + ", ".join(f"`{w}` × {n}" for w, n in weight_top[:5]) + "\n\n"
    md += "**Line heights:** " + ", ".join(f"`{l}` × {n}" for l, n in lh_top[:5]) + "\n\n"
    md += "**Letter spacings:** " + ", ".join(f"`{l}` × {n}" for l, n in ls_top[:5]) + "\n"

    md += "\n### 1.5 间距\n\n"
    md += "Padding（shorthand top right bottom left, top 5）：\n\n"
    for p, n in padding_top:
        md += f"- `{p}` × {n}\n"
    md += "\nGap（flex/grid 间距）：\n\n"
    for g, n in gap_top:
        md += f"- `{g}` × {n}\n"

    md += "\n### 1.6 圆角\n\n"
    if radius_top:
        for r, n in radius_top:
            md += f"- `{r}` × {n}\n"
    else:
        md += "几乎不用圆角（直角设计语言）\n"

    md += "\n### 1.7 阴影\n\n"
    if shadow_top:
        for s, n in shadow_top:
            md += f"- `{s}` × {n}\n"
    else:
        md += "**零阴影** —— 不靠 elevation 建层级（纯 hairline border / 留白）\n"

    md += "\n### 1.8 动效 transition\n\n"
    if transition_top:
        for t, n in transition_top:
            md += f"- `{t}` × {n}\n"
    else:
        md += "极少 transition，多数交互无 CSS 动效\n"

    md += "\n---\n\n## 2. 布局 Layout\n\n"
    md += "> 完整布局推断需要看 hero / sections 截图配合元素 rect 数据。\n"
    md += "> 自动产物里 `elements.json` 含每个元素的 `{x, y, w, h}`，可继续分析容器宽度、栏数、断点。\n\n"
    md += "页面骨架（按视觉滚动顺序）：\n\n"
    for i, sec in enumerate(summary.get("sections", [])):
        md += f"{i+1}. `{sec.get('file', '?')}` （y={sec.get('y', '?')}px）\n"

    md += "\n---\n\n## 3. 组件规范 Components\n\n"
    md += "> 自动数据无法推断「组件契约」——需要人工/AI 看截图归纳。\n"
    md += "> 建议从 hero 截图 + sections 截图开始，识别 button / card / chip / nav / hero 五大件，分别给完整 CSS。\n"
    md += "\n- **Button**：__待补__（看 hero 截图里的 CTA）\n"
    md += "- **Card**：__待补__（看 section 截图里的内容卡）\n"
    md += "- **Nav**：__待补__（看 hero 顶部）\n"
    md += "- **Hero**：__待补__（首屏 02_desktop_hero.png）\n"
    md += "- **Input**：__待补__（如有 form）\n"

    md += "\n---\n\n## 4. 页面结构\n\n"
    md += "Section 顺序（从 03_desktop_section_*.png 看）：\n\n"
    for i, sec in enumerate(summary.get("sections", [])):
        md += f"{i+1}. ![](./{sec['file']})\n"

    md += "\n---\n\n## 5. CSS Variables（可直接粘进 `:root`）\n\n"
    md += "```css\n:root {\n" + "\n".join(css_lines) + "\n}\n```\n\n"

    if vars_:
        md += "\n该站原 :root 自带的 CSS 变量（供对照）：\n\n```css\n"
        for k, v in list(vars_.items())[:20]:
            md += f"  {k}: {v};\n"
        md += "```\n"

    md += "\n---\n\n## 6. 落地清单（用这份规范做新项目时）\n\n"
    md += "- [ ] 把 §5 的 CSS variables 整段贴进 `:root`\n"
    md += "- [ ] 字体：去加载 `--font-display` 和 `--font-body`（或换成同类别的开放字体）\n"
    md += "- [ ] 间距阶按 §1.5 的高频值定 spacing token\n"
    md += "- [ ] §1.6 圆角原则严守：如果原站 `borderRadius` top-N 全是 0/2px，新站不要加大圆角\n"
    md += "- [ ] §1.7 阴影原则严守：如果原站无 `boxShadow`，新站靠 hairline border 而非 elevation\n"
    md += "- [ ] §0 / §3 的语义部分（气质、组件）人工或 AI vision 补齐\n"

    md += "\n---\n\n## 7. 产物清单\n\n"
    files_in_dir = sorted(out_dir.glob("*"))
    for f in files_in_dir:
        if f.is_file():
            kb = f.stat().st_size / 1024
            md += f"- `{f.name}` （{kb:.0f} KB）\n"

    md += "\n---\n\n## 8. 已知限制\n\n"
    md += "- **静态快照**：hover / active / focus 状态需要二次脚本对每个 button/a 做 `.hover()` 后再抓 styles 求差\n"
    md += "- **JS 动效**：CSS `transition` 抓到，但 JS / Framer Motion / Three.js 动画无法反推关键帧\n"
    md += "- **装饰素材**：手绘 SVG / 品牌图标只是引用 URL，没抠出来（也有版权风险）\n"
    md += "- **响应式断点**：当前只跑了 1440 和 390 两个 viewport，中间断点需要补跑\n"
    md += "- **字体推断**：类别（serif/sans/mono）准，但具体品牌（Inter vs Söhne）需要人工核对\n"
    md += "- **数据样本偏置**：只统计可见元素，hidden / display:none 的样式不计\n"

    return md


# ───── sites.js entry ─────
def synthesize_sites_entry(summary: dict) -> dict:
    """从 summary 生成可粘进 sites.js 的 11 层 spec 骨架。"""
    url = summary["url"]
    tokens = summary["tokens"]
    fonts = summary["fonts"]
    fontfams = pick_top(tokens["fontFamily"], 3)
    all_colors_top = pick_top(tokens["backgroundColor"], 6) + pick_top(tokens["color"], 6)
    color_tokens = assign_color_tokens(all_colors_top)

    # 字号 scale —— 按 px 数值降序分配 display / h1 / h2 / h3 / body / small / caption
    size_top = pick_top(tokens["fontSize"], 8)
    parsed = []
    for size, n in size_top:
        m = re.match(r"([\d.]+)px", size)
        if m:
            parsed.append((float(m.group(1)), size, n))
    parsed.sort(key=lambda x: -x[0])  # 大到小
    role_seq = ["display", "h1", "h2", "h3", "body", "small", "caption", "micro"]
    scale = []
    for i, (px, size, n) in enumerate(parsed[:len(role_seq)]):
        scale.append({"token": role_seq[i], "size": int(px), "frequency": n})

    spec = {
        "identity": {"keywords": [], "analogy": "", "oneLiner": ""},
        "colors": {
            **color_tokens,
            "principle": f"自动从 {summary['totalElementsVisible']} 个元素 computed styles 推断；top color 频次 {pick_top(tokens['color'], 3)}"
        },
        "typography": {
            "display": font_category(fontfams[0][0]) if fontfams else None,
            "body": font_category(fontfams[1][0]) if len(fontfams) > 1 else None,
            "displayActualName": fontfams[0][0] if fontfams else None,
            "bodyActualName": fontfams[1][0] if len(fontfams) > 1 else None,
            "scale": scale,
            "rules": []
        },
        "spacing": None,
        "surfaces": {
            "radius": {"primary": pick_top(tokens["borderRadius"], 1)[0][0] if pick_top(tokens["borderRadius"], 1) else "0"},
            "shadows": [s for s, _ in pick_top(tokens["boxShadow"], 3)],
            "borders": "auto-detected"
        },
        "layout": {"skeleton": "auto from sections"},
        "components": None,
        "motion": {"transitions": [t for t, _ in pick_top(tokens["transition"], 3)]},
        "interaction": None,
        "voice": None,
        "donts": [],
        "systemPrompt": "",
        "_extractedAt": date.today().isoformat(),
        "_extractedFrom": url,
        "_extractionMethod": "playwright-computed-styles"
    }
    return spec


# ───── CLI ─────
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("extract_dir", help="extract.py 的输出目录")
    args = parser.parse_args()

    out_dir = Path(args.extract_dir)
    if not (out_dir / "summary.json").exists():
        print(f"❌ 没找到 summary.json: {out_dir}")
        sys.exit(1)

    summary = json.loads((out_dir / "summary.json").read_text(encoding="utf-8"))

    md = synthesize_md(summary, out_dir)
    (out_dir / "DESIGN_SPEC.md").write_text(md, encoding="utf-8")

    spec = synthesize_sites_entry(summary)
    (out_dir / "sites-entry.json").write_text(
        json.dumps(spec, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("✓ 合成完成")
    print(f"  · {out_dir/'DESIGN_SPEC.md'}   ({len(md)} 字)")
    print(f"  · {out_dir/'sites-entry.json'}  ({len(json.dumps(spec))} 字)")
    print()
    print("下一步：")
    print("  1. 看 DESIGN_SPEC.md 的 §0、§3 标 __待补__ 的字段，人工补或 AI vision 补")
    print("  2. sites-entry.json 加 id/title/url/image/tags 后粘进 sites.js")


if __name__ == "__main__":
    main()
