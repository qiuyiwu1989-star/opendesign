import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_OS_CONTRACT_VERSION,
  CAPABILITY_MANIFEST_VERSION,
  AgentContractError,
  ArtifactRegistryError,
  AgentRunError,
  appendArtifact,
  appendAgentRunEvent,
  assertExecutionBundle,
  createAgentRunLedger,
  createArtifactRegistry,
  findArtifact,
  latestArtifactByType,
  replayAgentRunLedger,
  validateAgentRunEvent,
  validateArtifactEnvelope,
  validateCapabilityManifest,
  validateDesignWorkOrder,
  validateEvidenceBundle,
  validateExecutionBundle,
  validateExecutionPlan,
  validateFeedbackEvent,
  validateReviewCandidate,
  type AgentRunLedger,
  type ArtifactEnvelope,
  type CapabilityManifest,
  type DesignWorkOrder,
  type EvidenceBundle,
  type ExecutionBundle,
  type ExecutionPlan,
  type ReviewCandidate,
} from "./index.js";

const timestamp = "2026-08-14T04:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}` as const;
const human = { actorId: "human_owner", kind: "human" as const };
const agent = { actorId: "agent_director", kind: "agent" as const };

function workOrder(): DesignWorkOrder {
  return {
    contractVersion: AGENT_OS_CONTRACT_VERSION,
    workOrderId: "work_proposal_001",
    createdAt: timestamp,
    title: "AI 基础设施提案",
    objective: "让管理层决定是否启动试点",
    audience: { description: "公司管理层", decisionOrAction: "批准三个月试点" },
    deliverable: { kind: "proposal", formats: ["html", "pptx"], language: "zh-CN", pageCount: { min: 6, max: 8 } },
    sources: [{ sourceId: "source_brief", type: "brief", title: "项目简报", contentHash: digest }],
    brand: { name: "OpenDesign", assetIds: [], guidance: ["编辑型克制视觉"] },
    constraints: ["不得虚构数字"],
    successCriteria: ["关键建议可追溯到来源", "PPTX 文字原生可编辑"],
    confidentiality: "private",
  };
}

function plan(): ExecutionPlan {
  return {
    contractVersion: AGENT_OS_CONTRACT_VERSION,
    planId: "plan_proposal_001",
    workOrderId: "work_proposal_001",
    revision: 1,
    createdAt: timestamp,
    status: "draft",
    designPack: { id: "executive-proposal-cn", version: "1.0.0" },
    capabilityPins: [{ id: "skill_design_director", version: "1.0.0" }],
    stages: [
      {
        stageId: "stage_diagnose",
        order: 1,
        kind: "diagnose",
        objective: "形成来源化诊断",
        skillPins: [{ id: "skill_design_director", version: "1.0.0" }],
        toolIds: [],
        requiredArtifactTypes: [],
        expectedArtifactTypes: ["diagnosis"],
        approval: "human-after",
        maxAttempts: 2,
      },
      {
        stageId: "stage_compose",
        order: 2,
        kind: "compose",
        objective: "生成可导入作品",
        skillPins: [{ id: "skill_design_director", version: "1.0.0" }],
        toolIds: ["tool_html_compiler"],
        requiredArtifactTypes: ["diagnosis"],
        expectedArtifactTypes: ["scene-ir"],
        approval: "human-after",
        maxAttempts: 2,
      },
    ],
    budget: { maxDurationSeconds: 900, maxModelCalls: 8, maxImageCalls: 0 },
  };
}

function evidence(): EvidenceBundle {
  return {
    contractVersion: AGENT_OS_CONTRACT_VERSION,
    evidenceBundleId: "evidence_proposal_001",
    workOrderId: "work_proposal_001",
    createdAt: timestamp,
    sources: [{ sourceId: "source_brief", title: "项目简报", contentHash: digest, trust: "user-provided", license: "owned", capturedAt: timestamp }],
    claims: [{ claimId: "claim_recommendation", statement: "建议启动三个月试点", sourceIds: ["source_brief"], kind: "recommendation" }],
  };
}

