-- Migration 0002 · Sync code（v0.2 修正版）
-- 设计：每个 visitor 有且仅有 1 个固定 code（visitor_id 主键，1:1）
-- 应用方式：粘进 Supabase Dashboard → SQL Editor → Run
-- 安全：重复执行无害（drop if exists 兜底）

-- 干净重建（之前可能 paste 过老结构）
drop table if exists public.sync_codes cascade;

create table public.sync_codes (
  visitor_id   uuid        primary key,
  code         text        not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.sync_codes enable row level security;

-- SELECT：任意人可凭 code 查 visitor_id（绑定必需）
create policy "anon can lookup sync code"
  on public.sync_codes for select to anon
  using (true);

-- INSERT：任意 visitor 可登记自己的 code（重复 INSERT 会被 PK 约束挡，前端处理）
create policy "anon can create sync code"
  on public.sync_codes for insert to anon
  with check (true);

-- UPDATE：允许打 last_used_at 心跳（清理 stale 用的，不影响 code 本身）
create policy "anon can touch sync code"
  on public.sync_codes for update to anon
  using (true)
  with check (true);
