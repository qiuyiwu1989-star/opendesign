-- Migration 0004 · 区分两类队列请求
-- kind='collect'：请求收录一个还没在库里的新站（用户推荐 URL）
-- kind='pack'   ：请求为一个已收录的站，用 mimo 生成「完整设计系统包」（带真截图 + computed styles）
--
-- 应用方式：整段粘进 Supabase Dashboard → SQL Editor → Run（重复执行安全）。
-- 前置：已跑过 0003_submissions.sql。

-- ============ 加列 ============
alter table public.submissions add column if not exists kind text not null default 'collect';
alter table public.submissions add column if not exists slug text;   -- pack 请求时 = 已收录站的 slug

create index if not exists submissions_kind_idx on public.submissions (kind);

-- ============ 重建 admin_list_submissions：带 kind + slug ============
create or replace function public.admin_list_submissions(p_pass text)
returns table (
  id          uuid,
  url         text,
  host        text,
  note        text,
  visitor_id  uuid,
  status      text,
  kind        text,
  slug        text,
  created_at  timestamptz,
  host_voters int,
  host_total  int
)
language plpgsql
security definer
set search_path = public
as $$
declare v_pass text;
begin
  select value into v_pass from public.app_config where key = 'admin_passphrase';
  if v_pass is null or p_pass is null or p_pass <> v_pass then
    raise exception 'unauthorized';
  end if;

  return query
    select
      s.id, s.url, s.host, s.note, s.visitor_id, s.status, s.kind, s.slug, s.created_at,
      (select count(distinct s2.visitor_id)::int
         from public.submissions s2 where s2.host = s.host and s2.kind = s.kind) as host_voters,
      (select count(*)::int
         from public.submissions s2 where s2.host = s.host and s2.kind = s.kind) as host_total
    from public.submissions s
    order by s.created_at desc;
end;
$$;

grant execute on function public.admin_list_submissions(text) to anon;

-- ============ Done ============
-- 验证：select kind, count(*) from public.submissions group by kind;
