#!/usr/bin/env python3
"""
并发批量升级 —— N 个 worker 同时跑，充分利用 mimo token 窗口期。

用法：
  python3 scripts/upgrade-batch-parallel.py           # 默认 4 并发
  python3 scripts/upgrade-batch-parallel.py --workers 6
  python3 scripts/upgrade-batch-parallel.py --workers 3 --limit 50  # 只跑前 50 站

前置：
  - deploy.sh 已改成 PID 唯一 archive（避免并发 scp 冲突） ✓
  - pack_index_entry.py 已加 flock 写锁（避免并发写 packs-index 冲突） ✓
  - ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_MODEL 已在环境变量

每个 worker 独立处理一站：
  extract → 渲染质量门 → mimo → validate → pack → deploy（SKIP_SEO）
完成后主进程做一次整站 smoke + 完整 SEO deploy。
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
os.chdir(ROOT)

ap = argparse.ArgumentParser()
ap.add_argument("--workers", "-w", type=int, default=4, help="并发 worker 数（默认4）")
ap.add_argument("--limit", type=int, default=0, help="最多处理 N 站（0=全部）")
args = ap.parse_args()

# ── 构建待处理队列 ──────────────────────────────────────────────
def get_remaining():
    done = set(json.load(open("packs-index.json", encoding="utf-8")))
    pairs = []
    for p in sorted(glob.glob("sites/*.json")):
        d = json.load(open(p, encoding="utf-8"))
        if d.get("url") and d["id"] not in done:
            pairs.append((d["id"], d["url"]))
    return pairs

remaining = get_remaining()
if args.limit > 0:
    remaining = remaining[:args.limit]

total = len(remaining)
if total == 0:
    print("✓ 没有新站要处理")
    sys.exit(0)

print(f"╔══════════════════════════════════════════════════════════╗")
print(f"║  并发批量升级  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"║  待处理: {total} 站  Workers: {args.workers}  理论加速: ~{args.workers}x")
est_min = total * 4 // args.workers
print(f"║  预计时间: ~{est_min//60}h{est_min%60}m  (串行约 {total*4//60}h)")
print(f"╚══════════════════════════════════════════════════════════╝\n")

# ── 线程安全队列 ────────────────────────────────────────────────
import queue
q: queue.Queue = queue.Queue()
for item in remaining:
    q.put(item)

results = {"ok": 0, "fail": 0, "skip": 0}
results_lock = threading.Lock()
log_lock = threading.Lock()

def log(worker_id, msg):
    with log_lock:
        ts = datetime.now().strftime("%H:%M:%S")
        print(f"[{ts}][W{worker_id}] {msg}", flush=True)

def worker(worker_id: int):
    env = os.environ.copy()
    while True:
        try:
            slug, url = q.get_nowait()
        except queue.Empty:
            break

        with results_lock:
            done_count = results["ok"] + results["fail"] + results["skip"]
        log(worker_id, f"→ {slug}  ({done_count+1}/{total})")

        try:
            ret = subprocess.run(
                ["bash", "scripts/upgrade-pack.sh", slug, url],
                env=env,
                timeout=600,   # 10分钟超时
                capture_output=False,
            ).returncode
        except subprocess.TimeoutExpired:
            log(worker_id, f"✗ {slug} 超时（>10分钟），跳过")
            ret = -1

        with results_lock:
            if ret == 0:
                results["ok"] += 1
                log(worker_id, f"✓ {slug} 完成 (共{results['ok']}包)")
            elif ret == 4:
                results["skip"] += 1
                log(worker_id, f"⏭ {slug} 渲染质量门跳过")
            else:
                results["fail"] += 1
                log(worker_id, f"✗ {slug} 失败 exit={ret}")

        q.task_done()

# ── 启动 workers ────────────────────────────────────────────────
threads = []
for i in range(args.workers):
    t = threading.Thread(target=worker, args=(i,), daemon=True)
    t.start()
    threads.append(t)
    time.sleep(1.5)   # 错开启动，避免所有 worker 同时抢同一个站

for t in threads:
    t.join()

# ── 完成统计 ────────────────────────────────────────────────────
total_done = json.load(open("packs-index.json", encoding="utf-8"))
print(f"\n╔══════════════════════════════════════════════════════════╗")
print(f"║  批量完成！ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print(f"║  ✓成功: {results['ok']}  ✗失败: {results['fail']}  ⏭跳过: {results['skip']}")
print(f"║  当前总包数: {len(total_done)}")
print(f"╚══════════════════════════════════════════════════════════╝\n")

# ── 最终 smoke + 完整部署 ───────────────────────────────────────
print("▸ Smoke 验证...")
ret = subprocess.run(["bash", "scripts/smoke.sh"], capture_output=True, text=True)
if ret.returncode == 0:
    print("  ✓ Smoke 通过")
    print("▸ 完整部署（含 SEO 富页）...")
    subprocess.run(["bash", "scripts/deploy.sh"])
else:
    print("  ✗ Smoke 失败：")
    print(ret.stdout[-500:])
    sys.exit(1)

# ── 服务器解压新增包 ────────────────────────────────────────────
print("\n▸ 服务器解压新包...")
subprocess.run(["bash", "scripts/extract-packs-server.sh"],
               capture_output=True)
print("✓ 全流程完成")
