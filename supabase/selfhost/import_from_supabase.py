#!/usr/bin/env python3
"""把 Supabase 导出的 JSON 灌进自建 PG。

设计要点:
- 幂等:全部 ON CONFLICT DO NOTHING,重复跑不会翻倍
- 保真:逐表核对导入前后行数,对不上就报错退出(别静默丢数据)
- 序列对齐:若有 bigserial 表,导入后必须 setval(本库主键全是 uuid,暂不需要)
- app_config 特殊处理:【不覆盖】本地已种入的强随机口令/token,
  Supabase 里那份是旧的(而且 admin_passphrase 可能还是 CHANGE-ME 默认值)

用法(服务器上):
  python3 import_from_supabase.py /tmp/sbdump
"""
import json
import subprocess
import sys
from pathlib import Path

DB = "opendesign"
# 导入顺序:被引用的表在前(虽然目前没有外键约束,保持习惯)
TABLES = ["saves", "likes", "sync_codes", "submissions", "jobs", "discoveries", "run_logs"]
# 有自增序列、导入后需要 setval 的表。
# 注意:submissions/jobs/discoveries/run_logs 的主键是 uuid(gen_random_uuid()),
# 不是 bigserial,所以【没有序列要对齐】——留空是正确的,不是漏了。
SERIAL_TABLES: dict[str, str] = {}


def psql(sql: str, capture=True) -> str:
    # SQL 走 stdin 而不是 -c:大表的 JSON payload 塞进 argv 会触发
    # OSError [Errno 7] Argument list too long(1741 行 run_logs 就超了)
    r = subprocess.run(
        ["sudo", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-tAq", "-d", DB],
        input=sql, capture_output=capture, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(f"psql 失败: {(r.stderr or '')[:400]}")
    return (r.stdout or "").strip()


def count(table: str) -> int:
    return int(psql(f"select count(*) from public.{table}") or 0)


def import_table(dump_dir: Path, table: str) -> tuple[int, int, int]:
    """返回 (源行数, 导入前, 导入后)"""
    f = dump_dir / f"{table}.json"
    if not f.exists():
        print(f"  ⚠ {table}: 无导出文件,跳过")
        return (0, 0, 0)
    rows = json.loads(f.read_text(encoding="utf-8"))
    before = count(table)
    if not rows:
        return (0, before, before)

    # 只取目标表真实存在的列(Supabase 那边可能有本地没有的列),并查出每列类型——
    # jsonb 的 ->> 一律返回 text,PG 不做隐式转换,必须显式 cast 到目标类型
    # (否则报 column "created_at" is of type timestamptz but expression is of type text)
    typerows = psql(
        f"select column_name||'|'||data_type from information_schema.columns "
        f"where table_schema='public' and table_name='{table}'"
    ).splitlines()
    coltype = dict(line.split("|", 1) for line in typerows if "|" in line)

    cols = [c for c in sorted({k for r in rows for k in r.keys()}) if c in coltype]
    if not cols:
        print(f"  ⚠ {table}: 导出列与本地表对不上,跳过")
        return (len(rows), before, before)

    payload = json.dumps(rows, ensure_ascii=False).replace("'", "''")
    collist = ", ".join(f'"{c}"' for c in cols)

    def cast_expr(c: str) -> str:
        t = coltype[c]
        # ARRAY / json 类走 jsonb 提取,其余按声明类型显式 cast
        if t == "ARRAY":
            return f"""(select array_agg(x #>> '{{}}') from jsonb_array_elements(e->'{c}') x)"""
        if t in ("json", "jsonb"):
            return f"(e->'{c}')::{t}"
        return f"(e->>'{c}')::{t}"

    selectlist = ", ".join(cast_expr(c) for c in cols)
    sql = f"""
      insert into public.{table} ({collist})
      select {selectlist}
      from jsonb_array_elements('{payload}'::jsonb) as e
      on conflict do nothing;
    """
    psql(sql)
    return (len(rows), before, count(table))


def main():
    dump_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/sbdump")
    print(f"▸ 从 {dump_dir} 导入到 {DB}\n")
    problems = []
    for t in TABLES:
        src, before, after = import_table(dump_dir, t)
        added = after - before
        # 幂等重跑时 added 会是 0(数据已在),只有首次导入才要求 added == src
        ok = (added == src) or (before > 0 and after >= src)
        flag = "✓" if ok else "✗"
        print(f"  {flag} {t:<14} 源 {src:>5} | 导入前 {before:>5} → 后 {after:>5} (+{added})")
        if not ok:
            problems.append(f"{t}: 源 {src} 但只增加了 {added}")

    # 序列对齐(当前全库主键都是 uuid,这里是空转;将来若加 bigserial 表再填 SERIAL_TABLES)
    print()
    for t, pk in SERIAL_TABLES.items():
        try:
            seq = psql(f"select pg_get_serial_sequence('public.{t}','{pk}')")
            if seq:
                psql(f"select setval('{seq}', coalesce((select max({pk}) from public.{t}), 1))")
                print(f"  ✓ 序列对齐 {t}.{pk}")
        except Exception as e:
            problems.append(f"{t} 序列对齐失败: {e}")

    # app_config 不动:本地已种入强随机凭据,Supabase 那份是旧的
    print("\n  ⓘ app_config 有意跳过——本地已种强随机口令/token,不被旧值覆盖")

    if problems:
        print("\n✗ 有问题:")
        for p in problems:
            print(f"    {p}")
        sys.exit(1)
    print("\n✓ 全部导入并核对通过")


if __name__ == "__main__":
    main()
