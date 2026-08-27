import { assertSceneDocument, type DesignPackPin, type HtmlImportResult, type SceneDocument } from "@opendesign/studio-contracts";
import type { QaReport } from "@opendesign/studio-qa";

export const REVIEW_LEDGER_VERSION = "0.1.0" as const;

export type ReviewStatus =
  | "draft"
  | "in_review"
  | "approved_candidate"
  | "changes_requested"
  | "rejected";

export type ReviewActor = {
  actorId: string;
  kind: "human" | "agent" | "system";
  displayName?: string;
};

export type ReviewSourceCoverage = {
  declaredSourceIds: string[];
  usedSourceIds: string[];
  unusedSourceIds: string[];
  unresolvedSourceIds: string[];
};

export type ArtifactHash = {
  artifactId: string;
  digest: `sha256:${string}`;
};

export type DraftSnapshot = {
  revisionId: string;
  designPack: DesignPackPin;
  sourceCoverage: ReviewSourceCoverage;
  importResult: HtmlImportResult;
  /** Immutable provider/compiler output. It is evidence, never the mutable working document. */
  aiOutput: unknown;
};

export type CandidateSnapshot = {
  candidateId: string;
  reviewId: string;
  createdAt: string;
  approvedBy: ReviewActor;
  approvalReason: string;
  revisionId: string;
  designPack: DesignPackPin;
  sourceCoverage: ReviewSourceCoverage;
  qa: QaReport;
  artifactHashes: ArtifactHash[];
  document: SceneDocument;
  /** A candidate is deliberately separated from every publication side effect. */
  notPublished: true;
};

type EventEnvelope = {
  eventId: string;
  commandId: string;
  commandFingerprint: string;
  sequence: number;
  occurredAt: string;
  actor: ReviewActor;
};

export type DraftCreatedEvent = EventEnvelope & {
  type: "draft_created";
  reviewId: string;
  draft: DraftSnapshot;
};

export type ReviewSubmittedEvent = EventEnvelope & {
  type: "review_submitted";
  revisionId: string;
  document: SceneDocument;
};

export type CandidateApprovedEvent = EventEnvelope & {
  type: "candidate_approved";
  reason: string;
  candidate: CandidateSnapshot;
};

export type ChangesRequestedEvent = EventEnvelope & {
  type: "changes_requested";
  revisionId: string;
  reason: string;
};

export type ReviewRejectedEvent = EventEnvelope & {
  type: "review_rejected";
  revisionId: string;
  reason: string;
};

export type ReviewEvent =
  | DraftCreatedEvent
  | ReviewSubmittedEvent
  | CandidateApprovedEvent
  | ChangesRequestedEvent
  | ReviewRejectedEvent;

export type ReviewLedger = {
  ledgerVersion: typeof REVIEW_LEDGER_VERSION;
  reviewId: string;
  events: readonly ReviewEvent[];
};

export type ReviewProjection = {
  reviewId: string;
  status: ReviewStatus;
  draft: DraftSnapshot;
  reviewRevisionId?: string;
  reviewDocument?: SceneDocument;
  candidate?: CandidateSnapshot;
  decision?: { actor: ReviewActor; occurredAt: string; reason: string };
  lastSequence: number;
};

type CommandEnvelope = {
  commandId: string;
  occurredAt: string;
  actor: ReviewActor;
};

export type CreateDraftCommand = CommandEnvelope & {
  reviewId: string;
  draft: DraftSnapshot;
};

export type SubmitReviewCommand = CommandEnvelope & {
  currentRevisionId: string;
  currentDocument: SceneDocument;
};

export type ApproveCandidateCommand = CommandEnvelope & {
  candidateId: string;
  expectedRevisionId: string;
  /** The caller's latest working revision; it must still equal the submitted revision. */
  currentRevisionId: string;
  /** Current human-edited snapshot. The accepted import remains immutable evidence. */
  currentDocument: SceneDocument;
  reason: string;
  qa: QaReport;
  artifactHashes: ArtifactHash[];
};

export type RequestChangesCommand = CommandEnvelope & {
  expectedRevisionId: string;
  reason: string;
};

export type RejectReviewCommand = CommandEnvelope & {
  expectedRevisionId: string;
  reason: string;
};

export type ReviewErrorCode =
  | "command.idempotency_conflict"
  | "event.invalid"
  | "snapshot.invalid"
  | "transition.invalid"
  | "actor.human_required"
  | "revision.drift"
  | "import.not_accepted"
  | "source.missing"
  | "qa.blocker"
  | "qa.document_mismatch"
  | "pack.mismatch"
  | "artifact.invalid";

