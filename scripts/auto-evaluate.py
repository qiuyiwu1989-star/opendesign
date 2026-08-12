#!/usr/bin/env python3
"""
自动质量评估器 · 每天由 cron-auto-evaluate.sh 调用
────────────────────────────────────────────────────
流程：
  1. 读取 Supabase discoveries 表中 status='pending' 的候选站
  2. HTTP fetch 检查可达性 + 提取 title/description
  3. 用 mimo（ANTHROPIC_API_KEY）做轻量 AI 评分（~100 tokens/站，极低成本）
  4. 输出 approve / review / reject 的可解释建议，写入审计记录
  5. 所有候选仍留人工后台复核；本脚本不发布、不创建 job、不永久删除

环境变量（~/.opendesign-runner.env）：
  SB_URL / SB_ANON_KEY / RUNNER_TOKEN  （必须）
  ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL  （可选，无则启发式评分）
  AUTO_EVAL_BATCH_LIMIT=50             （每日最多评估数量，默认 50）
  AUTO_EVAL_APPROVE=7                  （启发式兜底建议收录阈值）
  AUTO_EVAL_IGNORE=4                   （启发式兜底建议拒绝阈值）
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

EVAL_BATCH_LIMIT  = int(os.environ.get("AUTO_EVAL_BATCH_LIMIT", "50"))
APPROVE_THRESHOLD = int(os.environ.get("AUTO_EVAL_APPROVE",   "7"))
IGNORE_THRESHOLD  = int(os.environ.get("AUTO_EVAL_IGNORE",    "4"))


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

POLICY_VERSION = "opendesign-curation-v1.0"

EVAL_PROMPT = """\
You are the daily curator for OpenDesign, a premium evidence-backed design library.
Decide whether this public website deserves human review for inclusion. Be strict.

URL: {url}
Title: {title}
Description: {description}

Hard reject: affiliate/ad directories, SEO farms, impersonation, duplicated aggregators,
malicious downloads, keyword stuffing, or content unrelated to design reference value.
Insufficient evidence means review, not approve and not an invented conclusion.

Consider: Is this a REAL website (not an app store page, GitHub repo, or docs)?
Does it have a notable visual design? Would a designer look at it for inspiration?

Reply with ONLY valid JSON:
{{"recommendation":"approve|review|reject","confidence":<0-100>,"reason":"<concise>",
"signals":[{{"id":"design-value|originality|utility|evidence|spam-risk|ad-risk|safety","label":"<short>","state":"pass|warn|fail","score":<0-100>,"evidence":["fact"]}}]}}"""


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
            "max_tokens": 512, "thinking": {"type": "disabled"},
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


def evaluate_decision(url: str, title: str, description: str) -> dict:
    """Return a bounded, auditable recommendation. Heuristic fallback is marked as such."""
    if not AI_KEY:
        score, reason = ai_score(url, title, description)
        recommendation = "approve" if score >= APPROVE_THRESHOLD else "reject" if score <= IGNORE_THRESHOLD else "review"
        return {"recommendation": recommendation, "confidence": min(75, 50 + abs(score - 5) * 6), "reason": reason,
                "signals": [{"id": "evidence", "label": "证据完整度", "state": "warn", "score": 40,
                             "evidence": ["heuristic fallback; AI model unavailable"]}]}
    prompt = EVAL_PROMPT.format(url=url, title=title[:100], description=description[:200])
    try:
        body = json.dumps({"model": AI_MODEL, "max_tokens": 1200, "thinking": {"type": "disabled"},
                           "messages": [{"role": "user", "content": prompt}]}).encode()
        req = urllib.request.Request(f"{AI_BASE}/v1/messages", data=body, method="POST",
            headers={"x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = json.loads(response.read().decode())
        raw = next(block["text"] for block in payload["content"] if block.get("type") == "text").strip()
        result = json.loads(re.sub(r"^```[a-z]*\n?", "", raw).rstrip("`").strip())
        recommendation = result.get("recommendation") if result.get("recommendation") in ("approve", "review", "reject") else "review"
        signals = result.get("signals") if isinstance(result.get("signals"), list) else []
        return {"recommendation": recommendation, "confidence": max(0, min(100, int(result.get("confidence", 50)))),
                "reason": str(result.get("reason", "Evidence requires human review"))[:1000], "signals": signals[:20]}
    except Exception as error:
        return {"recommendation": "review", "confidence": 0, "reason": f"ai_error: {str(error)[:160]}",
                "signals": [{"id": "evidence", "label": "证据完整度", "state": "warn", "score": 0,
                             "evidence": ["AI evaluation failed; human review required"]}]}


# ── 主流程 ────────────────────────────────────────────────────────────────────

def main():
    for v, n in [(SB_URL, "SB_URL"), (SB_KEY, "SB_ANON_KEY"), (TOKEN, "RUNNER_TOKEN")]:
        if not v:
            print(f"✗ 缺 {n}（写进 ~/.opendesign-runner.env）")
            sys.exit(1)

    if not AI_KEY:
        print("⚠  未配 ANTHROPIC_API_KEY，将使用启发式评分（建议配置以提升精准度）")

    # 读取待评估候选
    try:
        pending = rpc("runner_list_pending", {"p_token": TOKEN, "p_limit": EVAL_BATCH_LIMIT})
    except Exception as e:
        print(f"✗ 无法读取候选站: {e}")
        sys.exit(1)

    if not pending:
        print("✓ 无待评估候选站")
        return

    print(f"▸ 评估 {len(pending)} 个候选站  (本轮上限 {EVAL_BATCH_LIMIT})")
    print("  AI 只给建议并留痕；人工确认后才进入发布准备。\n")

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
            rpc("runner_record_curation_decision", {
                "p_token": TOKEN, "p_discovery_id": disc_id,
                "p_recommendation": "reject", "p_confidence": 99,
                "p_reason": f"不可达: {err}", "p_policy_version": POLICY_VERSION,
                "p_model": "availability-gate", "p_signals": [{"id": "evidence", "label": "证据完整度", "state": "fail", "score": 0, "evidence": [f"origin unavailable: {err}"]}],
            })
            print(f"       ✗ 不可达 ({err})，已记录拒绝建议，等待人工复核")
            ignored += 1
            time.sleep(0.3)
            continue

        full_title  = meta["title"] or title
        description = meta["description"]

        # 2. AI 结构化建议；只写审计记录，不直接发布或入队
        decision = evaluate_decision(url, full_title, description)
        recommendation = decision["recommendation"]
        rpc("runner_record_curation_decision", {
            "p_token": TOKEN, "p_discovery_id": disc_id,
            "p_recommendation": recommendation, "p_confidence": decision["confidence"],
            "p_reason": decision["reason"], "p_policy_version": POLICY_VERSION,
            "p_model": AI_MODEL if AI_KEY else "heuristic-fallback", "p_signals": decision["signals"],
        })
        if recommendation == "approve": approved += 1
        elif recommendation == "reject": ignored += 1
        else: deferred += 1
        print(f"       {recommendation.upper()} {decision['confidence']}% · 已记录，等待人工复核")
        time.sleep(0.5)   # AI API 限流缓冲

    print(f"\n完成：{approved} 建议收录 · {ignored} 建议拒绝 · {deferred} 人工复核")
    print("  → 所有判断均已留痕；没有创建发布任务。")


if __name__ == "__main__":
    main()
