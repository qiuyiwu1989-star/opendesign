-- Content quality v1. Draft only: do not execute outside an authorized release window.
-- Adds an append-only AI recommendation journal. Recommendations never publish,
-- enqueue, delete, or permanently reject a candidate; a human remains final.
begin;

create table if not exists public.curation_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_fingerprint text not null check (decision_fingerprint ~ '^[0-9a-f]{64}$'),
  discovery_id uuid not null references public.discoveries(id) on delete restrict,
  recommendation text not null check (recommendation in ('approve','review','reject')),
  confidence smallint not null check (confidence between 0 and 100),
  reason text not null check (length(reason) between 1 and 1000),
  policy_version text not null check (length(policy_version) between 1 and 80),
  model text not null check (length(model) between 1 and 120),
  signals jsonb not null check (jsonb_typeof(signals) = 'array' and jsonb_array_length(signals) = 7
    and pg_column_size(signals) <= 15360),
  decided_at timestamptz not null default clock_timestamp(),
  review_status text not null default 'pending' check (review_status in ('pending','confirmed','overridden')),
  reviewed_by text check (reviewed_by is null or length(reviewed_by) <= 120),
  reviewed_at timestamptz,
  review_reason text check (review_reason is null or length(review_reason) between 4 and 1000),
  final_recommendation text check (final_recommendation is null or final_recommendation in ('approve','review','reject')),
  check ((review_status = 'pending' and reviewed_by is null and reviewed_at is null
          and review_reason is null and final_recommendation is null)
      or (review_status in ('confirmed','overridden') and reviewed_by is not null
          and reviewed_at is not null and review_reason is not null and final_recommendation is not null)),
  check (review_status <> 'confirmed' or final_recommendation = recommendation)
);
alter table public.curation_decisions add column if not exists decision_fingerprint text;
alter table public.curation_decisions add column if not exists final_recommendation text;
update public.curation_decisions set decision_fingerprint =
  md5(concat_ws(':', discovery_id::text, policy_version, model, id::text)) ||
  md5(concat_ws(':', id::text, model, policy_version, discovery_id::text))
where decision_fingerprint is null;
update public.curation_decisions set final_recommendation = recommendation
where final_recommendation is null and review_status = 'confirmed';
alter table public.curation_decisions alter column decision_fingerprint set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'curation_decisions_fingerprint_format') then
    alter table public.curation_decisions add constraint curation_decisions_fingerprint_format
      check (decision_fingerprint ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'curation_decisions_final_recommendation') then
    alter table public.curation_decisions add constraint curation_decisions_final_recommendation
      check (final_recommendation is null or final_recommendation in ('approve','review','reject'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'curation_decisions_review_reason_length') then
    alter table public.curation_decisions add constraint curation_decisions_review_reason_length
      check (review_reason is null or length(review_reason) between 4 and 1000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'curation_decisions_review_state') then
    alter table public.curation_decisions add constraint curation_decisions_review_state
      check ((review_status = 'pending' and reviewed_by is null and reviewed_at is null
              and review_reason is null and final_recommendation is null)
          or (review_status in ('confirmed','overridden') and reviewed_by is not null
              and reviewed_at is not null and review_reason is not null
              and final_recommendation is not null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'curation_decisions_confirm_preserves_ai') then
    alter table public.curation_decisions add constraint curation_decisions_confirm_preserves_ai
      check (review_status <> 'confirmed' or final_recommendation = recommendation) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'curation_decisions_signals_contract') then
    alter table public.curation_decisions add constraint curation_decisions_signals_contract
      check (jsonb_typeof(signals) = 'array' and jsonb_array_length(signals) = 7
        and pg_column_size(signals) <= 15360) not valid;
  end if;
end $$;
alter table public.curation_decisions enable row level security;
revoke all on public.curation_decisions from anon, authenticated, public;
create index if not exists curation_decisions_review_idx
  on public.curation_decisions(review_status, decided_at desc);
create index if not exists curation_decisions_discovery_idx
  on public.curation_decisions(discovery_id, decided_at desc);
create unique index if not exists curation_decisions_fingerprint_idx
  on public.curation_decisions(decision_fingerprint);

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'opendesign_admin_review_writer_role') then
    create role opendesign_admin_review_writer_role nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;
alter role opendesign_admin_review_writer_role set statement_timeout = '5s';
alter role opendesign_admin_review_writer_role set lock_timeout = '1s';
alter role opendesign_admin_review_writer_role set idle_in_transaction_session_timeout = '5s';

