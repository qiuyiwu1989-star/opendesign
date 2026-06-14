#!/usr/bin/env python3
"""
服务器端任务执行器（cron 调用）。轮询 Supabase 的 jobs 队列，自动跑：
  - upgrade : LOCAL_DEPLOY=1 bash scripts/upgrade-pack.sh <slug> <url>（Playwright + mimo → Tier-2）
  - refresh : cache-bust 主图 thum.io → 重 build + 本机部署

只用一个 scoped 的 RUNNER_TOKEN 领活 / 交活（不碰 service_role）。
每次调用把队列里的活尽量清空（带单活超时 + 总数上限），再退出。

环境变量（放 /etc/opendesign-runner.env，systemd/cron 注入；不进 git）：
  SB_URL, SB_ANON_KEY, RUNNER_TOKEN
  ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL   # mimo
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parent.parent.resolve()
SB_URL = os.environ.get("SB_URL", "").rstrip("/")
SB_KEY = os.environ.get("SB_ANON_KEY", "")
TOKEN = os.environ.get("RUNNER_TOKEN", "")
MAX_JOBS = int(os.environ.get("RUNNER_MAX_JOBS", "8"))      # 每次调用最多处理几个，防跑飞
JOB_TIMEOUT = int(os.environ.get("RUNNER_JOB_TIMEOUT", "600"))


def rpc(name: str, params: dict):
    body = json.dumps(params).encode("utf-8")
    req = urllib.request.Request(
        f"{SB_URL}/rest/v1/rpc/{name}", data=body, method="POST",
        headers={"Content-Type": "application/json", "apikey": SB_KEY,
                 "Authorization": f"Bearer {SB_KEY}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        txt = r.read().decode("utf-8")
    return json.loads(txt) if txt.strip() else None


def run_upgrade(slug: str, url: str) -> tuple[bool, str]:
    # LOCAL_DEPLOY 由环境决定：服务器上设 1（本机 cp）；本地 drain 时不设（走 scp 部署到服务器，
    # 且本地仓库保持 canonical，不分叉）。
    # SKIP_PUBLISH=1：每站只出包+cp，不做整站重建/部署 —— 由 cron-publisher 定时统一发布，
    # 避免每个任务都全量 build（2700+ 文件）压垮 web 服务器。
    env = dict(os.environ)
    env["SKIP_PUBLISH"] = "1"
    try:
        p = subprocess.run(["bash", "scripts/upgrade-pack.sh", slug, url],
                           cwd=str(ROOT), env=env, capture_output=True, text=True,
                           timeout=JOB_TIMEOUT)
    except subprocess.TimeoutExpired:
        return False, "timeout"
    tail = (p.stdout or "")[-300:] + (p.stderr or "")[-300:]
    return p.returncode == 0, tail.strip()[-900:]


def run_collect(slug: str, url: str) -> tuple[bool, str]:
    """收录一个全新发现的站：先建最小 sites/<slug>.json（upgrade-pack 的 ingest 需要它存在
    且带 url），再走 upgrade-pack → Playwright 提取 + mimo grounded → Tier-2 完整包上线。"""
    if not url:
        return False, "collect 缺 url"
    sp = ROOT / "sites" / f"{slug}.json"
    if not sp.exists():
        from datetime import datetime
        sp.write_text(json.dumps({
            "id": slug, "schema_version": "0.3", "url": url,
            "title": slug.replace("-", " ").title(),
            "image": f"https://image.thum.io/get/width/1440/noanimate/{url}",
            "tags": [], "status": "pending",
            "added_at": datetime.now().strftime("%Y-%m-%d"),
            "added_by": "discover", "_meta": {},
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    return run_upgrade(slug, url)  # 新站文件就位后，复用完整的 Tier-2 升级管线


def run_refresh(slug: str) -> tuple[bool, str]:
    sp = ROOT / "sites" / f"{slug}.json"
    if not sp.exists():
        return False, f"no sites/{slug}.json"
    d = json.loads(sp.read_text(encoding="utf-8"))
    site_url = d.get("url", "")
    d["image"] = f"https://image.thum.io/get/width/1440/noanimate/?_cb={int(time.time())}/{site_url}"
    sp.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    env = {**os.environ, "SKIP_SEO": "1"}  # LOCAL_DEPLOY 同上：由环境决定
    try:
        p = subprocess.run(["bash", "scripts/deploy.sh"], cwd=str(ROOT), env=env,
                           capture_output=True, text=True, timeout=JOB_TIMEOUT)
    except subprocess.TimeoutExpired:
        return False, "timeout"
    return p.returncode == 0, "image refreshed" if p.returncode == 0 else (p.stderr or "")[-300:]


def main():
    for v, n in [(SB_URL, "SB_URL"), (SB_KEY, "SB_ANON_KEY"), (TOKEN, "RUNNER_TOKEN")]:
        if not v:
            print(f"✗ 缺环境变量 {n}"); sys.exit(1)

    done = 0
    while done < MAX_JOBS:
        try:
            job = rpc("runner_next_job", {"p_token": TOKEN})
        except urllib.error.HTTPError as e:
            print(f"✗ next_job HTTP {e.code}: {e.read().decode()[:200]}"); break
        if not job or not job.get("id"):
            break  # 队列空
        jid, kind, slug, url = job["id"], job["kind"], job["slug"], job.get("url")
        print(f"▸ [{kind}] {slug} ({jid})")
        try:
            if kind == "upgrade":
                ok, msg = run_upgrade(slug, url or "")
            elif kind == "collect":
                ok, msg = run_collect(slug, url or "")
            elif kind == "refresh":
                ok, msg = run_refresh(slug)
            else:
                ok, msg = False, f"unknown kind {kind}"
        except Exception as e:
            ok, msg = False, f"{type(e).__name__}: {e}"[:300]
        rpc("runner_finish_job", {"p_token": TOKEN, "p_id": jid,
                                  "p_status": "done" if ok else "failed", "p_result": msg})
        print(f"  {'✓' if ok else '✗'} {msg[:120]}")
        done += 1

    print(f"完成 {done} 个任务。" if done else "队列空，无任务。")


if __name__ == "__main__":
    main()
