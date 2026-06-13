#!/usr/bin/env python3
"""把一次 cron 运行结果写到 Supabase run_logs 表。
由 cron-*.sh 脚本在任务结束后调用，fire-and-forget（失败不影响主流程）。

用法：
  python3 scripts/log_run.py <started_at_iso> <kind> <status> <summary> [details]

  started_at_iso  ISO-8601，e.g. 2026-06-09T10:00:01+08:00
  kind            jobrunner | discover | auto-evaluate | adaptive-rank | self-optimize
  status          done | error | skipped
  summary         一行摘要（< 400 字符）
  details         末尾日志正文（可选，< 3000 字符）
"""
import json, os, sys, urllib.request
from pathlib import Path

# 加载环境变量
_env = Path.home() / ".opendesign-runner.env"
if _env.exists():
    for _line in _env.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

SB_URL  = os.environ.get("SB_URL", "").rstrip("/")
SB_KEY  = os.environ.get("SB_ANON_KEY", "")
TOKEN   = os.environ.get("RUNNER_TOKEN", "")

if len(sys.argv) < 4 or not SB_URL or not TOKEN:
    sys.exit(0)                     # 静默退出，不影响 cron 主流程

started_at = sys.argv[1]
kind       = sys.argv[2]
status     = sys.argv[3]
summary    = (sys.argv[4] if len(sys.argv) > 4 else "")[:400]
details    = (sys.argv[5] if len(sys.argv) > 5 else "")[:3000]

payload = json.dumps({
    "p_token":      TOKEN,
    "p_kind":       kind,
    "p_status":     status,
    "p_summary":    summary,
    "p_details":    details,
    "p_started_at": started_at,
}).encode("utf-8")

req = urllib.request.Request(
    f"{SB_URL}/rest/v1/rpc/log_cron_run",
    data    = payload,
    method  = "POST",
    headers = {
        "Content-Type":  "application/json",
        "apikey":         SB_KEY,
        "Authorization": f"Bearer {SB_KEY}",
    },
)
try:
    with urllib.request.urlopen(req, timeout=10):
        pass
except Exception:
    pass    # fire-and-forget：网络/RPC 失败不重试，不报错
