#!/usr/bin/env python3
"""
OpenDesign · build.py (v0.3)

把 sites/*.json （canonical 真源）→ 运行时所需的全部产物：

  dist/
    sites-index.json              ← 列表页瘦数据（id+title+tags+image+pack）
    sites/
      apple.json                  ← 详情完整数据（spec + desc + spec_i18n + narrative）
    legacy/                       ← v0.2 前端兼容文件，让 app.js 不用改
      sites.js
      sites-specs.json
      sites-i18n.json
    seo/
      sites/
        apple.en.html             ← 5 lang × N sites = 5N 静态 SEO 页面
        apple.ja.html
        apple.zh-CN.html
        ...
    sitemap.xml                   ← 含 hreflang 替代链接

用法：
  python3 scripts/build.py                # 全量构建
  python3 scripts/build.py --legacy-only  # 只重生成 legacy（最快开发循环）
  python3 scripts/build.py --seo-only     # 只生成 SEO 静态页
  python3 scripts/build.py --slug apple   # 只处理一站（调试用）
"""

from __future__ import annotations

import argparse
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent.parent.resolve()
SITES_DIR = ROOT / "sites"
DIST_DIR = ROOT / "dist"

LANGS = ["en", "zh-CN", "zh-TW", "ja", "ko"]
LANG_HTML = {"en": "en", "zh-CN": "zh-CN", "zh-TW": "zh-TW", "ja": "ja", "ko": "ko"}
BASE_URL = "https://opendesign.cc"

PACKS_INDEX = ROOT / "packs-index.json"
try:
    PACKS = json.loads(PACKS_INDEX.read_text(encoding="utf-8")) if PACKS_INDEX.exists() else {}
except Exception:
    PACKS = {}

# M-3: Pre-computed tag-based related sites map (slug → [{"id":…, "title":…}, …])
# Populated once in __main__ after all sites are loaded; read by render_site_html.
RELATED_SITES_MAP: dict = {}


def card_image(site, w=768, h=480):
    """卡片/OG 图优先用我们抓的真·桌面首屏截图（经 wsrv.nl 缩成小 webp），
    彻底甩开 thum.io 对 cookie 墙 / 反爬站截到垃圾页（还 HTTP 200，onerror 都不触发）的问题。
    没有完整包的站回退原 image。此函数不会抛异常（全 .get 带默认），不会拖垮批量逐站 build。"""
    slug = site.get("id", "")
    p = PACKS.get(slug) if isinstance(PACKS, dict) else None
    files = p.get("files", []) if isinstance(p, dict) else []
    if any(isinstance(f, dict) and f.get("name") == "02_desktop_hero.png" for f in files):
        return f"/thumbs/{slug}.webp"   # 自托管缩略图（scripts/make-thumbs.py 从真截图生成）
    return site.get("image", "")


def load_all_sites() -> list[dict]:
    if not SITES_DIR.exists():
        raise RuntimeError(f"{SITES_DIR} doesn't exist. Run migrate-to-v0.3.mjs first.")
    files = sorted(SITES_DIR.glob("*.json"))
    sites = []
    for f in files:
        try:
            sites.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception as e:
            print(f"  ✗ {f.name}: {e}")
    # 按 rank_score 降序排列（adaptive-rank.py 每日更新）；
    # 同分时按 added_at 降序（新站靠前），最后按 id 稳定排序。
    sites.sort(
        key=lambda s: (
            -(s.get("rank_score") or 0),           # rank 高的靠前
            -(int(s.get("added_at", "2020-01-01").replace("-", "")) if s.get("added_at") else 20200101),
            s.get("id", ""),
        )
    )
    return sites


# ============================================================
# Build target #1: dist/sites-index.json  (列表瘦数据)
# ============================================================

def build_sites_index(sites: list[dict]) -> dict:
    """前端列表页 / 画布只需要这一份。"""
    rows = []
    for s in sites:
        rows.append({
            "id": s["id"],
            "title": s["title"],
            "url": s["url"],
            "image": card_image(s),
            "tags": s.get("tags", []),
            "status": s.get("status", "pending"),
            "has_spec": bool(s.get("spec")),
            "has_pack": bool(s.get("pack", {}).get("available")),
            **({"no_preview": True} if s.get("no_preview") else {}),
        })
    return {
        "_meta": {
            "version": "0.3",
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "count": len(rows),
        },
        "sites": rows
    }


# ============================================================
# Build target #2: dist/legacy/sites.js + sites-specs.json + sites-i18n.json
# ============================================================
# 这一块让现有 app.js 不需要改就能用。等前端切到 dist/sites-index.json 后可弃用。

def build_legacy_sites_js(sites: list[dict]) -> str:
    """重建 sites.js（JS 数组），让 v0.2 app.js 能直接 load。"""
    js_sites = []
    for s in sites:
        # 把 desc.en 解出来给 palette/layout/interaction/motion/notes
        desc_en = s.get("desc", {}).get("en", {})
        # spec 复原：合并 spec (lang-neutral) + spec_i18n.en (lang-relative)
        spec_obj = {**(s.get("spec") or {})}
        i18n_en = s.get("spec_i18n", {}).get("en", {})
        if i18n_en:
            # identity / components / interaction / voice 直接 merge
            for k in ("identity", "components", "interaction", "voice"):
                if k in i18n_en:
                    spec_obj.setdefault(k, {}).update(i18n_en[k]) if isinstance(i18n_en[k], dict) else None
                    if not isinstance(i18n_en[k], dict):
                        spec_obj[k] = i18n_en[k]
            # donts / systemPrompt 顶层 string/list
            if "donts" in i18n_en: spec_obj["donts"] = i18n_en["donts"]
            if "systemPrompt" in i18n_en: spec_obj["systemPrompt"] = i18n_en["systemPrompt"]
            # 部分字段：merge sub-objects
            for k in ("colors", "typography", "spacing", "surfaces", "layout", "motion"):
                if k in i18n_en and isinstance(i18n_en[k], dict):
                    spec_obj.setdefault(k, {})
                    # typography 特殊：scaleUses 要 fold 回 scale[].use
                    if k == "typography" and "scaleUses" in i18n_en[k]:
                        rules = i18n_en[k].get("rules", [])
                        uses  = i18n_en[k].get("scaleUses", [])
                        if "scale" in spec_obj["typography"]:
                            for i, item in enumerate(spec_obj["typography"]["scale"]):
                                if i < len(uses):
                                    item["use"] = uses[i]
                        if rules: spec_obj["typography"]["rules"] = rules
                    else:
                        spec_obj[k].update(i18n_en[k])

        js_obj = {
            "id": s["id"],
            "title": s["title"],
            "url": s["url"],
            "image": card_image(s),
            "tags": s.get("tags", []),
            "palette": desc_en.get("palette", ""),
            "layout": desc_en.get("layout", ""),
            "interaction": desc_en.get("interaction", ""),
            "motion": desc_en.get("motion", ""),
            "notes": desc_en.get("notes", ""),
        }
        if spec_obj:
            js_obj["spec"] = spec_obj
        js_sites.append(js_obj)

    body = json.dumps(js_sites, ensure_ascii=False, indent=2)
    return f'''// Auto-generated by scripts/build.py from sites/*.json
// DO NOT EDIT BY HAND. Edit sites/<slug>.json instead.

const IMAGE_BASE = "https://pub-8c02bb0f8aa04c19b7b7ee44644801fd.r2.dev/images/768/";

function shot(url, w = 1440) {{
  return `https://image.thum.io/get/width/${{w}}/${{url}}`;
}}

window.STYLE_ATLAS_SITES = {body};
'''


def build_legacy_specs_json(sites: list[dict]) -> dict:
    """重建 sites-specs.json（AI vision 产物 overlay）"""
    out = {}
    for s in sites:
        if not s.get("spec"): continue
        out[s["id"]] = {
            "spec": s["spec"],
            "_model": s.get("_meta", {}).get("vision_model", "mimo-v2.5"),
            "_generatedAt": s.get("_meta", {}).get("vision_at", "")
        }
    return out


def build_legacy_i18n_json(sites: list[dict]) -> dict:
    """重建 sites-i18n.json（5 语言 desc overlay，全量版供按需降级）"""
    out = {
        "_meta": {
            "version": "0.3.1",
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "note": "Auto-generated by scripts/build.py from sites/*.json"
        }
    }
    for s in sites:
        if not s.get("desc"): continue
        out[s["id"]] = {lang: s["desc"].get(lang, {}) for lang in LANGS if s["desc"].get(lang)}
    return out


def build_i18n_per_lang(sites: list[dict]) -> dict[str, dict]:
    """
    按语言拆分 i18n overlay，生成 sites-i18n.{lang}.json。
    格式：{ site_id: { palette, layout, interaction, motion, notes, ... } }
    扁平化——不含 lang 嵌套层，节省体积。
    """
    per_lang: dict[str, dict] = {lang: {} for lang in LANGS}
    for s in sites:
        desc = s.get("desc") or {}
        for lang in LANGS:
            fields = desc.get(lang, {})
            if fields:
                per_lang[lang][s["id"]] = fields
    return per_lang


# ============================================================
# Build target #3: SEO static HTML per (site, lang)
# ============================================================

# 百度统计（国内）+ GA4（境外）—— SEO 落地页也要埋点（搜索流量直接落这里）
# 注：G-W2RPW945DH 与首页 index.html 保持一致，换成你的 GA4 Measurement ID
ANALYTICS_SNIPPET = """<script>var _hmt=_hmt||[];(function(){var hm=document.createElement("script");hm.src="https://hm.baidu.com/hm.js?14e82bc6d32ac2aa248d927998279013";var s=document.getElementsByTagName("script")[0];s.parentNode.insertBefore(hm,s);})();</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-W2RPW945DH"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-W2RPW945DH',{anonymize_ip:true});</script>"""

