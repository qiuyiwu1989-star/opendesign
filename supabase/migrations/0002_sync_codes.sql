-- Migration 0002 · 收藏跨设备携带（Sync Code）
-- 应用方式：粘进 Supabase Dashboard → SQL Editor → Run
-- 重复执行安全

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

create policy "anon can create sync code"
  on public.sync_codes for insert to anon
  with check (true);

create policy "anon can lookup sync code"
  on public.sync_codes for select to anon
  using (true);

create policy "anon can touch sync code"
  on public.sync_codes for update to anon
  using (true)
  with check (true);
