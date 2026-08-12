# OpenDesign Control Room · Phase 3 QA matrix

Status: local acceptance matrix. No server connection, production migration,
deployment, nginx activation, secret handling, or public write is authorized.

## Security matrix

| Boundary | Executable / review evidence | Pass condition |
| --- | --- | --- |
| Cookie | `security.security.test.ts` | `__Host-`, Path `/`, no Domain, HttpOnly, Secure, SameSite Strict, max age <= 24h; malformed value denied. |
| Session | security tests plus HTTP auth tests | Signed purpose-bound payload, numeric actor id, <=24h, expiry/tamper/invalidation denied, session id rotates at login. |
| CSRF / OAuth | security tests plus callback tests | State signed, <=5m, nonce stored and atomically consumed once, return path limited to `/admin`; logout also verifies Origin/Sec-Fetch-Site. |
| Headers / CSP | security tests plus HTTP response tests | JSON `no-store`, JSON content type, request id, CSP `default-src 'none'`, frame deny, nosniff, no referrer. |
| Route / method | HTTP route tests and nginx example review | Exact contract allowlist only; GET routes cannot receive bodies; logout is POST only; unknown prefix route fails closed. |
| Rate limiting | security tests and nginx staging validation | Separate auth/read budgets, bounded retry, fail closed under key exhaustion; nginx is the public first boundary. |
| Proxy trust | security tests and topology review | Forwarded address trusted only from loopback peer; app listens only on 127.0.0.1; nginx overwrites X-Forwarded-For. |
| Audit privacy | security tests and audit integration tests | IP/UA HMAC with distinct namespace/key; sensitive keys/values redacted; no cookie/token/code/SQL/password/body logging. |
| Secrets | startup/config tests and artifact scan | Required env missing/malformed fails startup; secrets never in response/log/build/client bundle. |
| Database | migration privilege assertions | Unauthenticated requests make zero DB queries; dedicated role has explicit SELECT only; statement/result limits; audit writer isolated. |
| Deployment | nginx/systemd examples plus runbook review | Loopback-only upstream, body/method/rate boundaries, root-only EnvironmentFile, systemd hardening, each production action separately approved. |

## Required command gates

Run from `studio/` after all Phase 3 lanes are integrated:

```sh
npm --workspace @opendesign/admin-api run typecheck
npm --workspace @opendesign/library-admin-api run test
npm --workspace @opendesign/admin-api run build
npm run typecheck
npm run test
npm run build
```

Artifact and configuration review:

```sh
rg -n "(BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|gh[porsu]_|postgres(ql)?://[^[:space:]]+:[^[:space:]@]+@)" studio/apps/admin-api/dist deploy docs
nginx -t
systemd-analyze security opendesign-admin-api.service
```

The last two commands run only on an approved staging/server composition; they
are not authorization to change the current server.

## Integration acceptance

- Operations and Sync output pass the existing Phase 2 provider parsers.
- An unauthenticated evidence request is rejected before any pool query.
- Database, GitHub, public revision, identity, and audit faults are isolated and
  expose request ids without internals.
- Audit failure is explicit; no success response claims an audit record exists.
- Read queries are parameterized, bounded, timed out, and use explicit columns.
- `/health/live` proves process response only; `/health/ready` proves required
  dependencies without leaking configuration.
- Existing Library/Admin production build guards remain green.
- Git diff contains no generated secret, local `.env`, account, migration output,
  deployment mutation, or production data.

## Release blockers

- No Phase 3 production database role/migration has been applied.
- No OAuth application/allowlist/session secret has been provisioned.
- No nginx or systemd example has been installed or activated.
- No public browser acceptance is valid until those actions receive explicit,
  separate authorization and the green local build is reviewed.