drop function if exists public.runner_record_curation_decision(text,uuid,text,int,text,text,text,jsonb);
create or replace function public.runner_record_curation_decision(
  p_token text, p_discovery_id uuid, p_recommendation text, p_confidence int,
  p_reason text, p_policy_version text, p_model text, p_signals jsonb,
  p_decision_fingerprint text
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_token text; v_id uuid;
begin
  select value into v_token from public.app_config where key = 'runner_token';
  if v_token is null or p_token is null or p_token <> v_token then raise exception 'unauthorized'; end if;
  if p_recommendation not in ('approve','review','reject') then raise exception 'bad recommendation'; end if;
  if p_confidence not between 0 and 100 then raise exception 'bad confidence'; end if;
  if p_decision_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'bad decision fingerprint'; end if;
  if jsonb_typeof(p_signals) <> 'array' or jsonb_array_length(p_signals) <> 7
     or pg_column_size(p_signals) > 15360 then raise exception 'bad signals'; end if;
  if not exists (select 1 from public.discoveries where id = p_discovery_id) then raise exception 'discovery not found'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_decision_fingerprint, 0));
  select id into v_id from public.curation_decisions
  where decision_fingerprint = p_decision_fingerprint;
  if v_id is not null then return v_id; end if;

  insert into public.curation_decisions
    (decision_fingerprint, discovery_id, recommendation, confidence, reason, policy_version, model, signals)
  values
    (p_decision_fingerprint, p_discovery_id, p_recommendation, p_confidence,
     left(p_reason,1000), left(p_policy_version,80), left(p_model,120), p_signals)
  on conflict (decision_fingerprint) do update
    set decision_fingerprint = excluded.decision_fingerprint
  returning id into v_id;

  -- Keep the candidate reviewable. This function never creates a job.
  update public.discoveries set auto_score = round(p_confidence / 10.0), auto_reason = left(p_reason,1000), status = 'pending'
  where id = p_discovery_id;
  return v_id;
end $$;
revoke all on function public.runner_record_curation_decision(text,uuid,text,int,text,text,text,jsonb,text) from public;
grant execute on function public.runner_record_curation_decision(text,uuid,text,int,text,text,text,jsonb,text) to anon;

create or replace function public.runner_find_curation_decision(
  p_token text, p_decision_fingerprint text
) returns uuid
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_token text; v_id uuid;
begin
  select value into v_token from public.app_config where key = 'runner_token';
  if v_token is null or p_token is null or p_token <> v_token then raise exception 'unauthorized'; end if;
  if p_decision_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'bad decision fingerprint'; end if;
  select id into v_id from public.curation_decisions where decision_fingerprint = p_decision_fingerprint;
  return v_id;
end $$;
revoke all on function public.runner_find_curation_decision(text,text) from public;
grant execute on function public.runner_find_curation_decision(text,text) to anon;

create or replace function opendesign_admin_read.review_curation_decision(
  p_decision_id uuid, p_reviewed_by text, p_action text,
  p_recommendation text, p_reason text
) returns table(
  outcome text, decision_id uuid, review_status text, recommendation text,
  reviewed_at timestamptz, reviewed_by text
)
language plpgsql security definer
set search_path = pg_catalog, public, opendesign_admin_read
as $$
declare v_existing public.curation_decisions%rowtype; v_now timestamptz := clock_timestamp();
begin
  if p_action not in ('confirm','override')
     or length(coalesce(p_reviewed_by,'')) not between 1 and 120
     or length(btrim(coalesce(p_reason,''))) not between 4 and 1000
     or (p_action = 'confirm' and p_recommendation is not null)
     or (p_action = 'override' and p_recommendation not in ('approve','review','reject')) then
    raise exception 'invalid decision review';
  end if;
  select * into v_existing from public.curation_decisions where id = p_decision_id for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text, null::timestamptz, null::text;
    return;
  end if;
  if v_existing.review_status <> 'pending' then
    return query select 'already_reviewed'::text, v_existing.id, v_existing.review_status,
      v_existing.final_recommendation, v_existing.reviewed_at, v_existing.reviewed_by;
    return;
  end if;
  update public.curation_decisions set
    review_status = case when p_action = 'confirm' then 'confirmed' else 'overridden' end,
    final_recommendation = case when p_action = 'confirm' then v_existing.recommendation else p_recommendation end,
    reviewed_by = p_reviewed_by,
    reviewed_at = v_now,
    review_reason = btrim(p_reason)
  where id = v_existing.id;
  return query select 'reviewed'::text, v_existing.id,
    case when p_action = 'confirm' then 'confirmed' else 'overridden' end,
    case when p_action = 'confirm' then v_existing.recommendation else p_recommendation end,
    v_now, p_reviewed_by;
end $$;
revoke all on function opendesign_admin_read.review_curation_decision(uuid,text,text,text,text)
  from public, anon, authenticated, opendesign_admin_read_role, opendesign_admin_audit_writer_role;
grant usage on schema opendesign_admin_read to opendesign_admin_review_writer_role;
grant execute on function opendesign_admin_read.review_curation_decision(uuid,text,text,text,text)
  to opendesign_admin_review_writer_role;
do $$ begin
  execute format('grant connect on database %I to opendesign_admin_review_writer_role', current_database());
end $$;

create or replace view opendesign_admin_read.curation_decisions
with (security_barrier = true) as
select c.id, c.discovery_id, coalesce(d.title,d.host,d.slug,'候选站点') candidate_title,
  d.url candidate_url, c.recommendation, c.confidence, c.reason,
  c.policy_version, c.model, c.decided_at, c.review_status,
  c.reviewed_by, c.reviewed_at, c.review_reason, c.signals,
  c.decision_fingerprint, c.final_recommendation
from public.curation_decisions c join public.discoveries d on d.id = c.discovery_id;
revoke all on opendesign_admin_read.curation_decisions from public;
grant select on opendesign_admin_read.curation_decisions to opendesign_admin_read_role;

commit;
