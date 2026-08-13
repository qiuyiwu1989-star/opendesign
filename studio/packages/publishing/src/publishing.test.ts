import assert from "node:assert/strict";
import test from "node:test";
import type { HtmlImportResult, SceneDocument } from "@opendesign/studio-contracts";
import type { QaReport } from "@opendesign/studio-qa";
import {
  approveCandidate,
  createReviewLedger,
  rejectReview,
  replayReviewLedger,
  requestChanges,
  ReviewConflictError,
  ReviewGateError,
  ReviewTransitionError,
  submitReview,
  type ApproveCandidateCommand,
  type DraftSnapshot,
  type ReviewActor,
  type ReviewLedger,
} from "./index.js";

import documentFixture from "../../contracts/fixtures/proposal-v0.json" with { type: "json" };

const human: ReviewActor = { actorId: "person_qiu", kind: "human", displayName: "Qiu" };
const agent: ReviewActor = { actorId: "agent_director", kind: "agent", displayName: "Design Director" };
const pack = { id: "editorial-proposal", version: "1.0.0" } as const;

function document(): SceneDocument {
  return structuredClone({
    ...documentFixture,
    designPack: pack,
    provenance: {
      generatedBy: { kind: "skill", name: "design-director" },
      sources: [{ sourceId: "source_article", type: "article", title: "Article", contentHash: `sha256:${"b".repeat(64)}` }],
    },
  }) as SceneDocument;
}

function importResult(nextDocument = document()): HtmlImportResult {
  return {
    importVersion: "0.1.0",
    status: "accepted",
    document: nextDocument,
    diagnostics: [],
    security: { untrustedInput: true, executableContent: "blocked", blockedNodeCount: 0 },
  };
}

function draft(overrides: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    revisionId: "revision_001",
    designPack: pack,
    sourceCoverage: {
      declaredSourceIds: ["source_article"],
      usedSourceIds: ["source_article"],
      unusedSourceIds: [],
      unresolvedSourceIds: [],
    },
    importResult: importResult(),
    aiOutput: {
      status: "accepted",
      html: "<main data-original=\"yes\"></main>",
      manifest: { taskId: "task_001", sourceCoverage: { unresolvedSourceIds: [] } },
    },
    ...overrides,
  };
}

function qa(documentId = "doc_studio_v0", blocker = 0): QaReport {
  return {
    documentId,
    schemaVersion: "0.1.0",
    deterministic: true,
    summary: { blocker, error: 0, warning: 0, note: 0, total: blocker },
    issues: blocker > 0 ? [{
      issueId: "scene:blocker:element",
      sceneId: "scene_cover",
      elementIds: ["cover_title"],
      category: "layout.out_of_bounds",
      severity: "blocker",
      message: "Blocked",
      safeAutoFix: false,
    }] : [],
  };
}

function qaError(documentId = "doc_studio_v0"): QaReport {
  return {
    documentId,
    schemaVersion: "0.1.0",
    deterministic: true,
    summary: { blocker: 0, error: 1, warning: 0, note: 0, total: 1 },
    issues: [{
      issueId: "scene:error:element",
      sceneId: "scene_cover",
      elementIds: ["cover_title"],
      category: "layout.out_of_bounds",
      severity: "error",
      message: "Layout error",
      safeAutoFix: false,
    }],
  };
}

function hash(character = "a") {
  return [{ artifactId: "structured-html", digest: `sha256:${character.repeat(64)}` as const }];
}

function openLedger(nextDraft = draft()): ReviewLedger {
  return createReviewLedger({
    reviewId: "review_001",
    commandId: "command_create",
    occurredAt: "2026-08-13T10:00:00.000Z",
    actor: agent,
    draft: nextDraft,
  });
}

function inReview(nextDraft = draft(), currentRevisionId = nextDraft.revisionId, currentDocument = nextDraft.importResult.document!): ReviewLedger {
  return submitReview(openLedger(nextDraft), {
    commandId: "command_submit",
    occurredAt: "2026-08-13T10:01:00.000Z",
    actor: human,
    currentRevisionId,
    currentDocument,
  });
}

function approval(overrides: Partial<ApproveCandidateCommand> = {}): ApproveCandidateCommand {
  return {
    commandId: "command_approve",
    candidateId: "candidate_001",
    occurredAt: "2026-08-13T10:02:00.000Z",
    actor: human,
    expectedRevisionId: "revision_001",
    currentRevisionId: "revision_001",
    currentDocument: document(),
    reason: "Evidence and layout are ready for publication review.",
    qa: qa(),
    artifactHashes: hash(),
    ...overrides,
  };
}

