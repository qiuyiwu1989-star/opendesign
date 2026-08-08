-- 自建 PG:显式表级授权(跑在 schema.sql + 全部 migrations 之后)
--
-- Supabase 会给 anon 自动授全表权限,再靠 RLS 收窄。自建 PG 没这个默认,
-- 必须显式 grant——而且要和 0009 收紧后的 policy 严格对应,不能多给。
--
-- 依据(从存活的 policy 反推,已核对):
--   saves       select + insert   (delete 已被 0009 收回,改走 remove_save RPC)
--   likes       select + insert   (同上)
--   submissions insert            (只能提交,读要管理员口令走 RPC)
--   sync_codes  insert            (查/续期已被 0009 收回,改走 lookup/touch RPC)
--   其余表      无直接权限,一律经 security definer RPC

grant select, insert on public.saves       to anon;
grant select, insert on public.likes       to anon;
grant insert          on public.submissions to anon;
grant insert          on public.sync_codes  to anon;

-- 聚合视图(前端读全局计数用)
grant select on public.site_like_counts to anon;
grant select on public.site_save_counts to anon;

-- 明确确认这些表 anon 一点都碰不到(只能经 RPC)
revoke all on public.app_config  from anon;
revoke all on public.jobs        from anon;
revoke all on public.discoveries from anon;
revoke all on public.run_logs    from anon;

-- 序列:insert 时若有 bigserial 需要 usage
do $$
declare s text;
begin
  for s in select sequence_name from information_schema.sequences where sequence_schema='public'
  loop
    execute format('grant usage, select on sequence public.%I to anon', s);
  end loop;
end
$$;

-- ── 自检:打印 anon 的最终权限,人工核对一眼 ──
select table_name, string_agg(privilege_type, ', ' order by privilege_type) as anon_privs
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
group by table_name
order by table_name;
