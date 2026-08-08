#!/usr/bin/env bash
# opendesign 库定时备份 · 由服务器 crontab 调用
#
# 为什么必须有这个：迁到自建 PG 之前，备份是 Supabase 平台顺手替我们做的；
# 迁完之后没人做了，而库里 saves/likes/submissions 是用户产生的、丢了补不回来
# （sites 数据在 git 里，run_logs/jobs 丢了顶多少段历史，saves 丢了就是真丢）。
#
# 设计取舍：
# - -Fc 自定义格式：压缩、支持选择性恢复，比 plain SQL 更实用
# - 备份完立刻 pg_restore -l 验一遍：列不出目录的 dump 不叫备份，叫一个文件
# - 同时落一份 manifest 记录各表行数：恢复后可以逐表核对，而不是"看着像成功了"
# - 保留 14 日 + 8 周 + 6 月，10MB 的库这点开销可以忽略
# - 异地：服务器上没有 COS 凭据，有就传、没有就明确记一行日志说没传，
#   绝不假装自己有异地副本（本机副本挡不住磁盘挂掉）
#
# 安装（服务器上跑一次）：
#   chmod +x /home/ubuntu/opendesign/scripts/backup-db.sh
#   ( crontab -l 2>/dev/null; echo '40 3 * * * /home/ubuntu/opendesign/scripts/backup-db.sh >> /var/log/opendesign-backup.log 2>&1' ) | crontab -
# 查日志：tail -f /var/log/opendesign-backup.log
# 恢复：见本文件末尾的「恢复手册」

set -euo pipefail

DB=opendesign
DIR=/var/backups/opendesign
KEEP_DAILY=14
KEEP_WEEKLY=8
KEEP_MONTHLY=6

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*"; }
die() { log "✗ $*"; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
DOW=$(date +%u)     # 7 = 周日
DOM=$(date +%d)

sudo mkdir -p "$DIR"/{daily,weekly,monthly}
sudo chown -R postgres:postgres "$DIR"
sudo chmod 700 "$DIR"

OUT="$DIR/daily/${DB}-${STAMP}.dump"
MANIFEST="$DIR/daily/${DB}-${STAMP}.manifest.txt"

log "▸ 开始备份 $DB"

# ── 1. dump ───────────────────────────────────────────────────
sudo -u postgres pg_dump -Fc -Z6 -d "$DB" -f "$OUT" \
  || die "pg_dump 失败"
SIZE=$(sudo stat -c %s "$OUT")
[ "$SIZE" -gt 10240 ] || die "dump 只有 ${SIZE}B，明显不对"

# ── 2. 验证：列不出目录的 dump 不算备份 ────────────────────────
TBLS=$(sudo -u postgres pg_restore -l "$OUT" 2>/dev/null | grep -c "TABLE DATA" || true)
[ "$TBLS" -ge 5 ] || die "pg_restore -l 只看到 $TBLS 张表，dump 可能损坏"

# ── 3. manifest：恢复后拿它逐表核对行数 ────────────────────────
{
  echo "# opendesign 备份清单  $(ts)"
  echo "# dump: $(basename "$OUT")  size=${SIZE}B  tables=${TBLS}"
  echo "# 恢复后用它核对：sudo -u postgres psql -d opendesign -c 'select relname,n_live_tup from pg_stat_user_tables order by 1'"
  sudo -u postgres psql -tAq -d "$DB" -c \
    "select relname||' '||n_live_tup from pg_stat_user_tables order by relname"
} | sudo tee "$MANIFEST" >/dev/null

log "✓ dump 完成 ${SIZE}B，${TBLS} 张表已验证可列目录"

# ── 4. 周/月副本（硬链接，不额外占盘）──────────────────────────
# 注意：这里必须用 if，不能写 `[ cond ] && cmd`——set -e 下条件为假时
# 整条 && 链返回 1，会把脚本直接干掉（第一版就是这么在非周日静默中断的）
if [ "$DOW" = "7" ]; then
  sudo ln -f "$OUT" "$DIR/weekly/${DB}-${STAMP}.dump"
  log "  ↳ 周副本"
fi
if [ "$DOM" = "01" ]; then
  sudo ln -f "$OUT" "$DIR/monthly/${DB}-${STAMP}.dump"
  log "  ↳ 月副本"
fi

# ── 5. 轮转 ───────────────────────────────────────────────────
# 备份目录是 700/postgres，通配符必须在 sudo 起的 shell 里展开——
# 在当前 ubuntu shell 里展开会因为读不到目录而原样留着 `*.dump`，
# 结果 ls 失败、计数为 0、prune 返回 1，又被 set -e 静默干掉。
list_dumps() { sudo sh -c "ls -1t '$DIR/$1'/*.dump 2>/dev/null" || true; }
prune() {
  local sub=$1 keep=$2 n
  n=$(list_dumps "$sub" | wc -l)
  if [ "$n" -gt "$keep" ]; then
    list_dumps "$sub" | tail -n +$((keep+1)) | while read -r f; do
      sudo rm -f "$f" "${f%.dump}.manifest.txt"
    done
    log "  ↳ $sub 轮转：$n → $keep"
  fi
  return 0   # 函数最后一句是条件判断时会把返回值带出去，显式收口
}
prune daily "$KEEP_DAILY"
prune weekly "$KEEP_WEEKLY"
prune monthly "$KEEP_MONTHLY"

# ── 6. 异地副本（有 COS 凭据才做；没有就明说没做）──────────────
ENV_FILE=/home/ubuntu/.opendesign-runner.env
if [ -f "$ENV_FILE" ] && grep -q '^COS_SECRET_ID=' "$ENV_FILE" 2>/dev/null; then
  if python3 -c "import boto3" 2>/dev/null; then
    python3 "$(dirname "$0")/backup-db-offsite.py" "$OUT" && log "✓ 已上传 COS 异地副本" \
      || log "⚠ COS 上传失败，本机副本仍在"
  else
    log "⚠ 无 boto3，跳过异地上传（pip3 install boto3）"
  fi
else
  log "⚠ 无 COS 凭据 → 只有本机副本。磁盘挂掉即全丢，请定期从 Mac 执行："
  log "    ./scripts/pull-backup.sh"
fi

log "✓ 备份完成：$OUT"
echo

# ══════════════════════════════════════════════════════════════
# 恢复手册
# ──────────────────────────────────────────────────────────────
# 1) 整库恢复到一个新库（推荐，先验证再切换，别直接盖生产）：
#      sudo -u postgres createdb opendesign_restore
#      sudo -u postgres pg_restore -d opendesign_restore --no-owner \
#        /var/backups/opendesign/daily/opendesign-<STAMP>.dump
#      # 核对行数，和同名 .manifest.txt 对得上才算成功
#      sudo -u postgres psql -tAq -d opendesign_restore \
#        -c "select relname||' '||n_live_tup from pg_stat_user_tables order by relname"
#
# 2) 确认无误后切换：
#      sudo systemctl stop opendesign-postgrest
#      sudo -u postgres psql -c 'alter database opendesign rename to opendesign_old'
#      sudo -u postgres psql -c 'alter database opendesign_restore rename to opendesign'
#      # 角色权限跟着库走，但 anon/authenticator 是全局角色，无需重建
#      sudo systemctl start opendesign-postgrest
#      curl -s https://opendesign.cc/db/rest/v1/likes?select=site_id\&limit=1
#
# 3) 只恢复单表（比如误删了 saves）：
#      sudo -u postgres pg_restore -d opendesign --data-only -t saves <dump>
# ══════════════════════════════════════════════════════════════