function artifact(overrides: Partial<ArtifactEnvelope> = {}): ArtifactEnvelope {
  return {
    contractVersion: AGENT_OS_CONTRACT_VERSION,
    artifactId: "artifact_scene_001",
    workOrderId: "work_proposal_001",
    planId: "plan_proposal_001",
    stageId: "stage_compose",
    artifactType: "scene-ir",
    revisionId: "revision_001",
    createdAt: timestamp,
    payloadHash: digest,
    payloadRef: "artifact://work_proposal_001/scene-ir/revision_001",
    designPack: { id: "executive-proposal-cn", version: "1.0.0" },
    skillPins: [{ id: "skill_design_director", version: "1.0.0" }],
    sourceCoverage: { declaredSourceIds: ["source_brief"], usedSourceIds: ["source_brief"], unresolvedSourceIds: [] },
    editability: { editable: true, capabilities: ["text", "typography", "asset", "frame", "order"], nativeElementRatio: 1 },
    validationStatus: "accepted",
    ...overrides,
  };
}

function candidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    contractVersion: AGENT_OS_CONTRACT_VERSION,
    candidateId: "candidate_001",
    workOrderId: "work_proposal_001",
    planId: "plan_proposal_001",
    artifactId: "artifact_scene_001",
    revisionId: "revision_002",
    createdAt: timestamp,
    createdBy: human,
    status: "approved",
    diff: { baseRevisionId: "revision_001", currentRevisionId: "revision_002", changedElementIds: ["element_title"] },
    qa: { reportArtifactId: "artifact_qa_001", blocker: 0, error: 0, warning: 1 },
    export: { reportArtifactId: "artifact_export_report", succeeded: true, artifactIds: ["artifact_export_pptx"] },
    sourceCoverage: { declaredSourceIds: ["source_brief"], usedSourceIds: ["source_brief"], unresolvedSourceIds: [] },
    decidedBy: human,
    decisionReason: "内容和版式已确认",
    notPublished: true,
    ...overrides,
  };
}

test("validates a versioned Work Order and rejects duplicate evidence IDs or invalid page ranges", () => {
  assert.equal(validateDesignWorkOrder(workOrder()).ok, true);
  const invalid = workOrder();
  invalid.deliverable.pageCount = { min: 9, max: 6 };
  invalid.sources.push({ ...invalid.sources[0]! });
  const result = validateDesignWorkOrder(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set(["source.duplicate", "deliverable.page_range"]));
});

test("requires ordered stages and plan-level capability pins", () => {
  const invalid = plan();
  invalid.stages[1]!.order = 3;
  invalid.stages[1]!.skillPins = [{ id: "skill_unpinned", version: "1.0.0" }];
  const result = validateExecutionPlan(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set(["stage.order_invalid", "capability.unpinned"]));
});

test("keeps facts and recommendations source-grounded while allowing explicit gaps", () => {
  const invalid = evidence();
  invalid.claims.push({ claimId: "claim_fact", statement: "无来源事实", sourceIds: [], kind: "fact" });
  invalid.claims.push({ claimId: "claim_gap", statement: "缺少预算", sourceIds: [], kind: "gap" });
  const result = validateEvidenceBundle(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.issues.map((issue) => issue.code), ["claim.source_required"]);
});

test("prevents accepted artifacts from claiming unresolved evidence or false editability", () => {
  const unresolved = artifact({ sourceCoverage: { declaredSourceIds: ["source_brief"], usedSourceIds: [], unresolvedSourceIds: ["source_brief"] } });
  const result = validateArtifactEnvelope(unresolved);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issues.some((issue) => issue.code === "artifact.unresolved_source"), true);
  const falseEditable = artifact({ editability: { editable: true, capabilities: [] } });
  const second = validateArtifactEnvelope(falseEditable);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.issues.some((issue) => issue.code === "artifact.capability_missing"), true);
});