export class ReviewLedgerError extends Error {
  readonly code: ReviewErrorCode;

  constructor(code: ReviewErrorCode, message: string) {
    super(message);
    this.name = "ReviewLedgerError";
    this.code = code;
  }
}

export class ReviewConflictError extends ReviewLedgerError {
  constructor(message: string) {
    super("command.idempotency_conflict", message);
    this.name = "ReviewConflictError";
  }
}

export class ReviewTransitionError extends ReviewLedgerError {
  constructor(message: string) {
    super("transition.invalid", message);
    this.name = "ReviewTransitionError";
  }
}

export class ReviewGateError extends ReviewLedgerError {}

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };

function jsonSnapshot(value: unknown, path = "$", seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new ReviewLedgerError("snapshot.invalid", `${path} contains a non-finite number`);
  }
  if (typeof value !== "object") {
    throw new ReviewLedgerError("snapshot.invalid", `${path} contains a non-JSON value`);
  }
  if (seen.has(value)) throw new ReviewLedgerError("snapshot.invalid", `${path} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => jsonSnapshot(item, `${path}[${index}]`, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ReviewLedgerError("snapshot.invalid", `${path} must be a plain JSON object`);
    }
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) result[key] = jsonSnapshot((value as Record<string, unknown>)[key], `${path}.${key}`, seen);
    return result;
  } finally {
    seen.delete(value);
  }
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function snapshot<T>(value: T): T {
  return freezeDeep(jsonSnapshot(value) as T);
}

function fingerprint(value: unknown): string {
  return JSON.stringify(jsonSnapshot(value));
}

function optionalFingerprint(value: unknown): string {
  return value === undefined ? "__undefined__" : fingerprint(value);
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new ReviewLedgerError("event.invalid", `${label} cannot be empty`);
}

function requireTimestamp(value: string): void {
  const timestamp = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== (value.includes(".") ? value : value.replace("Z", ".000Z"))) {
    throw new ReviewLedgerError("event.invalid", `Invalid event timestamp: ${value}`);
  }
}

function validateActor(actor: ReviewActor): void {
  requireText(actor.actorId, "actorId");
  if (!(["human", "agent", "system"] as const).includes(actor.kind)) {
    throw new ReviewLedgerError("event.invalid", `Unsupported actor kind: ${String(actor.kind)}`);
  }
}

function requireHuman(actor: ReviewActor): void {
  if (actor.kind !== "human") throw new ReviewGateError("actor.human_required", "A human actor must make the final review decision");
}

function assertRevision(expected: string, actual: string | undefined): void {
  requireText(expected, "expectedRevisionId");
  if (actual !== expected) throw new ReviewGateError("revision.drift", `Revision drift: expected ${expected}, current ${actual ?? "missing"}`);
}

function samePack(left: DesignPackPin | undefined, right: DesignPackPin): boolean {
  return left?.id === right.id && left.version === right.version;
}

function validateSourceCoverage(coverage: ReviewSourceCoverage): void {
  const declared = new Set(coverage.declaredSourceIds);
  const used = new Set(coverage.usedSourceIds);
  if (declared.size === 0 || used.size === 0 || coverage.unresolvedSourceIds.length > 0 || [...used].some((id) => !declared.has(id))) {
    throw new ReviewGateError("source.missing", "Candidate source coverage is missing or unresolved");
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item) => right.includes(item));
}

function validateSourceEvidence(draft: DraftSnapshot, document: SceneDocument): void {
  validateSourceCoverage(draft.sourceCoverage);
  const provenanceIds = document.provenance?.sources.map((source) => source.sourceId) ?? [];
  if (provenanceIds.length === 0 || new Set(provenanceIds).size !== provenanceIds.length) {
    throw new ReviewGateError("source.missing", "Accepted document source provenance is missing or duplicated");
  }
  if (!sameStringSet([...new Set(draft.sourceCoverage.declaredSourceIds)], provenanceIds)) {
    throw new ReviewGateError("source.missing", "Declared source coverage does not match document provenance");
  }
}

function validateArtifactHashes(hashes: readonly ArtifactHash[]): void {
  const ids = new Set<string>();
  if (hashes.length === 0) throw new ReviewGateError("artifact.invalid", "At least one artifact hash is required");
  for (const item of hashes) {
    if (!item.artifactId.trim() || ids.has(item.artifactId) || !/^sha256:[a-f0-9]{64}$/u.test(item.digest)) {
      throw new ReviewGateError("artifact.invalid", "Artifact hashes require unique IDs and lowercase sha256 digests");
    }
    ids.add(item.artifactId);
  }
}

function validateQa(report: QaReport, document: SceneDocument): void {
  if (report.deterministic !== true || report.documentId !== document.documentId || report.schemaVersion !== document.schemaVersion) {
    throw new ReviewGateError("qa.document_mismatch", "QA report identity does not match the current document");
  }
  const severities = ["blocker", "error", "warning", "note"] as const;
  const counts = Object.fromEntries(severities.map((severity) => [severity, report.issues.filter((issue) => issue.severity === severity).length])) as Record<(typeof severities)[number], number>;
  if (severities.some((severity) => report.summary[severity] !== counts[severity]) || report.summary.total !== report.issues.length) {
    throw new ReviewGateError("qa.document_mismatch", "QA summary does not match its issue evidence");
  }
  if (counts.blocker > 0 || counts.error > 0) throw new ReviewGateError("qa.blocker", "QA blockers and errors must be resolved before approval");
}

function acceptedDocument(draft: DraftSnapshot): SceneDocument {
  if (draft.importResult.status !== "accepted" || !draft.importResult.document) {
    throw new ReviewGateError("import.not_accepted", "Only an accepted HTML import can become a candidate");
  }
  const document = draft.importResult.document;
  if (!samePack(document.designPack, draft.designPack)) {
    throw new ReviewGateError("pack.mismatch", "Imported document does not match the pinned Design Pack");
  }
  validateSourceEvidence(draft, document);
  return document;
}

function validateCurrentDocument(draft: DraftSnapshot, currentDocument: SceneDocument): void {
  try {
    assertSceneDocument(currentDocument);
  } catch (error) {
    throw new ReviewGateError("snapshot.invalid", `Current document is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  const importedDocument = acceptedDocument(draft);
  if (currentDocument.documentId !== importedDocument.documentId) {
    throw new ReviewGateError("revision.drift", "Current document identity differs from the accepted import");
  }
  if (!samePack(currentDocument.designPack, draft.designPack)) {
    throw new ReviewGateError("pack.mismatch", "Current document changed the pinned Design Pack");
  }
  if (optionalFingerprint(currentDocument.provenance) !== optionalFingerprint(importedDocument.provenance)) {
    throw new ReviewGateError("source.missing", "Current document changed the accepted source provenance");
  }
}

