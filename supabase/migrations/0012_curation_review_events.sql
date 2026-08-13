-- Quality Judgment Ledger v2. Draft only: do not execute without an explicitly
-- authorized migration window. Human terminal reviews become append-only
-- judgment events while the original AI recommendation remains immutable.
begin;

create table if not exists public.curation_review_events (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references public.curation_decisions(id) on delete restrict,
  subject_id uuid not null references public.discoveries(id) on delete restrict,
  holder_type text not null default 'user' check (holder_type = 'user'),
  holder_id text not null check (length(holder_id) between 1 and 120),
  statement text not null check (statement in ('approve','review','reject')),
  reason text not null check (length(reason) between 4 and 1000),
  as_of timestamptz not null,
  recorded_at timestamptz not null default clock_timestamp(),
  supersedes_decision_id uuid not null references public.curation_decisions(id) on delete restrict,
  provenance jsonb not null check (
    jsonb_typeof(provenance) = 'object'
    and provenance->>'source' in ('admin-api','migration-backfill')
    and length(coalesce(provenance->>'requestId','')) between 1 and 128
    and provenance->>'aiDecisionId' = decision_id::text
    and pg_column_size(provenance) <= 4096
  ),
  check (decision_id = supersedes_decision_id),
  check (recorded_at >= as_of)
);
alter table public.curation_review_events enable row level security;
revoke all on public.curation_review_events from public, anon, authenticated,
  opendesign_admin_read_role, opendesign_admin_audit_writer_role,
  opendesign_admin_review_writer_role;

-- Deterministic compatibility backfill only. It does not infer missing actors,
-- subjects or time: every source value was already required by the v1 terminal
-- review state constraint. Existing AI fields remain untouched.
insert into public.curation_review_events
  (decision_id, subject_id, holder_id, statement, reason, as_of,
   recorded_at, supersedes_decision_id, provenance)
select c.id, c.discovery_id, c.reviewed_by, c.final_recommendation,
  c.review_reason, c.reviewed_at, c.reviewed_at, c.id,
  jsonb_build_object(
    'source', 'migration-backfill',
    'requestId', 'migration-0012:' || c.id::text,
    'aiDecisionId', c.id,
    'policyVersion', c.policy_version,
    'model', c.model
  )
from public.curation_decisions c
where c.review_status in ('confirmed','overridden')
  and c.reviewed_by is not null and c.reviewed_at is not null
  and c.review_reason is not null and c.final_recommendation is not null
  and length(c.reviewed_by) between 1 and 120
  and length(c.review_reason) between 4 and 1000
on conflict (decision_id) do nothing;

create or replace function opendesign_admin_read.prevent_curation_review_event_mutation()
returns trigger language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'curation review events are append-only';
end $$;
revoke all on function opendesign_admin_read.prevent_curation_review_event_mutation() from public;
drop trigger if exists curation_review_events_append_only on public.curation_review_events;
create trigger curation_review_events_append_only
before update or delete on public.curation_review_events
for each row execute function opendesign_admin_read.prevent_curation_review_event_mutation();

-- Replace the v1 five-argument writer. The request id is provenance, not an
-- authentication token, and is bounded before it reaches the ledger.
drop function if exists opendesign_admin_read.review_curation_decision(uuid,text,text,text,text);
create or replace function opendesign_admin_read.review_curation_decision(
  p_decision_id uuid, p_reviewed_by text, p_action text,
  p_recommendation text, p_reason text, p_request_id text
) returns table(
  outcome text, decision_id uuid, review_status text, recommendation text,
  reviewed_at timestamptz, reviewed_by text, review_event_id uuid,
  subject_id uuid, review_reason text, review_provenance jsonb
)
language plpgsql security definer
set search_path = pg_catalog, public, opendesign_admin_read
as $$
declare
  v_existing public.curation_decisions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_statement text;
  v_event_id uuid;
  v_provenance jsonb;
