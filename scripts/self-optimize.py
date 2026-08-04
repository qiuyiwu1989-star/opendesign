#!/usr/bin/env python3
"""
自我优化器 · 每周由 cron-self-optimize.sh 调用（推荐周日凌晨）
────────────────────────────────────────────────────────────────
两个任务：

1. 失效 URL 检测
   HTTP HEAD 所有 completed 站 → 连续失败 → status='broken'
   下次 cron-jobrunner 会跳过 broken 站的任务

2. 超期 spec 升级
   spec 生成时间超过 STALE_DAYS 天的站 → 排队 upgrade job
   每周最多 REFRESH_CAP 个（避免一次性烧太多 mimo）

环境变量：
  SB_URL / SB_ANON_KEY / RUNNER_TOKEN    （必须）
  OPTIMIZE_STALE_DAYS=180               （spec 多少天算超期，默认 180）
  OPTIMIZE_REFRESH_CAP=3                （每周最多排队几个升级，默认 3）
  OPTIMIZE_CHECK_TIMEOUT=10             （HTTP HEAD 超时秒数，默认 10）
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ROOT        = Path(__file__).parent.parent.resolve()
SITES_DIR   = ROOT / "sites"
SB_URL      = os.environ.get("SB_URL", "").rstrip("/")
SB_KEY      = os.environ.get("SB_ANON_KEY", "")
TOKEN       = os.environ.get("RUNNER_TOKEN", "")
STALE_DAYS  = int(os.environ.get("OPTIMIZE_STALE_DAYS",   "180"))
REFRESH_CAP = int(os.environ.get("OPTIMIZE_REFRESH_CAP",  "3"))
TIMEOUT     = int(os.environ.get("OPTIMIZE_CHECK_TIMEOUT","10"))


def rpc(name: str, params: dict):
    body = json.dumps(params).encode()
    req  = urllib.request.Request(
        f"{SB_URL}/rest/v1/rpc/{name}", data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode()
    return json.loads(raw) if raw.strip() else None


import socket

_BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
               "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36")

def check_url(url: str) -> tuple[bool, int, bool]:
    """探活。返回 (可达, HTTP状态码, DNS已死)。

    教训（2026-08 踩过的大坑）：这台服务器在国内，大量境外站从这里访问
    超时/被墙——用「从本机连不上」当死亡信号，曾一周内误杀 363 个活站
    （zapier/zed/zora 都被标了 broken）。所以：
      - 连接失败/超时 = 弱信号，永远不足以判死（可能只是 GFW/慢）
      - 只有 DNS 解析失败（域名本身没了）才算强死亡信号
      - HEAD 被很多站 405/403，退化到 GET 再试；bot UA 会被 Cloudflare
        拦，用浏览器 UA
    """
    host = urllib.parse.urlparse(url).netloc
    try:
        socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False, 0, True          # DNS 解析失败 → 域名真没了
    except Exception:
        pass                            # DNS 查询本身抖动 → 不下结论

    for method in ("HEAD", "GET"):
        try:
            req = urllib.request.Request(
                url, method=method, headers={"User-Agent": _BROWSER_UA})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.status < 400, r.status, False
        except urllib.error.HTTPError as e:
            if e.code in (403, 405) and method == "HEAD":
                continue                # 很多站拒 HEAD/拦 bot，GET 再试
            return e.code < 400, e.code, False
        except Exception:
            continue
    return False, 0, False              # 连不上，但 DNS 活着 → 弱信号


def main():
    for v, n in [(SB_URL, "SB_URL"), (SB_KEY, "SB_ANON_KEY"), (TOKEN, "RUNNER_TOKEN")]:
        if not v:
            print(f"✗ 缺 {n}")
            sys.exit(1)

    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")

    broken_new   = []
    broken_fixed = []
    stale_queue  = []

    all_files = sorted(SITES_DIR.glob("*.json"))
    # 带 try 逐个读：一个坏 JSON 文件不能炸掉整轮探活（打印文件名跳过即可）。
    # 探活范围 = completed + broken：broken 站必须参与探活，否则「恢复在线」分支
    # 永远走不到，被误标 broken 的站没有任何恢复路径。
    check_files = []
    for f in all_files:
        try:
            st = json.loads(f.read_text(encoding="utf-8")).get("status")
        except Exception as e:
            print(f"  ⚠ 坏 JSON 跳过: {f.name} ({e})")
            continue
        if st in ("completed", "broken"):
            check_files.append(f)

    print(f"▸ 自检 {len(check_files)} 个 completed/broken 站")
    print(f"  超期阈值: {STALE_DAYS}d  |  本周升级上限: {REFRESH_CAP}  |  HTTP 超时: {TIMEOUT}s\n")

    for jf in check_files:
        try:
            site = json.loads(jf.read_text(encoding="utf-8"))
        except Exception:
            continue

        slug    = site.get("id", jf.stem)
        url     = site.get("url", "")
        was_broken = site.get("status") == "broken"   # broken 站现在也在探活范围内，可命中恢复分支

        if not url:
            continue

        # ── 1. URL 可达性检查 ─────────────────────────────────────────────
        # 下架策略（2026-08 重写，血泪版）：
        #   · 库的资产是「已抽取的设计系统」（spec + 截图都在我们自己的 COS 上），
        #     不是外链。原站挂了，档案反而更珍贵（Wayback Machine 逻辑）——
        #     所以【有 pack 的站永不因不可达而下架】，只记 origin_dead 供前端展示。
        #   · 没 pack 的站，也只有 DNS 连续两周解析失败（域名真没了）才下架；
        #     「从本机连不上」在国内服务器上毫无证明力。
        reachable, code, dns_dead = check_url(url)
        time.sleep(0.2)   # 礼貌爬取

        has_pack = bool(site.get("pack", {}).get("available")) or bool(site.get("spec"))

        if reachable:
            # 站点可达 → 清除一切失效痕迹
            if site.get("broken_detected") or site.get("broken_at") or site.get("origin_dead"):
                site.pop("broken_detected", None)
                site.pop("broken_at", None)
                site.pop("origin_dead", None)
                if site.get("status") == "broken":
                    site["status"] = "completed"
                    broken_fixed.append(slug)
                    print(f"  ✓ 恢复: {slug}")
                jf.write_text(json.dumps(site, ensure_ascii=False, indent=2))
        elif dns_dead:
            if not site.get("broken_detected"):
                site["broken_detected"] = today_str
                jf.write_text(json.dumps(site, ensure_ascii=False, indent=2))
                print(f"  ⚠ DNS 疑似失效: {slug:<30}（下周复核）")
            elif has_pack:
                # 域名真没了，但设计系统档案还在 → 保留展示，标注原站已死
                if not site.get("origin_dead"):
                    site["origin_dead"] = today_str
                    jf.write_text(json.dumps(site, ensure_ascii=False, indent=2))
                    print(f"  🪦 原站已死(档案保留): {slug}")
            else:
                # 没档案 + 域名没了 → 这条记录才真的没价值
                site["status"]    = "broken"
                site["broken_at"] = today_str
                jf.write_text(json.dumps(site, ensure_ascii=False, indent=2))
                broken_new.append(slug)
                print(f"  💀 确认失效(无档案): {slug:<30}")
        # else: 连不上但 DNS 活着 → 弱信号，什么都不做（大概率是 GFW/慢）

        # ── 2. 超期 spec 检测 ────────────────────────────────────────────
        # 只有（本轮探活后仍是）completed 的站才排队升级——broken 站排升级是白烧 mimo
        if site.get("status") != "completed":
            continue
        if len(stale_queue) >= REFRESH_CAP:
            continue

        gen_at = (site.get("_meta", {}).get("generated_at") or
                  site.get("added_at", "2025-01-01"))
        try:
            gen_dt   = datetime.fromisoformat(gen_at).replace(tzinfo=timezone.utc)
            spec_age = (now - gen_dt).days
        except Exception:
            spec_age = 0

        if spec_age > STALE_DAYS:
            stale_queue.append((slug, url, spec_age))

    # ── 排队超期升级任务 ──────────────────────────────────────────────────────
    queued = 0
    for slug, url, age in stale_queue[:REFRESH_CAP]:
        try:
            rpc("runner_enqueue_job", {
                "p_token": TOKEN,
                "p_kind":  "upgrade",
                "p_slug":  slug,
                "p_url":   url,
            })
            queued += 1
            print(f"  🔄 排队升级: {slug:<30} spec {age}d 未更新")
        except Exception as e:
            print(f"  ✗ 排队失败 {slug}: {e}")

    # ── 汇总 ─────────────────────────────────────────────────────────────────
    print(f"\n完成自检:")
    print(f"  💀 新增失效: {len(broken_new)}  →  {broken_new}")
    print(f"  ✓  恢复在线: {len(broken_fixed)}  →  {broken_fixed}")
    print(f"  🔄 超期排队: {queued}/{REFRESH_CAP}  →  {[s for s,_,_ in stale_queue[:queued]]}")


if __name__ == "__main__":
    main()