test("010 registers immutable stage artifacts and rejects cross-task, revision, stage or pack drift", () => {
  const expanded = plan();
  expanded.stages[0]!.expectedArtifactTypes = ["diagnosis", "outline"];
  let registry = createArtifactRegistry(workOrder().workOrderId, expanded);
  const diagnosis = artifact({ artifactId: "artifact_diagnosis_001", stageId: "stage_diagnose", artifactType: "diagnosis", revisionId: "revision_diagnosis_001", editability: { editable: false, capabilities: [] } });
  registry = appendArtifact(registry, diagnosis);
  assert.equal(appendArtifact(registry, diagnosis), registry);
  const outline = artifact({ artifactId: "artifact_outline_001", stageId: "stage_diagnose", artifactType: "outline", revisionId: "revision_outline_001", editability: { editable: true, capabilities: ["text", "order"] } });
  registry = appendArtifact(registry, outline);
  assert.equal(latestArtifactByType(registry, "outline")?.artifactId, outline.artifactId);
  assert.equal(findArtifact(registry, diagnosis.artifactId)?.artifactType, "diagnosis");
  assert.throws(() => appendArtifact(registry, { ...outline, payloadHash: `sha256:${"b".repeat(64)}` }), (error: unknown) => error instanceof ArtifactRegistryError && error.code === "artifact.conflict");
  assert.throws(() => appendArtifact(registry, { ...outline, artifactId: "artifact_outline_002" }), (error: unknown) => error instanceof ArtifactRegistryError && error.code === "artifact.revision_conflict");
  assert.throws(() => appendArtifact(registry, { ...outline, artifactId: "artifact_outline_003", revisionId: "revision_outline_002", workOrderId: "work_other" }), (error: unknown) => error instanceof ArtifactRegistryError && error.code === "artifact.cross_work_order");
  assert.throws(() => appendArtifact(registry, { ...outline, artifactId: "artifact_outline_004", revisionId: "revision_outline_003", stageId: "stage_compose" }), (error: unknown) => error instanceof ArtifactRegistryError && error.code === "artifact.stage_mismatch");
  assert.throws(() => appendArtifact(registry, { ...outline, artifactId: "artifact_outline_005", revisionId: "revision_outline_004", designPack: { id: "other-pack", version: "1.0.0" } }), (error: unknown) => error instanceof ArtifactRegistryError && error.code === "artifact.pack_mismatch");
});

test("requires human approval and fail-closed QA/export gates while retaining notPublished", () => {
  assert.equal(validateReviewCandidate(candidate()).ok, true);
  const invalid = candidate({ decidedBy: agent, qa: { reportArtifactId: "artifact_qa_001", blocker: 0, error: 1, warning: 0 }, export: { reportArtifactId: "artifact_export_report", succeeded: false, artifactIds: ["artifact_export_pptx"] } });
  const result = validateReviewCandidate(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set(["candidate.human_required", "candidate.qa_blocked", "candidate.export_failed"]));
  const tampered = { ...candidate(), notPublished: false };
  assert.equal(validateReviewCandidate(tampered).ok, false);
});

test("separates private correction reasons from aggregate learning signals", () => {
  const privateFeedback = {
    contractVersion: AGENT_OS_CONTRACT_VERSION,
    feedbackId: "feedback_001",
    workOrderId: "work_proposal_001",
    occurredAt: timestamp,
    actor: human,
    target: { kind: "artifact", id: "artifact_scene_001" },
    signal: "modified",
    reason: "标题需要更直接",
    measurement: { operationCount: 2, durationSeconds: 45 },
    visibility: "private",
    changesHistoricalJudgment: false,
  } as const;
  assert.equal(validateFeedbackEvent(privateFeedback).ok, true);
  assert.equal(validateFeedbackEvent({ ...privateFeedback, visibility: "aggregate-only" }).ok, false);
  const noMeasurement = { ...privateFeedback, measurement: undefined };
  assert.equal(validateFeedbackEvent(noMeasurement).ok, false);
});

test("requires evaluated capability provenance and permanently forbids publish permission", () => {
  const manifest: CapabilityManifest = {
    manifestVersion: CAPABILITY_MANIFEST_VERSION,
    id: "skill_design_director",
    version: "1.0.0",
    kind: "skill",
    name: "OpenDesign Design Director",
    summary: "诊断并编排设计任务",
    lifecycle: "approved",
    compatibility: { workOrderContract: AGENT_OS_CONTRACT_VERSION, artifactContract: AGENT_OS_CONTRACT_VERSION },
    permissions: { network: "none", fileRead: true, fileWrite: true, model: true, publish: false },
    provenance: { sourceRef: "repo://skills/opendesign-design-director", license: "proprietary", reviewedAt: timestamp },
    taskKinds: ["proposal", "research-keynote", "article-graphics"],
    inputs: ["DesignWorkOrder"],
    outputs: ["ArtifactEnvelope"],
    stages: ["diagnose", "direction", "compose", "qa"],
    stoppingConditions: ["来源不足时停止"],
    evalSuiteIds: ["eval_design_director"],
  };
  assert.equal(validateCapabilityManifest(manifest).ok, true);
  assert.equal(validateCapabilityManifest({ ...manifest, provenance: { sourceRef: manifest.provenance.sourceRef, license: manifest.provenance.license } }).ok, false);
  assert.equal(validateCapabilityManifest({ ...manifest, permissions: { ...manifest.permissions, publish: true } }).ok, false);
});