HTML_TEMPLATE = """<!doctype html>
<html lang="{html_lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>{title} · {brand_tagline} · OpenDesign</title>
<meta name="description" content="{meta_desc}" />
<link rel="canonical" href="{canonical}" />
{alternates}
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/icons/icon-180.png" />
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#ffffff" />
<meta property="og:type" content="article" />
<meta property="og:title" content="{title} · OpenDesign" />
<meta property="og:description" content="{meta_desc}" />
<meta property="og:image" content="{og_image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:url" content="{canonical}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="{og_image}" />
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; max-width: 860px; margin: 72px auto; padding: 32px; color: #0a0a0a; line-height: 1.6; }}
  h1 {{ font-family: "Instrument Serif", Georgia, serif; font-size: 64px; font-weight: 400; letter-spacing: -1px; line-height: 1.05; margin: 0 0 8px; }}
  .eyebrow {{ color: #737373; font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; margin: 0 0 24px; }}
  .lead {{ color: #1f1f1f; font-size: 20px; margin: 24px 0; line-height: 1.5; }}
  .tags {{ margin: 16px 0 32px; }}
  .tags span {{ display: inline-block; padding: 4px 10px; background: #f5f5f4; border-radius: 999px; color: #1f1f1f; font-size: 12px; margin-right: 6px; }}
  .meta {{ font-size: 13px; color: #737373; margin: 28px 0; }}
  .meta a {{ color: #0a0a0a; }}
  .meta p {{ margin: 4px 0; }}
  .screenshot {{ width: 100%; border: 1px solid #e7e5e4; border-radius: 10px; margin: 32px 0; display: block; }}
  h2 {{ font-family: "Instrument Serif", Georgia, serif; font-style: italic; font-size: 34px; font-weight: 400; margin: 64px 0 4px; }}
  html[lang^="zh"] h2, html[lang^="ja"] h2, html[lang^="ko"] h2 {{ font-style: normal; font-family: "Source Han Serif SC", "Songti SC", Georgia, serif; }}
  .kicker {{ color: #a8a29e; font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; margin: 56px 0 0; }}
  .kicker + h2 {{ margin-top: 4px; }}
  .narrative {{ font-size: 16px; color: #292524; margin: 12px 0; }}
  .principle {{ font-size: 15px; color: #57534e; font-style: italic; margin: 6px 0 16px; }}
  html[lang^="zh"] .principle, html[lang^="ja"] .principle, html[lang^="ko"] .principle {{ font-style: normal; }}
  .insight {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; margin: 24px 0; }}
  .insight section {{ background: #fafafa; padding: 16px 20px; border-radius: 6px; }}
  .insight h3 {{ margin: 0 0 8px; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: #737373; font-weight: 600; }}
  .insight p {{ margin: 0; font-size: 14px; }}
  .seo-breadcrumb {{ margin: -32px 0 40px; font-size: 13px; }}
  .seo-breadcrumb a {{ color: #737373; text-decoration: none; }}
  .seo-breadcrumb a:hover {{ color: #0a0a0a; text-decoration: underline; }}
  .cta {{ display: inline-block; background: #0a0a0a; color: #fff; padding: 14px 22px; border-radius: 999px; text-decoration: none; font-size: 14px; margin: 16px 12px 16px 0; }}
  .cta.ghost {{ background: transparent; color: #0a0a0a; border: 1px solid #0a0a0a; }}
  .langs {{ font-size: 12px; color: #737373; margin: 72px 0 16px; padding-top: 32px; border-top: 1px solid #e7e5e4; }}
  .langs a {{ color: #0a0a0a; margin-right: 12px; }}
  .langs a.active {{ color: #b4451c; }}
  footer {{ margin-top: 64px; padding-top: 32px; border-top: 1px solid #e7e5e4; color: #737373; font-size: 12px; }}
  footer a {{ color: #0a0a0a; }}
  .actions {{ margin: 28px 0 8px; }}
  /* identity */
  .keywords {{ margin: 8px 0 14px; }}
  .keywords span {{ display: inline-block; padding: 5px 12px; border: 1px solid #e7e5e4; border-radius: 999px; font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #44403c; margin: 0 6px 6px 0; }}
  /* color swatches */
  .swatches {{ display: flex; flex-wrap: wrap; gap: 16px; margin: 16px 0 8px; }}
  .sw {{ display: flex; flex-direction: column; gap: 6px; }}
  .sw .chip {{ width: 64px; height: 64px; border-radius: 8px; border: 1px solid #e7e5e4; }}
  .sw code {{ color: #1f1f1f; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
  .sw em {{ color: #737373; font-style: normal; letter-spacing: 0.06em; text-transform: uppercase; font-size: 10px; }}
  /* type scale */
  .typescale {{ list-style: none; padding: 0; margin: 16px 0; }}
  .typescale li {{ display: flex; align-items: baseline; justify-content: space-between; gap: 20px; padding: 12px 0; border-bottom: 1px solid #f0efed; }}
  .typescale .sample {{ line-height: 1.1; color: #0a0a0a; overflow: hidden; white-space: nowrap; }}
  .typescale code {{ color: #737373; font-size: 12px; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
  .typemeta {{ font-size: 13px; color: #737373; margin: 8px 0 0; }}
  /* stat tiles (layout / motion) */
  .stats {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }}
  .stats div {{ background: #fafafa; border-radius: 8px; padding: 14px 16px; }}
  .stats b {{ display: block; font-size: 22px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
  .stats span {{ font-size: 11px; color: #737373; letter-spacing: 0.08em; text-transform: uppercase; }}
  /* spacing bars */
  .spacing {{ margin: 16px 0; }}
  .spacing div {{ display: flex; align-items: center; gap: 12px; margin: 6px 0; }}
  .spacing i {{ height: 14px; background: #d6d3d1; border-radius: 3px; display: block; }}
  .spacing code {{ font-size: 12px; color: #737373; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }}
  /* surfaces / radius */
  .radii {{ display: flex; flex-wrap: wrap; gap: 16px; margin: 16px 0; }}
  .radii div {{ text-align: center; }}
  .radii i {{ width: 72px; height: 72px; background: #f0efed; border: 1px solid #e0ddd8; display: block; }}
  .radii span {{ font-size: 11px; color: #737373; display: block; margin-top: 6px; }}
  /* components */
  .components {{ list-style: none; padding: 0; margin: 16px 0; }}
  .components li {{ padding: 12px 0; border-bottom: 1px solid #f0efed; font-size: 15px; }}
  .components b {{ display: inline-block; min-width: 96px; color: #0a0a0a; text-transform: capitalize; }}
  .components span {{ color: #44403c; }}
  /* don'ts */
  .donts {{ list-style: none; padding: 0; margin: 16px 0; }}
  .donts li {{ position: relative; padding: 10px 0 10px 28px; border-bottom: 1px solid #f0efed; font-size: 15px; color: #292524; }}
  .donts li::before {{ content: "✕"; position: absolute; left: 0; top: 10px; color: #b4451c; font-weight: 700; }}
  /* screenshot gallery */
  .gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin: 16px 0; }}
  .gallery figure {{ margin: 0; }}
  .gallery a {{ display: block; }}
  .gallery img {{ width: 100%; border: 1px solid #e7e5e4; border-radius: 8px; display: block; background: #f5f5f4; }}
  .gallery figcaption {{ font-size: 11px; color: #a8a29e; margin-top: 6px; }}
  /* system prompt */
  .sysprompt {{ background: #faf8f3; border: 1px solid #efe9dd; border-radius: 10px; padding: 18px 20px; margin: 16px 0; font-size: 14px; color: #292524; white-space: pre-wrap; line-height: 1.55; }}
  /* agent */
  .agent {{ background: #faf8f3; border: 1px solid #efe9dd; border-radius: 10px; padding: 20px 24px; margin: 48px 0; }}
  .agent h3 {{ margin: 0 0 6px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #b4451c; font-weight: 600; }}
  .agent p {{ margin: 0 0 12px; font-size: 14px; color: #1f1f1f; }}
  .agent a {{ color: #0a0a0a; font-size: 14px; margin-right: 18px; white-space: nowrap; }}
  /* M-3: Related sites — static links for PageRank flow */
  .related {{ margin: 48px 0 32px; padding-top: 32px; border-top: 1px solid #e7e5e4; }}
  .related h2 {{ font-size: 14px; font-family: inherit; font-style: normal; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #737373; margin: 0 0 16px; }}
  .related ul {{ list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 10px; }}
  .related li a {{ display: inline-block; padding: 6px 14px; border: 1px solid #e7e5e4; border-radius: 999px; font-size: 13px; color: #0a0a0a; text-decoration: none; }}
  .related li a:hover {{ background: #f5f5f4; }}
</style>
<script type="application/ld+json">
{json_ld}
</script>
{analytics}
</head>
<body>
{body}
</body>
</html>
"""