function validateApprovalGates(projection: ReviewProjection, candidate: CandidateSnapshot): void {
  const importedDocument = acceptedDocument(projection.draft);
  assertRevision(projection.reviewRevisionId ?? "", candidate.revisionId);
  validateSourceCoverage(candidate.sourceCoverage);
  if (fingerprint(candidate.sourceCoverage) !== fingerprint(projection.draft.sourceCoverage)) {
    throw new ReviewGateError("source.missing", "Candidate source coverage differs from the reviewed draft");
  }
  if (!samePack(candidate.designPack, projection.draft.designPack)) throw new ReviewGateError("pack.mismatch", "Candidate changed the Design Pack pin");
  validateCurrentDocument(projection.draft, candidate.document);
  validateQa(candidate.qa, candidate.document);
  validateArtifactHashes(candidate.artifactHashes);
  if (candidate.notPublished !== true) throw new ReviewLedgerError("event.invalid", "Candidate must remain notPublished");
  if (candidate.document.documentId !== importedDocument.documentId) throw new ReviewLedgerError("event.invalid", "Candidate document identity does not match the accepted import");
}

function baseEvent(command: CommandEnvelope, sequence: number): EventEnvelope {
  requireText(command.commandId, "commandId");
  requireTimestamp(command.occurredAt);
  validateActor(command.actor);
  return {
    eventId: `event_${sequence}_${command.commandId}`,
    commandId: command.commandId,
    commandFingerprint: fingerprint(command),
    sequence,
    occurredAt: command.occurredAt,
    actor: snapshot(command.actor),
  };
}

function eventCommandPayload(event: ReviewEvent): unknown {
  const command = {
    commandId: event.commandId,
    occurredAt: event.occurredAt,
    actor: event.actor,
  };
  if (event.type === "draft_created") return { ...command, reviewId: event.reviewId, draft: event.draft };
  if (event.type === "review_submitted") return { ...command, currentRevisionId: event.revisionId, currentDocument: event.document };
  if (event.type === "candidate_approved") {
    return {
      ...command,
      candidateId: event.candidate.candidateId,
      expectedRevisionId: event.candidate.revisionId,
      currentRevisionId: event.candidate.revisionId,
      currentDocument: event.candidate.document,
      reason: event.reason,
      qa: event.candidate.qa,
      artifactHashes: event.candidate.artifactHashes,
    };
  }
  return { ...command, expectedRevisionId: event.revisionId, reason: event.reason };
}