test("replays stages in order with explicit human confirmation and preserves idempotency", () => {
  let ledger = createAgentRunLedger(workOrder(), plan());
  const confirm = { eventId: "event_confirm", commandId: "command_confirm", type: "plan_confirmed" as const, occurredAt: timestamp, actor: human, inputArtifactIds: [], outputArtifactIds: [] };
  ledger = appendAgentRunEvent(ledger, confirm);
  const same = appendAgentRunEvent(ledger, confirm);
  assert.equal(same, ledger);
  ledger = appendAgentRunEvent(ledger, { eventId: "event_start_1", commandId: "command_start_1", stageId: "stage_diagnose", type: "stage_started", occurredAt: timestamp, actor: agent, inputArtifactIds: [], outputArtifactIds: [] });
  ledger = appendAgentRunEvent(ledger, { eventId: "event_complete_1", commandId: "command_complete_1", stageId: "stage_diagnose", type: "stage_completed", occurredAt: timestamp, actor: agent, inputArtifactIds: [], outputArtifactIds: ["artifact_diagnosis"] });
  ledger = appendAgentRunEvent(ledger, { eventId: "event_start_2", commandId: "command_start_2", stageId: "stage_compose", type: "stage_started", occurredAt: timestamp, actor: agent, inputArtifactIds: ["artifact_diagnosis"], outputArtifactIds: [] });
  ledger = appendAgentRunEvent(ledger, { eventId: "event_wait_2", commandId: "command_wait_2", stageId: "stage_compose", type: "stage_awaiting_input", occurredAt: timestamp, actor: agent, inputArtifactIds: [], outputArtifactIds: [], message: "请选择设计方向" });
  assert.equal(replayAgentRunLedger(ledger).status, "awaiting-input");
  ledger = appendAgentRunEvent(ledger, { eventId: "event_resume_2", commandId: "command_resume_2", stageId: "stage_compose", type: "stage_resumed", occurredAt: timestamp, actor: human, inputArtifactIds: [], outputArtifactIds: [] });
  ledger = appendAgentRunEvent(ledger, { eventId: "event_complete_2", commandId: "command_complete_2", stageId: "stage_compose", type: "stage_completed", occurredAt: timestamp, actor: agent, inputArtifactIds: ["artifact_diagnosis"], outputArtifactIds: ["artifact_scene_001"] });
  ledger = appendAgentRunEvent(ledger, { eventId: "event_plan_complete", commandId: "command_plan_complete", type: "plan_completed", occurredAt: timestamp, actor: agent, inputArtifactIds: [], outputArtifactIds: [] });
  const projection = replayAgentRunLedger(ledger);
  assert.equal(projection.status, "completed");
  assert.deepEqual(projection.stageStatuses, { stage_diagnose: "completed", stage_compose: "completed" });
  assert.equal(Object.isFrozen(ledger.events), true);
});

