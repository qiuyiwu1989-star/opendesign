import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import agentOsSchema from "../agent-os.schema.json" with { type: "json" };
import type {
  AgentRunEvent,
  ArtifactEnvelope,
  CapabilityManifest,
  DesignWorkOrder,
  EvidenceBundle,
  ExecutionBundle,
  ExecutionPlan,
  FeedbackEvent,
  ReviewCandidate,
} from "./types.js";

export type AgentContractIssue = {
  source: "schema" | "semantic";
  code: string;
  path: string;
  message: string;
};

export type AgentValidationResult<T> =
  | { ok: true; value: T; issues: readonly [] }
  | { ok: false; issues: readonly AgentContractIssue[] };

export class AgentContractError extends Error {
  readonly issues: readonly AgentContractIssue[];

  constructor(label: string, issues: readonly AgentContractIssue[]) {
    super(`${label} violates the Agent OS contract (${issues.length} issue${issues.length === 1 ? "" : "s"})`);
    this.name = "AgentContractError";
    this.issues = issues;
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const definitions = agentOsSchema.$defs;
const validators = {
  workOrder: ajv.compile({ $ref: "#/$defs/workOrder", $defs: definitions }),
  plan: ajv.compile({ $ref: "#/$defs/plan", $defs: definitions }),
  evidence: ajv.compile({ $ref: "#/$defs/evidence", $defs: definitions }),
  artifact: ajv.compile({ $ref: "#/$defs/artifact", $defs: definitions }),
  runEvent: ajv.compile({ $ref: "#/$defs/runEvent", $defs: definitions }),
  candidate: ajv.compile({ $ref: "#/$defs/candidate", $defs: definitions }),
  feedback: ajv.compile({ $ref: "#/$defs/feedback", $defs: definitions }),
  capability: ajv.compile({ $ref: "#/$defs/capability", $defs: definitions }),
} as const;

function schemaIssues(errors: ErrorObject[] | null | undefined): AgentContractIssue[] {
  return (errors ?? []).map((error) => ({
    source: "schema",
    code: `schema.${error.keyword}`,
    path: error.instancePath || "/",
    message: error.message ?? `failed ${error.keyword} validation`,
  }));
}

function validateSchema<T>(value: unknown, validator: ValidateFunction): AgentValidationResult<T> {
  if (validator(value)) return { ok: true, value: value as T, issues: [] };
  return { ok: false, issues: schemaIssues(validator.errors) };
}

function duplicateIssues(values: readonly string[], path: string, code: string): AgentContractIssue[] {
  const seen = new Set<string>();
  const issues: AgentContractIssue[] = [];
  values.forEach((value, index) => {
    if (seen.has(value)) issues.push({ source: "semantic", code, path: `${path}/${index}`, message: `Duplicate ID: ${value}` });
    seen.add(value);
  });
  return issues;
}

function pinKey(pin: { id: string; version: string }): string {
  return `${pin.id}@${pin.version}`;
}

function sourceCoverageIssues(coverage: ArtifactEnvelope["sourceCoverage"], path: string): AgentContractIssue[] {
  const issues: AgentContractIssue[] = [];
  const declared = new Set(coverage.declaredSourceIds);
  const used = new Set(coverage.usedSourceIds);
  const unresolved = new Set(coverage.unresolvedSourceIds);
  coverage.usedSourceIds.forEach((id, index) => {
    if (!declared.has(id)) issues.push({ source: "semantic", code: "source.used_undeclared", path: `${path}/usedSourceIds/${index}`, message: `Used source is not declared: ${id}` });
  });
  coverage.unresolvedSourceIds.forEach((id, index) => {
    if (!declared.has(id)) issues.push({ source: "semantic", code: "source.unresolved_undeclared", path: `${path}/unresolvedSourceIds/${index}`, message: `Unresolved source is not declared: ${id}` });
    if (used.has(id)) issues.push({ source: "semantic", code: "source.state_conflict", path: `${path}/unresolvedSourceIds/${index}`, message: `Source cannot be used and unresolved: ${id}` });
  });
  return issues;
}

export function validateDesignWorkOrder(value: unknown): AgentValidationResult<DesignWorkOrder> {
  const result = validateSchema<DesignWorkOrder>(value, validators.workOrder);
  if (!result.ok) return result;
  const issues = duplicateIssues(result.value.sources.map((source) => source.sourceId), "/sources", "source.duplicate");
  const pageCount = result.value.deliverable.pageCount;
  if (pageCount !== undefined && pageCount.min > pageCount.max) {
    issues.push({ source: "semantic", code: "deliverable.page_range", path: "/deliverable/pageCount", message: "Page count minimum cannot exceed maximum" });
  }
  return issues.length === 0 ? result : { ok: false, issues };
}

export function validateExecutionPlan(value: unknown): AgentValidationResult<ExecutionPlan> {
  const result = validateSchema<ExecutionPlan>(value, validators.plan);
  if (!result.ok) return result;
  const issues = duplicateIssues(result.value.stages.map((stage) => stage.stageId), "/stages", "stage.duplicate");
  issues.push(...duplicateIssues(result.value.capabilityPins.map(pinKey), "/capabilityPins", "capability.duplicate"));
  const planPins = new Set(result.value.capabilityPins.map(pinKey));
  result.value.stages.forEach((stage, index) => {
    if (stage.order !== index + 1) issues.push({ source: "semantic", code: "stage.order_invalid", path: `/stages/${index}/order`, message: "Stage orders must be continuous from one" });
    stage.skillPins.forEach((pin, pinIndex) => {
      if (!planPins.has(pinKey(pin))) issues.push({ source: "semantic", code: "capability.unpinned", path: `/stages/${index}/skillPins/${pinIndex}`, message: `Stage capability is not pinned by the plan: ${pinKey(pin)}` });
    });
  });
  return issues.length === 0 ? result : { ok: false, issues };
}

export function validateEvidenceBundle(value: unknown): AgentValidationResult<EvidenceBundle> {
  const result = validateSchema<EvidenceBundle>(value, validators.evidence);
  if (!result.ok) return result;
  const issues = duplicateIssues(result.value.sources.map((source) => source.sourceId), "/sources", "source.duplicate");
  issues.push(...duplicateIssues(result.value.claims.map((claim) => claim.claimId), "/claims", "claim.duplicate"));
  const sources = new Set(result.value.sources.map((source) => source.sourceId));
  result.value.claims.forEach((claim, claimIndex) => {
    if (claim.kind !== "gap" && claim.sourceIds.length === 0) issues.push({ source: "semantic", code: "claim.source_required", path: `/claims/${claimIndex}/sourceIds`, message: `${claim.kind} claims require at least one source` });
    claim.sourceIds.forEach((sourceId, sourceIndex) => {
      if (!sources.has(sourceId)) issues.push({ source: "semantic", code: "claim.source_missing", path: `/claims/${claimIndex}/sourceIds/${sourceIndex}`, message: `Claim source is not declared: ${sourceId}` });
    });
  });
  return issues.length === 0 ? result : { ok: false, issues };
}

export function validateArtifactEnvelope(value: unknown): AgentValidationResult<ArtifactEnvelope> {
  const result = validateSchema<ArtifactEnvelope>(value, validators.artifact);
  if (!result.ok) return result;
  const issues = sourceCoverageIssues(result.value.sourceCoverage, "/sourceCoverage");
  if (result.value.validationStatus === "accepted" && result.value.sourceCoverage.unresolvedSourceIds.length > 0) issues.push({ source: "semantic", code: "artifact.unresolved_source", path: "/sourceCoverage/unresolvedSourceIds", message: "Accepted artifacts cannot contain unresolved sources" });
  if (result.value.editability.editable && result.value.editability.capabilities.length === 0) issues.push({ source: "semantic", code: "artifact.capability_missing", path: "/editability/capabilities", message: "Editable artifacts require at least one capability" });
  if (!result.value.editability.editable && result.value.editability.capabilities.length > 0) issues.push({ source: "semantic", code: "artifact.capability_conflict", path: "/editability/capabilities", message: "Non-editable artifacts cannot claim editable capabilities" });
  return issues.length === 0 ? result : { ok: false, issues };
}

export function validateAgentRunEvent(value: unknown): AgentValidationResult<AgentRunEvent> {
  const result = validateSchema<AgentRunEvent>(value, validators.runEvent);
  if (!result.ok) return result;
  const issues: AgentContractIssue[] = [];
  const stageEvent = result.value.type.startsWith("stage_");
  if (stageEvent !== (result.value.stageId !== undefined)) issues.push({ source: "semantic", code: "event.stage_mismatch", path: "/stageId", message: stageEvent ? "Stage events require stageId" : "Plan events cannot contain stageId" });
  if ((result.value.type === "stage_failed" || result.value.type === "plan_failed") && !result.value.diagnosticCode) issues.push({ source: "semantic", code: "event.diagnostic_required", path: "/diagnosticCode", message: "Failure events require a stable diagnostic code" });
  if (result.value.type === "stage_completed" && result.value.outputArtifactIds.length === 0) issues.push({ source: "semantic", code: "event.output_required", path: "/outputArtifactIds", message: "Completed stages require output artifacts" });
  return issues.length === 0 ? result : { ok: false, issues };
}

export function validateReviewCandidate(value: unknown): AgentValidationResult<ReviewCandidate> {
  const result = validateSchema<ReviewCandidate>(value, validators.candidate);
  if (!result.ok) return result;
  const issues = sourceCoverageIssues(result.value.sourceCoverage, "/sourceCoverage");
  const decided = result.value.status !== "awaiting-human";
  if (decided && result.value.decidedBy?.kind !== "human") issues.push({ source: "semantic", code: "candidate.human_required", path: "/decidedBy", message: "Candidate decisions require a human actor" });
  if (decided && !result.value.decisionReason) issues.push({ source: "semantic", code: "candidate.reason_required", path: "/decisionReason", message: "Candidate decisions require a reason" });
  if (!decided && (result.value.decidedBy !== undefined || result.value.decisionReason !== undefined)) issues.push({ source: "semantic", code: "candidate.decision_conflict", path: "/status", message: "Awaiting candidates cannot contain a decision" });
  if (result.value.status === "approved") {
    if (result.value.qa.blocker > 0 || result.value.qa.error > 0) issues.push({ source: "semantic", code: "candidate.qa_blocked", path: "/qa", message: "Approved candidates cannot contain QA blockers or errors" });
    if (!result.value.export.succeeded) issues.push({ source: "semantic", code: "candidate.export_failed", path: "/export/succeeded", message: "Approved candidates require a successful export report" });
    if (result.value.sourceCoverage.unresolvedSourceIds.length > 0) issues.push({ source: "semantic", code: "candidate.source_unresolved", path: "/sourceCoverage/unresolvedSourceIds", message: "Approved candidates cannot contain unresolved sources" });
  }
  return issues.length === 0 ? result : { ok: false, issues };
}

export function validateFeedbackEvent(value: unknown): AgentValidationResult<FeedbackEvent> {
  const result = validateSchema<FeedbackEvent>(value, validators.feedback);
  if (!result.ok) return result;
  const issues: AgentContractIssue[] = [];
  if (result.value.signal === "modified" && result.value.measurement === undefined) issues.push({ source: "semantic", code: "feedback.measurement_required", path: "/measurement", message: "Modified feedback requires correction operation and duration measurements" });
  if (result.value.visibility === "aggregate-only" && result.value.reason !== undefined) issues.push({ source: "semantic", code: "feedback.private_reason", path: "/reason", message: "Aggregate-only feedback cannot expose a free-text reason" });
  return issues.length === 0 ? result : { ok: false, issues };
}

export function validateCapabilityManifest(value: unknown): AgentValidationResult<CapabilityManifest> {
  const result = validateSchema<CapabilityManifest>(value, validators.capability);
  if (!result.ok) return result;
  const issues: AgentContractIssue[] = [];
  if ((result.value.lifecycle === "approved" || result.value.lifecycle === "evaluated") && result.value.provenance.reviewedAt === undefined) issues.push({ source: "semantic", code: "capability.review_missing", path: "/provenance/reviewedAt", message: "Evaluated and approved capabilities require review evidence" });
  return issues.length === 0 ? result : { ok: false, issues };
}

function prefixIssues(issues: readonly AgentContractIssue[], prefix: string): AgentContractIssue[] {
  return issues.map((issue) => ({ ...issue, path: `${prefix}${issue.path === "/" ? "" : issue.path}` }));
}

export function validateExecutionBundle(value: ExecutionBundle): AgentValidationResult<ExecutionBundle> {
  const issues: AgentContractIssue[] = [];
  const workOrder = validateDesignWorkOrder(value.workOrder);
  const plan = validateExecutionPlan(value.plan);
  const evidence = validateEvidenceBundle(value.evidence);
  if (!workOrder.ok) issues.push(...prefixIssues(workOrder.issues, "/workOrder"));
  if (!plan.ok) issues.push(...prefixIssues(plan.issues, "/plan"));
  if (!evidence.ok) issues.push(...prefixIssues(evidence.issues, "/evidence"));
  value.artifacts.forEach((artifact, index) => {
    const result = validateArtifactEnvelope(artifact);
    if (!result.ok) issues.push(...prefixIssues(result.issues, `/artifacts/${index}`));
  });
  if (value.candidate !== undefined) {
    const candidate = validateReviewCandidate(value.candidate);
    if (!candidate.ok) issues.push(...prefixIssues(candidate.issues, "/candidate"));
  }
  const workOrderId = value.workOrder.workOrderId;
  if (value.plan.workOrderId !== workOrderId || value.evidence.workOrderId !== workOrderId || value.artifacts.some((artifact) => artifact.workOrderId !== workOrderId) || (value.candidate !== undefined && value.candidate.workOrderId !== workOrderId)) issues.push({ source: "semantic", code: "bundle.work_order_mismatch", path: "/", message: "All bundle members must belong to the same Work Order" });
  if (value.artifacts.some((artifact) => artifact.planId !== value.plan.planId) || (value.candidate !== undefined && value.candidate.planId !== value.plan.planId)) issues.push({ source: "semantic", code: "bundle.plan_mismatch", path: "/", message: "All artifacts and candidates must belong to the bundle plan" });
  const sourceIds = new Set(value.evidence.sources.map((source) => source.sourceId));
  value.artifacts.forEach((artifact, index) => artifact.sourceCoverage.declaredSourceIds.forEach((sourceId) => {
    if (!sourceIds.has(sourceId)) issues.push({ source: "semantic", code: "bundle.source_missing", path: `/artifacts/${index}/sourceCoverage/declaredSourceIds`, message: `Artifact references evidence outside the bundle: ${sourceId}` });
  }));
  const stages = new Map(value.plan.stages.map((stage) => [stage.stageId, stage]));
  value.artifacts.forEach((artifact, index) => {
    const stage = stages.get(artifact.stageId);
    if (stage === undefined) issues.push({ source: "semantic", code: "bundle.stage_missing", path: `/artifacts/${index}/stageId`, message: `Artifact stage is not declared by the plan: ${artifact.stageId}` });
    else if (!stage.expectedArtifactTypes.includes(artifact.artifactType)) issues.push({ source: "semantic", code: "bundle.artifact_unexpected", path: `/artifacts/${index}/artifactType`, message: `Stage ${stage.stageId} does not expect ${artifact.artifactType}` });
  });
  if (value.candidate !== undefined) {
    const artifactIds = new Set(value.artifacts.map((artifact) => artifact.artifactId));
    const requiredIds = [value.candidate.artifactId, value.candidate.qa.reportArtifactId, value.candidate.export.reportArtifactId, ...value.candidate.export.artifactIds];
    if (requiredIds.some((id) => !artifactIds.has(id))) issues.push({ source: "semantic", code: "bundle.candidate_artifact_missing", path: "/candidate", message: "Candidate references artifacts outside the bundle" });
  }
  return issues.length === 0 ? { ok: true, value, issues: [] } : { ok: false, issues };
}

export function assertExecutionBundle(value: ExecutionBundle): ExecutionBundle {
  const result = validateExecutionBundle(value);
  if (!result.ok) throw new AgentContractError("Execution bundle", result.issues);
  return result.value;
}