LABELS = {
    "en":    { "eyebrow": "CURATED · OPEN · FREE", "visit": "Visit", "open_in_app": "Open in OpenDesign", "open_pack": "Download design pack", "insights_h2": "Design DNA", "label_color": "Visual language", "label_layout": "Layout structure", "label_interaction": "Interaction shape", "label_motion": "Motion rules", "notes_label": "Why we curated this", "screenshot_alt": "screenshot", "download_pack": "Download design system", "browse_pack": "Browse pack contents", "palette_h2": "Color palette", "type_h2": "Type scale", "agent_h3": "Bring this taste to your agent", "agent_desc": "Hand your AI agent a machine-readable spec of this design — tokens, type, motion, the whole DNA.", "agent_skill": "OpenDesign skill", "agent_pack": "This pack for agents" },
    "zh-CN": { "eyebrow": "精选 · 开放 · 免费", "visit": "原站", "open_in_app": "在 OpenDesign 中打开", "open_pack": "下载素材包", "insights_h2": "设计 DNA", "label_color": "视觉语言", "label_layout": "布局结构", "label_interaction": "交互形态", "label_motion": "动效规则", "notes_label": "为什么收录", "screenshot_alt": "网站截图", "download_pack": "下载设计系统包", "browse_pack": "浏览包内文件", "palette_h2": "色板", "type_h2": "字阶", "agent_h3": "把这份品味接进你的 Agent", "agent_desc": "把这套设计的机器可读规格——色彩、字体、动效，整套 DNA——直接交给你的 AI Agent。", "agent_skill": "OpenDesign 技能", "agent_pack": "本站 Agent 包" },
    "zh-TW": { "eyebrow": "精選 · 開放 · 免費", "visit": "原站", "open_in_app": "在 OpenDesign 中開啟", "open_pack": "下載素材包", "insights_h2": "設計 DNA", "label_color": "視覺語言", "label_layout": "版面結構", "label_interaction": "互動形態", "label_motion": "動效規則", "notes_label": "為什麼收錄", "screenshot_alt": "網站截圖", "download_pack": "下載設計系統包", "browse_pack": "瀏覽包內檔案", "palette_h2": "色板", "type_h2": "字階", "agent_h3": "把這份品味接進你的 Agent", "agent_desc": "把這套設計的機器可讀規格——色彩、字體、動效，整套 DNA——直接交給你的 AI Agent。", "agent_skill": "OpenDesign 技能", "agent_pack": "本站 Agent 包" },
    "ja":    { "eyebrow": "厳選・オープン・無料", "visit": "オリジナル", "open_in_app": "OpenDesign で開く", "open_pack": "デザインパックをダウンロード", "insights_h2": "デザイン DNA", "label_color": "視覚言語", "label_layout": "レイアウト構造", "label_interaction": "インタラクション形態", "label_motion": "モーション規則", "notes_label": "なぜ収録", "screenshot_alt": "のスクリーンショット", "download_pack": "デザインシステムをダウンロード", "browse_pack": "パックの中身を見る", "palette_h2": "カラーパレット", "type_h2": "タイプスケール", "agent_h3": "このセンスを AI エージェントへ", "agent_desc": "この設計の機械可読な仕様——カラー・タイポ・モーションまで——をそのまま AI エージェントに渡せます。", "agent_skill": "OpenDesign スキル", "agent_pack": "このパック（エージェント用）" },
    "ko":    { "eyebrow": "큐레이션 · 오픈 · 무료", "visit": "원본 사이트", "open_in_app": "OpenDesign 에서 열기", "open_pack": "디자인 팩 다운로드", "insights_h2": "디자인 DNA", "label_color": "시각 언어", "label_layout": "레이아웃 구조", "label_interaction": "인터랙션 형태", "label_motion": "모션 규칙", "notes_label": "왜 수록", "screenshot_alt": "스크린샷", "download_pack": "디자인 시스템 다운로드", "browse_pack": "팩 내용 보기", "palette_h2": "컬러 팔레트", "type_h2": "타입 스케일", "agent_h3": "이 감각을 당신의 에이전트에", "agent_desc": "이 디자인의 기계 판독 가능한 사양——색상·타이포·모션까지——을 그대로 AI 에이전트에 전달하세요.", "agent_skill": "OpenDesign 스킬", "agent_pack": "이 팩 (에이전트용)" }
}


# 富详情页用到的少量额外 label（其余复用 MD_CHAPTER_HEADINGS / MD_LABELS）
SEO_EXTRA = {
    "en":    {"components_h": "Components", "voice_h": "Voice & Don'ts", "gallery_h": "Inside the pack — real screenshots", "voice_tone": "Tone", "voice_headline": "Headlines", "voice_cta": "CTAs", "voice_avoid": "Avoid", "sys_h": "System prompt", "data_note": "Captured from the live site · real computed styles"},
    "zh-CN": {"components_h": "组件", "voice_h": "文案语气与禁用清单", "gallery_h": "包内真实截图", "voice_tone": "语气", "voice_headline": "标题风格", "voice_cta": "按钮文案", "voice_avoid": "避免", "sys_h": "System Prompt", "data_note": "抓自真实页面 · 真 computed styles"},
    "zh-TW": {"components_h": "組件", "voice_h": "文案語氣與禁用清單", "gallery_h": "包內真實截圖", "voice_tone": "語氣", "voice_headline": "標題風格", "voice_cta": "按鈕文案", "voice_avoid": "避免", "sys_h": "System Prompt", "data_note": "擷取自真實頁面 · 真 computed styles"},
    "ja":    {"components_h": "コンポーネント", "voice_h": "文体と禁止事項", "gallery_h": "パック内の実スクリーンショット", "voice_tone": "トーン", "voice_headline": "見出し", "voice_cta": "CTA", "voice_avoid": "避ける", "sys_h": "System Prompt", "data_note": "実ページから取得 · 実 computed styles"},
    "ko":    {"components_h": "컴포넌트", "voice_h": "보이스와 금지 목록", "gallery_h": "팩 안의 실제 스크린샷", "voice_tone": "톤", "voice_headline": "헤드라인", "voice_cta": "CTA", "voice_avoid": "피하기", "sys_h": "System Prompt", "data_note": "실제 페이지에서 캡처 · 실 computed styles"},
}


