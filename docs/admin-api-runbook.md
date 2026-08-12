# OpenDesign Admin API runbook

This is a reviewable future deployment procedure for the read-only Phase 3
Admin API. It is not deployment authorization. Every production migration,
configuration change, service start/restart, nginx activation, rollback, and
public release requires an explicit approval for that exact action.

## Trust and release boundaries

- The API binds to `127.0.0.1`; only nginx exposes `/admin-api/v1/*`.
- GitHub OAuth authority is an allowlist of immutable numeric GitHub user ids.
- Browser sessions are opaque, signed, short-lived `__Host-` cookies.
- Database evidence is read through explicit least-privilege views/functions.
- The service cannot review, enqueue, publish, push Git, deploy, or write public
  Library state. Audit writing is a separate, narrowly scoped capability.
- Never paste secret values into tickets, chat, logs, shell history, Git, or
  systemd unit files. Provision the root-owned environment file out of band.

## Required environment names

Values are deliberately absent. The implementation must fail closed if a
required value is missing or malformed.

| Name | Purpose / constraint |
| --- | --- |
| `ADMIN_API_HOST` | Must be exactly `127.0.0.1`. |
| `ADMIN_API_PORT` | Loopback listener port; implementation/example default is `8790`. |
| `ADMIN_API_PUBLIC_ORIGIN` | Exact HTTPS origin used for Origin and OAuth checks. |
| `ADMIN_API_SIGNING_SECRET` | At least 32 unpredictable bytes; session/state signing only. |
| `ADMIN_API_AUDIT_HASH_KEY` | Separate at-least-32-byte key for IP/UA HMAC redaction. |
| `ADMIN_API_GITHUB_CLIENT_ID` | GitHub OAuth application id. |
| `ADMIN_API_GITHUB_CLIENT_SECRET` | GitHub OAuth secret. |
| `ADMIN_API_GITHUB_ALLOWED_USER_IDS` | Comma-separated immutable numeric GitHub ids. |
| `ADMIN_DATABASE_URL` | Dedicated read login, not an owner/service-role URL. |
| `ADMIN_AUDIT_DATABASE_URL` | Separately scoped audit client URL. |
| `ADMIN_API_SESSION_TTL_SECONDS` | Optional; implementation default `900`, maximum `3600` seconds. |
| `ADMIN_API_STATE_TTL_SECONDS` | Optional; implementation default `300`, maximum remains short-lived. |

Local/Git/GitHub/Public sync evidence providers are not part of this release.
The API must render those four nodes as `unknown`; do not configure invented
revision values. A later reviewed release may add fixed repository/public
revision endpoints.

When deployment wiring settles on different names, update this table, the
service unit, startup validation tests, and operator checklist together.

## Preflight (read-only)

1. Confirm the reviewed commit and a clean production build artifact.
2. Run Admin API typecheck and tests, including every `*.security.test.ts`.
3. Confirm no secret or production URL exists in the artifact or Git diff.
4. Review SQL grants/revokes and their rollback in the migration draft.
5. Confirm the database login owns nothing and has no table write privilege.
6. Run `nginx -t` against a staging composition of the include example.
7. Run `systemd-analyze security opendesign-admin-api.service` on the reviewed
   unit and document any hardening exception.
8. Confirm the application refuses any host other than `127.0.0.1`.

Stop after preflight. Production actions below each need separate approval.

## Migration order

1. With explicit **migration approval**, take a schema/grant snapshot, confirm
   migrations through `0009` are present, then apply the reviewed draft
   `supabase/migrations/0010_admin_read_api.sql` using the migration role.
2. From the read login, prove only the named views/functions are selectable.
3. Prove direct table reads and every insert/update/delete/execute outside the
   allowlist fail.
4. From the audit login, prove only the bounded audit function can execute. The
   audit client uses a normal transaction because PostgreSQL cannot invoke the
   writing function in a read-only transaction; database grants remain the
   hard boundary.
5. Save command exit status and object/grant names; never save credentials or
   returned operational records in CI artifacts.

If any privilege assertion fails, run the reviewed revoke/rollback transaction
and do not continue to service deployment.

## Service and nginx activation

1. With explicit **configuration approval**, provision a root-owned
   `/etc/opendesign/admin-api.env` (`root:root`, mode `0600`) without printing it.
2. With explicit **deployment approval**, install the reviewed build under an
   immutable release directory and repoint `/opt/opendesign/current` atomically.
3. Install the hardened unit, run `systemctl daemon-reload`, then start/restart
   the service only under explicit **service restart approval**.
4. Verify locally before nginx: live must respond; ready may report unavailable
   until dependencies pass. A health monitor treats `000`/`5xx` as down rather
   than hard-coding a single success status.
5. With explicit **nginx change approval**, compose the reviewed locations into
   the HTTPS server, run `nginx -t`, then reload nginx.

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
- OAuth state rejects tampering, replay, expiry, and off-origin return targets.
- Disallowed GitHub ids never receive a session. Allowed sessions use `Secure`,
  `HttpOnly`, `SameSite=Strict`, no `Domain`, and rotate on login.
- Logout accepts only same-origin POST, invalidates the session, and expires the
  cookie. A replayed invalidated session returns `401`.
- Auth/read rate limits return `429` and a bounded retry interval.
- Public JSON has `no-store`, strict CSP, frame/nosniff/referrer protections.
- Audit has actor/action/outcome/request id/latency and hashed IP/UA; it never
  contains cookies, OAuth code/tokens, SQL, passwords, or response bodies.
- Existing public Library and old admin fallback remain unchanged.

## Rollback

Rollback is also a production action and requires explicit approval.

1. Disable only the Admin API nginx include and validate/reload nginx.
2. Stop the Admin API service; do not disturb the public static Library.
3. Point `/opt/opendesign/current` back to the last known-good artifact if the
   service itself needs investigation.
4. Revoke LOGIN memberships first. Then, only with separately reviewed
   destructive-action approval, use the migration-tail rollback transaction to
   drop `opendesign_admin_read` and the two NOLOGIN group roles.
5. Rotate affected secrets if exposure is suspected; invalidate active sessions.
6. Repeat public Library and Admin API route checks and preserve redacted logs.

## Evidence retention

Keep commit id, build/test result, migration id, privilege assertions, nginx
validation, unit hardening result, health status codes, and rollback decision.
Never retain environment values, cookies, OAuth codes/tokens, raw IP/user-agent,
SQL text containing values, operational response bodies, or database dumps.
