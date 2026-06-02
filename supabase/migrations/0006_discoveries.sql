-- Migration 0006 · 自动发现队列（爬虫定期发现 → 后台审阅 → 一键收录）
--
-- 流程：discover.py（爬多源）→ runner_add_discovery 写入 discoveries 表
--      → 后台 admin_list_discoveries 审阅 → admin_review_discovery('approve')
--      → 写一条 jobs(kind='collect') → job_runner 跑 upgrade-pack → 完整包上线
--
-- 安全：写入用 runner_token（爬虫端，跟 0005 同一把）；审阅用 admin 口令。
-- 应用：整段粘进 Supabase SQL Editor → Run（前置：0003 / 0004 / 0005 已跑）。

create table if not exists public.discoveries (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,
  host        text not null unique,          -- 同一域名只发现一次
  slug        text not null,                  -- 收录用的 slug（discover.py 算好）
  title       text,
  image       text,                           -- 缩略图（thum.io 或源图）
  source      text,                           -- 'hn' | 'awesome' | 'land-book' …
  score       int  default 0,                 -- 来源信号（HN points 等）
  status      text not null default 'pending' check (status in ('pending','approved','ignored')),
  created_at  timestamptz not null default now()
);
create index if not exists discoveries_status_idx on public.discoveries (status, score desc, created_at desc);
alter table public.discoveries enable row level security;   -- 默认无 policy = 匿名全拒

-- ============ 爬虫写入（runner_token）============
create or replace function public.runner_add_discovery(
  p_token text, p_url text, p_host text, p_slug text, p_title text, p_image text, p_source text, p_score int)
returns text language plpgsql security definer set search_path = public as $$
declare v_tok text;
begin
  select value into v_tok from public.app_config where key = 'runner_token';
  if v_tok is null or p_token is null or p_token <> v_tok then raise exception 'unauthorized'; end if;
  insert into public.discoveries (url, host, slug, title, image, source, score)
  values (p_url, p_host, p_slug, p_title, p_image, p_source, coalesce(p_score,0))
  on conflict (host) do nothing;
  if found then return 'added'; else return 'dup'; end if;
end; $$;

-- ============ 后台审阅列表（口令）============
create or replace function public.admin_list_discoveries(p_pass text, p_status text)
returns setof public.discoveries language plpgsql security definer set search_path = public as $$
declare v_pass text;
begin
  select value into v_pass from public.app_config where key = 'admin_passphrase';
  if v_pass is null or p_pass is null or p_pass <> v_pass then raise exception 'unauthorized'; end if;
  return query
    select * from public.discoveries
    where (p_status is null or p_status = 'all' or status = p_status)
    order by score desc, created_at desc limit 200;
end; $$;

-- ============ 后台审阅动作（口令）：approve → 入收录队列；ignore → 忽略 ============
create or replace function public.admin_review_discovery(p_pass text, p_id uuid, p_action text)
returns text language plpgsql security definer set search_path = public as $$
declare v_pass text; v_d public.discoveries;
begin
  select value into v_pass from public.app_config where key = 'admin_passphrase';
  if v_pass is null or p_pass is null or p_pass <> v_pass then raise exception 'unauthorized'; end if;
  if p_action not in ('approve','ignore') then raise exception 'bad action'; end if;
  select * into v_d from public.discoveries where id = p_id;
  if v_d.id is null then raise exception 'not found'; end if;

  if p_action = 'ignore' then
    update public.discoveries set status = 'ignored' where id = p_id;
    return 'ignored';
  end if;

  -- approve：写一条 collect 任务（去重：同 slug 已 pending/running 就复用），并标 approved
  if not exists (select 1 from public.jobs where slug = v_d.slug and kind = 'collect' and status in ('pending','running')) then
    insert into public.jobs (kind, slug, url) values ('collect', v_d.slug, v_d.url);
  end if;
  update public.discoveries set status = 'approved' where id = p_id;
  return 'approved → 已入收录队列';
end; $$;

-- jobs 表的 kind 约束需要允许 'collect'（0005 只允许 upgrade/refresh）—— 放开
alter table public.jobs drop constraint if exists jobs_kind_check;
alter table public.jobs add  constraint jobs_kind_check check (kind in ('upgrade','refresh','collect'));

grant execute on function public.runner_add_discovery(text,text,text,text,text,text,text,int) to anon;
grant execute on function public.admin_list_discoveries(text,text)                            to anon;
grant execute on function public.admin_review_discovery(text,uuid,text)                       to anon;

-- 验证：select status, count(*) from public.discoveries group by status;
