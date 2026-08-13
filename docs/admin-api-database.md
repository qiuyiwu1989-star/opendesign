# Admin API database lane

Status: migration `0010_admin_read_api.sql` was applied to the production
`opendesign` database on 2026-08-12. Migration `0011_curation_decisions.sql`
remains a reviewed local draft and has not been applied. The review LOGIN is
not configured, so the new human-review write path is not deployed.

## Runtime interfaces

`DatabaseClient.query` is the only driver boundary. Every call supplies SQL,
parameter values, a deadline, and a hard maximum row count. The operations
repository emits the Phase 2 `OperationsEnvelope`, while independently failed
sections become `unavailable` without exposing PostgreSQL errors.

The HTTP composition root should create separate driver instances:

- `ADMIN_DATABASE_URL`: a deployment-managed LOGIN that is a member only of
  `opendesign_admin_read_role`.
- `ADMIN_AUDIT_DATABASE_URL`: a different LOGIN that is a member only of
  `opendesign_admin_audit_writer_role`.
- `ADMIN_REVIEW_DATABASE_URL`: a third LOGIN that is a member only of
  `opendesign_admin_review_writer_role`; it can execute the bounded terminal
  review function but cannot read or write base tables.

The repository does not load either variable or create connections itself.
Startup configuration and concrete drivers live outside this database lane.

## Query and evidence boundaries

- SQL statements are fixed and all limits are `$1` parameters.
- Default limit is 100; the hard ceiling is 200 rows per section.
- Default statement deadline is 2.5 seconds; the hard ceiling is 10 seconds.
- Submissions, discoveries, jobs, and logs come from explicit read views.
- Job `result`, log `summary`, and log `details` provide the Phase 2 checkpoint
  adapter with phase and failure evidence.
- Quality and origin data do not currently exist in PostgreSQL. Typed empty
  views preserve the envelope and truthfully yield no live rows.
- Database sync evidence is a non-secret digest of four operational watermark
  timestamps. It is evidence of database change, not a Git revision.

The read repository never reads `app_config`, calls legacy administrator/runner
RPC functions, or modifies state. The separate review repository can only call
`opendesign_admin_read.review_curation_decision(...)`; it cannot change queues,
publication, Git, deployment, or public Library state.

## Least privilege migration

`supabase/migrations/0010_admin_read_api.sql` runs after migrations 0003–0009;
`0011_curation_decisions.sql` adds the decision journal and review boundary.
Together they create an isolated schema and three `NOLOGIN`, `NOINHERIT` group roles:

- `opendesign_admin_read_role`: database `CONNECT`, schema `USAGE`, and
  `SELECT` only on seven named views.
- `opendesign_admin_audit_writer_role`: database `CONNECT`, schema `USAGE`, and
  `EXECUTE` only on `write_audit_event(...)`.
- `opendesign_admin_review_writer_role`: database `CONNECT`, schema `USAGE`, and
  `EXECUTE` only on `review_curation_decision(...)`.

`PUBLIC` receives no schema, table, view, or function privilege. The audit role
cannot select audit rows. The read role cannot execute the audit function.
Actual LOGIN roles and passwords are intentionally outside this migration.

The audit function is `SECURITY DEFINER` with a pinned search path and bounded
fields/metadata. Application sanitization independently removes query strings,
rejects sensitive metadata keys, and permits only a small metadata allowlist.
Audit failure returns `written: false`; callers must not report it as success.

## Verification before any release

The repository release gate runs `npm run test:release --workspace
@opendesign/library-admin-api`. It boots a disposable in-process PostgreSQL
environment, applies the baseline schema plus migrations 0002–0011, and proves
the migration, privilege, idempotency and HTTP-to-SQL review contracts. This
gate is deterministic and uses fixture credentials only; it never connects to
production.

Before production, repeat the following against an ephemeral clone made from
the target PostgreSQL version, never against the live database:

1. Apply the baseline plus 0002–0011 in order and confirm all three group roles
   have `rolcanlogin = false`.
2. With a temporary read-role member, select each named view and confirm direct
   table access, `app_config`, legacy RPC, DML, audit execution and review
   execution are denied.
3. With a temporary audit-role member, execute one valid audit function call;
   confirm view/table reads, direct inserts, review execution, and
   oversized/sensitive events fail.
4. With a temporary review-role member, execute one terminal review; confirm
   base-table reads/writes, audit execution and every unrelated RPC fail.
5. Exercise a database timeout and one missing view; verify only that envelope
   section degrades and no driver detail reaches JSON or logs.
6. Revoke temporary memberships and remove the temporary LOGIN roles.

## Production migration evidence · 2026-08-12

The explicitly authorized database-only release window completed successfully:

- Preflight confirmed PostgreSQL listens on localhost, the four required
  operational tables exist, and no partial admin schema/role state existed.
- A schema and role snapshot was captured before the migration; the reviewed
  migration SHA-256 was recorded without copying credentials or database rows.
- The migration completed in one transaction with `COMMIT`.
- Both group roles are `NOLOGIN`, non-superuser, `NOCREATEDB`, `NOCREATEROLE`,
  and `NOINHERIT`; their statement, lock, and idle transaction timeouts are set.
- The read role can select exactly the seven named views, but cannot read
  `public` base tables, insert audit rows, or call the audit function.
- The audit role cannot select views or audit rows and cannot insert directly;
  it can call only the bounded audit function.
- The audit function smoke test ran inside a rolled-back transaction. The audit
  table contained zero rows after verification.

This window did not create LOGIN roles or passwords, change environment files,
start the API, modify nginx, deploy frontend code, or push GitHub.

## Rollback

Before rollback, revoke group-role memberships from deployment-managed LOGINs.
Then use `deploy/rollback-library-admin-capabilities.sql`: drop the isolated
schema, then the review, audit and read group
roles. Preserve `public.curation_decisions` as an audit journal unless a
separate destructive data-removal approval explicitly names it. Service
rollback does not alter existing public content or legacy RPCs.
