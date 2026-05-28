#!/usr/bin/env python3
"""
OpenDesign · 设计系统提取器
─────────────────────────────────────────────────────────────────────────
用真浏览器（Playwright + Chromium）抓任意网站的 computed styles，
按频次统计聚合出真正的 design tokens（颜色、字体、字号、间距、圆角、阴影），
配套多段截图作视觉证据。

哲学：抓 token 不抓像素。高频出现 = 真 token，低频 = outlier。

用法：
  python3 extract.py https://linear.app
  python3 extract.py https://stripe.com --out ./extracts/stripe
  python3 extract.py https://lusion.co --headed   # 开有头模式调试

产物（默认放在 ./extracts/<domain>/）：
  - summary.json          按维度聚合的 token 频次（colors / fonts / sizes / spacing / radius / shadows...）
  - elements.json         全部可见元素的原始 computed styles
  - fonts.json            实际加载的字体文件
  - requests.json         所有网络请求 URL（截图 / 字体 / 第三方）
  - 01_desktop_full.png   1440 宽全页截图
  - 02_desktop_hero.png   1440 宽首屏
  - 03_section_NN.png     按 90% viewport 步进的滚动分段
  - 04_mobile_full.png    390 宽全页
  - 05_mobile_hero.png    390 宽首屏
  - dom.html              原始 HTML 快照
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright


# ─────────────── 配置常量 ───────────────
DESKTOP_VIEWPORT = {"width": 1440, "height": 900}
MOBILE_VIEWPORT = {"width": 390, "height": 844}
DESKTOP_SCALE = 2
MOBILE_SCALE = 3
NETWORKIDLE_TIMEOUT = 60_000
ANIMATION_SETTLE_MS = 3_000   # 等 Framer Motion / scroll reveal 跑完
SCROLL_STEP_RATIO = 0.9       # 每段截图覆盖 viewport 90%（留 10% 重叠）
MAX_SECTIONS = 16             # 最多滚动截 N 段，超长页面截断

# 抓哪些 computed style 字段（精挑过，覆盖 95% design token）
CAPTURE_PROPS = [
    "color", "backgroundColor", "backgroundImage",
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
    "fontStyle", "textTransform", "textDecoration",
    "borderRadius", "borderTopLeftRadius", "borderTopRightRadius",
    "borderBottomLeftRadius", "borderBottomRightRadius",
    "borderTop", "borderBottom", "borderLeft", "borderRight",
    "borderColor", "borderWidth", "borderStyle",
    "boxShadow", "filter", "backdropFilter", "opacity",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "marginTop", "marginRight", "marginBottom", "marginLeft",
    "gap", "rowGap", "columnGap",
    "display", "flexDirection", "alignItems", "justifyContent",
    "gridTemplateColumns", "gridTemplateRows", "gridAutoFlow",
    "transition", "animation",
    "transform", "transformOrigin",
    "position", "overflow",
    "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
    "textAlign", "verticalAlign",
    "cursor"
]

# 浏览器里跑的 JS，把所有可见元素的 computed styles 抓出来
COLLECT_JS = """
async () => {
  const props = %s;
  const out = [];
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom < 0) continue;  // 跳过页面顶部以上的
    const cs = getComputedStyle(el);
    const data = {
      tag: el.tagName.toLowerCase(),
      classes: el.className && typeof el.className === 'string' ? el.className.slice(0, 200) : '',
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      text: (el.textContent || '').trim().slice(0, 80)
    };
    for (const p of props) {
      const v = cs[p];
      if (v && v !== 'normal' && v !== 'none' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') {
        data[p] = v;
      }
    }
    out.push(data);
  }
  // CSS variables on :root
  const rootCS = getComputedStyle(document.documentElement);
  const vars = {};
  for (let i = 0; i < rootCS.length; i++) {
    const name = rootCS[i];
    if (name.startsWith('--')) {
      vars[name] = rootCS.getPropertyValue(name).trim();
    }
  }
  return { elements: out, cssVariables: vars, totalElements: all.length };
}
""" % json.dumps(CAPTURE_PROPS)

FONTS_JS = """
() => Array.from(document.fonts).map(f => ({
  family: f.family,
  style: f.style,
  weight: f.weight,
  stretch: f.stretch,
  status: f.status
}))
"""


# ─────────────── 工具 ───────────────
def slugify(url: str) -> str:
    host = urlparse(url).hostname or "site"
    return re.sub(r"[^a-z0-9-]+", "-", host.lower()).strip("-")


def normalize_color(c: str) -> str | None:
    """统一 rgba/rgb/hex 格式 → 始终用 rgba() 八位形式比较；返回 None 表示"等于透明"。"""
    if not c or c == "transparent":
        return None
    c = c.strip().lower()
    if c.startswith("#"):
        h = c[1:]
        if len(h) == 3:
            r, g, b = (int(ch * 2, 16) for ch in h)
            return f"rgba({r},{g},{b},1)"
        if len(h) == 6:
            r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
            return f"rgba({r},{g},{b},1)"
        if len(h) == 8:
            r, g, b, a = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), int(h[6:8], 16) / 255
            return f"rgba({r},{g},{b},{round(a,3)})"
    m = re.match(r"rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)", c)
    if m:
        r, g, b = int(float(m.group(1))), int(float(m.group(2))), int(float(m.group(3)))
        a = float(m.group(4)) if m.group(4) else 1.0
        if a == 0:
            return None
        return f"rgba({r},{g},{b},{round(a,3)})"
    return c


def aggregate(elements: list[dict]) -> dict:
    """统计聚合：找出真 design tokens。"""
    cnt = {
        "color": Counter(),
        "backgroundColor": Counter(),
        "backgroundImage": Counter(),  # 渐变 / 图片
        "fontFamily": Counter(),
        "fontSize": Counter(),
        "fontWeight": Counter(),
        "lineHeight": Counter(),
        "letterSpacing": Counter(),
        "borderRadius": Counter(),
        "boxShadow": Counter(),
        "transition": Counter(),
        "padding": Counter(),
        "gap": Counter(),
        "borderColor": Counter(),
        "borderWidth": Counter(),
        "textTransform": Counter(),
        "cursor": Counter()
    }
    for e in elements:
        c = normalize_color(e.get("color", ""))
        if c:
            cnt["color"][c] += 1
        bc = normalize_color(e.get("backgroundColor", ""))
        if bc:
            cnt["backgroundColor"][bc] += 1
        bi = e.get("backgroundImage", "")
        if bi and bi != "none":
            cnt["backgroundImage"][bi[:200]] += 1
        for k in ("fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
                  "borderRadius", "boxShadow", "transition", "borderColor",
                  "borderWidth", "textTransform", "cursor"):
            v = e.get(k)
            if v:
                cnt[k][v] += 1
        # 把上下左右 padding 拼成 shorthand
        p = "{} {} {} {}".format(
            e.get("paddingTop", "0px"), e.get("paddingRight", "0px"),
            e.get("paddingBottom", "0px"), e.get("paddingLeft", "0px")
        )
        if p != "0px 0px 0px 0px":
            cnt["padding"][p] += 1
        g = e.get("gap")
        if g:
            cnt["gap"][g] += 1

    return {k: v.most_common(30) for k, v in cnt.items()}


async def auto_dismiss_overlays(page):
    """尝试关掉 cookie banner / popup（best-effort）。"""
    selectors = [
        "[aria-label*='accept' i]", "[aria-label*='close' i]", "[aria-label*='dismiss' i]",
        "[id*='cookie'] button", "[class*='cookie'] button",
        "button:has-text('Accept')", "button:has-text('同意')", "button:has-text('I agree')",
        "[data-testid*='accept']"
    ]
    for sel in selectors:
        try:
            el = await page.query_selector(sel)
            if el and await el.is_visible():
                await el.click(timeout=1000)
                await page.wait_for_timeout(300)
        except Exception:
            pass


async def capture_segments(page, out_dir: Path, prefix: str, viewport_h: int):
    """按 viewport 高度的 90% 步进往下滚，每滚一次截一张。"""
    # 先回到顶部
    await page.evaluate("window.scrollTo(0, 0)")
    await page.wait_for_timeout(300)
    page_height = await page.evaluate("Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)")
    step = int(viewport_h * SCROLL_STEP_RATIO)
    sections = []
    y = 0
    for i in range(MAX_SECTIONS):
        if y >= page_height:
            break
        await page.evaluate(f"window.scrollTo(0, {y})")
        await page.wait_for_timeout(400)
        fname = f"{prefix}_section_{i:02d}.png"
        await page.screenshot(path=str(out_dir / fname), full_page=False)
        sections.append({"file": fname, "y": y})
        y += step
    return sections


async def extract(url: str, out_dir: Path, headed: bool = False, mobile_only: bool = False) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    results: dict = {"url": url, "extractedAt": None}
    requests_log: list[dict] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not headed)
        # ───── Desktop ─────
        ctx = await browser.new_context(
            viewport=DESKTOP_VIEWPORT,
            device_scale_factor=DESKTOP_SCALE,
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            )
        )
        page = await ctx.new_page()
        page.on("request", lambda r: requests_log.append({
            "url": r.url,
            "type": r.resource_type
        }))

        print(f"▸ [desktop] 加载 {url}...", flush=True)
        try:
            await page.goto(url, wait_until="networkidle", timeout=NETWORKIDLE_TIMEOUT)
        except Exception as e:
            print(f"  ⚠ networkidle 超时，仍尝试继续: {e}", flush=True)
        await page.wait_for_timeout(ANIMATION_SETTLE_MS)
        await auto_dismiss_overlays(page)
        await page.wait_for_timeout(500)

        print("▸ [desktop] 截图：full + hero + sections...", flush=True)
        await page.screenshot(path=str(out_dir / "01_desktop_full.png"), full_page=True)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(300)
        await page.screenshot(path=str(out_dir / "02_desktop_hero.png"), full_page=False)
        section_files = await capture_segments(page, out_dir, "03_desktop", DESKTOP_VIEWPORT["height"])
        print(f"  · 滚动截图 {len(section_files)} 张", flush=True)

        print("▸ [desktop] 抓 computed styles + fonts + DOM...", flush=True)
        await page.evaluate("window.scrollTo(0, 0)")
        await page.wait_for_timeout(300)
        snapshot = await page.evaluate(COLLECT_JS)
        fonts = await page.evaluate(FONTS_JS)
        html = await page.content()

        (out_dir / "elements.json").write_text(
            json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (out_dir / "fonts.json").write_text(
            json.dumps(fonts, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        (out_dir / "dom.html").write_text(html[:200_000], encoding="utf-8")  # 截 200KB 防爆

        await ctx.close()

        # ───── Mobile ─────
        ctx_m = await browser.new_context(
            viewport=MOBILE_VIEWPORT,
            device_scale_factor=MOBILE_SCALE,
            is_mobile=True,
            has_touch=True,
            user_agent=(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 "
                "(KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1"
            )
        )
        page_m = await ctx_m.new_page()
        print(f"▸ [mobile] 加载 {url}...", flush=True)
        try:
            await page_m.goto(url, wait_until="networkidle", timeout=NETWORKIDLE_TIMEOUT)
        except Exception as e:
            print(f"  ⚠ networkidle 超时: {e}", flush=True)
        await page_m.wait_for_timeout(ANIMATION_SETTLE_MS)
        await auto_dismiss_overlays(page_m)
        await page_m.wait_for_timeout(500)

        print("▸ [mobile] 截图：full + hero...", flush=True)
        await page_m.screenshot(path=str(out_dir / "04_mobile_full.png"), full_page=True)
        await page_m.evaluate("window.scrollTo(0, 0)")
        await page_m.wait_for_timeout(300)
        await page_m.screenshot(path=str(out_dir / "05_mobile_hero.png"), full_page=False)

        await ctx_m.close()
        await browser.close()

    # ─────────── 聚合分析 ───────────
    print("▸ 聚合统计 design tokens...", flush=True)
    aggregated = aggregate(snapshot["elements"])

    summary = {
        "url": url,
        "totalElementsVisible": len(snapshot["elements"]),
        "totalElementsAll": snapshot["totalElements"],
        "cssVariables": snapshot["cssVariables"],
        "fonts": fonts,
        "tokens": aggregated,
        "sections": section_files,
        "requests": {
            "byType": dict(Counter(r["type"] for r in requests_log)),
            "fonts": sorted({r["url"] for r in requests_log if r["type"] == "font"}),
            "stylesheets": sorted({r["url"] for r in requests_log if r["type"] == "stylesheet"})
        }
    }

    (out_dir / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "requests.json").write_text(
        json.dumps(requests_log, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return {
        "outDir": str(out_dir),
        "elements": snapshot["totalElements"],
        "elementsVisible": len(snapshot["elements"]),
        "topColors": aggregated["color"][:5],
        "topFonts": aggregated["fontFamily"][:3],
        "fontsLoaded": [f["family"] for f in fonts][:8]
    }


# ─────────────── CLI ───────────────
def main():
    parser = argparse.ArgumentParser(description="OpenDesign 设计系统提取器")
    parser.add_argument("url", help="要抓取的网站 URL（必须 http/https 开头）")
    parser.add_argument("--out", default=None, help="输出目录（默认 ./extracts/<domain>）")
    parser.add_argument("--headed", action="store_true", help="有头模式（调试用）")
    parser.add_argument("--mobile-only", action="store_true", help="只跑移动端")
    args = parser.parse_args()

    url = args.url.strip()
    if not re.match(r"^https?://", url):
        url = "https://" + url

    out_dir = Path(args.out) if args.out else Path(__file__).parent / "extracts" / slugify(url)
    print(f"▸ 输出: {out_dir}")

    result = asyncio.run(extract(url, out_dir, headed=args.headed, mobile_only=args.mobile_only))

    print()
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("✓ 提取完成")
    print(f"  目录: {result['outDir']}")
    print(f"  可见元素: {result['elementsVisible']} / 总 {result['elements']}")
    print(f"  Top 颜色: {result['topColors']}")
    print(f"  Top 字体: {result['topFonts']}")
    print(f"  实际加载字体: {result['fontsLoaded']}")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")


if __name__ == "__main__":
    main()