def render_site_html(site: dict, lang: str) -> str:
    """把整套设计系统（结构化 spec + 多语言叙事 + 真截图）渲染成杂志风富详情页。
    所有区块都按数据存在与否条件渲染：没 spec 的 stub 会优雅退化成一个干净的简页。"""
    from html import escape as esc
    L = LABELS[lang]
    X = SEO_EXTRA.get(lang, SEO_EXTRA["en"])
    H = MD_CHAPTER_HEADINGS.get(lang, MD_CHAPTER_HEADINGS["en"])
    slug = site["id"]
    title = site["title"]
    desc_block = site.get("desc", {}).get(lang) or site.get("desc", {}).get("en") or {}
    spec = site.get("spec") or {}
    si = site.get("spec_i18n", {}).get(lang) or site.get("spec_i18n", {}).get("en") or {}
    palette = desc_block.get("palette", "")
    notes_text = desc_block.get("notes", "")
    pack = PACKS.get(slug) if isinstance(PACKS, dict) else None

    canonical = f"{BASE_URL}/{lang}/sites/{slug}"
    alternates = "\n".join(
        f'<link rel="alternate" hreflang="{l}" href="{BASE_URL}/{l}/sites/{slug}" />' for l in LANGS
    ) + f'\n<link rel="alternate" hreflang="x-default" href="{BASE_URL}/en/sites/{slug}" />'
    lang_links = " · ".join(
        f'<a class="{"active" if l == lang else ""}" href="{BASE_URL}/{l}/sites/{slug}">{l}</a>'
        for l in LANGS
    )

    # ---------- 小工具 ----------
    def section(kicker, h2, inner):
        if not inner:
            return ""
        return f'<p class="kicker">{esc(kicker)}</p>\n<h2>{esc(h2)}</h2>\n{inner}'

    def narr(text):
        return f'<p class="narrative">{esc(text)}</p>' if (text and isinstance(text, str)) else ""

    def principle(text):
        return f'<p class="principle">{esc(text)}</p>' if (text and isinstance(text, str)) else ""

    def joinlist(items):
        items = [i for i in (items or []) if isinstance(i, str) and i.strip()]
        return ('<p class="narrative">' + " · ".join(esc(i) for i in items) + "</p>") if items else ""

    identity = si.get("identity") if isinstance(si.get("identity"), dict) else {}
    lead = (identity.get("oneLiner") if identity else "") or notes_text or palette or f"Design system spec — {title}"

    # ---------- body 区块 ----------
    B = []
    B.append(f'<p class="eyebrow">{esc(L["eyebrow"])}</p>')
    B.append(f'<h1>{esc(title)}</h1>')
    B.append(f'<p class="lead">{esc(lead)}</p>')
    if site.get("tags"):
        B.append('<div class="tags">' + "".join(f'<span>{esc(t)}</span>' for t in site["tags"]) + '</div>')

    hero = card_image(site, 1200, 750)
    if hero:
        B.append(f'<img class="screenshot" src="{hero}" alt="{esc(title)} {esc(L["screenshot_alt"])}" loading="lazy" />')

    # 下载 + 在 app 打开
    download_block = ""
    pack_html = ""
    agent_pack_link = ""
    if isinstance(pack, dict) and pack.get("zipFile"):
        zip_url = f"/packs/{slug}/{pack['zipFile']}"
        folder = pack.get("folderUrl") or f"/packs/{slug}/"
        size_mb = (pack.get("zipSize", 0) or 0) / 1024 / 1024
        download_block = f'<a class="cta" href="{zip_url}">↓ {esc(L["download_pack"])} ({size_mb:.0f} MB)</a>'
        pack_html = f'<p>📦 <a href="{folder}">{esc(L["browse_pack"])} →</a></p>'
        agent_pack_link = f' · <a href="{pack.get("agentUrl") or folder}">{esc(L["agent_pack"])} ↗</a>'
    elif site.get("pack", {}).get("available"):
        size_mb = site["pack"].get("zip_size", 0) / 1024 / 1024
        download_block = f'<a class="cta" href="{site["pack"]["zip_url"]}">↓ {esc(L["download_pack"])} ({size_mb:.0f} MB)</a>'
        pack_html = f'<p>📦 <a href="{site["pack"]["folder_url"]}">{esc(L["browse_pack"])} →</a></p>'
    # M-4: "在 OpenDesign 中打开" → 跳到 SPA 根路径并带 ?open=slug，SPA 会自动打开抽屉
    spa_open_url = f"/{lang}/?open={slug}"
    # 顶部返回首页面包屑（静态 SEO 页特有）
    home_url = f"/{lang}/"
    B.insert(0, f'<nav class="seo-breadcrumb"><a href="{home_url}">← OpenDesign</a></nav>')
    B.append(f'<div class="actions">{download_block}<a class="cta ghost" href="{spa_open_url}">{esc(L["open_in_app"])}</a></div>')
    B.append(f'<div class="meta"><p>{esc(L["visit"])}: <a href="{esc(site["url"])}" target="_blank" rel="noreferrer">{esc(site["url"])}</a></p>{pack_html}</div>')

    # 01 设计气质 DNA
    if identity:
        inner = ""
        kws = [k for k in (identity.get("keywords") or []) if isinstance(k, str)]
        if kws:
            inner += '<div class="keywords">' + "".join(f'<span>{esc(k)}</span>' for k in kws) + '</div>'
        inner += narr(identity.get("analogy"))
        B.append(section("01", H[0], inner))

    # 02 色彩
    colors = spec.get("colors") or {}
    SW_LABELS = {"bg": "BG", "bgSoft": "BG soft", "bgQuiet": "BG quiet", "ink": "Ink",
                 "inkSoft": "Ink soft", "accent": "Accent", "muted": "Muted",
                 "mutedSoft": "Muted soft", "line": "Line"}
    sw, seen = [], set()
    for key in ["accent", "ink", "inkSoft", "bg", "bgSoft", "bgQuiet", "muted", "line"]:
        v = colors.get(key)
        if not v or not isinstance(v, str) or v.lower() in seen:
            continue
        seen.add(v.lower())
        sw.append(f'<div class="sw"><span class="chip" style="background:{esc(v)}"></span><code>{esc(v)}</code><em>{SW_LABELS.get(key, key)}</em></div>')
    if sw:
        cprin = principle((si.get("colors") or {}).get("principle") if isinstance(si.get("colors"), dict) else "")
        B.append(section("02", H[1], '<div class="swatches">' + "".join(sw) + "</div>" + cprin))

    # 03 字体
    typ = spec.get("typography") or {}
    trows = []
    for item in (typ.get("scale") or []):
        if not isinstance(item, dict) or not item.get("size"):
            continue
        token = item.get("token") or "Aa"
        size = int(item["size"])
        weight = item.get("weight", 400) or 400
        trows.append(f'<li><span class="sample" style="font-size:{min(size,44)}px;font-weight:{weight}">{esc(token)}</span><code>{size}px · {weight}</code></li>')
    if trows:
        fams = list(dict.fromkeys(f for f in [typ.get("display"), typ.get("body"), typ.get("mono")] if f))
        meta_line = f'<p class="typemeta">{esc(" · ".join(fams))}</p>' if fams else ""
        rules = joinlist((si.get("typography") or {}).get("rules") if isinstance(si.get("typography"), dict) else None)
        B.append(section("03", H[2], meta_line + '<ul class="typescale">' + "".join(trows) + "</ul>" + rules))

    # 04 间距
    spacing = spec.get("spacing") or {}
    sc = [v for v in (spacing.get("scale") or []) if isinstance(v, (int, float))]
    if sc:
        bars = "".join(f'<div><i style="width:{min(int(v)*3,340)}px"></i><code>{int(v)}px</code></div>' for v in sc)
        rhythm = narr((si.get("spacing") or {}).get("rhythm") if isinstance(si.get("spacing"), dict) else "")
        B.append(section("04", H[3], f'<div class="spacing">{bars}</div>' + rhythm))

    # 05 表面（圆角 / 阴影 / 边线）
    surf = spec.get("surfaces") or {}
    radius = surf.get("radius") if isinstance(surf.get("radius"), dict) else {}
    rad = [(k, v) for k, v in radius.items() if isinstance(v, (int, float))]
    if rad:
        boxes = "".join(f'<div><i style="border-radius:{min(int(v),40)}px"></i><span>{esc(k)} · {int(v)}px</span></div>' for k, v in rad)
        sinfo = si.get("surfaces") if isinstance(si.get("surfaces"), dict) else {}
        extra = narr(sinfo.get("borders")) + joinlist(sinfo.get("shadows"))
        B.append(section("05", H[4], f'<div class="radii">{boxes}</div>' + extra))

    # 06 布局
    lay = spec.get("layout") or {}
    stat = []
    if lay.get("container"): stat.append((f'{int(lay["container"])}', "container"))
    if lay.get("columns"): stat.append((f'{int(lay["columns"])}', "columns"))
    if lay.get("gutter"): stat.append((f'{int(lay["gutter"])}px', "gutter"))
    if lay.get("breakpoints"): stat.append((" / ".join(str(int(b)) for b in lay["breakpoints"]), "breakpoints"))
    if stat:
        tiles = "".join(f'<div><b>{esc(v)}</b><span>{esc(k)}</span></div>' for v, k in stat)
        skel = narr((si.get("layout") or {}).get("skeleton") if isinstance(si.get("layout"), dict) else "")
        B.append(section("06", H[5], f'<div class="stats">{tiles}</div>' + skel))

    # 07 动效与交互
    mot = spec.get("motion") or {}
    dur = mot.get("durations") if isinstance(mot.get("durations"), dict) else {}
    mtiles = [(f'{int(v)}ms', k) for k, v in dur.items() if isinstance(v, (int, float))]
    if mtiles or mot.get("easing"):
        tiles = "".join(f'<div><b>{esc(v)}</b><span>{esc(k)}</span></div>' for v, k in mtiles)
        if mot.get("easing"):
            tiles += f'<div><b style="font-size:13px">{esc(str(mot["easing"]))}</b><span>easing</span></div>'
        pats = joinlist((si.get("motion") or {}).get("patterns") if isinstance(si.get("motion"), dict) else None)
        inter = si.get("interaction") if isinstance(si.get("interaction"), dict) else {}
        ipieces = [inter.get("hover"), inter.get("click")]
        idesc = narr(" · ".join(p for p in ipieces if isinstance(p, str) and p.strip())) if any(ipieces) else ""
        B.append(section("07", H[6], f'<div class="stats">{tiles}</div>' + pats + idesc))

    # 08 组件
    comp = si.get("components") if isinstance(si.get("components"), dict) else {}
    crows = [(k, v) for k, v in comp.items() if isinstance(v, str) and v.strip()]
    if crows:
        items = "".join(f'<li><b>{esc(k)}</b> <span>{esc(v)}</span></li>' for k, v in crows)
        B.append(section("08", X["components_h"], f'<ul class="components">{items}</ul>'))

    # 09 文案语气 + 禁用清单
    voice = si.get("voice") if isinstance(si.get("voice"), dict) else {}
    donts = [d for d in (si.get("donts") or []) if isinstance(d, str) and d.strip()]
    if voice or donts:
        inner = ""
        vmap = [(X["voice_tone"], voice.get("tone")), (X["voice_headline"], voice.get("headlineStyle")), (X["voice_cta"], voice.get("ctaStyle"))]
        vitems = "".join(f'<li><b>{esc(lab)}</b> <span>{esc(val)}</span></li>' for lab, val in vmap if isinstance(val, str) and val.strip())
        avoid = [a for a in (voice.get("avoid") or []) if isinstance(a, str)]
        if vitems:
            inner += f'<ul class="components">{vitems}</ul>'
        all_donts = donts + [f'{X["voice_avoid"]}: {a}' for a in avoid]
        if all_donts:
            inner += '<ul class="donts">' + "".join(f'<li>{esc(d)}</li>' for d in all_donts) + "</ul>"
        B.append(section("09", X["voice_h"], inner))

    # 10 包内真实截图画廊（文件需在服务器；批量部署会把解压文件推上去）
    if isinstance(pack, dict) and pack.get("files"):
        shots = [f for f in pack["files"]
                 if isinstance(f, dict) and f.get("category") == "shot"
                 and isinstance(f.get("name"), str) and f["name"].endswith(".png")
                 and "_full" not in f["name"]]  # 跳过超大整页截图，页面更快
        if shots:
            figs = "".join(
                f'<figure><a href="/packs/{slug}/{esc(f["name"])}" target="_blank" rel="noreferrer">'
                f'<img src="/packs/{slug}/{esc(f["name"])}" alt="{esc(title)} — {esc(f.get("desc") or f["name"])}" loading="lazy" /></a>'
                f'<figcaption>{esc(f.get("desc") or f["name"])}</figcaption></figure>'
                for f in shots
            )
            note = f'<p class="typemeta">{esc(X["data_note"])}</p>'
            B.append(section("10", X["gallery_h"], f'<div class="gallery">{figs}</div>' + note))

    # 11 System Prompt（可直接粘给 AI 工具）
    sysp = si.get("systemPrompt")
    if isinstance(sysp, str) and sysp.strip():
        B.append(section("11", X["sys_h"], f'<div class="sysprompt">{esc(sysp.strip())}</div>'))

    # 给你的 Agent
    B.append(
        f'<div class="agent"><h3>{esc(L["agent_h3"])}</h3>'
        f'<p>{esc(L["agent_desc"])}</p>'
        f'<a href="/skill.md">{esc(L["agent_skill"])} ↗</a>{agent_pack_link}</div>'
    )

    # M-3: Related sites — static internal links for PageRank flow + crawl depth
    # (ALL_SITES_FOR_RELATED is injected as a closure variable by build_seo_pages)
    related_sites = []
    site_tags = set(site.get("tags", []))
    if site_tags and "ALL_SITES_FOR_RELATED" in dir():
        pass  # handled below in build_seo_pages via RELATED_SITES_MAP
    if RELATED_SITES_MAP and slug in RELATED_SITES_MAP:
        related_sites = RELATED_SITES_MAP[slug]
    if related_sites:
        related_label = {"en":"More from the library","zh-CN":"更多精选","zh-TW":"更多精選","ja":"ライブラリからもっと","ko":"더 보기"}.get(lang,"More from the library")
        items = "".join(
            f'<li><a href="/{lang}/sites/{r["id"]}">{esc(r["title"])}</a></li>'
            for r in related_sites
        )
        B.append(f'<nav class="related"><h2>{esc(related_label)}</h2><ul>{items}</ul></nav>')

    B.append(f'<p class="langs">{lang_links}</p>')
    B.append(
        '<footer>'
        f'<p>OpenDesign · curated web aesthetics for AI-readable design DNA · <a href="{BASE_URL}/">opendesign.cc</a></p>'
        f'<p>{esc(L["notes_label"])}: {esc(notes_text or palette or "—")}</p>'
        '<p><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">浙ICP备2021038972号-5</a></p>'
        '</footer>'
    )

    body = "\n\n".join(s for s in B if s)

    # H-2: og_image must always be absolute (og:image requires full URL for social crawlers)
    _img_raw = hero or ""
    if _img_raw.startswith("/"):
        og_image = f"{BASE_URL}{_img_raw}"
    elif _img_raw.startswith("http"):
        og_image = _img_raw
    else:
        og_image = f"{BASE_URL}/og-cover.png"

    # H-4: JSON-LD with required fields (datePublished, dateModified, author) + BreadcrumbList
    added_at = site.get("added_at", "2025-01-01")
    json_ld = json.dumps({
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "WebPage",
                "@id": f"{canonical}#webpage",
                "url": canonical,
                "name": f"{title} · Design DNA · OpenDesign",
                "description": (lead or notes_text or palette)[:300],
                "image": og_image,
                "inLanguage": lang,
                "datePublished": added_at,
                "dateModified": added_at,
                "author": {"@type": "Organization", "name": "OpenDesign", "url": BASE_URL},
                "publisher": {"@type": "Organization", "name": "OpenDesign", "url": BASE_URL},
                "breadcrumb": {"@id": f"{canonical}#breadcrumb"},
                "isPartOf": {"@id": f"{BASE_URL}/#website"},
            },
            {
                "@type": "BreadcrumbList",
                "@id": f"{canonical}#breadcrumb",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "OpenDesign", "item": BASE_URL},
                    {"@type": "ListItem", "position": 2, "name": "Catalog", "item": f"{BASE_URL}/{lang}/"},
                    {"@type": "ListItem", "position": 3, "name": title, "item": canonical},
                ]
            }
        ]
    }, ensure_ascii=False)

    return HTML_TEMPLATE.format(
        html_lang=LANG_HTML[lang],
        title=esc(title),
        brand_tagline=esc(L["insights_h2"]),
        meta_desc=esc(lead[:160]),
        canonical=canonical,
        alternates=alternates,
        og_image=og_image,
        json_ld=json_ld,
        analytics=ANALYTICS_SNIPPET,
        body=body,
    )