function validateEventFingerprint(event: ReviewEvent): void {
  if (event.commandFingerprint !== fingerprint(eventCommandPayload(event))) {
    throw new ReviewLedgerError("event.invalid", `Command fingerprint mismatch at sequence ${event.sequence}`);
  }
}

function appendEvent(ledger: ReviewLedger, command: CommandEnvelope, make: (base: EventEnvelope) => ReviewEvent): ReviewLedger {
  const existing = ledger.events.find((event) => event.commandId === command.commandId);
  const commandFingerprint = fingerprint(command);
  if (existing) {
    if (existing.commandFingerprint === commandFingerprint) return ledger;
    throw new ReviewConflictError(`Command ${command.commandId} was already used with different content`);
  }
  const event = snapshot(make(baseEvent(command, ledger.events.length + 1)));
  const next = snapshot<ReviewLedger>({ ...ledger, events: [...ledger.events, event] });
  replayReviewLedger(next);
  return next;
}

function idempotentLedger(ledger: ReviewLedger, command: CommandEnvelope): ReviewLedger | undefined {
  const existing = ledger.events.find((event) => event.commandId === command.commandId);
  if (!existing) return undefined;
  if (existing.commandFingerprint === fingerprint(command)) return ledger;
  throw new ReviewConflictError(`Command ${command.commandId} was already used with different content`);
}

function requireStatus(projection: ReviewProjection, expected: ReviewStatus): void {
  if (projection.status !== expected) throw new ReviewTransitionError(`Cannot transition from ${projection.status}; expected ${expected}`);
}

export function createReviewLedger(command: CreateDraftCommand): ReviewLedger {
  requireText(command.reviewId, "reviewId");
  requireText(command.draft.revisionId, "revisionId");
  requireText(command.draft.designPack.id, "designPack.id");
  requireText(command.draft.designPack.version, "designPack.version");
  const event = snapshot<DraftCreatedEvent>({
    ...baseEvent(command, 1),
    type: "draft_created",
    reviewId: command.reviewId,
    draft: snapshot(command.draft),
  });
  const ledger = snapshot<ReviewLedger>({ ledgerVersion: REVIEW_LEDGER_VERSION, reviewId: command.reviewId, events: [event] });
  replayReviewLedger(ledger);
  return ledger;
}

export function submitReview(ledger: ReviewLedger, command: SubmitReviewCommand): ReviewLedger {
  const idempotent = idempotentLedger(ledger, command);
  if (idempotent) return idempotent;
  const projection = replayReviewLedger(ledger);
  requireStatus(projection, "draft");
  requireText(command.currentRevisionId, "currentRevisionId");
  validateCurrentDocument(projection.draft, command.currentDocument);
  return appendEvent(ledger, command, (base) => ({
    ...base,
    type: "review_submitted",
    revisionId: command.currentRevisionId,
    document: snapshot(command.currentDocument),
  }));
}

export function approveCandidate(ledger: ReviewLedger, command: ApproveCandidateCommand): ReviewLedger {
  const idempotent = idempotentLedger(ledger, command);
  if (idempotent) return idempotent;
  const projection = replayReviewLedger(ledger);
  requireStatus(projection, "in_review");
  requireHuman(command.actor);
  requireText(command.reason, "approval reason");
  assertRevision(command.expectedRevisionId, projection.reviewRevisionId);
  assertRevision(command.currentRevisionId, projection.reviewRevisionId);
  acceptedDocument(projection.draft);
  validateCurrentDocument(projection.draft, command.currentDocument);
  if (!projection.reviewDocument || fingerprint(command.currentDocument) !== fingerprint(projection.reviewDocument)) {
    throw new ReviewGateError("revision.drift", "Current document differs from the submitted review snapshot");
  }
  validateQa(command.qa, command.currentDocument);
  validateArtifactHashes(command.artifactHashes);
  const candidate = snapshot<CandidateSnapshot>({
    candidateId: command.candidateId,
    reviewId: ledger.reviewId,
    createdAt: command.occurredAt,
    approvedBy: command.actor,
    approvalReason: command.reason,
    revisionId: command.currentRevisionId,
    designPack: projection.draft.designPack,
    sourceCoverage: projection.draft.sourceCoverage,
    qa: command.qa,
    artifactHashes: command.artifactHashes,
    document: command.currentDocument,
    notPublished: true,
  });
  requireText(candidate.candidateId, "candidateId");
  return appendEvent(ledger, command, (base) => ({ ...base, type: "candidate_approved", reason: command.reason, candidate }));
}

