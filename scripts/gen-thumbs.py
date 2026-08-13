#!/usr/bin/env python3
"""卡片缩略图生成器（服务器端，从完整包 ZIP 直接抽）。

为什么：卡片图以前用 thum.io（在线截图服务），对带 cookie 墙 / 反爬 / JS 重的站经常
截到垃圾页（同意弹窗、Cloudflare 挑战页），还 HTTP 200 → 前端 onerror 都不触发，只能
干瞪着错图。改用我们 Playwright 抓的真·桌面首屏截图，缩成 ~15KB webp，自托管在
/thumbs/<slug>.webp。真图、快、可控、无第三方代理。

跑在 web 服务器上：ZIP 都在本地 <webroot>/packs/<slug>/<slug>-design-pack.zip，从里头
抽 02_desktop_hero.png，省去下载。deploy.sh 末尾用 sudo 调用。幂等（已存在跳过）、逐包容错
（单包坏不影响其它）。绝不抛到外面拖垮部署。

用法：
  python3 scripts/gen-thumbs.py [webroot]        # 默认 /var/www/opendesign.cc
  python3 scripts/gen-thumbs.py --force          # 重做全部
"""
import glob
import io
import json
import os
import sys
import urllib.request
import zipfile

try:
    from PIL import Image, ImageOps
except Exception:
    print("✗ 需要 Pillow（pip3 install pillow）"); sys.exit(0)  # exit 0：不拖垮 deploy

import argparse
ap = argparse.ArgumentParser()
ap.add_argument("--packs", default="/var/www/opendesign.cc/packs", help="完整包 ZIP 所在目录（含 <slug>/<slug>-design-pack.zip）")
ap.add_argument("--out", default="/var/www/opendesign.cc/thumbs", help="缩略图输出目录")
ap.add_argument("--qc", default=os.path.join(os.path.dirname(__file__), "..", "thumbs", "_qc.json"),
                help="qc-thumbs.py 的选帧决策 _qc.json；存在则按 {slug:{frame}} 用选中的帧")
ap.add_argument("--force", action="store_true")
ap.add_argument("--from-cos", metavar="PACKS_INDEX", nargs="?", const="auto",
                help="本地没有源图的 slug，改从 COS 拉首屏图生成（走 packs-index.json 里的 URL，"
                     "并用 imageMogr2 让 COS 先缩到 768 宽，省带宽）。默认找 <repo>/packs-index.json")
ap.add_argument("--cos-limit", type=int, default=0, help="--from-cos 时最多处理多少个（0=不限，调试用）")
a = ap.parse_args()
PACKS_DIR, THUMBS, FORCE = a.packs, a.out, a.force
os.makedirs(THUMBS, exist_ok=True)
W, H, Q = 768, 480, 80   # 768×480 (16:10) · q80 · 顶部锚定裁切

# QC 选帧决策（AI 选的最佳帧）；没有就默认用桌面首屏
QC = {}
try:
    if os.path.exists(a.qc):
        QC = json.load(open(a.qc, encoding="utf-8"))
except Exception:
    QC = {}

# 收集所有 pack slug：有 ZIP 的 + 只有松散文件的（不少站只解压了散图、没留 ZIP →
# 旧版只遍历 ZIP 会漏掉它们，导致 /thumbs/<slug>.webp 404 → 卡片回退到 thum.io 黑图）
slugs = set()
for zp in glob.glob(os.path.join(PACKS_DIR, "*", "*-design-pack.zip")):
    slugs.add(os.path.basename(os.path.dirname(zp)))
for d in glob.glob(os.path.join(PACKS_DIR, "*")):
    if os.path.isdir(d):
        slugs.add(os.path.basename(d))

# 源图不在本机时干脆不跑。
#
# 背景：pack 素材早就迁到 COS 了，只有服务器上还留着本地副本。从 Mac 跑
# deploy.sh 时 PACKS_DIR 是空的（或只有目录壳），于是每个 slug 都走到
# "无 ZIP 帧也无松散 PNG"，一次刷 1490 行 ✗，末尾还写 "目录共 0 张"——
# 看着像缩略图全没了，实际上服务器上好好的 943 张一张没动。
#
# 这种"每次都报一大片假失败"和长期红着的 CI 是同一种病：真出问题时
# 没人会再多看一眼。没有源图就说清楚"这台机器上没有源图"，然后退出。
if not a.from_cos and not any(
        os.path.isdir(os.path.join(PACKS_DIR, s)) and os.listdir(os.path.join(PACKS_DIR, s))
        for s in list(slugs)[:50]):
    have = len(glob.glob(os.path.join(THUMBS, "*.webp")))
    print(f"thumbs: 本机 {PACKS_DIR} 没有 pack 源图（素材在 COS / 服务器上），跳过生成。"
          f"本地已有 {have} 张。需要重生成请到服务器上跑。")
    raise SystemExit(0)

