import type { DesignPackPin, DocumentProvenance, HtmlImportResult, Revision, SceneDocument, ScenePatch } from "@opendesign/studio-contracts";
import type { DesignDirectorInput, DesignDirectorOutput } from "@opendesign/studio-design-director";
import type { ModelGenerationResult } from "@opendesign/studio-model-adapter";
import type { ReviewLedger, ReviewProjection } from "@opendesign/studio-publishing";
import type { AgentRunEvent, AgentRunProjection, ArtifactEnvelope, DesignWorkOrder, ExecutionPlan } from "@opendesign/studio-agent-os";

export type ProjectSummary = { projectId: string; title: string; sceneCount: number; updatedAt: string };
export type StoredRevision = { revision: Revision; document: SceneDocument };
export type AgentChangeCandidate = {
  candidateId: string;
  projectId: string;
  baseRevisionId: string;
  createdAt: string;
  status: "proposed" | "accepted" | "rejected" | "conflicted";
  target: { kind: "scene"; sceneId: string } | { kind: "element"; sceneId: string; elementId: string };
  instruction: string;
  rationale: string;
  patches: ScenePatch[];
  diffs: Array<{ elementId: string; field: "content"; before: string; after: string }>;
  proposedDocument: SceneDocument;
  decision?: { kind: "accepted" | "rejected" | "conflicted"; occurredAt: string; reason: string; revision?: Revision };
  notPublished: true;
};
export type GeneratedProject = {
  document: SceneDocument;
  storyline: Array<{ sceneId: string; order: number; title: string; purpose: string; headline: string }>;
  generator: "local-rules-v0";
};

export type StudioExportKind = "html" | "png" | "pptx";
export type StudioExportResult = {
  exportId: string;
  kind: StudioExportKind;
  renderer: string;
  warning?: string;
  files: Array<{ name: string; downloadUrl: string }>;
  bundle?: { name: string; downloadUrl: string };
  editabilityReport?: unknown;
};

export type StudioQaIssue = {
  issueId: string;
  sceneId: string;
  elementIds: string[];
  category: string;
  severity: "blocker" | "error" | "warning" | "note";
  message: string;
  safeAutoFix: boolean;
};

export type StudioQaReport = {
  documentId: string;
  summary: { blocker: number; error: number; warning: number; note: number; total: number };
  issues: StudioQaIssue[];
};

export type ProjectAsset = { assetId: string; name: string; mimeType: "image/png" | "image/jpeg"; width: number; height: number; url: string };
export type ReviewResponse = { ledger: ReviewLedger; projection: ReviewProjection };
export type ModelDraftResponse = { generation: ModelGenerationResult; review?: ReviewProjection };

export const generationJobStatuses = ["queued", "analyzing", "generating", "validating", "completed", "failed", "cancelled"] as const;
export type GenerationJobStatus = typeof generationJobStatuses[number];
export type GenerationJobErrorCode = "offline" | "rate_limited" | "provider_unavailable" | "invalid_input" | "creation_contract_incomplete" | "generation_failed";
export type GenerationJob = {
  jobId: string;
  status: GenerationJobStatus;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
  error?: { code: GenerationJobErrorCode; message: string; retryable?: boolean };
};
export type CreateWorkOrderInput = { brief: string; title?: string; designPack?: DesignPackPin };
export type WorkOrderWorkflow = {
  workOrder: DesignWorkOrder;
  plan: ExecutionPlan;
  projection: AgentRunProjection;
  events: readonly AgentRunEvent[];
  clarification: {
    status: "required" | "complete" | "not-needed";
    round: 0 | 1;
    maxQuestions: 2;
    questions: Array<{ questionId: "clarify_audience" | "clarify_action"; prompt: string; reason: string; answer?: string }>;
  };
  directionPreviews: Array<{
    directionId: string;
    name: string;
    pack: DesignPackPin;
    stance: "primary" | "alternate";
    rationale: string;
    tokens: { background: string; surface: string; text: string; accent: string; headingFamily: string };
    composition: { grid: string; density: "airy" | "balanced" | "dense"; rhythm: string };
  }>;
  selectedDirectionId: string;
  directionConfirmed: boolean;
  readyForConfirmation: boolean;
  artifacts: ArtifactEnvelope[];
  outlineReview: { status: "unavailable" | "draft" | "approved"; artifactId?: string; revisionId?: string; itemCount: number };
  generationJobId?: string;
};
export type WorkOrderOutlinePayload = {
  title: string;
  items: Array<{ itemId: string; order: number; role: "cover" | "context" | "insight" | "proposal" | "evidence" | "next-step"; title: string; purpose: string; sourceIds: string[] }>;
  method: "deterministic-v0";
};
export type WorkOrderArtifact = { artifact: ArtifactEnvelope; payload: unknown };

