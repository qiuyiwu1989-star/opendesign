#!/usr/bin/env bash
# 从服务器拉最新数据库备份到本机 —— 真·异地副本
#
# 服务器上的 /var/backups/opendesign 和数据库在同一块盘上，
# 挡得住误删表、挡不住磁盘/实例挂掉。这个脚本补上那一半：
# 在 Mac 上留一份，和服务器物理隔离。
#
# 用法：./scripts/pull-backup.sh
# 落点：~/OpenDesignBackups/（有意放在仓库外——备份不进 git，也不该被 clean 掉）

set -euo pipefail

HOST=${OD_SSH_HOST:-qiuyiwu-tencent-new}
DEST=${OD_BACKUP_DIR:-$HOME/OpenDesignBackups}
KEEP=20

mkdir -p "$DEST"

echo "▸ 从 $HOST 找最新备份"
# 通配符要在 sudo 起的 shell 里展开：备份目录 700/postgres，
# 远端 ubuntu shell 读不到目录，glob 会原样留着导致永远找不到文件
LATEST=$(ssh -o ConnectTimeout=15 "$HOST" \
  "sudo sh -c 'ls -1t /var/backups/opendesign/daily/*.dump 2>/dev/null' | head -1")
[ -n "$LATEST" ] || { echo "✗ 服务器上没有备份文件——先确认 backup-db.sh 的 cron 装了没"; exit 1; }

BASE=$(basename "$LATEST")
if [ -f "$DEST/$BASE" ]; then
  echo "✓ 本机已有 $BASE，无需重复拉取"
else
  echo "▸ 拉取 $BASE"
  # dump 属 postgres 且目录 700，得先 cat 到管道再落地（避免改服务器上的权限）
  ssh "$HOST" "sudo cat '$LATEST'" > "$DEST/$BASE.part"
  ssh "$HOST" "sudo cat '${LATEST%.dump}.manifest.txt'" > "$DEST/${BASE%.dump}.manifest.txt" 2>/dev/null || true
  mv "$DEST/$BASE.part" "$DEST/$BASE"
  echo "✓ 已存 $DEST/$BASE ($(du -h "$DEST/$BASE" | cut -f1))"
fi

# 本机也轮转，别无限堆
ls -1t "$DEST"/*.dump 2>/dev/null | tail -n +$((KEEP+1)) | while read -r f; do
  rm -f "$f" "${f%.dump}.manifest.txt"
done

echo
echo "本机备份（最新 5 份）："
ls -1lht "$DEST"/*.dump 2>/dev/null | head -5 | awk '{printf "  %s  %s %s %s\n", $5, $6, $7, $9}'
