# OpenDesign Admin API runbook

This is a reviewable future deployment procedure for the least-privilege Phase 3
Admin API. It is not deployment authorization. Every production migration,
configuration change, service start/restart, nginx activation, rollback, and
public release requires an explicit approval for that exact action.

## Trust and release boundaries

- The API binds to `127.0.0.1`; only nginx exposes `/admin-api/v1/*`.
- Authentication uses one fixed local operator name (`admin`) and a deployment-managed scrypt password hash.
- Browser sessions are opaque, signed, short-lived `__Host-` cookies.
- Database evidence is read through explicit least-privilege views/functions.
- The service may record one authenticated human terminal review only through a
  bounded security-definer function. It cannot enqueue, publish, delete, push
  Git, deploy, or otherwise write public Library state. Review and audit writing
  use separate, narrowly scoped database capabilities.
- Never paste secret values into tickets, chat, logs, shell history, Git, or
  systemd unit files. Provision the root-owned environment file out of band.

## Required environment names

Values are deliberately absent. The implementation must fail closed if a
required value is missing or malformed.

| Name | Purpose / constraint |
| --- | --- |
| `ADMIN_API_HOST` | Must be exactly `127.0.0.1`. |
| `ADMIN_API_PORT` | Loopback listener port; production release uses `18790` to avoid the existing `8790` listener. |
| `ADMIN_API_PUBLIC_ORIGIN` | Exact HTTPS origin used for Origin checks. |
| `ADMIN_API_SIGNING_SECRET` | At least 32 unpredictable bytes; session signing only. |
| `ADMIN_API_AUDIT_HASH_KEY` | Separate at-least-32-byte key for IP/UA HMAC redaction. |
| `ADMIN_API_ADMIN_USERNAME` | Must be exactly `admin`. |
| `ADMIN_API_PASSWORD_HASH` | Reviewed scrypt hash generated interactively; never plaintext. |
| `ADMIN_DATABASE_URL` | Dedicated read login, not an owner/service-role URL. |
| `ADMIN_AUDIT_DATABASE_URL` | Separately scoped audit client URL. |
| `ADMIN_REVIEW_DATABASE_URL` | Separate LOGIN that can execute only the bounded human-review function; it owns no table. |
| `ADMIN_API_SESSION_TTL_SECONDS` | Optional; implementation default `900`, maximum `3600` seconds. |

Local/Git/GitHub/Public sync evidence providers are not part of this release.
The API must render those four nodes as `unknown`; do not configure invented
revision values. A later reviewed release may add fixed repository/public
revision endpoints.

When deployment wiring settles on different names, update this table, the
service unit, startup validation tests, and operator checklist together.

## Preflight (read-only)

Public, unauthenticated release drift can be checked without server access:

```sh
python3 scripts/admin-public-preflight.py
```

The command performs HTTPS GET requests and a TLS handshake only. It must pass
all checks after activation. Before any production mutation, run the reviewed
server-local collector from the repository checkout:

```sh
sudo bash deploy/preflight-library-admin-production.sh
```

That collector reports environment key names, never values, and contains no
migration, configuration write, reload, restart, activation, or rollback step.

1. Confirm the reviewed commit and a clean production build artifact.
2. Run Admin API typecheck and tests, including every `*.security.test.ts`.
   The required release gate is `npm run test:release --workspace
   @opendesign/library-admin-api`; it must report the full migration chain,
   privilege matrix, idempotent recommendation, HTTP terminal-review, deployment
   contract and rollback-preservation tests.
3. Confirm no secret or production URL exists in the artifact or Git diff.
4. Review SQL grants/revokes and their rollback in the migration draft.
5. Confirm the database login owns nothing and has no table write privilege.
6. Run `nginx -t` against a staging composition of the include example.
7. Run `systemd-analyze security opendesign-admin-api.service` on the reviewed
   unit and document any hardening exception.
8. Confirm the application refuses any host other than `127.0.0.1`.
9. From a clean reviewed commit, run
   `bash scripts/build-library-admin-release.sh /absolute/output/path`; verify
   both archive hashes against their sidecars and retain the manifest. The
   production host must not run npm or contact a package registry.

Stop after preflight. Production actions below each need separate approval.

## Migration order

1. With explicit **migration approval**, take a schema/grant snapshot, confirm
   migrations through `0009` are present, then apply the reviewed draft
   `supabase/migrations/0010_admin_read_api.sql`, followed by
   `supabase/migrations/0011_curation_decisions.sql`, then
   `supabase/migrations/0012_curation_review_events.sql`, using the migration role.
2. From the read login, prove only the named views/functions are selectable.
3. Prove direct table reads and every insert/update/delete/execute outside the
   allowlist fail.
