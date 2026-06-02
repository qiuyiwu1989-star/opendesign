#!/usr/bin/env python3
"""扩展到 200 站 · 第二批 100 个 curated 候选 + 建 stub（dedup vs 现有）。

跑法：
  python3 scripts/expand-200.py --dry-run     # 只看分类/去重，不建文件
  python3 scripts/expand-200.py               # 建 sites/<slug>.json stub（之后 upgrade-batch 处理）
建完 stub 后：export ANTHROPIC_*; bash scripts/upgrade-batch.sh  （可断点续跑）
"""
import json
import sys
import glob
import urllib.parse
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent.parent
SITES = ROOT / "sites"

# (slug, url, title, tags, category)
C = [
    # ── 设计工作室 / studio ──────────────────────────────
    ("active-theory", "https://activetheory.net", "Active Theory", ["agency", "webgl", "creative"], "studio"),
    ("resn", "https://resn.co.nz", "Resn", ["agency", "interactive", "creative"], "studio"),
    ("locomotive", "https://locomotive.ca", "Locomotive", ["agency", "motion"], "studio"),
    ("basement-studio", "https://basement.studio", "Basement Studio", ["agency", "dev", "creative"], "studio"),
    ("unseen-studio", "https://unseen.co", "Unseen Studio", ["agency", "editorial"], "studio"),
    ("fourteen-islands", "https://14islands.com", "14islands", ["agency", "webgl"], "studio"),
    ("instrument", "https://instrument.com", "Instrument", ["agency", "brand"], "studio"),
    ("pentagram", "https://pentagram.com", "Pentagram", ["studio", "branding", "editorial"], "studio"),
    ("collins", "https://wearecollins.com", "Collins", ["branding", "studio"], "studio"),
    ("work-and-co", "https://work.co", "Work & Co", ["agency", "product"], "studio"),
    ("area17", "https://area17.com", "AREA 17", ["agency", "editorial"], "studio"),
    ("immersive-garden", "https://immersive-g.com", "Immersive Garden", ["agency", "webgl"], "studio"),
    ("akaru", "https://akaru.fr", "Akaru", ["agency", "webgl"], "studio"),
    ("dogstudio", "https://dogstudio.co", "Dogstudio", ["agency", "creative"], "studio"),
    ("hello-monday", "https://hellomonday.com", "Hello Monday", ["agency", "creative"], "studio"),
    ("aristide", "https://aristidebenoist.com", "Aristide Benoist", ["portfolio", "webgl"], "studio"),
    # ── 字体厂 / type foundry ────────────────────────────
    ("klim", "https://klim.co.nz", "Klim Type Foundry", ["type", "foundry", "editorial"], "type"),
    ("pangram", "https://pangrampangram.com", "Pangram Pangram", ["type", "foundry"], "type"),
    ("grilli-type", "https://grillitype.com", "Grilli Type", ["type", "foundry"], "type"),
    ("dinamo", "https://abcdinamo.com", "ABC Dinamo", ["type", "foundry"], "type"),
    ("colophon", "https://colophon-foundry.org", "Colophon", ["type", "foundry"], "type"),
    ("ohno", "https://ohnotype.co", "OH no Type Co", ["type", "foundry"], "type"),
    ("commercial-type", "https://commercialtype.com", "Commercial Type", ["type", "foundry"], "type"),
    ("sharp-type", "https://sharptype.co", "Sharp Type", ["type", "foundry"], "type"),
    # ── 独立产品 / indie product ─────────────────────────
    ("superlist", "https://superlist.com", "Superlist", ["product", "saas", "playful"], "product"),
    ("screen-studio", "https://screen.studio", "Screen Studio", ["product", "mac"], "product"),
    ("cap", "https://cap.so", "Cap", ["product", "mac", "oss"], "product"),
    ("fey", "https://www.fey.com", "Fey", ["product", "finance", "dark"], "product"),
    ("bear", "https://bear.app", "Bear", ["product", "notes"], "product"),
    ("craft", "https://www.craft.do", "Craft", ["product", "docs"], "product"),
    ("tana", "https://tana.inc", "Tana", ["product", "notes"], "product"),
    ("akiflow", "https://akiflow.com", "Akiflow", ["product", "calendar"], "product"),
    ("sunsama", "https://sunsama.com", "Sunsama", ["product", "calendar"], "product"),
    ("mymind", "https://mymind.com", "Mymind", ["product", "bookmarks"], "product"),
    ("readwise", "https://readwise.io", "Readwise Reader", ["product", "reading"], "product"),
    ("texts", "https://texts.com", "Texts", ["product", "messaging", "dark"], "product"),
    # ── 开发工具 / infra ────────────────────────────────
    ("neon", "https://neon.tech", "Neon", ["devtools", "database", "dark"], "dev"),
    ("clerk", "https://clerk.com", "Clerk", ["devtools", "auth"], "dev"),
    ("planetscale", "https://planetscale.com", "PlanetScale", ["devtools", "database"], "dev"),
    ("turso", "https://turso.tech", "Turso", ["devtools", "database"], "dev"),
    ("render", "https://render.com", "Render", ["devtools", "infra"], "dev"),
    ("fly", "https://fly.io", "Fly.io", ["devtools", "infra"], "dev"),
    ("modal", "https://modal.com", "Modal", ["devtools", "infra", "dark"], "dev"),
    ("val-town", "https://www.val.town", "Val Town", ["devtools", "playful"], "dev"),
    ("deno", "https://deno.com", "Deno", ["devtools", "runtime"], "dev"),
    ("bun", "https://bun.sh", "Bun", ["devtools", "runtime"], "dev"),
    ("astro", "https://astro.build", "Astro", ["devtools", "framework"], "dev"),
    ("svelte", "https://svelte.dev", "Svelte", ["devtools", "framework"], "dev"),
    ("remix", "https://remix.run", "Remix", ["devtools", "framework"], "dev"),
    ("tailwind", "https://tailwindcss.com", "Tailwind CSS", ["devtools", "css"], "dev"),
    ("prisma", "https://www.prisma.io", "Prisma", ["devtools", "orm"], "dev"),
    ("drizzle", "https://orm.drizzle.team", "Drizzle ORM", ["devtools", "orm"], "dev"),
    ("convex", "https://convex.dev", "Convex", ["devtools", "backend"], "dev"),
    ("inngest", "https://www.inngest.com", "Inngest", ["devtools", "dark"], "dev"),
    ("liveblocks", "https://liveblocks.io", "Liveblocks", ["devtools", "collab"], "dev"),
    ("trigger", "https://trigger.dev", "Trigger.dev", ["devtools", "dark"], "dev"),
    ("zed", "https://zed.dev", "Zed", ["devtools", "editor"], "dev"),
    ("replit", "https://replit.com", "Replit", ["devtools", "ide"], "dev"),
    ("hex", "https://hex.tech", "Hex", ["devtools", "data"], "dev"),
    # ── AI 产品 ─────────────────────────────────────────
    ("anthropic", "https://www.anthropic.com", "Anthropic", ["ai", "minimal"], "ai"),
    ("huggingface", "https://huggingface.co", "Hugging Face", ["ai", "community", "playful"], "ai"),
    ("groq", "https://groq.com", "Groq", ["ai", "hardware"], "ai"),
    ("fal", "https://fal.ai", "fal", ["ai", "dev"], "ai"),
    ("suno", "https://suno.com", "Suno", ["ai", "music"], "ai"),
    ("krea", "https://www.krea.ai", "Krea", ["ai", "design", "dark"], "ai"),
    ("pika", "https://pika.art", "Pika", ["ai", "video"], "ai"),
    ("descript", "https://www.descript.com", "Descript", ["ai", "video"], "ai"),
    ("captions", "https://www.captions.ai", "Captions", ["ai", "video"], "ai"),
    ("lumalabs", "https://lumalabs.ai", "Luma AI", ["ai", "3d"], "ai"),
    ("sierra", "https://sierra.ai", "Sierra", ["ai", "enterprise"], "ai"),
    ("glean", "https://www.glean.com", "Glean", ["ai", "search"], "ai"),
    ("character", "https://character.ai", "Character.AI", ["ai", "chat"], "ai"),
    # ── DTC 品牌 / 电商 ─────────────────────────────────
    ("on-running", "https://www.on.com", "On", ["ecommerce", "athletic"], "brand"),
    ("allbirds", "https://www.allbirds.com", "Allbirds", ["ecommerce", "sustainable"], "brand"),
    ("away", "https://www.awaytravel.com", "Away", ["ecommerce", "travel"], "brand"),
    ("warby-parker", "https://www.warbyparker.com", "Warby Parker", ["ecommerce", "eyewear"], "brand"),
    ("everlane", "https://www.everlane.com", "Everlane", ["ecommerce", "minimal"], "brand"),
    ("gymshark", "https://www.gymshark.com", "Gymshark", ["ecommerce", "fitness"], "brand"),
    ("oatly", "https://www.oatly.com", "Oatly", ["brand", "food", "quirky"], "brand"),
    ("graza", "https://www.graza.co", "Graza", ["brand", "food"], "brand"),
    ("omsom", "https://omsom.com", "Omsom", ["brand", "food"], "brand"),
    ("olipop", "https://drinkolipop.com", "Olipop", ["brand", "drink"], "brand"),
    ("magic-spoon", "https://magicspoon.com", "Magic Spoon", ["brand", "food", "retro"], "brand"),
    ("ssense", "https://www.ssense.com", "SSENSE", ["ecommerce", "fashion", "editorial"], "brand"),
    ("gentle-monster", "https://www.gentlemonster.com", "Gentle Monster", ["fashion", "eyewear"], "brand"),
    ("jacquemus", "https://www.jacquemus.com", "Jacquemus", ["fashion", "editorial"], "brand"),
    # ── 时尚 / 文化编辑 ─────────────────────────────────
    ("acne-studios", "https://www.acnestudios.com", "Acne Studios", ["fashion", "editorial"], "culture"),
    ("aime-leon-dore", "https://www.aimeleondore.com", "Aimé Leon Dore", ["fashion", "editorial"], "culture"),
    ("kith", "https://kith.com", "Kith", ["fashion", "streetwear"], "culture"),
    ("moma", "https://www.moma.org", "MoMA", ["museum", "culture"], "culture"),
    ("pudding", "https://pudding.cool", "The Pudding", ["editorial", "dataviz"], "culture"),
    ("its-nice-that", "https://www.itsnicethat.com", "It's Nice That", ["editorial", "design"], "culture"),
    ("dezeen", "https://www.dezeen.com", "Dezeen", ["editorial", "architecture"], "culture"),
    ("are-na", "https://www.are.na", "Are.na", ["tool", "community", "minimal"], "culture"),
    ("readymag", "https://readymag.com", "Readymag", ["tool", "design"], "culture"),
    ("dribbble", "https://dribbble.com", "Dribbble", ["community", "design"], "culture"),
    # ── Web3 / crypto ───────────────────────────────────
    ("phantom", "https://phantom.app", "Phantom", ["crypto", "wallet", "playful"], "web3"),
    ("rainbow", "https://rainbow.me", "Rainbow", ["crypto", "wallet", "colorful"], "web3"),
    ("uniswap", "https://uniswap.org", "Uniswap", ["crypto", "defi"], "web3"),
    ("zora", "https://zora.co", "Zora", ["crypto", "nft"], "web3"),
    ("foundation", "https://foundation.app", "Foundation", ["crypto", "nft", "minimal"], "web3"),
    ("polymarket", "https://polymarket.com", "Polymarket", ["crypto", "prediction", "dark"], "web3"),
    ("warpcast", "https://warpcast.com", "Warpcast", ["crypto", "social"], "web3"),
    ("optimism", "https://www.optimism.io", "Optimism", ["crypto", "l2"], "web3"),
    ("base", "https://www.base.org", "Base", ["crypto", "l2"], "web3"),
    ("ethereum", "https://ethereum.org", "Ethereum", ["crypto", "foundation"], "web3"),
    ("solana", "https://solana.com", "Solana", ["crypto", "dark"], "web3"),
]