# ============================================================
# Build target #4: downloadable DESIGN_SPEC.<lang>.md per pack
# ============================================================
# 拼接 narrative.<lang>（mimo 写的 10 个叙事段）+ 结构化数据表格（模板渲染）
# → magazine 风格 8 章 markdown，进 pack 文件夹给 AI agent 下载。

MD_CHAPTER_HEADINGS = {
    "en":    ["Identity DNA", "Color", "Typography", "Spacing", "Surfaces", "Layout", "Motion & Interaction", "Voice & Don'ts"],
    "zh-CN": ["设计气质 DNA", "色彩", "字体", "间距", "表面 (圆角 / 阴影 / 边线)", "布局", "动效与交互", "文案语气与禁用清单"],
    "zh-TW": ["設計氣質 DNA", "色彩", "字型", "間距", "表面 (圓角 / 陰影 / 邊線)", "版面", "動效與互動", "文案語氣與禁用清單"],
    "ja":    ["デザイン DNA", "カラー", "タイポグラフィ", "余白", "サーフェス (角丸 / 影 / 罫線)", "レイアウト", "モーションとインタラクション", "文体と禁止事項"],
    "ko":    ["디자인 DNA", "컬러", "타이포그래피", "여백", "표면 (라운드 / 그림자 / 경계선)", "레이아웃", "모션과 인터랙션", "보이스와 금지 목록"]
}

MD_LABELS = {
    "en":    {"token": "Token", "value": "Value", "use": "Use", "size": "Size", "lh": "Line-height", "weight": "Weight", "ls": "Letter-spacing", "donts_h": "Don'ts", "principle": "Color principle", "rules": "Type rules", "easing": "Easing", "system_prompt": "System Prompt (paste into AI tool)"},
    "zh-CN": {"token": "Token", "value": "值", "use": "用法", "size": "Size", "lh": "Line-height", "weight": "Weight", "ls": "Letter-spacing", "donts_h": "禁用清单", "principle": "用色原则", "rules": "字体规则", "easing": "Easing", "system_prompt": "System Prompt（粘进 AI 工具）"},
    "zh-TW": {"token": "Token", "value": "值", "use": "用法", "size": "Size", "lh": "Line-height", "weight": "Weight", "ls": "Letter-spacing", "donts_h": "禁用清單", "principle": "用色原則", "rules": "字型規則", "easing": "Easing", "system_prompt": "System Prompt（貼進 AI 工具）"},
    "ja":    {"token": "Token", "value": "値", "use": "用途", "size": "Size", "lh": "Line-height", "weight": "Weight", "ls": "Letter-spacing", "donts_h": "禁止事項", "principle": "カラー原則", "rules": "タイポルール", "easing": "Easing", "system_prompt": "System Prompt (AI ツールに貼り付け)"},
    "ko":    {"token": "Token", "value": "값", "use": "용도", "size": "Size", "lh": "Line-height", "weight": "Weight", "ls": "Letter-spacing", "donts_h": "금지 목록", "principle": "컬러 원칙", "rules": "타이포 규칙", "easing": "Easing", "system_prompt": "System Prompt (AI 도구에 붙여넣기)"}
}


def kebab(s: str) -> str:
    """bgSoft → bg-soft"""
    import re as _re
    return _re.sub(r"(?<!^)(?=[A-Z])", "-", s).lower()


