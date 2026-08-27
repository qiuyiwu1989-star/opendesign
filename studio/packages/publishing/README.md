# Studio Publishing Candidate Ledger

This package is a pure, append-only review state machine. It creates a human-approved **candidate snapshot**, never a publication.

## Flow

`draft → in_review → approved_candidate | changes_requested | rejected`

- `createReviewLedger` freezes the accepted AI/import evidence as the first event.
- `submitReview` pins the current human revision and its validated document snapshot (the revision may be newer than the AI draft).
- `approveCandidate` requires a human actor and an explicit current, human-edited `SceneDocument`.
- `requestChanges` and `rejectReview` require a human actor and a non-empty reason.
- `replayReviewLedger` rebuilds state and re-runs transition and approval gates.

All commands carry a `commandId`. Replaying an identical command is idempotent; reusing the ID with different content is a conflict.

## Approval gates

Approval fails closed unless all conditions are true:

- the HTML importer result is `accepted`;
- submitted, expected, and current revision IDs match;
- the approval document exactly matches the submitted review snapshot;
- the current document passes the Scene IR contract;
- document identity, Design Pack pin, and source provenance still match the accepted import;
- declared source coverage is non-empty, resolved, used, and matches document provenance;
- the deterministic QA report belongs to the current document, has an internally consistent summary, and contains no blocker or error;
- artifact IDs are unique and have lowercase SHA-256 digests;
- the decision actor is human and provides a reason.

The candidate preserves the current human-edited document while the draft event preserves the original AI output and accepted import. Every candidate has `notPublished: true`.

## Deliberate limits

The package contains no database, filesystem, HTTP, GitHub, public-site, or deployment adapter. It does not compute artifact hashes, run QA, update revisions, or publish candidates. Callers must supply those verified inputs and persist the returned immutable ledger through a separate append-only adapter.
