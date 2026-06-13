#!/usr/bin/env python3
"""
把所有 pack 文件（ZIP + 截图 + 文档）迁移到腾讯云 COS，
同步更新 packs-index.json 里的 URL → COS 地址。

迁移后 VPS /packs/ 目录可释放 ~16GB 磁盘，解决磁盘 100% 问题。
新包由 upgrade-pack.sh 直接上传到 COS（deploy 不再需要 scp 大文件到 VPS）。

用法：
  # dry-run（只看哪些文件会上传，不实际上传）
  python3 scripts/migrate-to-cos.py --dry-run

  # 正式迁移（上传所有文件 + 更新 packs-index.json）
  python3 scripts/migrate-to-cos.py

  # 只迁移某个 slug
  python3 scripts/migrate-to-cos.py --slug linear

  # 上传完成后更新 packs-index.json URL（让前端/SEO页用 COS URL）
  python3 scripts/migrate-to-cos.py --update-index

依赖：pip3 install boto3  （boto3 支持 S3 兼容 API，腾讯 COS 完全兼容）
凭证：从 ~/.opendesign-runner.env 读取 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION
"""
import argparse
import glob
import json
import os
import sys
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

ROOT = Path(__file__).parent.parent

# ── 加载凭证 ──────────────────────────────────────────────────
def load_env():
    env_file = Path.home() / ".opendesign-runner.env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

load_env()

SECRET_ID  = os.environ.get("COS_SECRET_ID", "")
SECRET_KEY = os.environ.get("COS_SECRET_KEY", "")
BUCKET     = os.environ.get("COS_BUCKET", "opendesign-1254041526")
REGION     = os.environ.get("COS_REGION", "ap-shanghai")
COS_BASE   = os.environ.get("COS_BASE_URL", f"https://{BUCKET}.cos.{REGION}.myqcloud.com")

if not SECRET_ID or not SECRET_KEY:
    print("✗ COS_SECRET_ID / COS_SECRET_KEY 未设置，请先在 ~/.opendesign-runner.env 里配置")
    sys.exit(1)

# ── boto3 S3 客户端（COS S3 兼容端点）────────────────────────
try:
    import boto3
    from botocore.config import Config
except ImportError:
    print("✗ 需要 boto3：pip3 install boto3")
    sys.exit(1)

# COS S3 兼容 API：boto3 virtual-style 时会自动把 bucket 拼到 endpoint 前面
# endpoint_url 用基础域（不含 bucket），boto3 自动构造 <bucket>.cos.<region>.myqcloud.com
endpoint = f"https://cos.{REGION}.myqcloud.com"
s3 = boto3.client(
    "s3",
    region_name=REGION,
    endpoint_url=endpoint,
    aws_access_key_id=SECRET_ID,
    aws_secret_access_key=SECRET_KEY,
    config=Config(
        signature_version="s3v4",
        s3={"addressing_style": "virtual"},
    ),
)

ap = argparse.ArgumentParser()
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--slug", default="")
ap.add_argument("--ext", default="", help="只上传指定扩展名，如 --ext .zip")
ap.add_argument("--force", action="store_true", help="强制重传（忽略 head_object 存在检查）")
ap.add_argument("--update-index", action="store_true", help="上传后把 packs-index.json URL 改为 COS")
ap.add_argument("--workers", type=int, default=8, help="并发上传线程数")
args = ap.parse_args()

INDEX_PATH = ROOT / "packs-index.json"
packs_index = json.loads(INDEX_PATH.read_text(encoding="utf-8")) if INDEX_PATH.exists() else {}

# ── 构建上传任务列表 ──────────────────────────────────────────
LOCAL_PACKS = ROOT / "extract" / "extracts"   # 本地 extract 目录
tasks = []  # (local_path, cos_key, slug)

slugs = [args.slug] if args.slug else list(packs_index.keys())

ALLOWED_EXT = args.ext.strip() if args.ext else ""

