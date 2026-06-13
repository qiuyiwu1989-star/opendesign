#!/usr/bin/env python3
"""
自动质量评估器 · 每天由 cron-auto-evaluate.sh 调用
────────────────────────────────────────────────────
流程：
  1. 读取 Supabase discoveries 表中 status='pending' 的候选站
  2. HTTP fetch 检查可达性 + 提取 title/description
  3. 用 mimo（ANTHROPIC_API_KEY）做轻量 AI 评分（~100 tokens/站，极低成本）
  4. score ≥ APPROVE_THRESHOLD → approve → 自动创建 collect job → cron-jobrunner 10分钟内执行
     score ≤ IGNORE_THRESHOLD  → ignore（排除低质量）
     中间分                    → defer（留人工后台审阅）
  5. 每日最多自动 approve DAILY_CAP 个站（防成本失控）

环境变量（~/.opendesign-runner.env）：
  SB_URL / SB_ANON_KEY / RUNNER_TOKEN  （必须）
  ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL  （可选，无则启发式评分）
  AUTO_EVAL_DAILY_CAP=10               （每日自动收录上限，默认 10）
  AUTO_EVAL_APPROVE=7                  （≥ 此分自动收录，默认 7）
  AUTO_EVAL_IGNORE=4                   （≤ 此分自动忽略，默认 4）
"""

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent.parent.resolve()

SB_URL   = os.environ.get("SB_URL", "").rstrip("/")
SB_KEY   = os.environ.get("SB_ANON_KEY", "")
TOKEN    = os.environ.get("RUNNER_TOKEN", "")
AI_KEY   = os.environ.get("ANTHROPIC_API_KEY", "")
AI_BASE  = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/")
AI_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-3-haiku-20240307")

DAILY_CAP         = int(os.environ.get("AUTO_EVAL_DAILY_CAP", "10"))
APPROVE_THRESHOLD = int(os.environ.get("AUTO_EVAL_APPROVE",   "7"))
IGNORE_THRESHOLD  = int(os.environ.get("AUTO_EVAL_IGNORE",    "4"))
MAX_QUEUE_BEFORE_PAUSE = 20   # 队列里已有超过这么多任务时暂停自动收录，避免服务器过载


# ── Supabase RPC ──────────────────────────────────────────────────────────────

def rpc(name: str, params: dict):
    body = json.dumps(params).encode()
    req  = urllib.request.Request(
        f"{SB_URL}/rest/v1/rpc/{name}", data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode()
    return json.loads(raw) if raw.strip() else None


# ── 站点元数据抓取 ────────────────────────────────────────────────────────────

def fetch_meta(url: str) -> dict:
    """轻量 HTTP 抓取：检查可达性 + 提取 title/description。"""
    try:
        req = urllib.request.Request(
            url, headers={"User-Agent": "Mozilla/5.0 (compatible; OpenDesignBot/1.0)"})
        with urllib.request.urlopen(req, timeout=10) as r:
            # 只读前 64KB，足够提取 meta
            html = r.read(65536).decode("utf-8", errors="ignore")

        title = (re.search(r'<title[^>]*>([^<]{1,120})</title>', html, re.I) or
                 re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\'](.*?)["\']', html, re.I))
        desc  = (re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\'](.*?)["\']', html, re.I) or
                 re.search(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\'](.*?)["\']', html, re.I))

        return {
            "title":       (title.group(1).strip()[:120] if title else ""),
            "description": (desc.group(1).strip()[:250]  if desc  else ""),
            "reachable":   True,
        }
    except urllib.error.HTTPError as e:
        return {"title": "", "description": "", "reachable": e.code < 400, "error": f"HTTP {e.code}"}
    except Exception as e:
        return {"title": "", "description": "", "reachable": False, "error": str(e)[:80]}


# ── AI 评分 ───────────────────────────────────────────────────────────────────

EVAL_PROMPT = """\
You are a curator for a premium web design library. Rate this website's design quality.

URL: {url}
Title: {title}
Description: {description}

Scoring guide (be strict — the bar is high):
  9-10: Exceptional. Would inspire any designer. Distinctive, tasteful, memorable.
  7-8:  Strong design. Clear visual identity, worth collecting.
  5-6:  Decent but generic, or uncertain from metadata alone.
  3-4:  Below average. Default templates, poor typography, no visual identity.
  0-2:  Not a design showcase. Docs site, API, utility, landing generator, etc.

Consider: Is this a REAL website (not an app store page, GitHub repo, or docs)?
Does it have a notable visual design? Would a designer look at it for inspiration?

Reply with ONLY valid JSON: {{"score": <0-10>, "reason": "<one concise sentence>"}}"""


