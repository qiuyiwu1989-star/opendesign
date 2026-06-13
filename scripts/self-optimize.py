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


def check_url(url: str) -> tuple[bool, int]:
    """HTTP HEAD 检查。返回 (可达, HTTP状态码)。"""
    try:
        req = urllib.request.Request(
            url, method="HEAD",
            headers={"User-Agent": "Mozilla/5.0 (compatible; OpenDesignBot/1.0)"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status < 400, r.status
    except urllib.error.HTTPError as e:
        return e.code < 400, e.code
    except Exception:
        return False, 0


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
    completed = [f for f in all_files
                 if json.loads(f.read_text(encoding="utf-8")).get("status") == "completed"]

    print(f"▸ 自检 {len(completed)} 个 completed 站")
    print(f"  超期阈值: {STALE_DAYS}d  |  本周升级上限: {REFRESH_CAP}  |  HTTP 超时: {TIMEOUT}s\n")

    for jf in completed:
        try:
            site = json.loads(jf.read_text(encoding="utf-8"))
        except Exception:
            continue

        slug    = site.get("id", jf.stem)
        url     = site.get("url", "")
        was_broken = site.get("status") == "broken"   # 不会命中（已被 filter 排除），保留逻辑

        if not url:
            continue

        # ── 1. URL 可达性检查 ─────────────────────────────────────────────
        reachable, code = check_url(url)
        time.sleep(0.2)   # 礼貌爬取

        if not reachable:
            if not site.get("broken_detected"):
                # 首次检测到失效，记录日期但不立即归档（等下次再确认）
                site["broken_detected"] = today_str
                jf.write_text(json.dumps(site, ensure_ascii=False, indent=2))
                print(f"  ⚠ 疑似失效: {slug:<30} HTTP {code}")
            else:
                # 第二次确认失效 → 标记 broken
                site["status"]         = "broken"
                site["broken_at"]      = today_str
                jf.write_text(json.dumps(site, ensure_ascii=False, indent=2))
                broken_new.append(slug)
                print(f"  💀 确认失效: {slug:<30} HTTP {code}，已标记 broken")
            continue
        else:
            # 站点恢复可达 → 清除失效标记
            if site.get("broken_detected") or site.get("broken_at"):
                site.pop("broken_detected", None)
                site.pop("broken_at", None)
                if site.get("status") == "broken":
                    site["status"] = "completed"
                    broken_fixed.append(slug)
                    print(f"  ✓ 恢复: {slug}")
                jf.write_text(json.dumps(site, ensure_ascii=False, indent=2))

        # ── 2. 超期 spec 检测 ────────────────────────────────────────────
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
