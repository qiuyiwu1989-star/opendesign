-- 网页美学 Supabase Schema
-- 用法：把整段粘到 Supabase Dashboard → SQL Editor → Run。
-- 重复执行安全（建表/视图/策略都带 if not exists 或先 drop）。

-- ============ Tables ============

create table if not exists public.saves (
  visitor_id uuid not null,
  site_id    text not null,
  created_at timestamptz not null default now(),
  primary key (visitor_id, site_id)
);

create table if not exists public.likes (
  visitor_id uuid not null,
  site_id    text not null,
  created_at timestamptz not null default now(),
  primary key (visitor_id, site_id)
);

create index if not exists saves_site_idx on public.saves (site_id);
create index if not exists likes_site_idx on public.likes (site_id);

-- ============ Aggregate Views ============

create or replace view public.site_like_counts as
  select site_id, count(*)::int as like_count
  from public.likes
  group by site_id;

create or replace view public.site_save_counts as
  select site_id, count(*)::int as save_count
  from public.saves
  group by site_id;

-- ============ Row Level Security ============
-- 这是个人精选站，没有 auth；所有访客都用匿名 visitor_id。
-- 策略原则：任何人可读（用于全局计数），任何人可写自己 visitor_id 名下的行。
-- 后续若加 auth，可在这里把 to anon 改为 to authenticated 并加 user_id 校验。

alter table public.saves enable row level security;
alter table public.likes enable row level security;

drop policy if exists "saves are public" on public.saves;
drop policy if exists "anyone can save" on public.saves;
drop policy if exists "anyone can unsave" on public.saves;
drop policy if exists "likes are public" on public.likes;
drop policy if exists "anyone can like" on public.likes;
drop policy if exists "anyone can unlike" on public.likes;

create policy "saves are public"   on public.saves for select to anon using (true);
create policy "anyone can save"    on public.saves for insert to anon with check (true);
create policy "anyone can unsave"  on public.saves for delete to anon using (true);

create policy "likes are public"   on public.likes for select to anon using (true);
create policy "anyone can like"    on public.likes for insert to anon with check (true);
create policy "anyone can unlike"  on public.likes for delete to anon using (true);

-- ============ Grants for views ============

grant select on public.site_like_counts to anon;
grant select on public.site_save_counts to anon;

-- ============ Sync Code（v0.2 · 收藏跨设备携带） ============
-- 设计：每个 visitor 有且仅有 1 个固定的 code（visitor_id 是 PK，1:1）
-- 流程：
--   Device A 第一次点「我的同步码」→ 表里 INSERT (visitor_id_A, 随机 code)；之后任何时候点都返回同一个 code
--   Device B 输入这个 code → SELECT visitor_id WHERE code=? → 替换 Device B 的 localStorage → reload
-- 安全考量：拿到 code 的人都能看到那个 visitor 的收藏，所以 UI 里要提醒不要外发。

drop table if exists public.sync_codes cascade;

create table public.sync_codes (
  visitor_id   uuid        primary key,
  code         text        not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.sync_codes enable row level security;

create policy "anon can lookup sync code"
  on public.sync_codes for select to anon
  using (true);

create policy "anon can create sync code"
  on public.sync_codes for insert to anon
  with check (true);

create policy "anon can touch sync code"
  on public.sync_codes for update to anon
  using (true)
  with check (true);

-- ============ Done ============
-- 验证：刷新 Supabase Dashboard → Table Editor，应看到 saves / likes / sync_codes 三张表。
