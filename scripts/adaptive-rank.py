#!/usr/bin/env python3
"""
自适应排名引擎 · 每日由 cron-adaptive-rank.sh 调用
────────────────────────────────────────────────────
社交信号 → 动态排名：
  rank_score = likes × 3 + saves × 5 + 新鲜度加成 + 质量加成
  · 30 天内上新   +10 分（新站曝光窗口）
  · 90 天内上新   +5  分
  · 有 pack（设计包）+5  分（内容完整度奖励）

自动归档（软下架）：
  · engagement=0 且超过 ARCHIVE_DAYS 天的站 → status='archived'
  · 只改 sites/<slug>.json，不删文件（可随时手动恢复）

变化时自动 build + deploy（LOCAL_DEPLOY=1 服务器本地部署）。

环境变量：
  SB_URL / SB_ANON_KEY        （必须）
  LOCAL_DEPLOY=1              （服务器上设，本机跑时不设）
  RANK_ARCHIVE_DAYS=90        （0 互动多少天后归档，默认 90）
"""

import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT         = Path(__file__).parent.parent.resolve()
SITES_DIR    = ROOT / "sites"
SB_URL       = os.environ.get("SB_URL", "").rstrip("/")
SB_KEY       = os.environ.get("SB_ANON_KEY", "")
LOCAL_DEPLOY = os.environ.get("LOCAL_DEPLOY", "") == "1"
ARCHIVE_DAYS = int(os.environ.get("RANK_ARCHIVE_DAYS", "90"))


def sb_select(table: str, select: str = "*"):
    """Supabase REST GET（公开 view / anon 可读）。"""
    url = f"{SB_URL}/rest/v1/{table}?select={select}"
    req = urllib.request.Request(
        url, headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main():
    if not SB_URL or not SB_KEY:
        print("✗ 缺 SB_URL / SB_ANON_KEY")
        sys.exit(1)

    # ── 1. 从 Supabase 拉取 engagement 数据 ──────────────────────────────────
    try:
        likes_raw = sb_select("site_like_counts", "site_id,like_count")
        saves_raw = sb_select("site_save_counts", "site_id,save_count")
    except Exception as e:
        print(f"✗ 无法读取 Supabase engagement: {e}")
        sys.exit(1)

    likes = {r["site_id"]: int(r["like_count"])  for r in likes_raw}
    saves = {r["site_id"]: int(r["save_count"])  for r in saves_raw}

    total_interactions = sum(likes.values()) + sum(saves.values())
    print(f"▸ 互动数据: {len(likes)} 站有 like，{len(saves)} 站有 save，共 {total_interactions} 次互动")

    # ── 2. 遍历所有 completed 站，计算并更新 rank_score ──────────────────────
    now     = datetime.now(timezone.utc)
    changed = 0
    archived = 0
    top10 = []

    for jf in sorted(SITES_DIR.glob("*.json")):
        try:
            site = json.loads(jf.read_text(encoding="utf-8"))
        except Exception:
            continue

        slug   = site.get("id", jf.stem)
        status = site.get("status", "pending")

        # 跳过 pending/failed/archived 等
        if status not in ("completed", "archived"):
            continue

        like_n = likes.get(slug, 0)
        save_n = saves.get(slug, 0)

        # 新鲜度加成
        added_str = site.get("added_at", "2025-01-01")
        try:
            added_dt = datetime.fromisoformat(added_str).replace(tzinfo=timezone.utc)
            age_days = (now - added_dt).days
        except Exception:
            age_days = 365

        recency_bonus = 10 if age_days <= 30 else (5 if age_days <= 90 else 0)

        # 内容完整度加成
        pack_bonus = 5 if site.get("pack", {}).get("available") else 0

        rank_score = like_n * 3 + save_n * 5 + recency_bonus + pack_bonus

        # ── 自动归档（软下架）──────────────────────────────────────────────
        if status == "completed" and like_n == 0 and save_n == 0 and age_days > ARCHIVE_DAYS:
            site["status"]          = "archived"
            site["archived_reason"] = f"0 engagement after {age_days}d"
            site["archived_at"]     = now.strftime("%Y-%m-%d")
            archived += 1
            print(f"  📦 归档: {slug:<30} (上新 {age_days}d，0 互动)")

        # ── 更新 rank_score ──────────────────────────────────────────────────
        old_score = site.get("rank_score", -999)
        if old_score != rank_score or "rank_score" not in site:
            site["rank_score"] = rank_score
            jf.write_text(
                json.dumps(site, ensure_ascii=False, indent=2),
                encoding="utf-8")
            changed += 1

        top10.append((rank_score, slug, like_n, save_n))

    # ── 3. 打印排行榜 Top 10 ─────────────────────────────────────────────────
    top10.sort(reverse=True)
    print(f"\n▸ 当前 Top 10:")
    for rank_score, slug, lk, sv in top10[:10]:
        print(f"   {rank_score:4d}pt  {slug:<30}  ♥{lk} ★{sv}")

    print(f"\n▸ 更新: {changed} 个站的 rank_score，归档: {archived} 个站")

    if changed == 0 and archived == 0:
        print("✓ 无变化，跳过 build+deploy")
        return

    # ── 4. 重建 dist/ ────────────────────────────────────────────────────────
    print("\n▸ 重建 dist/ ...")
    result = subprocess.run(
        [sys.executable, "scripts/build.py"],
        cwd=str(ROOT), capture_output=True, text=True)
    if result.returncode != 0:
        print(f"✗ build.py 失败:\n{result.stderr[-500:]}")
        sys.exit(1)
    print(result.stdout.strip()[-300:] if result.stdout else "  done")

    # ── 5. 部署 ─────────────────────────────────────────────────────────────
    print("▸ 部署...")
    env = dict(os.environ)
    env["SKIP_BUILD"] = "1"
    if LOCAL_DEPLOY:
        env["LOCAL_DEPLOY"] = "1"
    result = subprocess.run(
        ["bash", "scripts/deploy.sh"],
        cwd=str(ROOT), env=env, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"✗ deploy.sh 失败:\n{result.stderr[-300:]}")
        sys.exit(1)

    print("✓ 排名更新完成，站点已重新上线")


if __name__ == "__main__":
    main()
