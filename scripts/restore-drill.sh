#!/usr/bin/env bash
# 恢复演练：把最新 dump 恢复到临时库，逐表核对行数，然后销毁临时库。
#
# 没验证过能还原的备份不算备份。这个脚本要定期跑（建议每月一次），
# 跑的是真的 pg_restore，不是"看文件在不在"。
#
# 用法（服务器上）：bash /home/ubuntu/opendesign/scripts/restore-drill.sh
# 全程只碰 opendesign_restoretest 这个临时库，不动生产库。
set -euo pipefail
Q="select relname || ' ' || n_live_tup from pg_stat_user_tables order by relname"
LATEST=$(sudo sh -c 'ls -1t /var/backups/opendesign/daily/*.dump' | head -1)
echo "▸ 演练对象：$(basename "$LATEST")"
sudo -u postgres dropdb --if-exists opendesign_restoretest 2>/dev/null
sudo -u postgres createdb opendesign_restoretest
sudo -u postgres pg_restore -d opendesign_restoretest --no-owner "$LATEST"
sudo -u postgres psql -q -d opendesign_restoretest -c "analyze"
sudo -u postgres psql -tAq -d opendesign_restoretest -c "$Q" > /tmp/restored.txt
sudo sh -c "grep -v '^#' '${LATEST%.dump}.manifest.txt'" > /tmp/manifest.txt
echo
printf "  %-14s %8s %8s   %s\n" "表" "备份清单" "恢复后" "一致"
bad=0
while IFS= read -r line; do
  t=${line%% *}; n=${line##* }
  m=$(grep "^$t " /tmp/restored.txt | awk '{print $2}')
  if [ "$n" = "$m" ]; then s="✓"; else s="✗"; bad=$((bad+1)); fi
  printf "  %-14s %8s %8s   %s\n" "$t" "$n" "${m:-缺失}" "$s"
done < /tmp/manifest.txt
sudo -u postgres dropdb opendesign_restoretest
rm -f /tmp/restored.txt /tmp/manifest.txt
echo
if [ $bad -eq 0 ]; then echo "✓ 恢复演练通过：备份可还原，逐表行数一致，演练库已清理"
else echo "✗ 有 $bad 张表对不上"; exit 1; fi
