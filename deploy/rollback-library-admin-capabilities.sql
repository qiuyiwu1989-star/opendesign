-- REVIEWED ROLLBACK ARTIFACT ONLY.
-- Running this is a destructive production action and requires separate,
-- explicit approval. It removes only Admin API service capabilities. The
-- public curation decision journal and runner RPCs remain intact.
begin;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'opendesign_admin_api_read_login') then
    revoke opendesign_admin_read_role from opendesign_admin_api_read_login;
  end if;
  if exists (select 1 from pg_roles where rolname = 'opendesign_admin_api_audit_login') then
    revoke opendesign_admin_audit_writer_role from opendesign_admin_api_audit_login;
  end if;
  if exists (select 1 from pg_roles where rolname = 'opendesign_admin_api_review_login') then
    revoke opendesign_admin_review_writer_role from opendesign_admin_api_review_login;
  end if;
end $$;

drop schema if exists opendesign_admin_read cascade;

do $$
begin
  execute format(
    'revoke connect on database %I from opendesign_admin_review_writer_role, opendesign_admin_audit_writer_role, opendesign_admin_read_role',
    current_database()
  );
end $$;

drop role if exists opendesign_admin_review_writer_role;
drop role if exists opendesign_admin_audit_writer_role;
drop role if exists opendesign_admin_read_role;

commit;
