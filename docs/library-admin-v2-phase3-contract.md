# OpenDesign Control Room · Phase 3 contract

Status: local implementation contract for `feature/library-admin-v2`.

## Objective

Add a server-side Admin API that can authenticate an allowlisted curator and
read operational evidence from the self-hosted PostgreSQL database. Phase 3
produces deployable code and migration drafts, but does not touch production.

## Trust boundaries

- Browser talks only to same-origin `/admin-api/v1/*`.
- Admin API binds to `127.0.0.1`; nginx is the only future public ingress.
- Authentication uses one fixed local operator (`admin`) and a server-only
  reviewed scrypt password hash. Plaintext passwords are never persisted.
- Session is opaque to the browser, signed server-side, `HttpOnly`, `Secure`,
  `SameSite=Strict`, short-lived, and rotated after login.
- Secrets come only from process environment; startup fails closed when absent.

## Database boundaries

- A dedicated login role receives `CONNECT`, schema `USAGE`, and `SELECT` only
  on explicit admin read views/functions; no table ownership or public writes.
- Queries are parameterized, use statement/lock/idle transaction timeouts, and
  apply hard result limits.
- Review and pipeline evidence is read-only. No status update, enqueue, runner,
  publish, Git, or deployment capability exists in this service.
- Audit events use a separate narrowly scoped writer/function. Audit failure is
  reported and never silently represented as success.

## HTTP surface

- `GET /admin-api/v1/session`
- `POST /admin-api/v1/login`
- `POST /admin-api/v1/logout` (session invalidation only)
- `GET /admin-api/v1/operations`
- `GET /admin-api/v1/sync`
- `GET /admin-api/v1/health/live`
- `GET /admin-api/v1/health/ready`

All other routes and methods fail closed. JSON responses set `no-store`, CSP,
content-type and frame protections. Errors expose request ids, not secrets or
database internals.

## Audit model

Record request id, timestamp, operator id, action, outcome, route,
latency, source IP hash, user-agent hash, and bounded metadata. Never record
cookies, tokens, SQL text, passwords, or response bodies.

## Acceptance

- Unauthenticated evidence requests return 401 and never query the database.
- Invalid local credentials cannot receive a session.
- Allowed sessions expire, verify integrity, and can be invalidated.
- Operations and Sync responses satisfy the existing Phase 2 parsers.
- The SQL draft proves least privilege and contains reversible grants/revokes.
- Database/identity/audit failures are isolated, observable, and tested.
- No production connection, migration, account creation, nginx change, push,
  deployment, or secret handling occurs in this implementation phase.