test("rejects skipped stages, parallel active stages, agent confirmation and command conflicts", () => {
  const base = createAgentRunLedger(workOrder(), plan());
  assert.throws(() => appendAgentRunEvent(base, { eventId: "event_confirm", commandId: "command_confirm", type: "plan_confirmed", occurredAt: timestamp, actor: agent, inputArtifactIds: [], outputArtifactIds: [] }), (error: unknown) => error instanceof AgentRunError && error.code === "actor.human_required");
  const confirmed = appendAgentRunEvent(base, { eventId: "event_confirm", commandId: "command_confirm", type: "plan_confirmed", occurredAt: timestamp, actor: human, inputArtifactIds: [], outputArtifactIds: [] });
  assert.throws(() => appendAgentRunEvent(confirmed, { eventId: "event_start_2", commandId: "command_start_2", stageId: "stage_compose", type: "stage_started", occurredAt: timestamp, actor: agent, inputArtifactIds: [], outputArtifactIds: [] }), (error: unknown) => error instanceof AgentRunError && error.code === "transition.invalid");
  const running = appendAgentRunEvent(confirmed, { eventId: "event_start_1", commandId: "command_start_1", stageId: "stage_diagnose", type: "stage_started", occurredAt: timestamp, actor: agent, inputArtifactIds: [], outputArtifactIds: [] });
  assert.throws(() => appendAgentRunEvent(running, { eventId: "event_start_other", commandId: "command_start_other", stageId: "stage_compose", type: "stage_started", occurredAt: timestamp, actor: agent, inputArtifactIds: [], outputArtifactIds: [] }), (error: unknown) => error instanceof AgentRunError && error.code === "transition.invalid");
  assert.throws(() => appendAgentRunEvent(confirmed, { eventId: "event_changed", commandId: "command_confirm", type: "plan_confirmed", occurredAt: timestamp, actor: human, inputArtifactIds: [], outputArtifactIds: [], message: "changed" }), (error: unknown) => error instanceof AgentRunError && error.code === "command.conflict");
});

test("detects tampered ledgers and invalid failure/completion evidence", () => {
  assert.equal(validateAgentRunEvent({ contractVersion: AGENT_OS_CONTRACT_VERSION, eventId: "event_failure", commandId: "command_failure", sequence: 1, workOrderId: "work_proposal_001", planId: "plan_proposal_001", stageId: "stage_compose", type: "stage_failed", occurredAt: timestamp, actor: agent, inputArtifactIds: [], outputArtifactIds: [] }).ok, false);
  assert.equal(validateAgentRunEvent({ contractVersion: AGENT_OS_CONTRACT_VERSION, eventId: "event_complete", commandId: "command_complete", sequence: 1, workOrderId: "work_proposal_001", planId: "plan_proposal_001", stageId: "stage_compose", type: "stage_completed", occurredAt: timestamp, actor: agent, inputArtifactIds: [], outputArtifactIds: [] }).ok, false);
  const ledger = createAgentRunLedger(workOrder(), plan());
  const tampered: AgentRunLedger = { ...ledger, events: [{ contractVersion: AGENT_OS_CONTRACT_VERSION, eventId: "event_confirm", commandId: "command_confirm", sequence: 2, workOrderId: "work_proposal_001", planId: "plan_proposal_001", type: "plan_confirmed", occurredAt: timestamp, actor: human, inputArtifactIds: [], outputArtifactIds: [] }] };
  assert.throws(() => replayAgentRunLedger(tampered), (error: unknown) => error instanceof AgentRunError && error.code === "event.invalid");
});

test("cross-validates one execution bundle and rejects cross-task or undeclared artifacts", () => {
  const scene = artifact();
  const qa = artifact({ artifactId: "artifact_qa_001", stageId: "stage_compose", artifactType: "qa-report", editability: { editable: false, capabilities: [] } });
  const exportReport = artifact({ artifactId: "artifact_export_report", stageId: "stage_compose", artifactType: "export-report", editability: { editable: false, capabilities: [] } });
  const exportPptx = artifact({ artifactId: "artifact_export_pptx", stageId: "stage_compose", artifactType: "scene-ir" });
  const expandedPlan = plan();
  expandedPlan.stages[1]!.expectedArtifactTypes = ["scene-ir", "qa-report", "export-report"];
  const bundle: ExecutionBundle = { workOrder: workOrder(), plan: expandedPlan, evidence: evidence(), artifacts: [scene, qa, exportReport, exportPptx], candidate: candidate() };
  assert.equal(validateExecutionBundle(bundle).ok, true);
  assert.equal(assertExecutionBundle(bundle), bundle);
  const invalid: ExecutionBundle = { ...bundle, artifacts: [{ ...scene, workOrderId: "work_other" }] };
  const result = validateExecutionBundle(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.issues.some((issue) => issue.code === "bundle.work_order_mismatch"), true);
  assert.throws(() => assertExecutionBundle(invalid), AgentContractError);
});
