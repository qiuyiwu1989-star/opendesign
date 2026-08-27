# OpenDesign Control Room · Phase 2 contract

Status: implementation contract for `feature/library-admin-v2`.

## Objective

Connect Phase 1 to real, read-only operational evidence without putting a
password, token, mutation RPC, or deployment capability in the browser.

## Provider contract

- The browser may call only same-origin `GET /admin-api/v1/*` endpoints.
- Every response carries `source.kind`, `observedAt`, and diagnostics.
- Review, pipeline, sync, and pack evidence fail independently.
- An unavailable provider never causes static Library assets to disappear.
- The browser bundle contains no production credential and no write endpoint.

## Endpoints

- `GET /admin-api/v1/operations`: review cases and checkpointed pipeline runs.
- `GET /admin-api/v1/sync`: Database/Local/Git/GitHub/Public revision evidence.
- Development middleware may implement the endpoints using local files and
  read-only Git commands. Production implementation remains an Admin API concern.

## Pack optimization

- Do not emit the complete multi-megabyte `packs-index.json` into Admin dist.
- Emit a compact manifest containing only pack ids and build provenance.
- Load it independently so pack failure degrades `hasPack` accuracy, not the app.

## Acceptance

- Operational evidence is mapped into the unified review and pipeline model.
- Git sync evidence is explicit, comparable, timestamped, and read-only.
- Provider failures are represented as `unavailable`, never fake live data.
- Production build contains no full pack index and reports the compact size.
- Existing Phase 1 behavior, accessibility, tests, and old `admin.html` fallback remain intact.
