# OpenDesign Control Room · Phase 2 QA

Status: executable acceptance guide for `feature/library-admin-v2`. It adds to,
and never replaces, the Phase 1 matrix in `docs/library-admin-v2-qa.md`.

## Release checkpoints

| Gate | Pass condition | Failure semantics |
| --- | --- | --- |
| Operations evidence | Browser makes one same-origin `GET /admin-api/v1/operations`; valid review cases and ordered checkpoints map to the existing domain. | Provider is labelled `unavailable`; static Library assets and derived quality reviews remain visible. |
| Sync evidence | Browser makes one same-origin `GET /admin-api/v1/sync`; exactly Database, Local, Git, GitHub and Public are timestamped and `readOnly: true`. | All five nodes become explicit `unknown`; no location is reported as synchronized. |
| Pack membership | Build emits one `/pack-manifest.json` with sorted ids and `packs-index.json` provenance. | Missing/invalid manifest only degrades Pack membership accuracy; it cannot prevent the site index or Control Room shell from loading. |
| Read-only boundary | Provider requests use `GET`; browser source/dist contains no password, token, mutation RPC, write route or deploy action. | Any write-capable endpoint or secret is a release blocker. |
| Phase 1 regression | Original app and snapshot suites remain green; old root `admin.html` remains untouched. | Phase 2 does not ship until every Phase 1 assertion is restored. |

## Compact manifest contract

`src/data/pack/manifest.ts` is the schema boundary. Build code may pass the
full index to `createCompactPackManifest`, but the returned asset contains only:

- `schema = opendesign.pack-manifest.v1`;
- sorted, unique `packIds`;
- `provenance.source = packs-index.json`;
- build time, source count, and optional source bytes/revision.

Runtime parsing is intentionally partial: malformed individual ids are ignored
and reported while valid ids remain available. A malformed root, schema, or
provenance makes only the Pack provider unavailable.

## Production artifact budgets

Budgets are raw/uncompressed so results do not vary by compression tool:

- compact `pack-manifest.json`: at most 64 KiB;
- each JavaScript output: at most 350 KiB;
- total Admin `dist`: at most 1.25 MiB;
- `packs-index.json`: forbidden at every depth.

The pure gate and its unit tests live in
`src/test/production-build-guard.ts`. CI should recursively list built files,
pass `{ path, bytes }` records to `verifyProductionBuild`, and fail on any
reported error. The build log should print manifest bytes and total dist bytes.

Manual equivalent after `npm run build`:

```sh
test ! -e dist/packs-index.json
test "$(find dist -name packs-index.json -type f | wc -l | tr -d ' ')" = 0
test "$(find dist -name pack-manifest.json -type f | wc -l | tr -d ' ')" = 1
test "$(stat -f %z dist/pack-manifest.json)" -le 65536
find dist -type f -name '*.js' -exec stat -f '%z %N' {} \;
du -sk dist
```

On GNU/Linux, replace `stat -f %z` with `stat -c %s`. The final two lines are
also evaluated by the automated guard; `du` is only a human-readable report.

## Failure matrix

Run each provider case independently. In every row, navigation and static
Library assets must remain usable.

| Injected failure | Required result |
| --- | --- |
| Operations HTTP 503 / invalid JSON | Reviews and pipelines source `unavailable`; no synthetic live queue/run appears. |
| Sync HTTP 503 / invalid node | Sync source `unavailable`; five `unknown` read-only nodes appear. |
| Pack HTTP 503 | Existing site-index hints may remain, accompanied by a Pack diagnostic; app does not throw. |
| One invalid Pack id | Valid ids remain usable; state is `degraded` with per-record diagnostic. |
| Sites index failure | Existing labelled fallback behavior remains unchanged; operations/sync must not be rewritten as Library data. |

## Commands

From `studio/apps/library-admin`:

```sh
npm run typecheck
npm run test
npm run build
```

Then run the artifact checks above and the root Studio test/typecheck/build
commands. Browser QA covers Today, unified review, pipelines, Sync, keyboard
navigation, a 390 px viewport, zero horizontal overflow, and zero console errors.
No production connection, push, deploy, database mutation, or remote write is
part of this acceptance run.