def render_design_spec_md(site: dict, lang: str) -> str:
    """生成可下载的 DESIGN_SPEC.<lang>.md"""
    slug = site["id"]
    title = site["title"]
    spec = site.get("spec", {})
    spec_i18n = site.get("spec_i18n", {}).get(lang) or site.get("spec_i18n", {}).get("en") or {}
    desc = site.get("desc", {}).get(lang) or site.get("desc", {}).get("en") or {}
    narrative = site.get("narrative", {}).get(lang) or site.get("narrative", {}).get("en") or {}
    headings = MD_CHAPTER_HEADINGS.get(lang, MD_CHAPTER_HEADINGS["en"])
    L = MD_LABELS.get(lang, MD_LABELS["en"])

    parts = [f"# {title} · Design system migration spec"]
    parts.append("")
    parts.append(f"> Source: {site['url']}  ·  Curated by OpenDesign  ·  {lang}")
    parts.append("")
    if desc.get("notes"):
        parts.append(f"> {desc['notes']}")
        parts.append("")

    # Chapter 1 — Identity DNA
    parts.append(f"## 1. {headings[0]}")
    parts.append("")
    if narrative.get("ch1_intro"): parts.append(narrative["ch1_intro"]); parts.append("")
    ident = spec_i18n.get("identity", {})
    if ident.get("oneLiner"): parts.append(f"**One-liner:** {ident['oneLiner']}")
    if ident.get("keywords"): parts.append(f"**Keywords:** {' · '.join(ident['keywords'])}")
    if ident.get("analogy"):  parts.append(f"**Analogy:** {ident['analogy']}")
    parts.append("")

    # Chapter 2 — Color
    parts.append(f"## 2. {headings[1]}")
    parts.append("")
    if narrative.get("ch2_intro"): parts.append(narrative["ch2_intro"]); parts.append("")
    colors = spec.get("colors", {})
    color_uses = {"bg":"main background","bgSoft":"card background","bgQuiet":"quiet area","ink":"body text","inkSoft":"secondary text","muted":"placeholder","mutedSoft":"weak hint","accent":"single accent","line":"divider"}
    rows = [(f"--{kebab(k)}", v, color_uses.get(k, "")) for k, v in colors.items() if v and k in color_uses]
    if rows:
        parts.append(f"| {L['token']} | {L['value']} | {L['use']} |")
        parts.append("|---|---|---|")
        for k, v, u in rows:
            parts.append(f"| `{k}` | `{v}` | {u} |")
        parts.append("")
    if spec_i18n.get("colors", {}).get("principle"):
        parts.append(f"**{L['principle']}:** {spec_i18n['colors']['principle']}")
        parts.append("")
    if narrative.get("ch2_outro"): parts.append(narrative["ch2_outro"]); parts.append("")

    # Chapter 3 — Typography
    parts.append(f"## 3. {headings[2]}")
    parts.append("")
    if narrative.get("ch3_intro"): parts.append(narrative["ch3_intro"]); parts.append("")
    typo = spec.get("typography", {})
    if typo:
        if typo.get("display"): parts.append(f"- **Display:** {typo['display']}")
        if typo.get("body"):    parts.append(f"- **Body:** {typo['body']}")
        if typo.get("mono"):    parts.append(f"- **Mono:** {typo['mono']}")
        parts.append("")
        if typo.get("scale"):
            uses = spec_i18n.get("typography", {}).get("scaleUses", [])
            parts.append(f"| {L['token']} | {L['size']} | {L['lh']} | {L['weight']} | {L['ls']} | {L['use']} |")
            parts.append("|---|---|---|---|---|---|")
            for i, s in enumerate(typo["scale"]):
                use = uses[i] if i < len(uses) else ""
                parts.append(f"| {s.get('token','—')} | {s.get('size','—')}px | {s.get('lh','—')} | {s.get('weight','—')} | {s.get('ls','—')} | {use} |")
            parts.append("")
    if spec_i18n.get("typography", {}).get("rules"):
        parts.append(f"**{L['rules']}:**")
        for r in spec_i18n["typography"]["rules"]:
            parts.append(f"- {r}")
        parts.append("")

    # Chapter 4 — Spacing
    parts.append(f"## 4. {headings[3]}")
    parts.append("")
    if narrative.get("ch4_intro"): parts.append(narrative["ch4_intro"]); parts.append("")
    sp = spec.get("spacing", {})
    if sp.get("base"):  parts.append(f"- **Base unit:** {sp['base']}px")
    if sp.get("scale"): parts.append(f"- **Scale:** {' / '.join(str(x) for x in sp['scale'])} px")
    if spec_i18n.get("spacing", {}).get("rhythm"): parts.append(f"- **Rhythm:** {spec_i18n['spacing']['rhythm']}")
    parts.append("")

    # Chapter 5 — Surfaces
    parts.append(f"## 5. {headings[4]}")
    parts.append("")
    if narrative.get("ch5_intro"): parts.append(narrative["ch5_intro"]); parts.append("")
    surf = spec.get("surfaces", {})
    if surf.get("radius"):
        r = surf["radius"]
        parts.append(f"- **Radius:** sm {r.get('sm','—')}px · md {r.get('md','—')}px · lg {r.get('lg','—')}px · pill {r.get('pill','—')}px")
    if spec_i18n.get("surfaces", {}).get("shadows"):
        parts.append("- **Shadows:**")
        for s in spec_i18n["surfaces"]["shadows"]: parts.append(f"  - {s}")
    if spec_i18n.get("surfaces", {}).get("borders"):
        parts.append(f"- **Borders:** {spec_i18n['surfaces']['borders']}")
    parts.append("")

    # Chapter 6 — Layout
    parts.append(f"## 6. {headings[5]}")
    parts.append("")
    if narrative.get("ch6_intro"): parts.append(narrative["ch6_intro"]); parts.append("")
    ly = spec.get("layout", {})
    if ly.get("container"):   parts.append(f"- **Container max:** {ly['container']}px")
    if ly.get("paragraph"):   parts.append(f"- **Paragraph max:** {ly['paragraph']}px")
    if ly.get("columns"):     parts.append(f"- **Grid:** {ly['columns']} columns, gutter {ly.get('gutter','—')}px")
    if ly.get("breakpoints"): parts.append(f"- **Breakpoints:** {' / '.join(str(x) for x in ly['breakpoints'])} px")
    if spec_i18n.get("layout", {}).get("skeleton"):
        parts.append("")
        parts.append(f"**Skeleton:** {spec_i18n['layout']['skeleton']}")
    parts.append("")

    # Chapter 7 — Motion & Interaction
    parts.append(f"## 7. {headings[6]}")
    parts.append("")
    if narrative.get("ch7_intro"): parts.append(narrative["ch7_intro"]); parts.append("")
    mot = spec.get("motion", {})
    if mot.get("durations"):
        d = mot["durations"]
        parts.append(f"- **Durations:** micro {d.get('micro','—')}ms · small {d.get('small','—')}ms · medium {d.get('medium','—')}ms")
    if mot.get("easing"):     parts.append(f"- **{L['easing']}:** `{mot['easing']}`")
    if spec_i18n.get("motion", {}).get("patterns"):
        parts.append("- **Patterns:**")
        for p in spec_i18n["motion"]["patterns"]: parts.append(f"  - {p}")
    inter = spec_i18n.get("interaction", {})
    if inter:
        parts.append("")
        for k in ["hover", "click", "transition", "keyboard"]:
            if inter.get(k): parts.append(f"- **{k.title()}:** {inter[k]}")
    parts.append("")

    # Chapter 8 — Voice & Don'ts
    parts.append(f"## 8. {headings[7]}")
    parts.append("")
    if narrative.get("ch8_intro"): parts.append(narrative["ch8_intro"]); parts.append("")
    voice = spec_i18n.get("voice", {})
    if voice:
        if voice.get("tone"):          parts.append(f"- **Tone:** {voice['tone']}")
        if voice.get("headlineStyle"): parts.append(f"- **Headline style:** {voice['headlineStyle']}")
        if voice.get("ctaStyle"):      parts.append(f"- **CTA style:** {voice['ctaStyle']}")
        if voice.get("avoid"):         parts.append(f"- **Avoid:** {' / '.join(voice['avoid'])}")
        parts.append("")
    donts = spec_i18n.get("donts", [])
    if donts:
        parts.append(f"### {L['donts_h']}")
        for d in donts: parts.append(f"- ❌ {d}")
        parts.append("")
    if narrative.get("ch8_outro"): parts.append(narrative["ch8_outro"]); parts.append("")

    # System Prompt
    if spec_i18n.get("systemPrompt"):
        parts.append(f"## {L['system_prompt']}")
        parts.append("")
        parts.append("```")
        parts.append(spec_i18n["systemPrompt"])
        parts.append("```")
        parts.append("")

    return "\n".join(parts)


# ============================================================
# Build target #4c: per-pack manifest.json (Pack Standard v1 · 自描述)
# ============================================================
# Agent 命中 folder URL 即可 GET manifest.json，知道这个作品有哪些文件、哪个层级、怎么用。
# 契约见 docs/design-pack-standard.md。

def render_pack_manifest(site: dict, doc_langs: list, has_design_md: bool,
                         has_spec: bool, tier2: dict | None) -> dict:
    slug = site["id"]
    agent_url = f"{BASE_URL}/packs/{slug}/"
    documents = {}
    if has_design_md:
        documents["DESIGN.md"] = "Google design.md format (YAML front matter + 8 sections)"
    for lang in doc_langs:
        documents[f"DESIGN_SPEC.{lang}.md"] = f"OpenDesign 11-layer spec ({lang})"
    if has_spec:
        documents["spec.json"] = "11-layer design tokens (machine-readable)"

    complete = None
    if tier2 and (tier2.get("files") or tier2.get("zipFile")):
        complete = {
            "zip": tier2.get("zipFile"),
            "zipSize": tier2.get("zipSize") or tier2.get("zip_size"),
            "fileCount": tier2.get("fileCount") or len(tier2.get("files") or []),
            "files": [f.get("name") for f in (tier2.get("files") or []) if f.get("name")],
            "includes": "real computed styles (summary.json), loaded fonts (fonts.json), desktop+mobile screenshots",
        }

    return {
        "standard": "design-pack/v1",
        "slug": slug,
        "title": site.get("title", ""),
        "url": site.get("url", ""),
        "tags": site.get("tags", []),
        "tier": 2 if complete else 1,
        "agentUrl": agent_url,
        "documents": documents,
        "complete": complete,
        "usage": ("Feed any DESIGN_SPEC.*.md (or DESIGN.md) into Claude / Cursor / v0 / Lovable, "
                  "or point your agent at this folder URL to read the full design system."),
    }


# Build target #4b: DESIGN.md (Google Stitch / VoltAgent compat)
# ============================================================
# 让我们的 spec 同时能被 Google Stitch + Anthropic Claude + Cursor + Lovable 用。
# 11 层 spec → YAML front matter + 8 章 markdown body（Google design.md 格式）。

def to_kebab(s: str) -> str:
    import re as _re
    return _re.sub(r"(?<!^)(?=[A-Z])", "-", s or "").lower()