export class StudioApiError extends Error {
  readonly code: GenerationJobErrorCode;
  readonly status: number;

  constructor(message: string, code: GenerationJobErrorCode, status = 0) {
    super(message);
    this.name = "StudioApiError";
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function parseGenerationJob(value: unknown): GenerationJob {
  if (!isObject(value)
    || typeof value.jobId !== "string" || value.jobId.length === 0
    || !generationJobStatuses.includes(value.status as GenerationJobStatus)
    || !isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)) {
    throw new StudioApiError("生成任务响应格式无效，请稍后重试。", "generation_failed");
  }
  if (value.projectId !== undefined && (typeof value.projectId !== "string" || value.projectId.length === 0)) {
    throw new StudioApiError("生成任务返回了无效的作品 ID。", "generation_failed");
  }
  let error: GenerationJob["error"];
  if (value.error !== undefined) {
    if (!isObject(value.error)
      || typeof value.error.code !== "string" || value.error.code.length === 0
      || typeof value.error.message !== "string"
      || (value.error.retryable !== undefined && typeof value.error.retryable !== "boolean")) {
      throw new StudioApiError("生成任务返回了无效的错误信息。", "generation_failed");
    }
    const code = ["offline", "rate_limited", "provider_unavailable", "invalid_input", "creation_contract_incomplete"].includes(value.error.code) ? value.error.code as GenerationJobErrorCode : "generation_failed";
    error = { code, message: value.error.message, ...(value.error.retryable === undefined ? {} : { retryable: value.error.retryable }) };
  }
  if (value.status === "completed" && !value.projectId) {
    throw new StudioApiError("生成已完成，但没有可打开的作品。", "generation_failed");
  }
  if (value.status === "failed" && !error) {
    throw new StudioApiError("生成失败，但服务端没有返回诊断信息。", "generation_failed");
  }
  return {
    jobId: value.jobId,
    status: value.status as GenerationJobStatus,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.projectId ? { projectId: value.projectId } : {}),
    ...(error ? { error } : {}),
  };
}

function apiErrorFromPayload(payload: unknown, status: number): StudioApiError {
  const object = isObject(payload) ? payload : {};
  const nested = isObject(object.error) ? object.error : undefined;
  const rawCode = nested?.code ?? object.code;
  const code = status === 429 ? "rate_limited"
    : rawCode === "provider_unavailable" ? "provider_unavailable"
    : rawCode === "invalid_input" ? "invalid_input"
    : rawCode === "creation_contract_incomplete" ? "creation_contract_incomplete"
    : rawCode === "rate_limited" ? "rate_limited"
    : "generation_failed";
  const message = typeof nested?.message === "string" ? nested.message
    : typeof object.error === "string" ? object.error
    : typeof object.message === "string" ? object.message
    : `Studio API returned ${status}`;
  return new StudioApiError(message, code, status);
}

async function generationRequest(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new StudioApiError("当前网络不可用。恢复网络后可重试；已建立的任务仍可通过任务 ID 恢复。", "offline");
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new StudioApiError("生成服务返回了无法读取的响应。", "generation_failed", response.status);
  }
  if (!response.ok) throw apiErrorFromPayload(payload, response.status);
  return payload;
}

function parseJobEnvelope(payload: unknown): GenerationJob {
  if (!isObject(payload) || !("job" in payload)) {
    throw new StudioApiError("生成服务没有返回任务。", "generation_failed");
  }
  return parseGenerationJob(payload.job);
}

