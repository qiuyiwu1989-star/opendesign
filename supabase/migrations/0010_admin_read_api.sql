-- Phase 3 draft only. Do not run without an explicitly authorized release window.
-- Dedicated read schema and bounded audit function for the server-side Admin API.
begin;

create schema if not exists opendesign_admin_read;
revoke all on schema opendesign_admin_read from public;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'opendesign_admin_read_role') then
    create role opendesign_admin_read_role nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'opendesign_admin_audit_writer_role') then
    create role opendesign_admin_audit_writer_role nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;

alter role opendesign_admin_read_role set statement_timeout = '10s';
alter role opendesign_admin_read_role set lock_timeout = '1s';
alter role opendesign_admin_read_role set idle_in_transaction_session_timeout = '5s';
alter role opendesign_admin_audit_writer_role set statement_timeout = '5s';
alter role opendesign_admin_audit_writer_role set lock_timeout = '1s';
alter role opendesign_admin_audit_writer_role set idle_in_transaction_session_timeout = '5s';

revoke all on all tables in schema opendesign_admin_read from public;
revoke all on all functions in schema opendesign_admin_read from public;
alter default privileges in schema opendesign_admin_read revoke all on tables from public;
alter default privileges in schema opendesign_admin_read revoke all on functions from public;

create or replace view opendesign_admin_read.submissions
with (security_barrier = true) as
select s.id, s.url, s.host, s.note, s.status, s.kind, s.slug, s.created_at,
  aggregate.host_total, aggregate.host_voters
from public.submissions s
join (
  select host, kind, count(*)::int host_total,
    count(distinct visitor_id)::int host_voters
  from public.submissions group by host, kind
) aggregate using (host, kind);

create or replace view opendesign_admin_read.discoveries
with (security_barrier = true) as
select d.id, d.url, d.host, d.slug, d.title, d.source, d.score, d.status, d.created_at
from public.discoveries d;

create or replace view opendesign_admin_read.jobs
with (security_barrier = true) as
select j.id, j.kind, j.slug, j.url, j.status, left(j.result, 1000) as result,
  j.created_at, j.updated_at
from public.jobs j;

create or replace view opendesign_admin_read.run_logs
with (security_barrier = true) as
select r.id, r.kind, r.status, r.started_at, r.finished_at,
  left(r.summary, 400) as summary, left(r.details, 3000) as details
from public.run_logs r;

-- Quality and origin evidence currently lives in checked-in library artifacts,
-- not PostgreSQL. Empty typed views preserve the Phase 2 partial-source contract.
create or replace view opendesign_admin_read.quality_issues as
select null::text id, null::text asset_id, null::text title, null::text summary,
  null::text severity, null::text status, null::text url, null::timestamptz created_at,
  array[]::text[] evidence where false;
create or replace view opendesign_admin_read.origin_issues as
select null::text id, null::text asset_id, null::text title, null::text summary,
  null::text status, null::text url, null::timestamptz created_at,
  array[]::text[] evidence where false;

create or replace view opendesign_admin_read.database_sync as
select md5(concat_ws(':',
  coalesce((select max(updated_at)::text from public.jobs), ''),
  coalesce((select max(created_at)::text from public.submissions), ''),
  coalesce((select max(created_at)::text from public.discoveries), ''),
  coalesce((select max(finished_at)::text from public.run_logs), '')
)) as revision,
clock_timestamp() as observed_at,
'Read-only digest of operational table watermarks.'::text as detail;

create table if not exists opendesign_admin_read.audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null check (length(request_id) between 1 and 128),
  occurred_at timestamptz not null,
  actor_id text check (actor_id is null or length(actor_id) <= 40),
  action text not null check (length(action) between 1 and 80),
  outcome text not null check (outcome in ('success','denied','failure')),
  route text not null check (length(route) between 1 and 200),
  latency_ms integer not null check (latency_ms between 0 and 600000),
  source_ip_hash text check (source_ip_hash is null or length(source_ip_hash) <= 128),
  user_agent_hash text check (user_agent_hash is null or length(user_agent_hash) <= 128),
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 4096),
  recorded_at timestamptz not null default clock_timestamp()
);
revoke all on opendesign_admin_read.audit_events from public, opendesign_admin_read_role, opendesign_admin_audit_writer_role;

create or replace function opendesign_admin_read.write_audit_event(
  p_request_id text, p_occurred_at timestamptz, p_actor_id text, p_action text,
  p_outcome text, p_route text, p_latency_ms integer, p_source_ip_hash text,
  p_metadata jsonb
) returns table(event_id uuid)
language plpgsql security definer
set search_path = pg_catalog, opendesign_admin_read
as $$
declare v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb); v_id uuid;
begin
  if p_outcome not in ('success','denied','failure')
     or length(coalesce(p_request_id,'')) not between 1 and 128
     or length(coalesce(p_action,'')) not between 1 and 80
     or length(coalesce(p_route,'')) not between 1 and 200
     or p_latency_ms not between 0 and 600000
     or pg_column_size(v_metadata) > 4096 then
    raise exception 'invalid audit event';
  end if;
  if v_metadata ?| array['cookie','authorization','token','secret','password','passphrase','oauth','code','sql','query','body'] then
    raise exception 'sensitive audit metadata key';
  end if;
  insert into opendesign_admin_read.audit_events
    (request_id, occurred_at, actor_id, action, outcome, route, latency_ms,
     source_ip_hash, user_agent_hash, metadata)
  values (p_request_id, p_occurred_at, left(p_actor_id,40), p_action, p_outcome,
    p_route, p_latency_ms, left(p_source_ip_hash,128), left(v_metadata->>'userAgentHash',128),
    v_metadata - 'userAgentHash') returning id into v_id;
  return query select v_id;
end $$;

revoke all on function opendesign_admin_read.write_audit_event(text,timestamptz,text,text,text,text,integer,text,jsonb) from public, opendesign_admin_read_role;
grant usage on schema opendesign_admin_read to opendesign_admin_read_role, opendesign_admin_audit_writer_role;
do $$ begin
  execute format('grant connect on database %I to opendesign_admin_read_role', current_database());
  execute format('grant connect on database %I to opendesign_admin_audit_writer_role', current_database());
end $$;
grant select on opendesign_admin_read.submissions, opendesign_admin_read.discoveries,
  opendesign_admin_read.jobs, opendesign_admin_read.run_logs,
  opendesign_admin_read.quality_issues, opendesign_admin_read.origin_issues,
  opendesign_admin_read.database_sync to opendesign_admin_read_role;
grant execute on function opendesign_admin_read.write_audit_event(text,timestamptz,text,text,text,text,integer,text,jsonb)
  to opendesign_admin_audit_writer_role;

-- A separately managed LOGIN may be granted these group roles during deployment.
-- This migration intentionally creates no LOGIN and contains no password.
commit;

-- Rollback (run separately, after revoking memberships from deployment LOGINs):
-- begin;
-- drop schema if exists opendesign_admin_read cascade;
-- drop role if exists opendesign_admin_audit_writer_role;
-- drop role if exists opendesign_admin_read_role;
-- commit;
