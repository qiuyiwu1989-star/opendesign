# Production read-only preflight — 2026-08-13

Status: **NO-GO for RC2 activation**. This document records public evidence and
the remaining server-side evidence gap. It is not authorization to migrate,
configure, reload, restart, activate, roll back, push, or deploy.

## Scope and method

- Public evidence was collected with unauthenticated HTTPS `GET` requests and a
  TLS handshake only.
- SSH was attempted with public-key authentication in batch mode. The host did
  not accept an available local key, so no server command was run.
- Password fallback was deliberately not used.
- No login, human-review submission, database query, file write, service action,
  Git operation, or production mutation was performed.

The repeatable public probe is:

```sh
python3 scripts/admin-public-preflight.py
```

On 2026-08-13 it passed **10 of 17** release checks.

## Verified public evidence

| Boundary | Evidence | Result |
| --- | --- | --- |
| Legacy entry | `/admin.html` returns `302` to `/admin/` | Pass |
| Admin shell | `/admin/` returns `200` | Pass |
| API liveness | live and ready endpoints return `200` | Pass |
| Anonymous boundary | session returns `authenticated: false` | Pass |
| Read auth boundary | operations and sync return `401` without a session | Pass |
| Compact Pack evidence | `/admin/pack-manifest.json` is valid v1 evidence with 920 Pack IDs | Pass |
| Human review UI | active JS bundle does not contain `/admin-api/v1/decisions/review` | **Fail** |
| Pack loader | active JS bundle refers to root `/pack-manifest.json`, while evidence is served under `/admin/` | **Fail** |
| Human review API routing | `GET /admin-api/v1/decisions/review` falls through to `404`; the RC2 exact route is absent | **Fail** |
| Admin CSP | active shell retains legacy inline/frame policy | **Fail** |
| Frame protection | `X-Frame-Options` is `SAMEORIGIN`, not RC2 `DENY` | **Fail** |
| Admin cache policy | shell lacks explicit `no-cache`/`no-store` | **Fail** |
| TLS renewal window | certificate expires 2026-08-25, 12 days after evidence capture | **Fail** |

The public state is therefore a **partial upgrade**: the new Admin entry and
read API exist, but the human terminal-review UI/API contract, Pack path, and
reviewed Admin security headers are not active together. Activating only one
more layer would deepen the version skew; RC2 must be prepared and activated as
one named, checksummed API/Web release after its database capability is proven.

## Server-side evidence still unknown

These are unknown, not assumed healthy or failed:

- actual PostgreSQL server version (the reviewed target is 18.4.x);
- migrations and objects through `0011_curation_decisions.sql`;
- isolated read, audit, and review LOGIN memberships;
- presence of `ADMIN_REVIEW_DATABASE_URL` without exposing its value;
- active Admin API release pointer, port and systemd unit;
- active nginx composition versus repository RC2 include;
- certbot renewal timer state and renewal history;
- rollback pointer integrity.

The repository now includes a server-local, read-only collector:

```sh
sudo bash deploy/preflight-library-admin-production.sh
```

It checks service state, nginx syntax, loopback binding, environment **key
names only**, PostgreSQL objects/roles/privileges, release symlinks, and the
certificate renewal timer. It never sources or prints the environment file and
contains no migration, grant, reload, restart, activation, or write operation.
Run it only after an approved public-key access path is available, or have the
server operator return its redacted PASS/FAIL output.

## RC2 release blockers

1. **P0 — TLS renewal assurance.** Verify the renewal timer and renewal logs
   immediately. Renew under a separately approved operational action if the
   timer cannot prove a safe renewal before 2026-08-25.
2. **P0 — internal state evidence.** Collect the server-local preflight result;
   do not migrate or activate while database/service state is unknown.
3. **P0 — version consistency.** Apply the reviewed 0011/review capability and
   activate the matching API and Web artifacts as separately authorized steps.
4. **P1 — nginx contract.** Activate the exact human-review route, strict Admin
   CSP/frame/cache headers, and the `/admin/pack-manifest.json` contract.
5. **P1 — acceptance.** Re-run the public probe. All 17 checks must pass before
   the observation window begins.

## Go criteria

RC2 is eligible for explicit deployment approvals only when:

- the server-local preflight exits `0` without exposing secrets;
- the PostgreSQL version and 0011 objects are verified on production;
- read/audit/review capabilities are mutually exclusive;
- a clean commit produces matching checksummed API and Web archives;
- nginx configuration validates before reload;
- a rollback target exists and resolves;
- certificate renewal has at least the 21-day public safety window or a verified
  automatic renewal path with current evidence;
- the post-activation public probe passes 17/17.

Until then, the correct action is **do not activate RC2**.
