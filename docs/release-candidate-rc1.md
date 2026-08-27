# Library quality RC1 release evidence

Status: local release candidate only. Nothing in this checklist authorizes a
production migration, credential change, service restart, nginx reload, GitHub
push, deployment, cron installation or public write.

## Scope

RC1 covers the daily AI curation journal and its human terminal-review path:

- seven bounded quality signals with fail-closed spam, advertising and safety
  rules;
- fingerprint-based idempotency, with no automatic collect job or publication;
- authenticated same-origin human confirmation or explicit override;
- immutable AI recommendation plus separate final recommendation and review
  evidence;
- three mutually bounded database roles for read evidence, audit append and
  terminal review.

## Automated release gates

From `studio/`:

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run test:release --workspace @opendesign/library-admin-api
```

From the repository root:

```sh
python3 -m py_compile scripts/auto-evaluate.py
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
python3 scripts/auto-evaluate.py --fixture scripts/fixtures/daily-curation-sample.json --limit 1
bash scripts/smoke.sh
git diff --check
```

The migration test uses a disposable process-local PostgreSQL runtime. It
applies `supabase/schema.sql` and migrations 0002–0011, then proves:

1. all three capability roles are `NOLOGIN` and mutually bounded;
2. duplicate AI evaluation fingerprints return one journal row;
3. terminal override preserves the original AI recommendation;
4. a real login/session and HTTP review reaches SQL through the review-only
   role;
5. a second terminal review is rejected with conflict semantics.

This gate complements rather than replaces a pre-production clone rehearsal on
the target PostgreSQL version. The documented production target is PostgreSQL
18.4; that version must still be verified read-only and rehearsed on a clone at
the start of the release window.

## Immutable release artifacts

After the reviewed commit is clean, build outside the repository with an
absolute output path:

```sh
bash scripts/build-library-admin-release.sh /absolute/path/to/rc-output
```

The builder performs a clean dependency install, all workspace gates, the
release integration suite and production builds. It emits separate Admin API
and Admin Web archives, SHA-256 sidecars, and `release-manifest.json` containing
the exact commit, toolchain and artifact hashes. The production bootstrap must
not contact npm; it verifies archive hashes and members before extraction.

## Promotion checklist

- Current commit is reviewed, immutable and has a clean worktree.
- CI gates above are green from a clean install.
- The known PPTX parser advisory remains contained by the documented input
  guard; no untrusted file bypass is enabled.
- A target-version PostgreSQL clone rehearsal records migration IDs, role/object
  names and exit status, but no credentials or operational rows.
- Deployment-managed LOGIN roles own no objects and each receives exactly one
  group-role membership.
- Nginx and systemd staging validations pass before any public switch.
- Rollback owner, observation window and stop conditions are named.
- Explicit production approvals are obtained independently for migration,
  configuration, service restart, nginx activation and deployment.

## Stop and rollback conditions

Stop promotion on any migration error, privilege outside the allowlist,
unexpected write/publication, missing audit evidence, authentication bypass,
unbounded request, dependency readiness failure or public Library regression.

For service rollback, remove the Admin API nginx exposure and stop/repoint only
the Admin API service. Revoke deployment LOGIN memberships before removing the
isolated schema and three group roles. Preserve the decision journal by default;
deleting it is a distinct destructive action requiring explicit approval.
