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
import json, os, sys, time, urllib.request
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

def _clean(s):
    # argv 以 surrogateescape 解码进来；调用方常用 `tail -c N` 截断日志，会在多字节
    # UTF-8 字符中间切断 → 残字节变成 surrogate，json.dumps 编码时会抛 UnicodeEncodeError
    # （在 try 之前抛 → 整个脚本崩溃、心跳丢失）。这里重组字节并丢掉非法 UTF-8，彻底清干净。
    return s.encode("utf-8", "surrogateescape").decode("utf-8", "ignore")

started_at = sys.argv[1]
kind       = sys.argv[2]
status     = sys.argv[3]
summary    = _clean(sys.argv[4] if len(sys.argv) > 4 else "")[:400]
details    = _clean(sys.argv[5] if len(sys.argv) > 5 else "")[:3000]

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
# 重试 3 次（带退避）：publisher 在重型 build+deploy 之后立刻打点，那一刻服务器
# 网络/CPU 常被占满 → 单次 urlopen 容易瞬时失败。不重试就会静默丢心跳（曾踩过）。
for _attempt in range(3):
    try:
        with urllib.request.urlopen(req, timeout=15):
            break
    except Exception:
        if _attempt < 2:
            time.sleep(2)
        # 最后一次仍失败 → fire-and-forget，静默放弃，不影响 cron 主流程