def host_of(u):
    return urllib.parse.urlparse(u).netloc.lower().replace("www.", "")


def main():
    dry = "--dry-run" in sys.argv
    existing_hosts, existing_slugs = set(), set()
    for p in glob.glob(str(SITES / "*.json")):
        existing_slugs.add(Path(p).stem)
        try:
            existing_hosts.add(host_of(json.loads(Path(p).read_text(encoding="utf-8")).get("url", "")))
        except Exception:
            pass

    from collections import Counter
    cats = Counter()
    new, dup = [], []
    for slug, url, title, tags, cat in C:
        if slug in existing_slugs or host_of(url) in existing_hosts:
            dup.append(slug)
            continue
        new.append((slug, url, title, tags, cat))
        cats[cat] += 1

    print(f"候选 {len(C)} · 去重后新增 {len(new)} · 跳过(已存在) {len(dup)}")
    print("分类分布:", dict(cats))
    if dup:
        print("跳过的(已收录):", dup)
    print(f"\n现有站点 {len(existing_slugs)} → 加完将达 {len(existing_slugs) + len(new)}")

    if dry:
        print("\n(--dry-run：未建文件)")
        return
    made = 0
    for slug, url, title, tags, cat in new:
        p = SITES / f"{slug}.json"
        if p.exists():
            continue
        p.write_text(json.dumps({
            "id": slug, "schema_version": "0.3", "url": url, "title": title,
            "image": "", "tags": tags, "status": "pending",
            "added_at": datetime.now().strftime("%Y-%m-%d"), "added_by": "expand-200", "_meta": {},
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        made += 1
    print(f"\n✓ 建了 {made} 个 stub。下一步：bash scripts/upgrade-batch.sh（可断点续跑）")


if __name__ == "__main__":
    main()