export function requestChanges(ledger: ReviewLedger, command: RequestChangesCommand): ReviewLedger {
  const idempotent = idempotentLedger(ledger, command);
  if (idempotent) return idempotent;
  const projection = replayReviewLedger(ledger);
  requireStatus(projection, "in_review");
  requireHuman(command.actor);
  requireText(command.reason, "decision reason");
  assertRevision(command.expectedRevisionId, projection.reviewRevisionId);
  return appendEvent(ledger, command, (base) => ({ ...base, type: "changes_requested", revisionId: command.expectedRevisionId, reason: command.reason }));
}

export function rejectReview(ledger: ReviewLedger, command: RejectReviewCommand): ReviewLedger {
  const idempotent = idempotentLedger(ledger, command);
  if (idempotent) return idempotent;
  const projection = replayReviewLedger(ledger);
  requireStatus(projection, "in_review");
  requireHuman(command.actor);
  requireText(command.reason, "decision reason");
  assertRevision(command.expectedRevisionId, projection.reviewRevisionId);
  return appendEvent(ledger, command, (base) => ({ ...base, type: "review_rejected", revisionId: command.expectedRevisionId, reason: command.reason }));
}

export function replayReviewLedger(ledger: ReviewLedger): ReviewProjection {
  if (ledger.ledgerVersion !== REVIEW_LEDGER_VERSION || !ledger.reviewId.trim() || ledger.events.length === 0) {
    throw new ReviewLedgerError("event.invalid", "Ledger header or event stream is invalid");
  }
  const commandIds = new Set<string>();
  let projection: ReviewProjection | undefined;
  for (const [index, rawEvent] of ledger.events.entries()) {
    const event = snapshot(rawEvent);
    if (event.sequence !== index + 1 || event.eventId !== `event_${event.sequence}_${event.commandId}` || commandIds.has(event.commandId)) {
      throw new ReviewLedgerError("event.invalid", `Invalid event envelope at sequence ${index + 1}`);
    }
    commandIds.add(event.commandId);
    requireTimestamp(event.occurredAt);
    validateActor(event.actor);
    validateEventFingerprint(event);
    if (index === 0) {
      if (event.type !== "draft_created" || event.reviewId !== ledger.reviewId) throw new ReviewLedgerError("event.invalid", "The stream must begin with its matching draft_created event");
      projection = { reviewId: ledger.reviewId, status: "draft", draft: event.draft, lastSequence: event.sequence };
      continue;
    }
    if (!projection) throw new ReviewLedgerError("event.invalid", "Missing draft projection");
    if (event.type === "draft_created") throw new ReviewTransitionError("A ledger can contain only one draft_created event");
    if (event.type === "review_submitted") {
      requireStatus(projection, "draft");
      requireText(event.revisionId, "review revisionId");
      validateCurrentDocument(projection.draft, event.document);
      projection = { ...projection, status: "in_review", reviewRevisionId: event.revisionId, reviewDocument: event.document, lastSequence: event.sequence };
      continue;
    }
    requireStatus(projection, "in_review");
    requireHuman(event.actor);
    if (event.type === "candidate_approved") {
      requireText(event.reason, "approval reason");
      if (event.candidate.reviewId !== ledger.reviewId
        || event.candidate.createdAt !== event.occurredAt
        || event.candidate.approvalReason !== event.reason
        || fingerprint(event.candidate.approvedBy) !== fingerprint(event.actor)) {
        throw new ReviewLedgerError("event.invalid", "Candidate decision metadata differs from its approval event");
      }
      validateApprovalGates(projection, event.candidate);
      projection = {
        ...projection,
        status: "approved_candidate",
        candidate: event.candidate,
        decision: { actor: event.actor, occurredAt: event.occurredAt, reason: event.reason },
        lastSequence: event.sequence,
      };
      continue;
    }
    requireText(event.reason, "decision reason");
    assertRevision(event.revisionId, projection.reviewRevisionId);
    projection = {
      ...projection,
      status: event.type === "changes_requested" ? "changes_requested" : "rejected",
      decision: { actor: event.actor, occurredAt: event.occurredAt, reason: event.reason },
      lastSequence: event.sequence,
    };
  }
  if (!projection) throw new ReviewLedgerError("event.invalid", "Ledger cannot be empty");
  return snapshot(projection);
}