function parseWorkflow(value: unknown): WorkOrderWorkflow {
  if (!isObject(value) || !isObject(value.workOrder) || !isObject(value.plan) || !isObject(value.projection) || !Array.isArray(value.events)) {
    throw new StudioApiError("Creation Contract 响应格式无效，请重新建立任务。", "generation_failed");
  }
  const workOrder = value.workOrder;
  const plan = value.plan;
  const projection = value.projection;
  const pinsValid = Array.isArray(plan.capabilityPins) && plan.capabilityPins.every((pin) => isObject(pin) && typeof pin.id === "string" && typeof pin.version === "string");
  const stagesValid = Array.isArray(plan.stages) && plan.stages.length > 0 && plan.stages.every((stage) => isObject(stage)
    && typeof stage.stageId === "string" && typeof stage.kind === "string" && typeof stage.objective === "string" && typeof stage.order === "number");
  const sourcesValid = Array.isArray(workOrder.sources) && workOrder.sources.length > 0 && workOrder.sources.every((source) => isObject(source) && typeof source.sourceId === "string" && typeof source.title === "string");
  const clarification = isObject(value.clarification) ? value.clarification : {};
  const directions = Array.isArray(value.directionPreviews) ? value.directionPreviews : [];
  const clarificationValid = ["required", "complete", "not-needed"].includes(String(clarification.status))
    && (clarification.round === 0 || clarification.round === 1)
    && clarification.maxQuestions === 2
    && Array.isArray(clarification.questions) && clarification.questions.length <= 2
    && clarification.questions.every((question) => isObject(question)
      && ["clarify_audience", "clarify_action"].includes(String(question.questionId))
      && typeof question.prompt === "string" && typeof question.reason === "string"
      && (question.answer === undefined || typeof question.answer === "string"));
  const directionsValid = directions.length === 3
    && directions.every((direction) => isObject(direction)
      && typeof direction.directionId === "string" && typeof direction.name === "string"
      && isObject(direction.pack) && typeof direction.pack.id === "string" && typeof direction.pack.version === "string"
      && ["primary", "alternate"].includes(String(direction.stance)) && typeof direction.rationale === "string"
      && isObject(direction.tokens) && [direction.tokens.background, direction.tokens.surface, direction.tokens.text, direction.tokens.accent, direction.tokens.headingFamily].every((token) => typeof token === "string")
      && isObject(direction.composition) && typeof direction.composition.grid === "string"
      && ["airy", "balanced", "dense"].includes(String(direction.composition.density)) && typeof direction.composition.rhythm === "string");
  const artifacts = Array.isArray(value.artifacts) ? value.artifacts : [];
  const artifactTypes = ["diagnosis", "outline", "direction", "structured-html", "scene-ir", "qa-report", "export-report"];
  const artifactsValid = artifacts.length > 0 && artifacts.every((artifact) => isObject(artifact)
    && typeof artifact.artifactId === "string" && typeof artifact.workOrderId === "string" && typeof artifact.planId === "string" && typeof artifact.stageId === "string"
    && artifactTypes.includes(String(artifact.artifactType)) && typeof artifact.revisionId === "string" && isIsoDate(artifact.createdAt)
    && typeof artifact.payloadHash === "string" && /^sha256:[a-f0-9]{64}$/u.test(artifact.payloadHash) && typeof artifact.payloadRef === "string"
    && isObject(artifact.designPack) && typeof artifact.designPack.id === "string" && typeof artifact.designPack.version === "string"
    && Array.isArray(artifact.skillPins) && isObject(artifact.sourceCoverage) && Array.isArray(artifact.sourceCoverage.declaredSourceIds) && Array.isArray(artifact.sourceCoverage.usedSourceIds) && Array.isArray(artifact.sourceCoverage.unresolvedSourceIds)
    && isObject(artifact.editability) && typeof artifact.editability.editable === "boolean" && Array.isArray(artifact.editability.capabilities)
    && ["draft", "accepted", "rejected"].includes(String(artifact.validationStatus)));
  const outlineReview = isObject(value.outlineReview) ? value.outlineReview : {};
  const outlineReviewValid = ["unavailable", "draft", "approved"].includes(String(outlineReview.status))
    && Number.isSafeInteger(outlineReview.itemCount) && Number(outlineReview.itemCount) >= 0
    && (outlineReview.artifactId === undefined || typeof outlineReview.artifactId === "string")
    && (outlineReview.revisionId === undefined || typeof outlineReview.revisionId === "string")
    && (outlineReview.status === "unavailable" ? outlineReview.artifactId === undefined : artifacts.some((artifact) => isObject(artifact) && artifact.artifactId === outlineReview.artifactId && artifact.artifactType === "outline"));
  if (typeof workOrder.workOrderId !== "string" || !/^workorder_[a-z0-9]{8,59}$/u.test(workOrder.workOrderId)
    || typeof workOrder.title !== "string" || typeof workOrder.objective !== "string"
    || !isObject(workOrder.audience) || typeof workOrder.audience.description !== "string" || typeof workOrder.audience.decisionOrAction !== "string"
    || !sourcesValid || !artifactsValid || !outlineReviewValid || new Set(artifacts.map((artifact) => isObject(artifact) ? artifact.artifactId : "")).size !== artifacts.length || artifacts.some((artifact) => isObject(artifact) && artifact.workOrderId !== workOrder.workOrderId)
    || !Array.isArray(workOrder.successCriteria) || !workOrder.successCriteria.every((criterion) => typeof criterion === "string")
    || typeof plan.planId !== "string" || plan.workOrderId !== workOrder.workOrderId
    || !isObject(plan.designPack) || typeof plan.designPack.id !== "string" || typeof plan.designPack.version !== "string"
    || !pinsValid || !stagesValid || !isObject(plan.budget)
    || !clarificationValid || !directionsValid || typeof value.selectedDirectionId !== "string"
    || !directions.some((direction) => isObject(direction) && direction.directionId === value.selectedDirectionId)
    || typeof value.directionConfirmed !== "boolean" || typeof value.readyForConfirmation !== "boolean"
    || value.readyForConfirmation !== ((clarification.status === "complete" || clarification.status === "not-needed") && value.directionConfirmed && outlineReview.status === "approved")
    || typeof plan.budget.maxDurationSeconds !== "number" || typeof plan.budget.maxModelCalls !== "number" || typeof plan.budget.maxImageCalls !== "number"
    || projection.workOrderId !== workOrder.workOrderId || projection.planId !== plan.planId
    || typeof projection.status !== "string" || !isObject(projection.stageStatuses)
    || !Object.values(projection.stageStatuses).every((status) => ["queued", "running", "awaiting-input", "completed", "failed", "cancelled"].includes(String(status)))) {
    throw new StudioApiError("Creation Contract 缺少目标、能力版本或阶段信息。", "generation_failed");
  }
  if (value.generationJobId !== undefined && (typeof value.generationJobId !== "string" || !/^job_[a-z0-9]{8,59}$/u.test(value.generationJobId))) {
    throw new StudioApiError("Creation Contract 返回了无效的任务关联。", "generation_failed");
  }
  return value as unknown as WorkOrderWorkflow;
}

