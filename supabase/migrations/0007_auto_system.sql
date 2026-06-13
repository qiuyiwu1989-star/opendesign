-- Migration 0007 · 自治系统扩展
--
-- 赋能三个自治模块：
--   auto-evaluate.py  · AI 自动评估候选站，无需人工审阅
--   adaptive-rank.py  · 社交信号驱动动态排名（已有 likes/saves view，本迁移无需改）
--   self-optimize.py  · 检测失效/超期站点，自动排队升级
--
-- 安全模型：
--   所有新函数只用 runner_token（已在 0005 定义，存 app_config），
--   不需要 admin 口令 ——  runner 是可信的服务器进程，token 放 ~/.opendesign-runner.env。
--
-- 应用：把整段粘到 Supabase SQL Editor → Run（前置：0005 + 0006 已跑）

-- ═══ discoveries 表扩展字段 ═══════════════════════════════════════════════

alter table public.discoveries
  add column if not exists auto_score  int,       -- AI 评分 0-10
  add column if not exists auto_reason text;      -- AI 评分依据（一句话）

-- ═══ runner 可读候选队列 ═══════════════════════════════════════════════════

create or replace function public.runner_list_pending(
  p_token text,
  p_limit int default 30
)
returns setof public.discoveries
language plpgsql security definer set search_path = public as $$
declare v_tok text;
begin
  select value into v_tok from public.app_config where key = 'runner_token';
  if v_tok is null or p_token is null or p_token <> v_tok then
    raise exception 'unauthorized';
  end if;
  return query
    select * from public.discoveries
    where status = 'pending'
    order by score desc, created_at desc
    limit p_limit;
end; $$;

grant execute on function public.runner_list_pending(text, int) to anon;

-- ═══ runner 自动评估一条候选 ══════════════════════════════════════════════

create or replace function public.runner_auto_evaluate(
  p_token  text,
  p_id     uuid,
  p_action text,      -- 'approve' | 'ignore' | 'defer'
  p_score  int,
  p_reason text
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_tok text;
  v_d   public.discoveries;
begin
  select value into v_tok from public.app_config where key = 'runner_token';
  if v_tok is null or p_token is null or p_token <> v_tok then
    raise exception 'unauthorized';
  end if;
  if p_action not in ('approve', 'ignore', 'defer') then
    raise exception 'bad action: %', p_action;
  end if;

  select * into v_d from public.discoveries where id = p_id;
  if v_d.id is null then raise exception 'discovery not found'; end if;

  -- 更新评分 + 状态
  update public.discoveries set
    auto_score  = p_score,
    auto_reason = p_reason,
    status = case
      when p_action = 'approve' then 'approved'
      when p_action = 'ignore'  then 'ignored'
      else 'pending'   -- defer 保持 pending，留人工审阅
    end
  where id = p_id;

  -- approve → 自动创建 collect 任务（去重）
  if p_action = 'approve' then
    if not exists (
      select 1 from public.jobs
      where slug = v_d.slug and kind = 'collect' and status in ('pending', 'running')
    ) then
      insert into public.jobs (kind, slug, url)
      values ('collect', v_d.slug, v_d.url);
    end if;
    return 'approved → collect job created';
  end if;

  return p_action;
end; $$;

grant execute on function public.runner_auto_evaluate(text, uuid, text, int, text) to anon;

-- ═══ runner 可直接入队 job（无需 admin 口令）════════════════════════════

create or replace function public.runner_enqueue_job(
  p_token text,
  p_kind  text,
  p_slug  text,
  p_url   text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tok text; v_id uuid;
begin
  select value into v_tok from public.app_config where key = 'runner_token';
  if v_tok is null or p_token is null or p_token <> v_tok then
    raise exception 'unauthorized';
  end if;
  if p_kind not in ('upgrade', 'refresh', 'collect') then
    raise exception 'bad kind: %', p_kind;
  end if;
  -- 去重：同 (kind, slug) 已有 pending/running 就复用
  select id into v_id from public.jobs
    where slug = p_slug and kind = p_kind and status in ('pending', 'running')
    order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.jobs (kind, slug, url)
  values (p_kind, p_slug, coalesce(p_url, ''))
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function public.runner_enqueue_job(text, text, text, text) to anon;

-- ═══ 查看已入队待执行任务数（runner 用于自我限流）════════════════════════

create or replace function public.runner_pending_count(p_token text)
returns int
language plpgsql security definer set search_path = public as $$
declare v_tok text; v_cnt int;
begin
  select value into v_tok from public.app_config where key = 'runner_token';
  if v_tok is null or p_token is null or p_token <> v_tok then
    raise exception 'unauthorized';
  end if;
  select count(*) into v_cnt from public.jobs where status in ('pending', 'running');
  return coalesce(v_cnt, 0);
end; $$;

grant execute on function public.runner_pending_count(text) to anon;

-- ═══ 验证 ════════════════════════════════════════════════════════════════

-- 验证：select runner_list_pending('<your_runner_token>', 5);
-- 验证：select runner_pending_count('<your_runner_token>');
