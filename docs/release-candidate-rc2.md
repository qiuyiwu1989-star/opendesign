# Library Admin RC2 pre-deployment rehearsal

Status: local pre-deployment evidence only. RC2 does not authorize production
database changes, credential changes, public pointer activation, service
restart, nginx reload, GitHub push or deployment.

## Release gaps closed after RC1

1. **Review capability wiring** — production preparation now provides a third,
   review-only database LOGIN and `ADMIN_REVIEW_DATABASE_URL`.
2. **Existing-install safety** — the current two-login installation uses a
   dedicated upgrade path that never rotates the active read/audit passwords.
3. **Migration confidence** — 0011 is reapplied safely on the embedded semantic
   baseline; AI fingerprint idempotency and terminal review remain intact.
4. **Rollback proof** — the capability rollback removes only the isolated Admin
   schema and group roles while retaining deployment LOGINs, the decision
   journal and runner RPCs.
5. **Immutable artifacts** — a clean local commit produces API/Web archives,
   SHA-256 sidecars and a commit/toolchain manifest. Production does not run npm.
6. **Archive safety** — production preparation rejects malformed release IDs,
   checksum mismatches, device entries and path/link traversal before extraction.
7. **Real public activation** — preparation no longer claims deployment success.
   A separate approved activation atomically switches `/opt/opendesign/current`
   and `/var/www/opendesign.cc/admin`, while preserving previous pointers.
8. **Legacy entry transition** — the reviewed nginx include redirects
   `/admin.html` to `/admin/`; the legacy file remains on disk for rollback.

## Release gates

```sh
bash -n scripts/build-library-admin-release.sh
bash -n deploy/bootstrap-library-admin-production.sh
bash -n deploy/prepare-library-admin-review-upgrade.sh
bash -n deploy/activate-library-admin-release.sh
bash -n deploy/rollback-library-admin-release.sh
cd studio
npm run typecheck
npm test
npm run build
npm run test:release --workspace @opendesign/library-admin-api
```

The release integration suite must prove all of the following:

- baseline and migrations 0002–0011 execute;
- 0011 can be applied again without duplicating its table or review function;
- read, audit and review capabilities remain mutually exclusive;
- login → HTTP terminal review → review-only SQL succeeds;
- duplicate AI decisions and duplicate terminal review remain idempotent;
- rollback retains the audit journal and removes all group-role memberships;
- preparation, immutable packaging, activation, nginx routing and rollback
  artifacts satisfy their static security contracts.

## Production boundaries

Production work remains split into independent approvals:

1. database migration;
2. existing-install review capability preparation;
3. release artifact preparation;
4. nginx configuration validation and reload;
5. named release pointer activation;
6. service restart;
7. public acceptance and observation;
8. rollback, if a predeclared trigger fires.

No vague approval combines these actions. Database-capability rollback is
separate from file-pointer rollback, and decision-journal deletion is not part
of either rollback.