for slug in slugs:
    pack = packs_index.get(slug)
    if not pack:
        continue

    # ZIP 文件（本地有 extract/extracts/<slug>-design-pack.zip）
    zip_local = ROOT / "extract" / "extracts" / f"{slug}-design-pack.zip"
    if zip_local.exists():
        if not ALLOWED_EXT or zip_local.suffix == ALLOWED_EXT:
            tasks.append((zip_local, f"packs/{slug}/{zip_local.name}", slug))

    # 各文件（summary.json, fonts.json, *.png, DESIGN_SPEC.md 等）
    exdir = LOCAL_PACKS / slug
    if exdir.is_dir():
        for f in exdir.iterdir():
            if f.is_file() and f.suffix in (".png", ".json", ".md", ".zip"):
                if not ALLOWED_EXT or f.suffix == ALLOWED_EXT:
                    tasks.append((f, f"packs/{slug}/{f.name}", slug))

print(f"待上传: {len(tasks)} 个文件  Workers: {args.workers}")
if args.dry_run:
    for local, key, slug in tasks[:20]:
        print(f"  {slug:25} {key}")
    if len(tasks) > 20:
        print(f"  ... 还有 {len(tasks)-20} 个")
    print("[dry-run] 未实际上传")
    sys.exit(0)

# ── 并发上传 ─────────────────────────────────────────────────
lock = threading.Lock()
ok = 0; fail = 0; skip = 0

CONTENT_TYPES = {
    ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg",
    ".json": "application/json", ".md": "text/markdown; charset=utf-8",
    ".zip": "application/zip",
}

def upload_one(task):
    global ok, fail, skip
    local, key, slug = task
    ct = CONTENT_TYPES.get(local.suffix, "application/octet-stream")
    try:
        # 检查是否已存在（跳过重复上传；--force 时强制重传）
        if not args.force:
            try:
                s3.head_object(Bucket=BUCKET, Key=key)
                with lock: skip += 1
                return True
            except Exception:
                pass

        # 用 put_object + 显式 ContentLength，避免 COS multipart UploadPart MissingContentLength 错误
        # 对 ZIP 等大文件尤其必要（boto3 默认对 >8MB 文件走 multipart，COS 兼容层会报错）
        file_size = local.stat().st_size
        with open(str(local), "rb") as fh:
            s3.put_object(
                Bucket=BUCKET,
                Key=key,
                Body=fh,
                ContentType=ct,
                CacheControl="public,max-age=31536000",
                ContentLength=file_size,
            )
        with lock: ok += 1
        return True
    except Exception as e:
        with lock:
            fail += 1
            print(f"  ✗ {key}: {e}")
        return False

with ThreadPoolExecutor(max_workers=args.workers) as pool:
    futs = {pool.submit(upload_one, t): t for t in tasks}
    done = 0
    for fut in as_completed(futs):
        done += 1
        if done % 50 == 0:
            with lock:
                print(f"  进度: {done}/{len(tasks)}  ✓{ok} ✗{fail} ⏭{skip}")

print(f"\n✓ 上传完成: ✓{ok} 成功  ✗{fail} 失败  ⏭{skip} 已存在跳过")

# ── 更新 packs-index.json URL → COS ──────────────────────────
if args.update_index or fail == 0:
    print("\n▸ 更新 packs-index.json → COS URL...")
    updated = 0
    for slug, pack in packs_index.items():
        zip_file = pack.get("zipFile", "")
        if zip_file:
            pack["zipUrl"]    = f"{COS_BASE}/packs/{slug}/{zip_file}"
            pack["folderUrl"] = f"{COS_BASE}/packs/{slug}/"
            pack["agentUrl"]  = f"{COS_BASE}/packs/{slug}/"
            pack["specPreviewUrl"] = f"{COS_BASE}/packs/{slug}/DESIGN_SPEC.md"
            # 更新 files 列表里每个文件的 URL
            for f in pack.get("files", []):
                f["url"] = f"{COS_BASE}/packs/{slug}/{f['name']}"
            updated += 1
    INDEX_PATH.write_text(json.dumps(packs_index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  ✓ 已更新 {updated} 个条目的 URL → COS")
    print(f"  下一步：python3 scripts/build.py && bash scripts/deploy.sh")

print(f"\nCOS bucket: {COS_BASE}/packs/")