# ── --from-cos：本地没源图的走 COS ──────────────────────────────────
# 素材包早就迁到 COS 了，服务器上只留了 943 个 slug 的本地副本，另外 545 个
# 只有 COS 上有。这批站因此没有 /thumbs/<slug>.webp，前端每次都要先吃一个
# 404、再去 COS 拉原图兜底——能看，但每张卡都白跑一趟。
# 这里直接从 COS 把首屏图取回来生成本地缩略图，把那 545 个 404 消掉。
COS_URLS = {}
if a.from_cos:
    idx_path = a.from_cos
    if idx_path == "auto":
        idx_path = os.path.join(os.path.dirname(__file__), "..", "packs-index.json")
    try:
        pidx = json.load(open(idx_path, encoding="utf-8"))
    except Exception as e:
        print(f"✗ 读不到 packs-index.json（{idx_path}）: {e}"); raise SystemExit(0)
    PREF = ("02_desktop_hero", "01_desktop_full", "03_desktop_section", "05_mobile_hero")
    for slug, e in pidx.items():
        shots = [f for f in (e.get("files") or []) if f.get("category") == "shot" and f.get("url")]
        pick = next((f for p in PREF for f in shots if f.get("name", "").startswith(p)), None)
        if pick:
            # 让 COS 先缩到 768 宽再传：原图常有 258KB+，缩完 ~20KB，
            # 545 张的差别是 140MB vs 11MB
            COS_URLS[slug] = pick["url"] + "?imageMogr2/thumbnail/768x/format/webp/quality/80"
    slugs |= set(COS_URLS)
    print(f"  ⓘ --from-cos：packs-index 提供了 {len(COS_URLS)} 个可回源的 slug")

def load_frame(slug, want):
    """优先从 ZIP 抽选中帧；ZIP 没有就用目录里的松散 PNG。返回 RGB Image 或 None。"""
    pack_dir = os.path.join(PACKS_DIR, slug)
    zp = os.path.join(pack_dir, f"{slug}-design-pack.zip")
    cands = [want, "02_desktop_hero.png", "01_desktop_full.png"]
    # 1) ZIP
    if os.path.exists(zp):
        try:
            with zipfile.ZipFile(zp) as z:
                names = z.namelist()
                for c in cands:
                    name = next((n for n in names if n.endswith(c)), None)
                    if name:
                        return Image.open(io.BytesIO(z.read(name))).convert("RGB")
        except Exception:
            pass
    # 2) 松散 PNG
    for c in cands:
        lp = os.path.join(pack_dir, c)
        if os.path.exists(lp):
            return Image.open(lp).convert("RGB")
    # 3) COS 回源（仅 --from-cos）。放在最后：本地有就绝不走网络
    url = COS_URLS.get(slug)
    if url:
        req = urllib.request.Request(url, headers={"User-Agent": "opendesign-thumbs/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return Image.open(io.BytesIO(r.read())).convert("RGB")
    return None

ok = skip = fail = 0
nosrc = []      # 无素材包的 slug:正常状态,汇总一行,不逐条刷屏
todo = sorted(slugs)
if a.from_cos and a.cos_limit:
    todo = [s for s in todo if not os.path.exists(os.path.join(THUMBS, f"{s}.webp"))][:a.cos_limit]
for slug in todo:
    out = os.path.join(THUMBS, f"{slug}.webp")
    if os.path.exists(out) and not FORCE:
        skip += 1
        continue
    try:
        want = (QC.get(slug) or {}).get("frame", "02_desktop_hero.png")  # AI 选中的帧，没有就首屏
        img = load_frame(slug, want)
        if img is None:
            # "这个站压根没有素材包"是常态,不是故障:1,486 个站里约 560 个
            # 没跑过 Playwright 抓取,自然没有可抽的帧。以前每个都打一行 ✗,
            # 一次部署刷近千行——真正的失败(解码错、网络挂)就淹没在里面了。
            # 所以这类归到 nosrc 只计数,末尾汇总一行;✗ 只留给真异常。
            nosrc.append(slug)
            continue
        img = ImageOps.fit(img, (W, H), method=Image.LANCZOS, centering=(0.5, 0.0))
        img.save(out, "WEBP", quality=Q, method=6)
        ok += 1
        print(f"  ✓ {slug}  {os.path.getsize(out) // 1024}KB")
    except Exception as e:
        fail += 1
        print(f"  ✗ {slug}: {type(e).__name__}: {e}")

total = len(glob.glob(os.path.join(THUMBS, "*.webp")))
line = f"thumbs: 生成 {ok} · 跳过 {skip} · 目录共 {total} 张"
if nosrc:
    line += f" · {len(nosrc)} 个站无素材包(正常,这些站没跑过 Playwright 抓取)"
if fail:
    line += f" · ✗ {fail} 个真失败"
print(line)
