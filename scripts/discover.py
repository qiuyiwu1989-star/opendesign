#!/usr/bin/env python3
"""
全网发现器 · 定期爬「有设计感的网站」→ 写入后台发现队列（discoveries 表）供审阅。

可插拔多源（每个源返回 [{url,title,source,score}]）：
  - hn        : Hacker News Algolia API（Show HN，设计向过滤，干净直链，免封）
  - landbook  : land-book.com 画廊（Playwright 穿 Cloudflare，尽力取组织站外链）
  你可以再加：awwwards / godly / siteinspire …（实现一个 source_xxx() 即可）

去重：① 跳过已收录的 86 站 host（读 sites/*.json）② 跳过库里已发现的 host（DB unique）。
缩略图：统一用 thum.io 即时生成（审阅时一眼可看），不依赖源站图。
写入：runner_add_discovery(runner_token)（跟 0005 job runner 同一把 scoped token）。

用法：
  export SB_URL=https://<proj>.supabase.co  SB_ANON_KEY=sb_publishable_xxx  RUNNER_TOKEN=xxx
  python3 scripts/discover.py                 # 全源跑，写入 DB
  python3 scripts/discover.py --dry-run       # 只打印候选，不写库（无需 token）
  python3 scripts/discover.py --source hn      # 只跑某个源
  python3 scripts/discover.py --limit 40       # 每源最多取几条
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent.resolve()
SITES_DIR = ROOT / "sites"
sys.path.insert(0, str(ROOT / "scripts"))
from ingest import slug_from_url  # 复用 slug 算法（含「已注册 host → 复用 slug」）

SB_URL = os.environ.get("SB_URL", "").rstrip("/")
SB_KEY = os.environ.get("SB_ANON_KEY", "")
TOKEN = os.environ.get("RUNNER_TOKEN", "")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

# 这些 host 不是「作品站」，发现时直接丢
JUNK_HOSTS = {
    "github.com", "gitlab.com", "bitbucket.org", "news.ycombinator.com",
    "youtube.com", "youtu.be", "reddit.com", "twitter.com", "x.com",
    "medium.com", "dev.to", "substack.com", "npmjs.com", "pypi.org",
    "arxiv.org", "wikipedia.org", "google.com", "apps.apple.com",
    "play.google.com", "amazon.com", "producthunt.com", "land-book.com",
    "framer.com", "framer.link", "webflow.com", "notion.so", "notion.site",
    "gumroad.com", "linkedin.com", "facebook.com", "discord.com", "discord.gg",
    "t.me", "telegram.org", "patreon.com", "kickstarter.com",
    "cloudflare.com",  # land-book 的 "Just a moment" 挑战页伪 host
}
# 偏开发/工具类的标题信号（无设计信号时丢）
DEV_RE = re.compile(r"\b(cli|sdk|api|library|lib|framework|database|db|kubernetes|k8s|"
                    r"compiler|terminal|self.?hosted|open.?source|plugin|cron|proxy|"
                    r"benchmark|dataset|llm|gpu|wasm|rust|golang|postgres|sqlite|docker)\b", re.I)
# 设计/作品信号（命中则保留，盖过 DEV_RE）
DESIGN_RE = re.compile(r"\b(design|portfolio|landing|studio|award|beautiful|minimal|"
                       r"typography|brand|agency|aesthetic|gallery|showcase|fonts?|"
                       r"animation|3d|webgl|creative|art|magazine|editorial)\b", re.I)


def http_json(url: str, timeout: int = 20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def host_of(url: str) -> str:
    return urllib.parse.urlparse(url).netloc.lower().replace("www.", "")


def existing_hosts() -> set:
    """已收录 86 站的 host 白名单（去重用）。"""
    hosts = set()
    for p in SITES_DIR.glob("*.json"):
        try:
            u = json.loads(p.read_text(encoding="utf-8")).get("url", "")
            h = host_of(u)
            if h:
                hosts.add(h)
        except Exception:
            continue
    return hosts


def thumb(url: str) -> str:
    return f"https://image.thum.io/get/width/600/noanimate/{url}"


# ───────────────────────── 源 1：Hacker News（Show HN）─────────────────────────
def source_hn(limit: int) -> list:
    """两路 HN（Algolia 公开 API，干净直链，不封）：
       ① Show HN 高分帖（新发布的产品/作品）② 全站含设计关键词的高分故事。
       开发向标题且无设计信号 → 丢；最终人工在审阅队列里把关。"""
    queries = [
        "https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&numericFilters=points%3E40&hitsPerPage=80",
        "https://hn.algolia.com/api/v1/search?tags=story&query=design%20portfolio%20studio&numericFilters=points%3E80&hitsPerPage=60",
    ]
    seen, out = set(), []
    for q in queries:
        try:
            hits = http_json(q).get("hits", [])
        except Exception as e:
            print(f"  ! hn 拉取失败: {e}", file=sys.stderr); continue
        for h in hits:
            url = (h.get("url") or "").strip()
            title = (h.get("title") or "").replace("Show HN:", "").strip()
            pts = int(h.get("points") or 0)
            if not url.startswith("http"):
                continue
            host = host_of(url)
            if not host or host in seen or host in JUNK_HOSTS:
                continue
            if host.endswith(".github.io") and pts < 80:
                continue
            if DEV_RE.search(title) and not DESIGN_RE.search(title):
                continue
            seen.add(host)
            out.append({"url": url, "title": title[:80] or host, "source": "hn", "score": pts})
    out.sort(key=lambda c: c["score"], reverse=True)
    return out[:limit]


# ───────────────────────── 源 2：land-book（Playwright）─────────────────────────
def source_landbook(limit: int) -> list:
    """land-book 画廊。Cloudflare + JS + 联盟跳转 → 用 Playwright，尽力取组织（非赞助）外链。"""
    out = []
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        print("  ! landbook 跳过：未装 playwright", file=sys.stderr)
        return out
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(headless=True)
            pg = b.new_page(user_agent=UA)
            pg.goto("https://land-book.com/", wait_until="domcontentloaded", timeout=40000)
            pg.wait_for_timeout(3500)
            detail_links = pg.evaluate("""() => {
              const s = new Set();
              document.querySelectorAll('a[href*="/websites/"]').forEach(a => s.add(a.href));
              return [...s];
            }""")
            for durl in detail_links[: limit * 3]:
                if len(out) >= limit:
                    break
                try:
                    pg.goto(durl, wait_until="domcontentloaded", timeout=25000)
                    pg.wait_for_timeout(1200)
                    real = pg.evaluate("""() => {
                      let best = '';
                      document.querySelectorAll('a[href^="http"]').forEach(a => {
                        const h = a.href;
                        const t = (a.textContent||'').toLowerCase();
                        const aff = /land-book\\.com|framer\\.(com|link)|twitter|x\\.com|facebook|linkedin|instagram|pinterest|youtube|google|cdn\\.|webflow\\.com\\/\\?/.test(h);
                        if (!aff && (/visit|website|live|view/.test(t) || a.target==='_blank')) { if(!best) best = h; }
                      });
                      return best;
                    }""")
                    if not real:
                        continue
                    host = host_of(real)
                    if not host or host in JUNK_HOSTS:
                        continue
                    name = durl.rsplit("/", 1)[-1]
                    name = re.sub(r"^\d+-", "", name).replace("-", " ").title()
                    out.append({"url": f"https://{host}", "title": name[:80] or host,
                                "source": "land-book", "score": 0})
                except Exception:
                    continue
            b.close()
    except Exception as e:
        print(f"  ! landbook 失败: {e}", file=sys.stderr)
    return out


SOURCES = {"hn": source_hn, "landbook": source_landbook}


def rpc_add(cand: dict) -> str:
    body = json.dumps({
        "p_token": TOKEN, "p_url": cand["url"], "p_host": cand["host"],
        "p_slug": cand["slug"], "p_title": cand["title"], "p_image": cand["image"],
        "p_source": cand["source"], "p_score": cand["score"],
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{SB_URL}/rest/v1/rpc/runner_add_discovery", data=body, method="POST",
        headers={"Content-Type": "application/json", "apikey": SB_KEY,
                 "Authorization": f"Bearer {SB_KEY}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return (r.read().decode("utf-8") or '""').strip().strip('"')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=list(SOURCES), help="只跑某个源（默认全跑）")
    ap.add_argument("--limit", type=int, default=30, help="每源最多取几条")
    ap.add_argument("--dry-run", action="store_true", help="只打印，不写库")
    args = ap.parse_args()

    if not args.dry_run:
        for v, n in [(SB_URL, "SB_URL"), (SB_KEY, "SB_ANON_KEY"), (TOKEN, "RUNNER_TOKEN")]:
            if not v:
                print(f"✗ 缺环境变量 {n}（或加 --dry-run 只看候选）"); sys.exit(1)

    known = existing_hosts()
    print(f"已收录 {len(known)} 个 host（去重白名单）")
    sources = [args.source] if args.source else list(SOURCES)

    # 收集 → 去重（vs 已收录 + 本次内部）→ 规范化
    seen, cands = set(known), []
    for sname in sources:
        print(f"\n▸ 源 [{sname}] 爬取中…")
        raw = SOURCES[sname](args.limit)
        kept = 0
        for c in raw:
            host = host_of(c["url"])
            if not host or host in seen:
                continue
            seen.add(host)
            slug = slug_from_url(c["url"])
            cands.append({**c, "host": host, "slug": slug, "image": thumb(c["url"])})
            kept += 1
        print(f"    取 {len(raw)} 条 → 去重后新增 {kept} 条")

    cands.sort(key=lambda c: c["score"], reverse=True)
    print(f"\n候选合计 {len(cands)} 条：")
    for c in cands:
        print(f"  [{c['source']:9}] {c['score']:>4}  {c['host'][:28]:28}  {c['title'][:40]}")

    if args.dry_run:
        print("\n（--dry-run：未写库）")
        return
    added = dup = 0
    for c in cands:
        try:
            r = rpc_add(c)
            if r == "added":
                added += 1
            else:
                dup += 1
        except Exception as e:
            print(f"  ✗ 写入失败 {c['host']}: {e}", file=sys.stderr)
    print(f"\n✓ 写入发现队列：新增 {added}，已存在 {dup}。去后台「发现队列」审阅 → 点收录。")


if __name__ == "__main__":
    main()
