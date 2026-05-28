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
-- 设计：用户在 Device A 生成一个易记的 code（如 "quiet-fern-42"），
--      Device B 输入这个 code 后，把自己的 localStorage visitor_id 替换为
--      Device A 的 visitor_id —— 之前在 A 上的收藏自动出现。
-- 不需要邮箱、密码、OAuth；不持久化任何 PII。
-- 代价：拿到 code 的任何人都能看到那个浏览器的收藏，所以 UI 里要提醒不要外发。

create table if not exists public.sync_codes (
  code         text primary key,
  visitor_id   uuid not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists sync_codes_visitor_idx on public.sync_codes (visitor_id);

alter table public.sync_codes enable row level security;

drop policy if exists "anon can create sync code" on public.sync_codes;
drop policy if exists "anon can lookup sync code" on public.sync_codes;
drop policy if exists "anon can touch sync code"  on public.sync_codes;

-- INSERT：任何匿名访客可以为自己生成一个 code
create policy "anon can create sync code"
  on public.sync_codes for insert to anon
  with check (true);

-- SELECT：任何人凭 code 可以查 visitor_id（绑定流程必需）
create policy "anon can lookup sync code"
  on public.sync_codes for select to anon
  using (true);

-- UPDATE：允许更新 last_used_at（轻量心跳，方便后续做清理；不允许改 visitor_id）
create policy "anon can touch sync code"
  on public.sync_codes for update to anon
  using (true)
  with check (true);

-- ============ Done ============
-- 验证：刷新 Supabase Dashboard → Table Editor，应看到 saves / likes / sync_codes 三张表。
