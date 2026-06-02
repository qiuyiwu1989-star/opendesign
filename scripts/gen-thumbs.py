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
import os
import sys
import zipfile

try:
    from PIL import Image, ImageOps
except Exception:
    print("✗ 需要 Pillow（pip3 install pillow）"); sys.exit(0)  # exit 0：不拖垮 deploy

import argparse
ap = argparse.ArgumentParser()
ap.add_argument("--packs", default="/var/www/opendesign.cc/packs", help="完整包 ZIP 所在目录（含 <slug>/<slug>-design-pack.zip）")
ap.add_argument("--out", default="/var/www/opendesign.cc/thumbs", help="缩略图输出目录")
ap.add_argument("--force", action="store_true")
a = ap.parse_args()
PACKS_DIR, THUMBS, FORCE = a.packs, a.out, a.force
os.makedirs(THUMBS, exist_ok=True)
W, H, Q = 768, 480, 80   # 768×480 (16:10) · q80 · 顶部锚定裁切

ok = skip = fail = 0
for zp in sorted(glob.glob(os.path.join(PACKS_DIR, "*", "*-design-pack.zip"))):
    slug = os.path.basename(os.path.dirname(zp))
    out = os.path.join(THUMBS, f"{slug}.webp")
    if os.path.exists(out) and not FORCE:
        skip += 1
        continue
    try:
        with zipfile.ZipFile(zp) as z:
            name = next((n for n in z.namelist() if n.endswith("02_desktop_hero.png")), None)
            if not name:
                fail += 1
                print(f"  ✗ {slug}: zip 里没 02_desktop_hero.png")
                continue
            img = Image.open(io.BytesIO(z.read(name))).convert("RGB")
        img = ImageOps.fit(img, (W, H), method=Image.LANCZOS, centering=(0.5, 0.0))
        img.save(out, "WEBP", quality=Q, method=6)
        ok += 1
        print(f"  ✓ {slug}  {os.path.getsize(out) // 1024}KB")
    except Exception as e:
        fail += 1
        print(f"  ✗ {slug}: {type(e).__name__}: {e}")

print(f"thumbs: 生成 {ok} · 跳过 {skip} · 失败 {fail} · 目录共 {len(glob.glob(os.path.join(THUMBS, '*.webp')))} 张")