def ai_score(url: str, title: str, description: str) -> tuple[int, str]:
    """AI 快评。无 key 时退回启发式评分。"""
    if not AI_KEY:
        score = 5
        signals = (title + " " + description + " " + url).lower()
        design_kw = r"\b(design|studio|creative|brand|agency|portfolio|art|type|motion|visual)\b"
        junk_kw   = r"\b(docs|documentation|api|sdk|cli|dashboard|admin|analytics|github)\b"
        if re.search(design_kw, signals):
            score += 2
        if re.search(junk_kw, signals):
            score -= 3
        return max(0, min(10, score)), "heuristic (no AI key)"

    prompt = EVAL_PROMPT.format(
        url=url, title=title[:100], description=description[:200])

    try:
        body = json.dumps({
            "model":      AI_MODEL,
            "max_tokens": 120,
            "messages":   [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            f"{AI_BASE}/v1/messages", data=body, method="POST",
            headers={
                "x-api-key":           AI_KEY,
                "anthropic-version":   "2023-06-01",
                "content-type":        "application/json",
            })
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read().decode())

        # mimo v2.5 返回 thinking 块在 text 前面，按 type 找而非用下标
        text = next(b["text"] for b in resp["content"] if b.get("type") == "text").strip()
        # 允许有 markdown code fence
        text = re.sub(r"^```[a-z]*\n?", "", text).rstrip("`").strip()
        result = json.loads(text)
        return int(result.get("score", 5)), str(result.get("reason", ""))[:120]

    except Exception as e:
        return 5, f"ai_error: {str(e)[:80]}"


# ── 主流程 ────────────────────────────────────────────────────────────────────

def main():
    for v, n in [(SB_URL, "SB_URL"), (SB_KEY, "SB_ANON_KEY"), (TOKEN, "RUNNER_TOKEN")]:
        if not v:
            print(f"✗ 缺 {n}（写进 ~/.opendesign-runner.env）")
            sys.exit(1)

    if not AI_KEY:
        print("⚠  未配 ANTHROPIC_API_KEY，将使用启发式评分（建议配置以提升精准度）")

    # 检查队列负载，避免服务器过载
    try:
        pending_jobs = rpc("runner_pending_count", {"p_token": TOKEN})
        if pending_jobs and pending_jobs > MAX_QUEUE_BEFORE_PAUSE:
            print(f"⏸  队列已有 {pending_jobs} 个待处理任务，暂停自动收录（上限 {MAX_QUEUE_BEFORE_PAUSE}）")
            return
    except Exception as e:
        print(f"  ⚠ 无法检查队列: {e}")

    # 读取待评估候选
    try:
        pending = rpc("runner_list_pending", {"p_token": TOKEN, "p_limit": 50})
    except Exception as e:
        print(f"✗ 无法读取候选站: {e}")
        sys.exit(1)

    if not pending:
        print("✓ 无待评估候选站")
        return

    print(f"▸ 评估 {len(pending)} 个候选站  (每日上限 {DAILY_CAP} 个自动收录)")
    print(f"  approve ≥ {APPROVE_THRESHOLD}  |  ignore ≤ {IGNORE_THRESHOLD}  |  defer 5-6\n")

    approved = ignored = deferred = 0

    for d in pending:
        url   = d.get("url", "")
        slug  = d.get("slug", "")
        title = d.get("title", "")
        disc_id = d["id"]

        print(f"  [{slug[:24]:<24}] {url[:55]}")

        # 1. 可达性检查 + 元数据
        meta = fetch_meta(url)
        if not meta["reachable"]:
            err = meta.get("error", "")
            rpc("runner_auto_evaluate", {
                "p_token": TOKEN, "p_id": disc_id,
                "p_action": "ignore", "p_score": 0,
                "p_reason": f"不可达: {err}"
            })
            print(f"       ✗ 不可达 ({err})，已忽略")
            ignored += 1
            time.sleep(0.3)
            continue

        full_title  = meta["title"] or title
        description = meta["description"]

        # 2. AI 评分
        score, reason = ai_score(url, full_title, description)
        print(f"       {score:2d}/10  {reason[:70]}")

        # 3. 决策
        if score >= APPROVE_THRESHOLD and approved < DAILY_CAP:
            action = "approve"
            approved += 1
            label = f"✓ 自动收录 ({approved}/{DAILY_CAP})"
        elif score >= APPROVE_THRESHOLD and approved >= DAILY_CAP:
            action = "defer"
            label  = f"~ 今日配额已满，留待明日"
            deferred += 1
        elif score <= IGNORE_THRESHOLD:
            action = "ignore"
            label  = "✗ 质量不足，忽略"
            ignored += 1
        else:
            action = "defer"
            label  = "~ 存疑，留人工后台审阅"
            deferred += 1

        rpc("runner_auto_evaluate", {
            "p_token": TOKEN, "p_id": disc_id,
            "p_action": action, "p_score": score,
            "p_reason": reason
        })
        print(f"       {label}")
        time.sleep(0.5)   # AI API 限流缓冲

    print(f"\n完成：✓ {approved} 收录  ✗ {ignored} 忽略  ~ {deferred} 存疑")
    if approved > 0:
        print(f"  → job_runner 将在 10 分钟内开始 Playwright+mimo 完整提取")


if __name__ == "__main__":
    main()