test("replays an append-only draft to approved candidate stream", () => {
  const ledger = approveCandidate(inReview(), approval());
  const projection = replayReviewLedger(structuredClone(ledger));
  assert.equal(projection.status, "approved_candidate");
  assert.equal(projection.lastSequence, 3);
  assert.equal(projection.candidate?.notPublished, true);
  assert.equal(projection.candidate?.revisionId, "revision_001");
  assert.deepEqual(projection.candidate?.designPack, pack);
  assert.deepEqual(projection.candidate?.artifactHashes, hash());
  assert.equal(projection.candidate?.qa.deterministic, true);
  assert.equal(projection.candidate?.document.documentId, "doc_studio_v0");
  assert.ok(Object.isFrozen(ledger));
  assert.ok(Object.isFrozen(ledger.events));
  assert.ok(Object.isFrozen(projection.candidate));
});

test("reuses an identical command idempotently and conflicts on changed command content", () => {
  const ledger = inReview();
  const command = approval();
  const approved = approveCandidate(ledger, command);
  assert.strictEqual(approveCandidate(approved, command), approved);
  assert.throws(
    () => approveCandidate(approved, { ...command, reason: "Changed reason" }),
    (error: unknown) => error instanceof ReviewConflictError && error.code === "command.idempotency_conflict",
  );
});

test("does not mutate or replace the original AI output", () => {
  const original = draft();
  const before = structuredClone(original.aiOutput);
  const ledger = approveCandidate(inReview(original), approval());
  assert.deepEqual(original.aiOutput, before);
  assert.deepEqual(replayReviewLedger(ledger).draft.aiOutput, before);
  assert.notStrictEqual(replayReviewLedger(ledger).draft.aiOutput, original.aiOutput);
  assert.equal("aiOutput" in (replayReviewLedger(ledger).candidate ?? {}), false);
});

test("approves a human-edited current document without changing the imported AI evidence", () => {
  const original = draft();
  const edited = document();
  edited.scenes[0]!.elements[1]!.content = "这是人工确认后的标题。";
  const ledger = approveCandidate(inReview(original, "revision_edit_002", edited), approval({
    expectedRevisionId: "revision_edit_002",
    currentRevisionId: "revision_edit_002",
    currentDocument: edited,
  }));
  const projection = replayReviewLedger(ledger);
  assert.equal(projection.candidate?.document.scenes[0]!.elements[1]!.content, "这是人工确认后的标题。");
  assert.notDeepEqual(projection.candidate?.document, original.importResult.document);
  assert.equal((projection.draft.importResult.document?.scenes[0]!.elements[1]!.content), "让视觉作品在生成之后，继续生长。");
  assert.deepEqual(projection.draft.aiOutput, original.aiOutput);
});

