-- 0008_run_logs.sql
-- 自动化任务运行日志：每次 cron 执行完写一行，admin 后台可查。
--
-- 应用：粘进 Supabase SQL Editor → Run。
-- 依赖：app_config 表已有 runner_token + admin_passphrase（0005 / 0007 已设）。

create table if not exists public.run_logs (
  id          uuid        primary key default gen_random_uuid(),
  kind        text        not null,   -- 'jobrunner' | 'discover' | 'auto-evaluate' | 'adaptive-rank' | 'self-optimize'
  status      text        not null default 'done'
                          check (status in ('done','error','skipped')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  summary     text,       -- 一行摘要，e.g. "评估 6 站 · ✓ 0 收录 · ✗ 0 忽略 · ~ 6 存疑"
  details     text        -- 末尾日志（最多 3000 字符）
);

create index if not exists run_logs_started_idx on public.run_logs (started_at desc);
create index if not exists run_logs_kind_idx    on public.run_logs (kind, started_at desc);

alter table public.run_logs enable row level security;
-- 无 policy = 匿名全拒，只走下面的 security-definer RPC

-- ── 服务器写入（runner token 鉴权，和 job runner 共用同一个 token）─────────────
create or replace function public.log_cron_run(
  p_token      text,
  p_kind       text,
  p_status     text        default 'done',
  p_summary    text        default null,
  p_details    text        default null,
  p_started_at timestamptz default now()
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_tok text; v_id uuid;
begin
  select value into v_tok from public.app_config where key = 'runner_token';
  if v_tok is null or p_token is null or p_token <> v_tok then
    raise exception 'unauthorized';
  end if;
  insert into public.run_logs (kind, status, started_at, finished_at, summary, details)
  values (p_kind, p_status, p_started_at, now(),
          left(p_summary, 400), left(p_details, 3000))
  returning id into v_id;
  return v_id;
end; $$;

grant execute on function
  public.log_cron_run(text,text,text,text,text,timestamptz)
  to anon;

-- ── 管理员读取（admin passphrase 鉴权）────────────────────────────────────────
create or replace function public.admin_get_logs(
  p_pass  text,
  p_kind  text  default null,   -- null / 'all' = 全部类型
  p_limit int   default 80
)
returns setof public.run_logs
language plpgsql security definer set search_path = public as $$
declare v_pw text;
begin
  select value into v_pw from public.app_config where key = 'admin_passphrase';
  if p_pass is null or p_pass <> v_pw then raise exception 'unauthorized'; end if;
  if p_kind is null or p_kind = 'all' then
    return query
      select * from public.run_logs order by started_at desc limit p_limit;
  else
    return query
      select * from public.run_logs where kind = p_kind
      order by started_at desc limit p_limit;
  end if;
end; $$;

grant execute on function public.admin_get_logs(text,text,int) to anon;