def render_google_design_md(site: dict, lang: str = "en") -> str:
    """生成 Google design.md 格式（YAML front matter + 8 章 prose）"""
    slug = site["id"]
    title = site["title"]
    spec = site.get("spec", {})
    spec_i18n = site.get("spec_i18n", {}).get(lang) or site.get("spec_i18n", {}).get("en") or {}

    colors = spec.get("colors", {}) or {}
    typo = spec.get("typography", {}) or {}
    rounded = (spec.get("surfaces", {}) or {}).get("radius", {}) or {}
    spacing = spec.get("spacing", {}) or {}

    # ---- YAML front matter ----
    lines = ["---"]
    lines.append(f"name: {title}")
    desc = (site.get("desc", {}).get(lang) or {}).get("notes", "")
    if desc: lines.append(f"description: \"{desc[:200]}\"")
    lines.append("version: alpha")
    lines.append("")

    # Colors → kebab-case tokens（Google 用 primary/secondary/tertiary/neutral，
    # 我们 bg/ink/accent ... 映射过去 + 保留我们原 name 也加）
    if any(colors.values()):
        lines.append("colors:")
        # Google-style mapping
        if colors.get("bg"):     lines.append(f'  background: "{colors["bg"]}"')
        if colors.get("ink"):    lines.append(f'  primary: "{colors["ink"]}"')
        if colors.get("inkSoft"):lines.append(f'  secondary: "{colors["inkSoft"]}"')
        if colors.get("accent"): lines.append(f'  tertiary: "{colors["accent"]}"')
        if colors.get("muted"):  lines.append(f'  neutral: "{colors["muted"]}"')
        # Our 11-layer 原 token 名也保留
        for k in ("bgSoft", "bgQuiet", "mutedSoft", "line"):
            if colors.get(k):
                lines.append(f'  {to_kebab(k)}: "{colors[k]}"')
        lines.append("")

    # Typography
    if typo.get("scale"):
        lines.append("typography:")
        for s in typo["scale"]:
            tok = s.get("token", "body")
            family = typo.get("display") if "display" in tok else typo.get("body") or typo.get("display") or "sans-serif"
            size_px = s.get("size", 16)
            lines.append(f"  {tok}:")
            if family: lines.append(f"    fontFamily: {family}")
            lines.append(f"    fontSize: {size_px}px")
            if s.get("lh"):     lines.append(f"    lineHeight: {s['lh']}")
            if s.get("weight"): lines.append(f"    fontWeight: {s['weight']}")
            if s.get("ls"):     lines.append(f"    letterSpacing: \"{s['ls']}\"")
        lines.append("")

    # Rounded
    if any(v is not None for v in rounded.values()):
        lines.append("rounded:")
        for k in ("sm", "md", "lg", "pill"):
            v = rounded.get(k)
            if v is not None:
                lines.append(f"  {k}: {v}px")
        lines.append("")

    # Spacing
    if spacing.get("scale"):
        lines.append("spacing:")
        # 第一个是 xs, 第二个是 sm, etc.
        scale_keys = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl"]
        for i, v in enumerate(spacing["scale"][:7]):
            lines.append(f"  {scale_keys[i] if i < len(scale_keys) else f's{i}'}: {v}px")
        lines.append("")

    lines.append("---")
    lines.append("")

    # ---- Markdown body (8 sections) ----
    ident = spec_i18n.get("identity") or {}
    lines.append("## Overview")
    lines.append("")
    if ident.get("oneLiner"): lines.append(ident["oneLiner"])
    elif desc:                lines.append(desc)
    if ident.get("analogy"):
        lines.append("")
        lines.append(f"*{ident['analogy']}*")
    lines.append("")

    if any(colors.values()):
        lines.append("## Colors")
        lines.append("")
        if spec_i18n.get("colors", {}).get("principle"):
            lines.append(spec_i18n["colors"]["principle"])
            lines.append("")
        for k, label in [("bg","Background"),("ink","Primary text"),("inkSoft","Secondary text"),("accent","Accent"),("muted","Muted"),("line","Borders")]:
            if colors.get(k):
                lines.append(f"- **{label} (`{colors[k]}`)** — uses `{to_kebab(k)}` token")
        lines.append("")

    if typo.get("display") or typo.get("body"):
        lines.append("## Typography")
        lines.append("")
        if typo.get("display"): lines.append(f"- **Display:** {typo['display']}")
        if typo.get("body"):    lines.append(f"- **Body:** {typo['body']}")
        if typo.get("mono"):    lines.append(f"- **Mono:** {typo['mono']}")
        if spec_i18n.get("typography", {}).get("rules"):
            lines.append("")
            for r in spec_i18n["typography"]["rules"]:
                lines.append(f"- {r}")
        lines.append("")

    if spacing.get("scale"):
        lines.append("## Layout")
        lines.append("")
        if spec_i18n.get("layout", {}).get("skeleton"):
            lines.append(spec_i18n["layout"]["skeleton"])
            lines.append("")
        if spec_i18n.get("spacing", {}).get("rhythm"):
            lines.append(f"*Rhythm:* {spec_i18n['spacing']['rhythm']}")
            lines.append("")

    if spec_i18n.get("surfaces"):
        sf = spec_i18n["surfaces"]
        lines.append("## Elevation & Depth")
        lines.append("")
        if sf.get("shadows"):
            for sh in sf["shadows"]:
                lines.append(f"- {sh}")
        if sf.get("borders"):
            lines.append(f"- Borders: {sf['borders']}")
        lines.append("")

    if rounded:
        lines.append("## Shapes")
        lines.append("")
        for k in ("sm","md","lg","pill"):
            v = rounded.get(k)
            if v is not None: lines.append(f"- `{k}`: {v}px")
        lines.append("")

    comps = spec_i18n.get("components") or {}
    if any(comps.values()):
        lines.append("## Components")
        lines.append("")
        for name in ("button","card","chip","input","hero"):
            recipe = comps.get(name)
            if recipe: lines.append(f"- **{name}:** {recipe}")
        lines.append("")

    donts = spec_i18n.get("donts") or []
    if donts:
        lines.append("## Do's and Don'ts")
        lines.append("")
        lines.append("**Don't:**")
        for d in donts:
            lines.append(f"- {d}")
        lines.append("")

    sp = spec_i18n.get("systemPrompt")
    if sp:
        lines.append("---")
        lines.append("")
        lines.append("## System Prompt (paste into AI agent)")
        lines.append("")
        lines.append("```")
        lines.append(sp)
        lines.append("```")
        lines.append("")

    return "\n".join(lines)


# ============================================================
# Build target #5b: llms.txt（GEO —— 给 LLM/Agent 的导览，暴露 /packs/ 协议）
# ============================================================

def build_llms_txt(sites: list[dict], pidx: dict) -> str:
    lines = [
        "# OpenDesign",
        "",
        "> 把值得反复回看的网页设计沉淀成可被 AI / Agent 直接复用的设计系统规范。",
        "",
        "**核心**: 每一个收录的网站都附带一份**机器可读的完整设计系统** —— 不是文案、不是 PSD，"
        "而是把视觉 / 布局 / 排版 / 动效 / 交互抽象成 AI（Claude / Cursor / v0 / Lovable）可直接复用的迁移指令。",
        "",
        "**正式站点**: https://opendesign.cc/",
        "**sitemap**: https://opendesign.cc/sitemap.xml",
        "",
        "## ⭐ AI / Agent 从这里开始",
        "",
        "**先 GET `https://opendesign.cc/skill.md`** —— 它会把你变成一位「设计总监」："
        "理解需求 → 给专业意见 → 从 545+ 真实设计系统里推荐合适的作品 → 拆解成 grounded 落地方案。"
        "这是用本库的正确姿势；下面的端点是它会用到的原料。",
        "",
        "## 给 AI / Agent：原料端点",
        "",
        "先 `GET https://opendesign.cc/catalog.json` 按需求搜索（字段：slug / title / tags / summary）。"
        "再用 slug 取该站的设计系统：",
        "",
        "```",
        "https://opendesign.cc/packs/<slug>/                  → DESIGN.md（folder 默认页）",
        "https://opendesign.cc/packs/<slug>/DESIGN.md          → Google design.md 兼容格式（YAML + 8 段）",
        "https://opendesign.cc/packs/<slug>/DESIGN_SPEC.en.md  → OpenDesign 11 层规范（en/zh-CN/zh-TW/ja/ko）",
        "https://opendesign.cc/packs/<slug>/spec.json          → 11 层设计 tokens（机器可读）",
        "```",
        "",
        "把任意 DESIGN_SPEC.*.md 粘进你的编码 Agent，或让 Agent 直接读 folder URL —— "
        "它会读到该站完整的 11 层设计系统并按同样的设计语言生成 / 改造页面。",
        "",
        "本站全部内容已静态化（每站 × 5 语言独立 HTML），无需执行 JS 即可抓取。",
        "",
    ]
    # H-5: single section (removed duplicate 全部收录) — keeps llms.txt under 100 KB
    tier2 = [s for s in sites if s["id"] in pidx]
    lines.append(f"## 完整包（{len(tier2)} 个 · Tier 2 · 含真截图 + 真 computed styles）")
    lines.append("")
    lines.append("每个 slug 有 5 个机器可读端点：")
    lines.append("```")
    lines.append("DESIGN_SPEC.en.md   → 11 层完整规范（英文）")
    lines.append("DESIGN_SPEC.zh-CN.md → 中文规范")
    lines.append("spec.json           → 结构化 tokens")
    lines.append("DESIGN.md           → Google design.md 格式")
    lines.append("<slug>-design-pack.zip → 完整包含截图的 ZIP")
    lines.append("```")
    lines.append("")
    lines.append("路径格式：`https://opendesign.cc/packs/<slug>/<filename>`")
    lines.append("")
    for s in tier2:
        slug = s["id"]
        desc = (s.get("desc", {}).get("en") or {}).get("notes") \
            or (s.get("desc", {}).get("zh-CN") or {}).get("notes") or ""
        lines.append(f"- [{s['title']}](https://opendesign.cc/en/sites/{slug}) "
                     f"· <https://opendesign.cc/packs/{slug}/DESIGN_SPEC.en.md>"
                     + (f" — {desc[:80]}" if desc else ""))
    lines.append("")
    return "\n".join(lines)


# Build target #5: sitemap.xml with hreflang
# ============================================================