test("fails closed on revision drift", () => {
  assert.throws(
    () => approveCandidate(inReview(), approval({ currentRevisionId: "revision_002" })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "revision.drift",
  );
  assert.throws(
    () => submitReview(openLedger(), {
      commandId: "command_bad_submit",
      occurredAt: "2026-08-13T10:01:00.000Z",
      actor: human,
      currentRevisionId: "revision_stale",
      currentDocument: { ...document(), documentId: "wrong_document" },
    }),
    (error: unknown) => error instanceof ReviewGateError && error.code === "revision.drift",
  );
});

test("rejects approval when the document changed after its revision was submitted", () => {
  const submitted = document();
  submitted.scenes[0]!.elements[1]!.content = "Submitted title";
  const ledger = inReview(draft(), "revision_edit_002", submitted);
  const changedAfterReview = structuredClone(submitted);
  changedAfterReview.scenes[0]!.elements[1]!.content = "Changed without a new submitted revision";
  assert.throws(
    () => approveCandidate(ledger, approval({
      expectedRevisionId: "revision_edit_002",
      currentRevisionId: "revision_edit_002",
      currentDocument: changedAfterReview,
    })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "revision.drift",
  );
});

test("fails closed when importer did not accept or provenance is missing", () => {
  const partial: HtmlImportResult = {
    importVersion: "0.1.0",
    status: "partial",
    document: document(),
    diagnostics: [],
    security: { untrustedInput: true, executableContent: "blocked", blockedNodeCount: 0 },
  };
  assert.throws(
    () => approveCandidate(inReview(draft({ importResult: partial })), approval()),
    (error: unknown) => error instanceof ReviewGateError && error.code === "import.not_accepted",
  );
  const missingSource = draft({
    sourceCoverage: { declaredSourceIds: ["source_article"], usedSourceIds: [], unusedSourceIds: ["source_article"], unresolvedSourceIds: [] },
  });
  assert.throws(
    () => approveCandidate(inReview(missingSource), approval()),
    (error: unknown) => error instanceof ReviewGateError && error.code === "source.missing",
  );
  const unresolved = draft({
    sourceCoverage: { declaredSourceIds: ["source_article"], usedSourceIds: ["source_article"], unusedSourceIds: [], unresolvedSourceIds: ["source_unknown"] },
  });
  assert.throws(
    () => approveCandidate(inReview(unresolved), approval()),
    (error: unknown) => error instanceof ReviewGateError && error.code === "source.missing",
  );
});

test("fails closed on QA blockers, document mismatch, Pack mismatch and invalid artifacts", () => {
  assert.throws(
    () => approveCandidate(inReview(), approval({ qa: qa("doc_studio_v0", 1) })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "qa.blocker",
  );
  assert.throws(
    () => approveCandidate(inReview(), approval({ qa: qaError() })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "qa.blocker",
  );
  assert.throws(
    () => approveCandidate(inReview(), approval({ qa: qa("another_document") })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "qa.document_mismatch",
  );
  const dishonestQa = qa();
  dishonestQa.issues.push({
    issueId: "scene:blocker:tampered",
    sceneId: "scene_cover",
    elementIds: ["cover_title"],
    category: "layout.out_of_bounds",
    severity: "blocker",
    message: "Hidden by a dishonest summary",
    safeAutoFix: false,
  });
  assert.throws(
    () => approveCandidate(inReview(), approval({ qa: dishonestQa })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "qa.document_mismatch",
  );
  assert.throws(
    () => approveCandidate(inReview(draft({ designPack: { id: "another-pack", version: "1.0.0" } })), approval()),
    (error: unknown) => error instanceof ReviewGateError && error.code === "pack.mismatch",
  );
  assert.throws(
    () => approveCandidate(inReview(), approval({ artifactHashes: [] })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "artifact.invalid",
  );
});

test("fails closed when the current document identity, Pack pin or source provenance drifts", () => {
  const changedId = document();
  changedId.documentId = "different_document";
  assert.throws(
    () => approveCandidate(inReview(), approval({ currentDocument: changedId, qa: qa("different_document") })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "revision.drift",
  );

  const changedPack = document();
  changedPack.designPack = { id: "another-pack", version: "1.0.0" };
  assert.throws(
    () => approveCandidate(inReview(), approval({ currentDocument: changedPack })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "pack.mismatch",
  );

  const baseWithProvenance = draft();
  const changedProvenance = structuredClone(baseWithProvenance.importResult.document!);
  changedProvenance.provenance!.sources[0]!.title = "Changed Source";
  assert.throws(
    () => approveCandidate(inReview(baseWithProvenance), approval({ currentDocument: changedProvenance })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "source.missing",
  );
});

test("requires human final decisions and rejects illegal transitions", () => {
  assert.throws(
    () => approveCandidate(inReview(), approval({ actor: agent })),
    (error: unknown) => error instanceof ReviewGateError && error.code === "actor.human_required",
  );
  assert.throws(
    () => approveCandidate(openLedger(), approval()),
    (error: unknown) => error instanceof ReviewTransitionError,
  );
  assert.throws(
    () => submitReview(inReview(), {
      commandId: "command_resubmit",
      occurredAt: "2026-08-13T10:03:00.000Z",
      actor: human,
      currentRevisionId: "revision_001",
      currentDocument: document(),
    }),
    (error: unknown) => error instanceof ReviewTransitionError,
  );
});

test("records changes requested and rejected as terminal, reasoned human decisions", () => {
  const changed = requestChanges(inReview(), {
    commandId: "command_changes",
    occurredAt: "2026-08-13T10:02:00.000Z",
    actor: human,
    expectedRevisionId: "revision_001",
    reason: "Repair the evidence label.",
  });
  assert.equal(replayReviewLedger(changed).status, "changes_requested");
  assert.equal(replayReviewLedger(changed).decision?.reason, "Repair the evidence label.");

  const rejected = rejectReview(inReview(), {
    commandId: "command_reject",
    occurredAt: "2026-08-13T10:02:00.000Z",
    actor: human,
    expectedRevisionId: "revision_001",
    reason: "The proposal conflicts with the brief.",
  });
  assert.equal(replayReviewLedger(rejected).status, "rejected");
  assert.equal(replayReviewLedger(rejected).decision?.actor.actorId, human.actorId);
});

test("detects tampered sequence and candidate snapshots during replay", () => {
  const ledger = approveCandidate(inReview(), approval());
  const brokenSequence = structuredClone(ledger) as unknown as { events: Array<{ sequence: number }> };
  brokenSequence.events[1]!.sequence = 99;
  assert.throws(() => replayReviewLedger(brokenSequence as unknown as ReviewLedger));

  const published = structuredClone(ledger) as unknown as { events: Array<{ candidate?: { notPublished: boolean } }> };
  published.events[2]!.candidate!.notPublished = false;
  assert.throws(() => replayReviewLedger(published as unknown as ReviewLedger));

  const alteredDocument = structuredClone(ledger) as unknown as { events: Array<{ candidate?: { document: SceneDocument } }> };
  alteredDocument.events[2]!.candidate!.document.documentId = "tampered_document";
  assert.throws(() => replayReviewLedger(alteredDocument as unknown as ReviewLedger));
});