begin
  if p_action not in ('confirm','override')
     or length(coalesce(p_reviewed_by,'')) not between 1 and 120
     or length(btrim(coalesce(p_reason,''))) not between 4 and 1000
     or length(coalesce(p_request_id,'')) not between 1 and 128
     or (p_action = 'confirm' and p_recommendation is not null)
     or (p_action = 'override' and p_recommendation not in ('approve','review','reject')) then
    raise exception 'invalid decision review';
  end if;

  select * into v_existing from public.curation_decisions
  where id = p_decision_id for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text,
      null::timestamptz, null::text, null::uuid, null::uuid, null::text, null::jsonb;
    return;
  end if;
  if v_existing.review_status <> 'pending'
     or exists (select 1 from public.curation_review_events where public.curation_review_events.decision_id = v_existing.id) then
    select e.id, e.provenance into v_event_id, v_provenance
    from public.curation_review_events e where e.decision_id = v_existing.id;
    return query select 'already_reviewed'::text, v_existing.id, v_existing.review_status,
      v_existing.final_recommendation, v_existing.reviewed_at, v_existing.reviewed_by,
      v_event_id, v_existing.discovery_id, v_existing.review_reason, v_provenance;
    return;
  end if;

  v_statement := case when p_action = 'confirm' then v_existing.recommendation else p_recommendation end;
  v_provenance := jsonb_build_object(
    'source', 'admin-api',
    'requestId', p_request_id,
    'aiDecisionId', v_existing.id,
    'policyVersion', v_existing.policy_version,
    'model', v_existing.model
  );
  insert into public.curation_review_events
    (decision_id, subject_id, holder_id, statement, reason, as_of,
     supersedes_decision_id, provenance)
  values
    (v_existing.id, v_existing.discovery_id, p_reviewed_by, v_statement,
     btrim(p_reason), v_now, v_existing.id, v_provenance)
  returning id into v_event_id;

  -- These columns are a compatibility/current-state index. The AI judgment
  -- fields (recommendation, confidence, reason, policy, model, signals and
  -- decided_at) are deliberately never updated.
  update public.curation_decisions set
    review_status = case when p_action = 'confirm' then 'confirmed' else 'overridden' end,
    final_recommendation = v_statement,
    reviewed_by = p_reviewed_by,
    reviewed_at = v_now,
    review_reason = btrim(p_reason)
  where id = v_existing.id;

  return query select 'reviewed'::text, v_existing.id,
    case when p_action = 'confirm' then 'confirmed' else 'overridden' end,
    v_statement, v_now, p_reviewed_by, v_event_id, v_existing.discovery_id,
    btrim(p_reason), v_provenance;
end $$;

revoke all on function opendesign_admin_read.review_curation_decision(uuid,text,text,text,text,text)
  from public, anon, authenticated, opendesign_admin_read_role, opendesign_admin_audit_writer_role;
grant execute on function opendesign_admin_read.review_curation_decision(uuid,text,text,text,text,text)
  to opendesign_admin_review_writer_role;

create or replace view opendesign_admin_read.curation_review_events
with (security_barrier = true) as
select e.id, e.decision_id, e.subject_id, e.holder_type, e.holder_id,
  e.statement, e.reason, e.as_of, e.recorded_at,
  e.supersedes_decision_id, e.provenance
from public.curation_review_events e;
revoke all on opendesign_admin_read.curation_review_events from public;
grant select on opendesign_admin_read.curation_review_events to opendesign_admin_read_role;

create or replace view opendesign_admin_read.curation_decisions
with (security_barrier = true) as
select c.id, c.discovery_id,
  coalesce(d.title,d.host,d.slug,'候选站点') candidate_title,
  d.url candidate_url, c.recommendation, c.confidence, c.reason,
  c.policy_version, c.model, c.decided_at, c.review_status,
  c.reviewed_by, c.reviewed_at, c.review_reason, c.signals,
  c.decision_fingerprint, c.final_recommendation,
  c.discovery_id subject_id,
  'agent'::text ai_holder_type, c.model ai_holder_id,
  c.recommendation ai_statement, c.decided_at ai_as_of,
  jsonb_build_object(
    'source', 'daily-ai-curator', 'aiDecisionId', c.id,
    'policyVersion', c.policy_version, 'model', c.model
  ) ai_provenance,
  e.id review_event_id, e.holder_type review_holder_type,
  e.holder_id review_holder_id, e.statement review_statement,
  e.as_of review_as_of, e.recorded_at review_recorded_at,
  e.provenance review_provenance, e.supersedes_decision_id
from public.curation_decisions c
join public.discoveries d on d.id = c.discovery_id
left join public.curation_review_events e on e.decision_id = c.id;
revoke all on opendesign_admin_read.curation_decisions from public;
grant select on opendesign_admin_read.curation_decisions to opendesign_admin_read_role;

commit;