def build_sitemap(sites: list[dict]) -> str:
    """每个 (slug, lang) 一个 url，附 alternate xhtml links（Google standard）"""
    today = datetime.now().strftime("%Y-%m-%d")
    entries = []
    # 首页 + 关键路径
    for lang in LANGS:
        alternates = "".join(
            f'    <xhtml:link rel="alternate" hreflang="{l}" href="{BASE_URL}/{l}/" />' for l in LANGS
        ) + f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{BASE_URL}/" />'
        entries.append(f'''  <url>
    <loc>{BASE_URL}/{lang}/</loc>
    <lastmod>{today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
{alternates}
  </url>''')

    # 每个站
    for s in sites:
        slug = s["id"]
        for lang in LANGS:
            alternates = "".join(
                f'    <xhtml:link rel="alternate" hreflang="{l}" href="{BASE_URL}/{l}/sites/{slug}" />\n' for l in LANGS
            ) + f'    <xhtml:link rel="alternate" hreflang="x-default" href="{BASE_URL}/en/sites/{slug}" />'
            entries.append(f'''  <url>
    <loc>{BASE_URL}/{lang}/sites/{slug}</loc>
    <lastmod>{today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
{alternates}
  </url>''')

    body = "\n".join(entries)
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>{BASE_URL}/</loc>
    <lastmod>{today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
{body}
</urlset>
'''


# ============================================================
# Main
# ============================================================

def main():
    ap = argparse.ArgumentParser(description="OpenDesign v0.3 build")
    ap.add_argument("--legacy-only", action="store_true")
    ap.add_argument("--seo-only", action="store_true")
    ap.add_argument("--slug", help="only one site (debug)")
    ap.add_argument("--clean", action="store_true", help="rm -rf dist first")
    args = ap.parse_args()

    if args.clean and DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
        print(f"× cleaned {DIST_DIR}")
    DIST_DIR.mkdir(exist_ok=True)

    all_sites = load_all_sites()
    if args.slug:
        all_sites = [s for s in all_sites if s["id"] == args.slug]
    # 只发布 completed 站 —— pending / failed / needs_review 不进 index/SEO/sitemap
    # （它们的 sites/<slug>.json 仍在 git 里，curator 修好后重 build 自动上架）
    sites = [s for s in all_sites if s.get("status") == "completed"]
    skipped = len(all_sites) - len(sites)
    print(f"Loaded {len(all_sites)} sites · publishing {len(sites)} completed · skipping {skipped} (pending/failed/review)")

    # 1) Index + per-site detail
    if not args.seo_only:
        index = build_sites_index(sites)
        (DIST_DIR / "sites-index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  ✓ dist/sites-index.json ({len(sites)} sites)")

        (DIST_DIR / "sites").mkdir(exist_ok=True)
        for s in sites:
            (DIST_DIR / "sites" / f'{s["id"]}.json').write_text(
                json.dumps(s, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        print(f"  ✓ dist/sites/*.json ({len(sites)} files)")

        # 2) Legacy compat (lets current app.js run unchanged)
        legacy_dir = DIST_DIR / "legacy"
        legacy_dir.mkdir(exist_ok=True)
        (legacy_dir / "sites.js").write_text(build_legacy_sites_js(sites), encoding="utf-8")
        (legacy_dir / "sites-specs.json").write_text(
            json.dumps(build_legacy_specs_json(sites), ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        (legacy_dir / "sites-i18n.json").write_text(
            json.dumps(build_legacy_i18n_json(sites), ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        # 按语言拆分（节省 ~70% 传输）：sites-i18n.zh-CN.json、sites-i18n.en.json 等
        per_lang = build_i18n_per_lang(sites)
        for lang, data in per_lang.items():
            (legacy_dir / f"sites-i18n.{lang}.json").write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
        print(f"  ✓ dist/legacy/* (sites.js + sites-specs.json + sites-i18n.json + per-lang splits)")

    # 3) SEO static HTML
    if not args.legacy_only:
        # M-3: Pre-compute related sites map (tag-based) for static internal links + PageRank
        global RELATED_SITES_MAP
        _tag_buckets: dict = {}  # tag → list of (id, title)
        for s in sites:
            for t in s.get("tags", []):
                _tag_buckets.setdefault(t, []).append({"id": s["id"], "title": s["title"]})
        for s in sites:
            _slug = s["id"]
            _related: dict = {}
            for t in s.get("tags", []):
                for r in _tag_buckets.get(t, []):
                    if r["id"] != _slug and r["id"] not in _related:
                        _related[r["id"]] = r
                        if len(_related) >= 6:
                            break
                if len(_related) >= 6:
                    break
            RELATED_SITES_MAP[_slug] = list(_related.values())[:6]

        seo_dir = DIST_DIR / "seo"
        for lang in LANGS:
            ld = seo_dir / lang / "sites"
            ld.mkdir(parents=True, exist_ok=True)
        for s in sites:
            for lang in LANGS:
                html = render_site_html(s, lang)
                (seo_dir / lang / "sites" / f'{s["id"]}.html').write_text(html, encoding="utf-8")
        total_html = len(sites) * len(LANGS)
        print(f"  ✓ dist/seo/<lang>/sites/<slug>.html ({total_html} pages)")

    # 4) 每个 pack 文件夹（遵守 docs/design-pack-standard.md · Pack Standard v1）：
    #    Tier 1（必有）：DESIGN.md + DESIGN_SPEC.<lang>.md + spec.json + manifest.json
    #    Tier 2（有完整包时，来自 packs-index.json）：截图 / summary.json / fonts.json / ZIP
    if not args.legacy_only:
        packs_dir = DIST_DIR / "packs"
        # 读 Tier 2 清单（哪些 slug 有完整 Playwright 包）
        try:
            pidx = json.loads((ROOT / "packs-index.json").read_text(encoding="utf-8"))
        except Exception:
            pidx = {}
        md_count = 0
        design_md_count = 0
        manifest_count = 0
        for s in sites:
            slug = s["id"]
            slug_dir = packs_dir / slug
            slug_dir.mkdir(parents=True, exist_ok=True)
            doc_langs = []
            # Tier 1 · magazine 风格（叙事 + 表格）每语言一份
            for lang in LANGS:
                if not s.get("narrative", {}).get(lang):
                    continue
                (slug_dir / f"DESIGN_SPEC.{lang}.md").write_text(render_design_spec_md(s, lang), encoding="utf-8")
                doc_langs.append(lang)
                md_count += 1
            # Tier 1 · Google Stitch / VoltAgent 兼容（YAML front matter + 8 章）
            has_design_md = False
            if s.get("spec") and any(v for v in s.get("spec", {}).get("colors", {}).values()):
                (slug_dir / "DESIGN.md").write_text(render_google_design_md(s, "en"), encoding="utf-8")
                has_design_md = True
                design_md_count += 1
            # Tier 1 · spec.json（11 层 tokens，机器可读）
            spec_obj = s.get("spec") or {}
            if spec_obj:
                (slug_dir / "spec.json").write_text(
                    json.dumps(spec_obj, ensure_ascii=False, indent=2), encoding="utf-8")
            # 每个 pack 一份自描述 manifest.json（Agent 命中 folder URL 即知全貌）
            (slug_dir / "manifest.json").write_text(
                json.dumps(render_pack_manifest(s, doc_langs, has_design_md, bool(spec_obj), pidx.get(slug)),
                           ensure_ascii=False, indent=2),
                encoding="utf-8")
            manifest_count += 1
        if md_count:
            print(f"  ✓ dist/packs/<slug>/DESIGN_SPEC.<lang>.md ({md_count} files)")
        if design_md_count:
            print(f"  ✓ dist/packs/<slug>/DESIGN.md ({design_md_count} files · Google format)")
        if manifest_count:
            print(f"  ✓ dist/packs/<slug>/manifest.json + spec.json ({manifest_count} packs · Pack Standard v1)")

    # 5) Sitemap
    if not args.legacy_only:
        sitemap = build_sitemap(sites)
        (DIST_DIR / "sitemap.xml").write_text(sitemap, encoding="utf-8")
        print(f"  ✓ dist/sitemap.xml ({len(sites)} sites × {len(LANGS)} langs)")

    # 5b) llms.txt（GEO：暴露 /packs/ 协议给 LLM/Agent）→ 写到根（部署直接 serve）
    if not args.legacy_only:
        llms = build_llms_txt(sites, pidx)
        (ROOT / "llms.txt").write_text(llms, encoding="utf-8")
        print(f"  ✓ llms.txt ({len(sites)} sites · 暴露 /packs/ agent 协议)")

    # 5c) catalog.json（给 agent skill 的干净目录：slug/标题/标签/一句话/资源 URL）
    if not args.legacy_only:
        cat = []
        for s in sites:
            sp = s.get("spec") or {}
            slug = s["id"]
            cat.append({
                "slug": slug, "title": s.get("title"), "url": s.get("url"),
                "tags": s.get("tags", []),
                "summary": (sp.get("identity", {}) or {}).get("essence")
                or (s.get("desc", {}) or {}).get("en", {}).get("notes") or "",
                "has_pack": slug in PACKS,
                "spec_md": f"{BASE_URL}/packs/{slug}/DESIGN_SPEC.en.md",
                "spec_json": f"{BASE_URL}/packs/{slug}/spec.json",
            })
        (ROOT / "catalog.json").write_text(
            json.dumps({"count": len(cat), "designs": cat}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  ✓ catalog.json（agent skill 目录 · {len(cat)} 站）")

    # 5d) skill.md（agent 安装清单：复制 URL 给 agent，它读完就会按品味匹配 + 取真 tokens）
    skill_src = ROOT / "skill" / "SKILL.md"
    if skill_src.exists():
        (ROOT / "skill.md").write_text(skill_src.read_text(encoding="utf-8"), encoding="utf-8")
        print("  ✓ skill.md（= skill/SKILL.md，根路径直供 agent）")

    print(f"\nDone. dist/ → {sum(1 for _ in DIST_DIR.rglob('*') if _.is_file())} files")


if __name__ == "__main__":
    main()
