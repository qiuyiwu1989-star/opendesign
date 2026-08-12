# OpenDesign Control Room · Phase 1 QA

Status: executable acceptance plan for `feature/library-admin-v2`.

## Scope and safety boundary

This lane verifies the local, read-oriented Control Room shell defined in
`library-admin-v2-contract.md`. It does not connect to production, mutate Supabase,
create or push a Git branch, merge, deploy, or replace the existing `admin.html`.

The old admin is used only as behavioral evidence. Its direct status updates,
job enqueue actions, copied ingest commands, and six-second polling are explicitly
not acceptance criteria for Phase 1. The new shell may preview an action, but it
must not execute one.

## Test strategy

- Prefer accessible queries (`role`, accessible name, `aria-current`) over classes
  or DOM structure.
- Use `data-testid` only when a stable repeated entity id cannot be expressed with
  an accessible query, for example `today-action-{id}`.
- Inject `AdminSnapshot` through `App({ initialSnapshot })` for deterministic view
  tests. Exercise `loadAdminSnapshot()` separately for loading and failure states.
- Treat `live`, `snapshot`, and `unavailable` as product truth, not styling details.
- Do not make a test pass by weakening an assertion. A missing contract behavior
  remains a reported implementation gap.

## Automated acceptance matrix

| Area | Required observation | Preferred query / assertion | Failure guarded against |
|---|---|---|---|
| Today priorities | At least three tasks are visible in priority order and each is keyboard reachable. | Find the Today heading, then a named list and its first three links/buttons; assert their titles and order from `snapshot.today`. | Count-only dashboard with no answer to “what next?” |
| Content funnel | Review/assets/pipeline counts are visible without implying that snapshot data is live. | Query named funnel region and exact count labels; also assert the global source-state notice. | Stale numbers presented as production truth. |
| Unified review | Discovery, submission, quality, and origin cases can coexist in one view, with source text distinct from status. | Navigate by named link/button to Review; query each case by title, then assert a source badge/name within it. | Separate queues or source encoded only by color. |
| Review keyboard flow | A review case and its preview action are reachable and operable with semantic controls. | `getByRole("button" | "link", { name: ... })`; trigger activation and assert preview output. | Click-only cards or non-semantic div controls. |
| Resource quality axes | Every resource exposes Evidence tier, Curation status, and Origin status as three independent values. | Open Assets; locate resource by name and assert `E0..E3`, curation value, and origin value in the same item/row. | Legacy Tier 1/Tier 2 collapsed into a single “quality” badge. |
| Origin unavailable | An unavailable origin is stated in text and not represented only by a warning color. | Assert exact `unavailable`/localized equivalent plus a textual explanation. | Silent dead origin or color-only failure state. |
| Source state | `snapshot` and `unavailable` are explicit; snapshot shows `generatedAt`; unavailable does not render sample data as live truth. | Inject each source state; query `status`/alert text and timestamp; assert live wording is absent for non-live states. | Demo/sample data masquerading as current production data. |
| Loading / empty / error | Loading, an intentionally empty snapshot, and adapter failure are separate states. | Render without injection and mock pending/rejected loader; inject empty arrays; assert progress/status, empty guidance, and alert respectively. | One generic blank screen for all data conditions. |
| Pipeline checkpoints | A run shows ordered checkpoints and each checkpoint's state (`success`, `running`, `failed`, `pending`). | Navigate to Pipelines; locate run, query ordered/list items and assert labels and state text in order. | A single final job state hiding the failed phase. |
| Pipeline read-only | No retry/run/execute control exists in Phase 1. | Assert absence of buttons named retry/run/execute; any inspection control must not mutate data. | Reintroducing old job enqueue behavior. |
| GitHub drift | Local, Git workspace, GitHub, and public states are individually visible, including `unknown`/`unavailable`. | Navigate to Sync; query four named nodes/rows and assert their state and drift summary. | A single “synced” badge hiding where drift exists. |
| Sync read-only | Push, merge, deploy, publish, and remote branch creation controls do not exist. | `queryByRole("button", { name: /push|merge|deploy|publish|.../i })` is null. | Accidental production/repository mutation from the browser shell. |
| Preview-only actions | Every offered action is named as a preview and only opens an impact summary. | Activate a button with “Preview/预览” in its accessible name; assert a preview heading/impact text and no mutation adapter call. | Ambiguous button that appears to perform an irreversible action. |
| Navigation | Today, Review, Assets, Pipelines, and Sync are present; current destination is exposed to assistive tech. | Query navigation landmark and five accessible links/buttons; activate each and assert `aria-current="page"` plus matching main heading. | Hidden sections without usable navigation state. |
| Landmarks | Navigation and one primary `main` landmark exist; each screen has a meaningful heading. | `getByRole("navigation")`, `getByRole("main")`, `getByRole("heading", { level: 1 })`. | Screen-reader users cannot orient themselves. |
| Non-color status | Source, quality, checkpoint, and drift states include readable labels. | Assert state text within each entity; do not inspect CSS color as the only assertion. | Color-only communication. |

## Fixture coverage

The shared fixture should deliberately include:

- three Today actions with different priorities and sources;
- one review case from each `ReviewSource`;
- resources that exercise `E0` and `E3`, all curation states, and at least one
  `unavailable` origin;
- one fully successful pipeline and one run with a failed checkpoint followed by
  pending checkpoints;
- Sync data with at least one drift, one match, and one unknown/unavailable node;
- diagnostics that make snapshot provenance visible.

An empty fixture contains the same schema with empty collections. It is not an
`unavailable` response and must produce actionable empty-state copy.

## Manual verification

These checks are intentionally visual or time-based and do not belong in brittle
DOM assertions:

1. A curator can point to the top three next actions within ten seconds of opening
   Today at a desktop viewport.
2. Focus indicators remain clearly visible through the full navigation, list, and
   preview flow using only the keyboard.
3. Source, quality-axis, checkpoint, and drift states remain distinguishable in
   forced-colors/high-contrast mode and without relying on hue.
4. The shell remains usable at a narrow viewport without hiding source provenance
   or the current navigation destination.
5. Snapshot and unavailable notices have enough visual hierarchy that they cannot
   be mistaken for a quiet footer disclaimer.

## Local verification commands

Run from `studio/` after the app scaffold and dependencies are integrated:

```bash
npm --workspace @opendesign/library-admin run test
npm --workspace @opendesign/library-admin run typecheck
npm --workspace @opendesign/library-admin run build
```

Then run the aggregate checks:

```bash
npm run test
npm run typecheck
npm run build
```

The existing `admin.html` remains the fallback and must not be modified or removed
as part of this phase.