function parseWorkflowEnvelope(payload: unknown): WorkOrderWorkflow {
  if (!isObject(payload) || !("workflow" in payload)) throw new StudioApiError("服务端没有返回 Creation Contract。", "generation_failed");
  return parseWorkflow(payload.workflow);
}

export async function createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrderWorkflow> {
  return parseWorkflowEnvelope(await generationRequest("/api/work-orders", { method: "POST", body: JSON.stringify(input) }));
}

export async function loadWorkOrder(workOrderId: string): Promise<WorkOrderWorkflow> {
  return parseWorkflowEnvelope(await generationRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}`));
}

export async function confirmWorkOrder(workOrderId: string): Promise<{ workflow: WorkOrderWorkflow; job: GenerationJob }> {
  const payload = await generationRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}/confirm`, { method: "POST", body: "{}" });
  if (!isObject(payload) || !("workflow" in payload) || !("job" in payload)) throw new StudioApiError("确认计划后没有返回生成任务。", "generation_failed");
  const workflow = parseWorkflow(payload.workflow);
  const job = parseGenerationJob(payload.job);
  if (workflow.generationJobId !== job.jobId) throw new StudioApiError("Creation Contract 与生成任务关联不一致。", "generation_failed");
  return { workflow, job };
}

export async function answerWorkOrderClarifications(workOrderId: string, answers: Array<{ questionId: string; answer: string }>): Promise<WorkOrderWorkflow> {
  return parseWorkflowEnvelope(await generationRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}/clarifications`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  }));
}

export async function selectWorkOrderDirection(workOrderId: string, directionId: string): Promise<WorkOrderWorkflow> {
  return parseWorkflowEnvelope(await generationRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}/direction`, {
    method: "POST",
    body: JSON.stringify({ directionId }),
  }));
}

