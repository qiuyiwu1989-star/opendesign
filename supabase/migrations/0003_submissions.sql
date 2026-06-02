-- Migration 0003 · Submissions（投稿合并进收藏 · 需求驱动策展）
-- 模型：用户不再"公开投稿"。用户收藏/推荐一个 URL → 进 submissions 队列。
--       用户在自己的收藏页看得到（localStorage），我们在 /admin 后台看全部聚合，
--       决定是否跑 ingest 管线、发布到广场（status=completed 的站点才进 build）。
--
-- 应用方式：整段粘进 Supabase Dashboard → SQL Editor → Run（重复执行安全）。
-- ⚠️ 跑完后务必改掉默认 admin 口令（见文件末尾说明）。

create extension if not exists pgcrypto;

-- ============ submissions 表 ============
create table if not exists public.submissions (
  id          uuid        primary key default gen_random_uuid(),
  url         text        not null,
  host        text        not null,                       -- 归一化域名，用来聚合需求/去重
  note        text,                                        -- 用户备注（可选）
  visitor_id  uuid        not null,
  status      text        not null default 'pending',      -- pending | accepted | rejected | published
  created_at  timestamptz not null default now()
);

create index if not exists submissions_host_idx   on public.submissions (host);
create index if not exists submissions_status_idx on public.submissions (status);

alter table public.submissions enable row level security;

-- 任何访客可以提交一条请求；但不能 select / update / delete（读走 admin RPC）
drop policy if exists "anyone can submit" on public.submissions;
create policy "anyone can submit"
  on public.submissions for insert to anon
  with check (true);

-- ============ 私有 admin 配置（口令） ============
-- 开 RLS、不加任何 policy → anon 完全读不到这张表。
-- 只有下面 security definer 的函数（以 owner 身份运行）能读它。
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

alter table public.app_config enable row level security;

-- 种一个占位口令（部署后请改成你自己的强口令，见末尾）
insert into public.app_config (key, value)
  values ('admin_passphrase', 'CHANGE-ME-opendesign-2026')
  on conflict (key) do nothing;

-- ============ Admin RPC（口令校验 + 绕过 RLS 读写） ============
-- security definer：以函数 owner（postgres）身份运行，绕过 RLS；用口令把门。
-- 这样 anon publishable key 也能调，但没口令拿不到任何东西。

create or replace function public.admin_list_submissions(p_pass text)
returns table (
  id          uuid,
  url         text,
  host        text,
  note        text,
  visitor_id  uuid,
  status      text,
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
  -- 严格校验：口令行缺失(v_pass null) / 入参为空 / 不匹配 —— 任一情况都拒绝。
  -- （避免子查询返回 NULL 时 `p_pass <> NULL` 为 NULL 导致 if 不触发的鉴权绕过）
  if v_pass is null or p_pass is null or p_pass <> v_pass then
    raise exception 'unauthorized';
  end if;

  return query
    select
      s.id, s.url, s.host, s.note, s.visitor_id, s.status, s.created_at,
      (select count(distinct s2.visitor_id)::int
         from public.submissions s2 where s2.host = s.host) as host_voters,
      (select count(*)::int
         from public.submissions s2 where s2.host = s.host) as host_total
    from public.submissions s
    order by s.created_at desc;
end;
$$;

create or replace function public.admin_update_status(p_pass text, p_id uuid, p_status text)
returns void
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
  if p_status not in ('pending', 'accepted', 'rejected', 'published') then
    raise exception 'bad status';
  end if;
  update public.submissions set status = p_status where id = p_id;
end;
$$;

grant execute on function public.admin_list_submissions(text)        to anon;
grant execute on function public.admin_update_status(text, uuid, text) to anon;

-- ============ 部署后必做 ============
-- 1) 改 admin 口令（换成你自己的强口令）：
--      update public.app_config set value = '你的强口令' where key = 'admin_passphrase';
-- 2) /admin 页面登录时输入这个口令即可（口令只存浏览器 sessionStorage，不进 git）。
-- 3) 验证：select * from public.submissions;  —— 应该能看到用户提交的请求。
