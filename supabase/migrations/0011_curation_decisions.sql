-- Content quality v1. Draft only: do not execute outside an authorized release window.
-- Adds an append-only AI recommendation journal. Recommendations never publish,
-- enqueue, delete, or permanently reject a candidate; a human remains final.
begin;

create table if not exists public.curation_decisions (
  id uuid primary key default gen_random_uuid(),
  discovery_id uuid not null references public.discoveries(id) on delete restrict,
  recommendation text not null check (recommendation in ('approve','review','reject')),
  confidence smallint not null check (confidence between 0 and 100),
  reason text not null check (length(reason) between 1 and 1000),
  policy_version text not null check (length(policy_version) between 1 and 80),
  model text not null check (length(model) between 1 and 120),
  signals jsonb not null check (jsonb_typeof(signals) = 'array' and pg_column_size(signals) <= 16384),
  decided_at timestamptz not null default clock_timestamp(),
  review_status text not null default 'pending' check (review_status in ('pending','confirmed','overridden')),
  reviewed_by text check (reviewed_by is null or length(reviewed_by) <= 120),
  reviewed_at timestamptz,
  review_reason text check (review_reason is null or length(review_reason) <= 1000)
);
alter table public.curation_decisions enable row level security;
revoke all on public.curation_decisions from anon, authenticated, public;
create index if not exists curation_decisions_review_idx
  on public.curation_decisions(review_status, decided_at desc);
create index if not exists curation_decisions_discovery_idx
  on public.curation_decisions(discovery_id, decided_at desc);

create or replace function public.runner_record_curation_decision(
  p_token text, p_discovery_id uuid, p_recommendation text, p_confidence int,
  p_reason text, p_policy_version text, p_model text, p_signals jsonb
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_token text; v_id uuid;
begin
  select value into v_token from public.app_config where key = 'runner_token';
  if v_token is null or p_token is null or p_token <> v_token then raise exception 'unauthorized'; end if;
  if p_recommendation not in ('approve','review','reject') then raise exception 'bad recommendation'; end if;
  if p_confidence not between 0 and 100 then raise exception 'bad confidence'; end if;
  if jsonb_typeof(p_signals) <> 'array' or pg_column_size(p_signals) > 16384 then raise exception 'bad signals'; end if;
  if not exists (select 1 from public.discoveries where id = p_discovery_id) then raise exception 'discovery not found'; end if;

  insert into public.curation_decisions
    (discovery_id, recommendation, confidence, reason, policy_version, model, signals)
  values
    (p_discovery_id, p_recommendation, p_confidence, left(p_reason,1000),
     left(p_policy_version,80), left(p_model,120), p_signals)
  returning id into v_id;

  -- Keep the candidate reviewable. This function never creates a job.
  update public.discoveries set auto_score = round(p_confidence / 10.0), auto_reason = left(p_reason,1000), status = 'pending'
  where id = p_discovery_id;
  return v_id;
end $$;
revoke all on function public.runner_record_curation_decision(text,uuid,text,int,text,text,text,jsonb) from public;
grant execute on function public.runner_record_curation_decision(text,uuid,text,int,text,text,text,jsonb) to anon;

create or replace view opendesign_admin_read.curation_decisions
with (security_barrier = true) as
select c.id, c.discovery_id, coalesce(d.title,d.host,d.slug,'候选站点') candidate_title,
  d.url candidate_url, c.recommendation, c.confidence, c.reason,
  c.policy_version, c.model, c.decided_at, c.review_status,
  c.reviewed_by, c.reviewed_at, c.review_reason, c.signals
from public.curation_decisions c join public.discoveries d on d.id = c.discovery_id;
revoke all on opendesign_admin_read.curation_decisions from public;
grant select on opendesign_admin_read.curation_decisions to opendesign_admin_read_role;

commit;
