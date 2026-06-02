-- Migration 0005 · 后台任务队列（点击升级 / 刷新主图 → 服务器 cron 自动跑）
--
-- 安全模型：
--   - 后台入队：admin_enqueue_job(口令) —— 口令门，防滥用（job 会触发花钱的 mimo）
--   - 服务器领活：runner_next_job(runner_token) / runner_finish_job(...) —— 用一个独立的
--     runner_token（存 app_config），服务器只拿这个 scoped token，不需要 service_role。
--   - jobs 表 RLS 全关，匿名碰不到，只能走上面这几个 security-definer RPC。
--
-- 应用：整段粘进 Supabase SQL Editor → Run（前置：已跑过 0003 / 0004）。

create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('upgrade', 'refresh')),
  slug        text not null,
  url         text,
  status      text not null default 'pending' check (status in ('pending','running','done','failed')),
  result      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists jobs_status_idx on public.jobs (status, created_at);

alter table public.jobs enable row level security;  -- 默认无 policy = 匿名全拒

-- runner token（服务器领活用）。换成你自己的或保留随机种子。
insert into public.app_config (key, value)
values ('runner_token', encode(gen_random_bytes(16), 'hex'))
on conflict (key) do nothing;

-- ============ 后台入队（口令门）============
create or replace function public.admin_enqueue_job(p_pass text, p_kind text, p_slug text, p_url text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_pass text; v_id uuid;
begin
  select value into v_pass from public.app_config where key = 'admin_passphrase';
  if v_pass is null or p_pass is null or p_pass <> v_pass then raise exception 'unauthorized'; end if;
  if p_kind not in ('upgrade','refresh') then raise exception 'bad kind'; end if;
  -- 去重：同一 (kind,slug) 已有 pending/running 就复用，不重复排队
  select id into v_id from public.jobs
    where slug = p_slug and kind = p_kind and status in ('pending','running')
    order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.jobs (kind, slug, url) values (p_kind, p_slug, p_url) returning id into v_id;
  return v_id;
end; $$;

-- ============ 后台看队列（口令门）============
create or replace function public.admin_list_jobs(p_pass text)
returns setof public.jobs
language plpgsql security definer set search_path = public as $$
declare v_pass text;
begin
  select value into v_pass from public.app_config where key = 'admin_passphrase';
  if v_pass is null or p_pass is null or p_pass <> v_pass then raise exception 'unauthorized'; end if;
  return query select * from public.jobs order by created_at desc limit 100;
end; $$;

-- ============ 服务器领一个活（runner token）============
create or replace function public.runner_next_job(p_token text)
returns public.jobs
language plpgsql security definer set search_path = public as $$
declare v_tok text; v_job public.jobs;
begin
  select value into v_tok from public.app_config where key = 'runner_token';
  if v_tok is null or p_token is null or p_token <> v_tok then raise exception 'unauthorized'; end if;
  -- 原子领取最早的 pending → 标 running
  update public.jobs set status = 'running', updated_at = now()
   where id = (select id from public.jobs where status = 'pending' order by created_at limit 1 for update skip locked)
   returning * into v_job;
  return v_job;  -- 没活时返回 NULL 行
end; $$;

-- ============ 服务器交活（runner token）============
create or replace function public.runner_finish_job(p_token text, p_id uuid, p_status text, p_result text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_tok text;
begin
  select value into v_tok from public.app_config where key = 'runner_token';
  if v_tok is null or p_token is null or p_token <> v_tok then raise exception 'unauthorized'; end if;
  if p_status not in ('done','failed','pending') then raise exception 'bad status'; end if;
  update public.jobs set status = p_status, result = left(coalesce(p_result,''), 1000), updated_at = now()
   where id = p_id;
end; $$;

grant execute on function public.admin_enqueue_job(text,text,text,text) to anon;
grant execute on function public.admin_list_jobs(text)                  to anon;
grant execute on function public.runner_next_job(text)                  to anon;
grant execute on function public.runner_finish_job(text,uuid,text,text) to anon;

-- ============ 应用后看一眼 runner token（服务器要用）============
-- select value from public.app_config where key = 'runner_token';