4. From the audit login, prove only the bounded audit function can execute. The
   audit client uses a normal transaction because PostgreSQL cannot invoke the
   writing function in a read-only transaction; database grants remain the
   hard boundary.
5. From the review login, prove only
   `opendesign_admin_read.review_curation_decision(uuid,text,text,text,text,text)` can
   execute. Prove base-table reads/writes, runner RPCs, audit writes, job enqueue,
   delete, and any public-state mutation fail. Confirm duplicate review returns
   `already_reviewed` without changing the original AI `recommendation`.
6. Save command exit status and object/grant names; never save credentials or
   returned operational records in CI artifacts.

If any privilege assertion fails, run the reviewed revoke/rollback transaction
and do not continue to service deployment.

## Service and nginx activation

1. With explicit **migration/configuration approval**, prepare the named,
   checksummed artifacts. For a first install, the bootstrap creates three
   isolated database LOGINs and a pending environment file and refuses any
   pre-existing deployment login. For the current two-login installation, use
   `deploy/prepare-library-admin-review-upgrade.sh`: it adds only the review
   LOGIN, preserves the active read/audit passwords, and writes a pending
   environment. Neither path switches public file pointers.
2. With explicit **configuration approval**, provision/complete the root-owned
   `/etc/opendesign/admin-api.env` (`root:root`, mode `0600`) without printing it.
3. With explicit **nginx configuration approval**, compose the reviewed include,
   run `nginx -t`, then reload nginx. Before file activation, `/admin/` may be
   unavailable; the legacy `admin.html` file remains on disk as rollback evidence.
4. With explicit **deployment approval for the named release**, run
   `deploy/activate-library-admin-release.sh <release-id>`. It captures previous
   Admin API and Admin Web pointers and atomically switches both; it does not
   restart a service or reload nginx.
5. Install the hardened unit, run `systemctl daemon-reload`, then start/restart
   the service only under explicit **service restart approval**.
6. Verify locally before public acceptance: live must respond; ready may report unavailable
   until dependencies pass. A health monitor treats `000`/`5xx` as down rather
   than hard-coding a single success status.

## Health and public acceptance

Run after approved activation, without recording response bodies containing
operational evidence:

- Loopback is listening and no `0.0.0.0:<port>` / `[::]:<port>` listener exists.
- `GET /admin-api/v1/health/live` responds without database secrets.
- `GET /admin-api/v1/health/ready` isolates dependency failure and returns a
  request id, never driver/SQL internals.
- Unauthenticated `operations` and `sync` return `401` and do not query data.
- Unknown routes return `404`; wrong methods are rejected (`404`/`405`) before
  reaching a write-capable handler; bodies above the nginx limit are rejected.
- `POST /admin-api/v1/decisions/review` requires a valid session, exact
  same-origin JSON, a 4..1000-character reason, and a pending decision. Confirm
  preserves the AI recommendation; override requires an explicit final
  recommendation; repeated reviews return `409`. Neither action creates work or
  changes public content.
- Invalid usernames/passwords never receive a session. Valid sessions use `Secure`,
  `HttpOnly`, `SameSite=Strict`, no `Domain`, and rotate on login.
- Logout accepts only same-origin POST, invalidates the session, and expires the
  cookie. A replayed invalidated session returns `401`.
- Auth/read rate limits return `429` and a bounded retry interval.
- Public JSON has `no-store`, strict CSP, frame/nosniff/referrer protections.
- Audit has actor/action/outcome/request id/latency and hashed IP/UA; it never
  contains cookies, tokens, SQL, passwords, or response bodies.
- Existing public Library remains unchanged. The legacy `admin.html` file stays
  on disk as rollback evidence, while its public route enters the new `/admin/`
  Control Room after the reviewed nginx include is active.

## Rollback

Rollback is also a production action and requires explicit approval.

1. Disable only the Admin API nginx include and validate/reload nginx.
2. Stop the Admin API service; do not disturb the public static Library.
3. With explicit rollback approval, run
   `deploy/rollback-library-admin-release.sh` to restore both previous file
   pointers atomically, then restart only the Admin API if needed.
4. Revoke LOGIN memberships first. Then, only with separately reviewed
   destructive-action approval, use the consolidated rollback order documented
   in `deploy/rollback-library-admin-capabilities.sql` to drop
   `opendesign_admin_read` and the three NOLOGIN group roles. Preserve
   `public.curation_decisions` by default.
5. Rotate affected secrets if exposure is suspected; invalidate active sessions.
6. Repeat public Library and Admin API route checks and preserve redacted logs.

## Evidence retention

Keep commit id, build/test result, migration id, privilege assertions, nginx
validation, unit hardening result, health status codes, and rollback decision.
Never retain environment values, cookies, tokens, raw IP/user-agent,
SQL text containing values, operational response bodies, or database dumps.