export async function approveWorkOrderOutline(workOrderId: string, expectedArtifactId: string): Promise<WorkOrderWorkflow> {
  return parseWorkflowEnvelope(await generationRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}/outline`, {
    method: "POST",
    body: JSON.stringify({ action: "approve", expectedArtifactId }),
  }));
}

export async function loadWorkOrderArtifact(workOrderId: string, artifactId: string): Promise<WorkOrderArtifact> {
  const payload = await generationRequest(`/api/work-orders/${encodeURIComponent(workOrderId)}/artifacts/${encodeURIComponent(artifactId)}`);
  if (!isObject(payload) || !isObject(payload.artifact) || payload.artifact.artifactId !== artifactId || payload.artifact.workOrderId !== workOrderId || !("payload" in payload)) {
    throw new StudioApiError("阶段产物响应格式无效。", "generation_failed");
  }
  return payload as unknown as WorkOrderArtifact;
}

export function parseWorkOrderOutlinePayload(value: unknown): WorkOrderOutlinePayload {
  if (!isObject(value) || typeof value.title !== "string" || value.method !== "deterministic-v0" || !Array.isArray(value.items) || value.items.length < 1
    || !value.items.every((item) => isObject(item) && typeof item.itemId === "string" && Number.isSafeInteger(item.order)
      && ["cover", "context", "insight", "proposal", "evidence", "next-step"].includes(String(item.role))
      && typeof item.title === "string" && typeof item.purpose === "string" && Array.isArray(item.sourceIds) && item.sourceIds.every((sourceId) => typeof sourceId === "string"))) {
    throw new StudioApiError("大纲产物缺少稳定页面角色或来源。", "generation_failed");
  }
  return value as unknown as WorkOrderOutlinePayload;
}

export function parseWorkOrderScenePayload(value: unknown): SceneDocument {
  if (!isObject(value) || typeof value.schemaVersion !== "string" || typeof value.documentId !== "string" || typeof value.title !== "string"
    || !isObject(value.canvas) || value.canvas.width !== 1600 || value.canvas.height !== 900 || value.canvas.unit !== "logical-px"
    || !Array.isArray(value.directions) || value.directions.length < 1 || !Array.isArray(value.scenes) || value.scenes.length < 1
    || !value.directions.every((direction) => isObject(direction) && typeof direction.id === "string" && typeof direction.name === "string" && isObject(direction.tokens))
    || !value.scenes.every((scene) => isObject(scene) && typeof scene.id === "string" && Number.isSafeInteger(scene.order) && typeof scene.title === "string"
      && typeof scene.purpose === "string" && typeof scene.layout === "string" && Array.isArray(scene.elements)
      && scene.elements.every((element) => isObject(element) && typeof element.id === "string" && typeof element.type === "string" && typeof element.role === "string" && isObject(element.frame)))) {
    throw new StudioApiError("Scene IR 阶段产物格式无效。", "generation_failed");
  }
  return value as unknown as SceneDocument;
}

export function parseWorkOrderQaPayload(value: unknown): StudioQaReport {
  if (!isObject(value) || typeof value.documentId !== "string" || !isObject(value.summary) || !Array.isArray(value.issues)) {
    throw new StudioApiError("QA 阶段产物格式无效。", "generation_failed");
  }
  const rawCounts = [value.summary.blocker, value.summary.error, value.summary.warning, value.summary.note, value.summary.total];
  if (!rawCounts.every((count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) {
    throw new StudioApiError("QA 阶段产物格式无效。", "generation_failed");
  }
  const counts = rawCounts as number[];
  if (!counts.every((count) => Number.isSafeInteger(count) && count >= 0)
    || counts[4] !== counts[0]! + counts[1]! + counts[2]! + counts[3]!
    || !value.issues.every((issue) => isObject(issue) && typeof issue.issueId === "string" && typeof issue.sceneId === "string" && typeof issue.message === "string")) {
    throw new StudioApiError("QA 阶段产物格式无效。", "generation_failed");
  }
  return value as unknown as StudioQaReport;
}

export async function loadGenerationJob(jobId: string): Promise<GenerationJob> {
  return parseJobEnvelope(await generationRequest(`/api/generation-jobs/${encodeURIComponent(jobId)}`));
}

export async function cancelGenerationJob(jobId: string): Promise<GenerationJob> {
  return parseJobEnvelope(await generationRequest(`/api/generation-jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST", body: "{}" }));
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as T & { error?: unknown };
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : isObject(payload.error) && typeof payload.error.message === "string" ? payload.error.message : `Studio API returned ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function parseAgentChangeCandidate(value: unknown): AgentChangeCandidate {
  if (!isObject(value)
    || typeof value.candidateId !== "string" || !/^change_[a-z0-9]{8,59}$/u.test(value.candidateId)
    || typeof value.projectId !== "string" || typeof value.baseRevisionId !== "string" || !isIsoDate(value.createdAt)
    || !["proposed", "accepted", "rejected", "conflicted"].includes(String(value.status))
    || typeof value.instruction !== "string" || typeof value.rationale !== "string" || value.notPublished !== true
    || !isObject(value.target) || !["scene", "element"].includes(String(value.target.kind)) || typeof value.target.sceneId !== "string"
    || (value.target.kind === "element" && typeof value.target.elementId !== "string")
    || !Array.isArray(value.patches) || value.patches.length !== 1 || !Array.isArray(value.diffs) || value.diffs.length !== 1
    || !isObject(value.proposedDocument) || value.proposedDocument.documentId !== value.projectId || !Array.isArray(value.proposedDocument.scenes) || !Array.isArray(value.proposedDocument.directions)) {
    throw new Error("Agent 修改候选响应格式无效。");
  }
  const patch = value.patches[0];
  const diff = value.diffs[0];
  if (!isObject(patch) || patch.field !== "content" || typeof patch.elementId !== "string" || typeof patch.value !== "string"
    || !isObject(diff) || diff.field !== "content" || diff.elementId !== patch.elementId || typeof diff.before !== "string" || diff.after !== patch.value) {
    throw new Error("Agent 修改候选缺少可验证的文字 Diff。");
  }
  if (value.decision !== undefined && (!isObject(value.decision) || !["accepted", "rejected", "conflicted"].includes(String(value.decision.kind)) || !isIsoDate(value.decision.occurredAt) || typeof value.decision.reason !== "string")) {
    throw new Error("Agent 修改候选的人工决定格式无效。");
  }
  return value as unknown as AgentChangeCandidate;
}

export async function loadProject(projectId: string): Promise<SceneDocument | null> {
  try {
    const document = await apiRequest<SceneDocument>(`/api/projects/${projectId}`);
    if (!document || document.documentId !== projectId || !Array.isArray(document.scenes) || !Array.isArray(document.directions)) {
      throw new Error("Studio API returned an invalid project document");
    }
    return document;
  } catch (error) {
    if (error instanceof Error && error.message === "Project not found") return null;
    throw error;
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const payload = await apiRequest<{ projects?: ProjectSummary[] }>("/api/projects");
  if (!Array.isArray(payload.projects)) throw new Error("Studio API returned an invalid project list");
  return payload.projects;
}

export async function generateProject(brief: string, title?: string, designPack?: DesignPackPin): Promise<GeneratedProject> {
  return apiRequest<GeneratedProject>("/api/projects/generate", {
    method: "POST",
    body: JSON.stringify({ brief, ...(title ? { title } : {}), ...(designPack ? { designPack } : {}) }),
  });
}

export async function createDesignDirectorDraft(input: DesignDirectorInput): Promise<DesignDirectorOutput> {
  const response = await fetch("/api/design-director/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json() as DesignDirectorOutput & { error?: string };
  if (response.status === 422 && payload.status === "rejected") return payload;
  if (!response.ok) throw new Error(payload.error || `Studio API returned ${response.status}`);
  return payload;
}

export async function createModelDraft(input: DesignDirectorInput): Promise<ModelDraftResponse> {
  const result = await apiRequest<ModelDraftResponse>("/api/model/drafts", {
    method: "POST",
    body: JSON.stringify({ requestId: `model_${Date.now().toString(36)}`, input }),
  });
  return result;
}

export async function loadReview(reviewId: string): Promise<ReviewResponse | null> {
  try {
    return await apiRequest<ReviewResponse>(`/api/reviews/${reviewId}`);
  } catch (error) {
    if (error instanceof Error && error.message === "Review not found") return null;
    throw error;
  }
}

export async function submitProjectReview(reviewId: string, revisionId: string, currentDocument: SceneDocument): Promise<ReviewResponse> {
  return apiRequest<ReviewResponse>(`/api/reviews/${reviewId}/submit`, {
    method: "POST",
    body: JSON.stringify({ revisionId, currentDocument }),
  });
}

export async function approveProjectCandidate(reviewId: string, revisionId: string, reason: string): Promise<ReviewResponse> {
  return apiRequest<ReviewResponse>(`/api/reviews/${reviewId}/approve`, {
    method: "POST",
    body: JSON.stringify({ revisionId, reason }),
  });
}

export async function importProjectHtml(html: string, provenance: DocumentProvenance): Promise<HtmlImportResult> {
  const response = await fetch("/api/imports/html", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html, provenance }),
  });
  const payload = await response.json() as HtmlImportResult & { error?: string };
  if (response.status === 422 && payload.status === "rejected") return payload;
  if (!response.ok) throw new Error(payload.error || `Studio API returned ${response.status}`);
  return payload;
}

export async function duplicateProject(projectId: string): Promise<SceneDocument> {
  return (await apiRequest<{ document: SceneDocument }>(`/api/projects/${projectId}/duplicate`, { method: "POST", body: "{}" })).document;
}

export async function listRevisions(projectId: string): Promise<StoredRevision[]> {
  return (await apiRequest<{ revisions: StoredRevision[] }>(`/api/projects/${projectId}/revisions`)).revisions;
}

export async function persistProject(document: SceneDocument, patches: ScenePatch[] = [], reason: "edit" | "qa-fix" | "regenerate" = "edit"): Promise<StoredRevision> {
  const result = await apiRequest<{ document: SceneDocument; revision: Revision }>(`/api/projects/${document.documentId}`, {
    method: "PUT",
    body: JSON.stringify({ document, patches, reason }),
  });
  return { document: result.document, revision: result.revision };
}

export async function listAgentChangeCandidates(projectId: string): Promise<AgentChangeCandidate[]> {
  const payload = await apiRequest<{ candidates?: unknown[] }>(`/api/projects/${projectId}/agent-changes`);
  if (!Array.isArray(payload.candidates)) throw new Error("Studio API 没有返回修改候选列表。");
  return payload.candidates.map(parseAgentChangeCandidate);
}

export async function createAgentChangeCandidate(projectId: string, input: { instruction: string; target: AgentChangeCandidate["target"] }): Promise<AgentChangeCandidate> {
  const payload = await apiRequest<{ candidate?: unknown }>(`/api/projects/${projectId}/agent-changes`, { method: "POST", body: JSON.stringify(input) });
  return parseAgentChangeCandidate(payload.candidate);
}

export async function acceptAgentChangeCandidate(projectId: string, candidateId: string, reason: string): Promise<{ candidate: AgentChangeCandidate; document: SceneDocument; revision: Revision }> {
  const payload = await apiRequest<{ candidate?: unknown; document?: SceneDocument; revision?: Revision }>(`/api/projects/${projectId}/agent-changes/${candidateId}/accept`, { method: "POST", body: JSON.stringify({ reason }) });
  const candidate = parseAgentChangeCandidate(payload.candidate);
  if (!payload.document || payload.document.documentId !== projectId || !payload.revision || payload.revision.revisionId !== candidate.decision?.revision?.revisionId) throw new Error("接受候选后没有返回一致的新修订。");
  return { candidate, document: payload.document, revision: payload.revision };
}

export async function rejectAgentChangeCandidate(projectId: string, candidateId: string, reason: string): Promise<AgentChangeCandidate> {
  const payload = await apiRequest<{ candidate?: unknown }>(`/api/projects/${projectId}/agent-changes/${candidateId}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
  return parseAgentChangeCandidate(payload.candidate);
}

export async function createExport(projectId: string, kind: StudioExportKind): Promise<StudioExportResult> {
  return apiRequest<StudioExportResult>(`/api/projects/${projectId}/exports`, {
    method: "POST",
    body: JSON.stringify({ kind }),
  });
}

export async function runProjectQa(document: SceneDocument): Promise<StudioQaReport> {
  return apiRequest<StudioQaReport>("/api/qa", {
    method: "POST",
    body: JSON.stringify({ document }),
  });
}

export async function uploadProjectImage(projectId: string, file: File): Promise<ProjectAsset> {
  const buffer = new Uint8Array(await new Response(file).arrayBuffer());
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return apiRequest<ProjectAsset>(`/api/projects/${projectId}/assets`, {
    method: "POST",
    body: JSON.stringify({ name: file.name, mimeType: file.type, data: btoa(binary) }),
  });
}
