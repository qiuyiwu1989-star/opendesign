#!/usr/bin/env python3
"""缩略图质检 + AI 选帧 —— 修"主体不对"。

对每个站，把它那一组真实截图（首屏/全页/几张分段/移动）发给 mimo 视觉，让它选出
最能代表设计、避开 cookie墙/空白/纯导航/主体残缺的那一张当卡片封面，并打 1–5 分。
决策写进 thumbs/_qc.json（{slug:{frame,score,issue}}）；deploy 时服务器端 gen-thumbs
读它、用选中的那一帧重生成 /thumbs/<slug>.webp。低分的进后台质检面板供人工复核。

数据源：本地 extract/extracts/<slug>/（本机跑过批量的站都有整组帧）。
用法：
  export ANTHROPIC_API_KEY=... ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic ANTHROPIC_MODEL=mimo-v2.5
  python3 scripts/qc-thumbs.py                 # 全部有帧的站
  python3 scripts/qc-thumbs.py --only aesop,cuberto
  python3 scripts/qc-thumbs.py --limit 20
"""
from __future__ import annotations   # 兼容 Python 3.9 的 `X | None` 注解

import argparse
import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = None   # 我们自己的全页大图，关掉 decompression-bomb 警告

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from ingest import call_mimo, parse_json_from_response  # 复用已验证的 mimo 视觉调用

EXDIR = ROOT / "extract" / "extracts"
THUMBS = ROOT / "thumbs"
THUMBS.mkdir(exist_ok=True)
QC_JSON = THUMBS / "_qc.json"

# 只把这几帧发给 mimo（控成本）：当前默认 + 全页 + 前几段 + 移动
CAND_ORDER = ["02_desktop_hero.png", "01_desktop_full.png",
              "03_desktop_section_00.png", "03_desktop_section_01.png",
              "03_desktop_section_02.png", "05_mobile_hero.png"]

SYS = ("你在为一个高端网页设计画廊挑选卡片封面缩略图。我会给同一个网站的几张真实截图，"
       "每张前有「候选 N」标注。挑出最能代表这个网站设计水准、最适合做封面的一张。"
       "必须避开：① cookie/隐私同意弹窗 ② 空白或加载中 ③ 只有导航栏没有主体内容 ④ 主体被遮挡或残缺。"
       "优先：主视觉强、能一眼看出设计风格、信息密度合适。"
       '只返回 JSON：{"best": <候选序号整数>, "score": <1-5 所选这张作为封面的质量>, '
       '"issue": "<所选若仍有瑕疵写一短语，否则写 ok>"}')


def candidates(slug: str) -> list[Path]:
    d = EXDIR / slug
    return [d / n for n in CAND_ORDER if (d / n).exists()] if d.exists() else []


def small_jpeg_b64(path: Path, w: int = 448) -> str:
    im = Image.open(path).convert("RGB")
    if im.width > w:
        im = im.resize((w, int(im.height * w / im.width)))
    if im.height > 1200:                       # 全页图太长 → 只发上半，省 token
        im = im.crop((0, 0, im.width, 1200))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def regen_thumb(slug: str, frame: str) -> bool:
    src = EXDIR / slug / frame
    if not src.exists():
        return False
    im = Image.open(src).convert("RGB")
    im = ImageOps.fit(im, (768, 480), method=Image.LANCZOS, centering=(0.5, 0.0))
    im.save(THUMBS / f"{slug}.webp", "WEBP", quality=80, method=6)
    return True


def looks_blank(path: Path) -> bool:
    """近乎纯色/黑屏/空白？（缩到 64×40 灰度看方差）—— headless 没渲染出来的 WebGL/懒加载帧。
    真实设计方差远大于此；纯色/黑屏方差趋近 0。"""
    g = Image.open(path).convert("L").resize((64, 40))
    px = list(g.getdata())
    mean = sum(px) / len(px)
    var = sum((p - mean) ** 2 for p in px) / len(px)
    return var < 110


def qc_one(slug: str) -> dict | None:
    cands = candidates(slug)
    if not cands:
        return None
    # 启发式兜底：先剔除近乎纯色/黑屏的帧（AI 偶尔会把纯黑当"极简"给高分）
    good = [p for p in cands if not looks_blank(p)]
    if not good:
        return {"frame": "02_desktop_hero.png", "score": 1,
                "issue": "所有帧近乎空白/黑屏(headless 未渲染，需重抓或剔除)"}
    cands = good
    content = []
    for i, p in enumerate(cands, 1):
        content.append({"type": "text", "text": f"候选 {i}（{p.name}）："})
        content.append({"type": "image", "source": {
            "type": "base64", "media_type": "image/jpeg", "data": small_jpeg_b64(p)}})
    content.append({"type": "text", "text": f"共 {len(cands)} 张。按系统指令选最佳封面，只返回 JSON。"})
    try:
        res = call_mimo(messages=[{"role": "user", "content": content}], system=SYS, max_tokens=300)
        j = parse_json_from_response(res["content_text"])
        best = max(1, min(int(j.get("best", 1)), len(cands)))
        return {"frame": cands[best - 1].name, "score": int(j.get("score", 0)),
                "issue": str(j.get("issue", ""))[:60]}
    except Exception as e:
        return {"frame": "02_desktop_hero.png", "score": 0, "issue": f"qc-fail:{type(e).__name__}"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    qc = json.loads(QC_JSON.read_text(encoding="utf-8")) if QC_JSON.exists() else {}
    if args.only:
        slugs = args.only.split(",")
    else:
        slugs = sorted(d.name for d in EXDIR.iterdir() if d.is_dir()) if EXDIR.exists() else []
        slugs = [s for s in slugs if s not in qc]   # 断点续：跳过已质检的
    if args.limit:
        slugs = slugs[:args.limit]

    done = low = 0
    for s in slugs:
        r = qc_one(s)
        if not r:
            continue
        qc[s] = r
        regen_thumb(s, r["frame"])
        flag = "⚠ 低分" if (r["score"] and r["score"] < 3) else "✓"
        if r["score"] and r["score"] < 3:
            low += 1
        print(f"  {flag} {s}: 选 {r['frame']:26} 分 {r['score']} · {r['issue']}")
        done += 1
        QC_JSON.write_text(json.dumps(qc, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nQC 完成 {done} 站（{low} 个低分待复核）· 报告 {QC_JSON}")


if __name__ == "__main__":
    main()
