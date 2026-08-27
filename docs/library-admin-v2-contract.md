# OpenDesign Control Room · Phase 1 contract

Status: implementation contract for `feature/library-admin-v2`.

## Product boundary

Phase 1 is a local, read-oriented replacement shell for the existing `admin.html`.
It must not deploy, write production data, push GitHub, or change authentication.
The existing admin remains available as a fallback.

## Workspace boundary

- UI lane: `studio/apps/library-admin/src/components/**`, `App.tsx`, `styles.css`, app scaffold.
- Data lane: `studio/apps/library-admin/src/data/**`, `src/domain.ts`.
- Verification lane: `studio/apps/library-admin/src/**/*.test.ts(x)`, `docs/library-admin-v2-*.md`.
- Root integrator owns shared root/lock/config changes and final integration.

## Required screens

1. `today`: prioritized review tasks, content funnel, pipeline and GitHub signals.
2. `review`: unified cases from discovery, submission, and quality review.
3. `assets`: searchable design resources with three-axis quality state.
4. `pipelines`: checkpoint-based run summaries, read-only in Phase 1.
5. `sync`: local/Git/GitHub/public drift visualization, read-only in Phase 1.

## Domain vocabulary

```ts
type EvidenceTier = "E0" | "E1" | "E2" | "E3";
type CurationStatus = "unreviewed" | "accepted" | "recommended";
type OriginStatus = "alive" | "changed" | "degraded" | "unavailable";
type ReviewSource = "discovery" | "submission" | "quality" | "origin";
type SignalState = "healthy" | "attention" | "blocked" | "unknown";
```

Data adapters return an explicit source state (`live`, `snapshot`, `unavailable`) and
must never represent sample data as production truth. UI actions are preview-only.

## Acceptance

- A curator can identify the top three actions in under ten seconds.
- Review source and quality axes are visually distinct and keyboard reachable.
- Empty, loading, snapshot, and unavailable states are explicit.
- No secret, production mutation, deployment, push, merge, or remote branch creation.
- `npm run typecheck`, tests, and production build pass locally.
