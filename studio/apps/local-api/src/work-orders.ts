import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_OS_CONTRACT_VERSION,
  appendAgentRunEvent,
  createAgentRunLedger,
  replayAgentRunLedger,
  validateArtifactEnvelope,
  type AgentRunEvent,
  type AgentRunLedger,
  type AgentRunProjection,
  type ArtifactEnvelope,
  type ArtifactType,
  type DesignWorkOrder,
  type ExecutionPlan,
  type ExecutionStage,
  type RunActor,
} from "@opendesign/studio-agent-os";
import type { DesignPackPin, SceneDocument } from "@opendesign/studio-contracts";
import type { DesignDirectorInput, DesignDirectorOutput } from "@opendesign/studio-design-director";
import { designDirections, getDesignPack } from "@opendesign/studio-design-packs/catalog";
import type { QaReport } from "@opendesign/studio-qa";
import type { GenerationJob, GenerationJobStatus } from "./generation-jobs.js";

const SCOPE_HASH = /^(?:scope_)?[a-f0-9]{64}$/u;
const WORK_ORDER_ID = /^workorder_[a-z0-9]{8,59}$/u;
const PUBLIC_ACTOR: RunActor = { actorId: "studio_public_session", kind: "human" };
const SYSTEM_ACTOR: RunActor = { actorId: "studio_runtime", kind: "system" };

export type CreateWorkOrderInput = {
  brief: string;
  title?: string;
  designPack?: DesignPackPin;
};

export type WorkOrderWorkflow = {
  workOrder: DesignWorkOrder;
  plan: ExecutionPlan;
  projection: AgentRunProjection;
  events: readonly AgentRunEvent[];
  clarification: WorkOrderClarification;
  directionPreviews: readonly WorkOrderDirectionPreview[];
  selectedDirectionId: string;
  directionConfirmed: boolean;
  readyForConfirmation: boolean;
  artifacts: readonly ArtifactEnvelope[];
  outlineReview: WorkOrderOutlineReview;
  generationJobId?: string;
};

export type WorkOrderOutlineItem = {
  itemId: string;
  order: number;
  role: "cover" | "context" | "insight" | "proposal" | "evidence" | "next-step";
  title: string;
  purpose: string;
  sourceIds: string[];
};

export type WorkOrderOutlinePayload = {
  title: string;
  items: WorkOrderOutlineItem[];
  method: "deterministic-v0";
};

export type WorkOrderOutlineReview = {
  status: "unavailable" | "draft" | "approved";
  artifactId?: string;
  revisionId?: string;
  itemCount: number;
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type PersistedArtifact = { envelope: ArtifactEnvelope; payload: JsonValue };

export type WorkOrderClarificationQuestion = {
  questionId: "clarify_audience" | "clarify_action";
  prompt: string;
  reason: string;
  answer?: string;
};

export type WorkOrderClarification = {
  status: "required" | "complete" | "not-needed";
  round: 0 | 1;
  maxQuestions: 2;
  questions: WorkOrderClarificationQuestion[];
};

export type WorkOrderDirectionPreview = {
  directionId: string;
  name: string;
  pack: DesignPackPin;
  stance: "primary" | "alternate";
  rationale: string;
  tokens: { background: string; surface: string; text: string; accent: string; headingFamily: string };
  composition: { grid: string; density: "airy" | "balanced" | "dense"; rhythm: string };
};

type PersistedWorkOrder = {
  persistenceVersion: 1;
  scopeHash: string;
  ledger: AgentRunLedger;
  generationInput: DesignDirectorInput;
  clarification?: WorkOrderClarification;
  directionPreviews?: WorkOrderDirectionPreview[];
  selectedDirectionId?: string;
  directionConfirmed?: boolean;
  artifacts?: PersistedArtifact[];
  projectId?: string;
  generationJobId?: string;
};

export type WorkOrderManagerOptions = {
  rootDirectory: string;
  now?: () => Date;
  id?: () => string;
  maxPerScope?: number;
};

type JobCreator = (input: DesignDirectorInput) => Promise<GenerationJob>;
type JobReader = (jobId: string) => GenerationJob | null;
type AcceptedDesignDirectorOutput = Extract<DesignDirectorOutput, { status: "accepted" }>;

function assertScopeHash(scopeHash: string): void {
  if (!SCOPE_HASH.test(scopeHash)) throw new TypeError("Invalid session scope hash");
}

function normalizedInput(input: CreateWorkOrderInput): Required<Pick<CreateWorkOrderInput, "brief" | "title">> & { designPack: DesignPackPin } {
  if (typeof input.brief !== "string") throw new TypeError("Brief is required");
  const brief = input.brief.replace(/\s+/gu, " ").trim();
  if ([...brief].length < 12 || [...brief].length > 12_000) throw new TypeError("Brief must contain between 12 and 12,000 characters");
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 120) : [...brief].slice(0, 64).join("");
  const designPack = input.designPack ?? { id: "executive-proposal-cn", version: "1.0.0" };
  if (!/^[a-z][a-z0-9_-]{2,95}$/u.test(designPack.id) || !/^\d+\.\d+\.\d+$/u.test(designPack.version)) throw new TypeError("Design Pack pin is invalid");
  if (!getDesignPack(designPack.id, designPack.version)) throw new TypeError("Design Pack pin is not available in the approved catalog");
  return { brief, title, designPack };
}

function deliverableKind(packId: string): DesignWorkOrder["deliverable"]["kind"] {
  if (packId === "research-keynote-cn") return "research-keynote";
  if (packId === "editorial-story-graphics-cn") return "article-graphics";
  return "proposal";
}

const AUDIENCE_CUE = /受众|面向|给.{0,12}(?:看|汇报)|audience|投资人|管理层|客户|学生|设计师|产品负责人|决策者/iu;
const ACTION_CUE = /希望.{0,20}(?:决定|行动|理解|相信|购买|批准|选择)|需要.{0,20}(?:确认|批准|决策)|确认.{0,12}(?:阶段|方案|方向)|decision|call\s*to\s*action|下一步/iu;

function createClarification(brief: string): WorkOrderClarification {
  const questions: WorkOrderClarificationQuestion[] = [];
  if (!AUDIENCE_CUE.test(brief)) questions.push({ questionId: "clarify_audience", prompt: "这份作品主要给谁看？", reason: "受众会改变论证深度、语言和视觉密度。" });
  if (!ACTION_CUE.test(brief)) questions.push({ questionId: "clarify_action", prompt: "看完后希望对方做出什么决定或行动？", reason: "明确行动才能让叙事收束到可确认的结果。" });
  return { status: questions.length === 0 ? "not-needed" : "required", round: questions.length === 0 ? 0 : 1, maxQuestions: 2, questions };
}

function createDirectionPreviews(selectedPackId: string): WorkOrderDirectionPreview[] {
  return designDirections(selectedPackId).map((direction) => {
    const pack = getDesignPack(direction.referenceSlug, direction.referenceVersion);
    if (!pack) throw new TypeError("Design Pack direction is not available in the approved catalog");
    return {
      directionId: direction.id,
      name: direction.name,
      pack: { id: pack.id, version: pack.version },
      stance: direction.stance,
      rationale: direction.rationale,
      tokens: {
        background: pack.tokens.background,
        surface: pack.tokens.surface,
        text: pack.tokens.text,
        accent: pack.tokens.accent,
        headingFamily: pack.tokens.headingFamily,
      },
      composition: structuredClone(pack.designDna.composition),
    };
  });
}

function decisionState(record: PersistedWorkOrder): Required<Pick<PersistedWorkOrder, "clarification" | "directionPreviews" | "selectedDirectionId" | "directionConfirmed">> {
  const selectedDirectionId = record.selectedDirectionId ?? `direction_${record.ledger.plan.designPack.id}`;
  return {
    clarification: record.clarification ?? createClarification(record.generationInput.brief.objective),
    directionPreviews: record.directionPreviews ?? createDirectionPreviews(record.ledger.plan.designPack.id),
    selectedDirectionId,
    directionConfirmed: record.directionConfirmed ?? false,
  };
}

function hasValidPersistedDecisions(record: Partial<PersistedWorkOrder>): boolean {
  if (record.clarification !== undefined) {
    const clarification = record.clarification;
    if (!["required", "complete", "not-needed"].includes(clarification.status)
      || ![0, 1].includes(clarification.round) || clarification.maxQuestions !== 2
      || !Array.isArray(clarification.questions) || clarification.questions.length > 2
      || clarification.questions.some((question) => !["clarify_audience", "clarify_action"].includes(question.questionId)
        || typeof question.prompt !== "string" || typeof question.reason !== "string"
        || (question.answer !== undefined && typeof question.answer !== "string"))) return false;
  }
  if (record.directionPreviews !== undefined) {
    if (!Array.isArray(record.directionPreviews) || record.directionPreviews.length !== 3) return false;
    for (const direction of record.directionPreviews) {
      const pack = getDesignPack(direction.pack?.id, direction.pack?.version);
      if (!pack || direction.directionId !== `direction_${pack.id}` || typeof direction.name !== "string"
        || !["primary", "alternate"].includes(direction.stance) || typeof direction.rationale !== "string"
        || !direction.tokens || !direction.composition) return false;
    }
  }
  if (record.selectedDirectionId !== undefined && (typeof record.selectedDirectionId !== "string" || !/^direction_[a-z][a-z0-9_-]{2,95}$/u.test(record.selectedDirectionId))) return false;
  if (record.directionConfirmed !== undefined && typeof record.directionConfirmed !== "boolean") return false;
  if (record.directionPreviews && record.selectedDirectionId && !record.directionPreviews.some((direction) => direction.directionId === record.selectedDirectionId)) return false;
  return true;
}

function canonicalJson(value: unknown, path = "$", seen = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== "object") throw new TypeError(`${path} is not JSON serializable`);
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item, index) => canonicalJson(item, `${path}[${index}]`, seen)).join(",")}]`;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must be a plain object`);
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], `${path}.${key}`, seen)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function payloadDigest(payload: JsonValue): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

function hasValidPersistedArtifacts(record: Partial<PersistedWorkOrder>): boolean {
  if (record.artifacts === undefined) return true;
  if (!Array.isArray(record.artifacts)) return false;
  const ids = new Set<string>();
  for (const artifact of record.artifacts) {
    if (!artifact || typeof artifact !== "object" || !("envelope" in artifact) || !("payload" in artifact)) return false;
    const validation = validateArtifactEnvelope(artifact.envelope);
    if (!validation.ok || ids.has(artifact.envelope.artifactId) || artifact.envelope.workOrderId !== record.ledger?.workOrder.workOrderId || artifact.envelope.payloadHash !== payloadDigest(artifact.payload)) return false;
    ids.add(artifact.envelope.artifactId);
  }
  return true;
}

function revisePlan(record: PersistedWorkOrder): void {
  const current = record.ledger.plan;
  const revision = current.revision + 1;
  const plan = structuredClone(current);
  plan.revision = revision;
  plan.planId = `plan_${record.ledger.workOrder.workOrderId.slice("workorder_".length)}_r${revision}`;
  record.ledger = createAgentRunLedger(structuredClone(record.ledger.workOrder), plan);
}

function createOutline(record: PersistedWorkOrder): WorkOrderOutlinePayload {
  const title = record.ledger.workOrder.title;
  const sourceIds = record.ledger.workOrder.sources.map((source) => source.sourceId);
  const items: Array<Omit<WorkOrderOutlineItem, "itemId" | "order" | "sourceIds">> = [
    { role: "cover", title, purpose: "明确主题、受众与需要推动的决定" },
    { role: "context", title: "为什么现在需要讨论", purpose: "界定背景、约束与证据边界" },
    { role: "insight", title: "关键判断与机会", purpose: "把已知事实与需要验证的推断分开" },
    { role: "proposal", title: "建议方案与设计原则", purpose: "提出可执行的核心方案" },
    { role: "evidence", title: "实施路径与验证方式", purpose: "说明行动、责任和成功标准" },
    { role: "next-step", title: "需要确认的下一步", purpose: "收束到明确决定与行动" },
  ];
  return {
    title: `${title} · 大纲`,
    items: items.map((item, index) => ({ ...item, itemId: `outline_item_${index + 1}`, order: index + 1, sourceIds })),
    method: "deterministic-v0",
  };
}

function artifactSlug(type: ArtifactType): string {
  return type.replaceAll("-", "_");
}

function latestArtifactRecord(record: PersistedWorkOrder, type: ArtifactType, currentPlanOnly = true): PersistedArtifact | null {
  return (record.artifacts ?? []).filter((artifact) => artifact.envelope.artifactType === type && (!currentPlanOnly || artifact.envelope.planId === record.ledger.plan.planId)).at(-1) ?? null;
}

function appendArtifactRecord(record: PersistedWorkOrder, input: {
  stageId: string;
  artifactType: ArtifactType;
  payload: JsonValue;
  validationStatus: ArtifactEnvelope["validationStatus"];
  editability: ArtifactEnvelope["editability"];
  createdAt: string;
}): PersistedArtifact {
  const stage = record.ledger.plan.stages.find((candidate) => candidate.stageId === input.stageId);
  if (!stage || !stage.expectedArtifactTypes.includes(input.artifactType)) throw new TypeError(`Stage ${input.stageId} does not produce ${input.artifactType}`);
  const records = record.artifacts ?? [];
  const sequence = records.filter((artifact) => artifact.envelope.artifactType === input.artifactType).length + 1;
  const suffix = record.ledger.workOrder.workOrderId.slice("workorder_".length);
  const slug = artifactSlug(input.artifactType);
  const artifactId = `artifact_${suffix}_${slug}_${sequence}`;
  const envelope: ArtifactEnvelope = {
    contractVersion: AGENT_OS_CONTRACT_VERSION,
    artifactId,
    workOrderId: record.ledger.workOrder.workOrderId,
    planId: record.ledger.plan.planId,
    stageId: input.stageId,
    artifactType: input.artifactType,
    revisionId: `revision_${suffix}_${slug}_${sequence}`,
    createdAt: input.createdAt,
    payloadHash: payloadDigest(input.payload),
    payloadRef: `/api/work-orders/${record.ledger.workOrder.workOrderId}/artifacts/${artifactId}`,
    designPack: structuredClone(record.ledger.plan.designPack),
    skillPins: structuredClone(stage.skillPins),
    sourceCoverage: {
      declaredSourceIds: record.ledger.workOrder.sources.map((source) => source.sourceId),
      usedSourceIds: record.ledger.workOrder.sources.map((source) => source.sourceId),
      unresolvedSourceIds: [],
    },
    editability: structuredClone(input.editability),
    validationStatus: input.validationStatus,
  };
  const validation = validateArtifactEnvelope(envelope);
  if (!validation.ok) throw new TypeError(`Artifact contract rejected ${artifactId}: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  const artifact = { envelope, payload: structuredClone(input.payload) };
  record.artifacts = [...records, artifact];
  return artifact;
}

function appendPlanningArtifacts(record: PersistedWorkOrder, createdAt: string): void {
  appendArtifactRecord(record, {
    stageId: "stage_diagnose",
    artifactType: "diagnosis",
    payload: {
      objective: record.ledger.workOrder.objective,
      audience: structuredClone(record.ledger.workOrder.audience),
      successCriteria: structuredClone(record.ledger.workOrder.successCriteria),
      evidenceBoundary: "只使用已声明来源；缺少的信息必须标记为缺口。",
    },
    validationStatus: "accepted",
    editability: { editable: false, capabilities: [] },
    createdAt,
  });
  const decisions = decisionState(record);
  if (!decisions.directionConfirmed) return;
  const direction = decisions.directionPreviews.find((candidate) => candidate.directionId === decisions.selectedDirectionId);
  if (!direction) throw new TypeError("Selected direction is unavailable");
  appendArtifactRecord(record, {
    stageId: "stage_direction",
    artifactType: "direction",
    payload: structuredClone(direction) as unknown as JsonValue,
    validationStatus: "accepted",
    editability: { editable: false, capabilities: [] },
    createdAt,
  });
  appendArtifactRecord(record, {
    stageId: "stage_outline",
    artifactType: "outline",
    payload: createOutline(record) as unknown as JsonValue,
    validationStatus: "draft",
    editability: { editable: true, capabilities: ["text", "order"] },
    createdAt,
  });
}

const DIRECTOR = { id: "opendesign-design-director", version: "0.3.0" } as const;
const NARRATIVE = { id: "narrative-architect", version: "0.1.0" } as const;
const ART_DIRECTOR = { id: "art-director", version: "0.1.0" } as const;
const CRITIC = { id: "design-critic", version: "0.1.0" } as const;

function stage(stage: Omit<ExecutionStage, "order">, order: number): ExecutionStage {
  return { ...stage, order };
}

function createContracts(input: ReturnType<typeof normalizedInput>, workOrderId: string, now: string): { workOrder: DesignWorkOrder; plan: ExecutionPlan; generationInput: DesignDirectorInput } {
  const kind = deliverableKind(input.designPack.id);
  const sourceDigest = createHash("sha256").update(input.brief).digest("hex");
  const workOrder: DesignWorkOrder = {
    contractVersion: AGENT_OS_CONTRACT_VERSION,
    workOrderId,
    createdAt: now,
    title: input.title,
    objective: input.brief,
    audience: { description: "内容创作者与决策者", decisionOrAction: "确认叙事、设计方向与下一步行动" },
    deliverable: { kind, formats: ["html", "pptx"], language: "zh-CN", pageCount: { min: 6, max: 8 } },
    sources: [{ sourceId: "source_brief", type: "brief", title: "用户 Brief", contentHash: `sha256:${sourceDigest}` }],
    brand: { name: "OpenDesign", assetIds: [], guidance: ["清晰", "克制", "结论先行", "不得补造用户未提供的事实"] },
    constraints: ["引用内容只来自已声明来源", "人工修改不得被生成任务静默覆盖", "发布必须由用户显式确认"],
    successCriteria: ["形成三个可比较的设计方向", "文字与图片可继续替换", "Scene IR 通过 importer 与确定性 QA", "HTML 与 PPTX 可真实导出"],
    confidentiality: "public",
  };
  const stages: ExecutionStage[] = [
    stage({ stageId: "stage_diagnose", kind: "diagnose", objective: "确认目标、受众、证据边界与成功标准", skillPins: [DIRECTOR], toolIds: [], requiredArtifactTypes: [], expectedArtifactTypes: ["diagnosis"], approval: "none", maxAttempts: 1 }, 1),
    stage({ stageId: "stage_direction", kind: "direction", objective: "形成一主两备的真实视觉方向", skillPins: [DIRECTOR, ART_DIRECTOR], toolIds: ["design-pack-catalog"], requiredArtifactTypes: ["diagnosis"], expectedArtifactTypes: ["direction"], approval: "human-before", maxAttempts: 2 }, 2),
    stage({ stageId: "stage_outline", kind: "outline", objective: "形成可审查且来源化的页面大纲", skillPins: [DIRECTOR, NARRATIVE], toolIds: ["outline-structurer"], requiredArtifactTypes: ["diagnosis", "direction"], expectedArtifactTypes: ["outline"], approval: "human-before", maxAttempts: 2 }, 3),
    stage({ stageId: "stage_compose", kind: "compose", objective: "将叙事和方向编译为 Structured HTML", skillPins: [DIRECTOR, NARRATIVE, ART_DIRECTOR], toolIds: ["model-adapter", "structured-html-compiler"], requiredArtifactTypes: ["outline", "direction"], expectedArtifactTypes: ["structured-html"], approval: "none", maxAttempts: 2 }, 4),
    stage({ stageId: "stage_import", kind: "import", objective: "安全导入并建立可编辑 Scene IR", skillPins: [DIRECTOR], toolIds: ["inert-html-importer"], requiredArtifactTypes: ["structured-html"], expectedArtifactTypes: ["scene-ir"], approval: "none", maxAttempts: 1 }, 5),
    stage({ stageId: "stage_qa", kind: "qa", objective: "执行来源、布局、可编辑与导出前质量检查", skillPins: [CRITIC], toolIds: ["scene-ir-qa"], requiredArtifactTypes: ["scene-ir"], expectedArtifactTypes: ["qa-report"], approval: "none", maxAttempts: 1 }, 6),
    stage({ stageId: "stage_edit", kind: "edit", objective: "保留当前稿并由用户进行局部编辑或请求修改", skillPins: [DIRECTOR, ART_DIRECTOR], toolIds: ["scene-ir-editor"], requiredArtifactTypes: ["scene-ir", "qa-report"], expectedArtifactTypes: ["scene-ir"], approval: "human-before", maxAttempts: 5 }, 7),
    stage({ stageId: "stage_review", kind: "review", objective: "冻结差异、来源与 QA 证据并由人工确认候选", skillPins: [CRITIC], toolIds: ["candidate-ledger"], requiredArtifactTypes: ["scene-ir", "qa-report"], expectedArtifactTypes: ["scene-ir"], approval: "human-before", maxAttempts: 3 }, 8),
    stage({ stageId: "stage_export", kind: "export", objective: "按明确动作导出 HTML 与原生可编辑 PPTX", skillPins: [DIRECTOR], toolIds: ["html-renderer", "pptx-renderer"], requiredArtifactTypes: ["scene-ir", "qa-report"], expectedArtifactTypes: ["export-report"], approval: "human-before", maxAttempts: 2 }, 9),
  ];
  const plan: ExecutionPlan = {
    contractVersion: AGENT_OS_CONTRACT_VERSION,
    planId: `plan_${workOrderId.slice("workorder_".length)}`,
    workOrderId,
    revision: 1,
    createdAt: now,
    status: "draft",
    designPack: input.designPack,
    capabilityPins: [DIRECTOR, NARRATIVE, ART_DIRECTOR, CRITIC],
    stages,
    budget: { maxDurationSeconds: 180, maxModelCalls: 2, maxImageCalls: 0 },
  };
  const generationInput: DesignDirectorInput = {
    inputVersion: "0.1.0",
    taskId: workOrderId,
    title: input.title,
    brief: { objective: input.brief, audience: workOrder.audience.description, decisionRequest: workOrder.audience.decisionOrAction, constraints: workOrder.constraints },
    content: { summary: input.brief, keyPoints: [{ id: "point_brief", text: [...input.brief].slice(0, 500).join(""), sourceIds: ["source_brief"] }], callToAction: "人工编辑并确认细节后再交付。" },
    sources: [{ sourceId: "source_brief", type: "brief", title: "用户 Brief", content: input.brief }],
    brand: { name: workOrder.brand.name, tone: workOrder.brand.guidance.slice(0, 3) },
    deliverable: { kind: kind === "research-keynote" ? "keynote" : kind, audience: workOrder.audience.description, language: "zh-CN", format: "structured-html", pageCount: 6 },
    designPack: input.designPack,
    editability: { requiredCapabilities: ["text", "typography", "asset", "frame", "order"], requireNativeText: true, requireReplaceableImages: true, requireReorderablePages: true },
  };
  return { workOrder, plan, generationInput };
}

function publicWorkflow(record: PersistedWorkOrder): WorkOrderWorkflow {
  const decisions = decisionState(record);
  const clarificationReady = decisions.clarification.status === "complete" || decisions.clarification.status === "not-needed";
  const outline = latestArtifactRecord(record, "outline");
  const outlineReview: WorkOrderOutlineReview = outline
    ? { status: outline.envelope.validationStatus === "accepted" ? "approved" : "draft", artifactId: outline.envelope.artifactId, revisionId: outline.envelope.revisionId, itemCount: Array.isArray((outline.payload as { items?: unknown }).items) ? (outline.payload as { items: unknown[] }).items.length : 0 }
    : { status: "unavailable", itemCount: 0 };
  return structuredClone({
    workOrder: record.ledger.workOrder,
    plan: record.ledger.plan,
    projection: replayAgentRunLedger(record.ledger),
    events: record.ledger.events,
    ...decisions,
    readyForConfirmation: clarificationReady && decisions.directionConfirmed && outlineReview.status === "approved",
    artifacts: (record.artifacts ?? []).map((artifact) => artifact.envelope),
    outlineReview,
    ...(record.generationJobId ? { generationJobId: record.generationJobId } : {}),
  });
}

function isPersistedWorkOrder(value: unknown, scopeHash: string): value is PersistedWorkOrder {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PersistedWorkOrder>;
  if (record.persistenceVersion !== 1 || record.scopeHash !== scopeHash || !record.ledger || !record.generationInput) return false;
  if (!hasValidPersistedDecisions(record) || !hasValidPersistedArtifacts(record)) return false;
  try {
    const projection = replayAgentRunLedger(record.ledger);
    return WORK_ORDER_ID.test(projection.workOrderId) && record.generationInput.taskId === projection.workOrderId;
  } catch {
    return false;
  }
}

export class WorkOrderManager {
  readonly #records = new Map<string, Map<string, PersistedWorkOrder>>();
  readonly #locks = new Map<string, Promise<void>>();
  readonly #now: () => Date;
  readonly #id: () => string;
  readonly #limit: number;
  #initialized = false;

  constructor(readonly options: WorkOrderManagerOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? (() => `workorder_${randomUUID().replaceAll("-", "")}`);
    this.#limit = options.maxPerScope ?? 20;
    if (!Number.isSafeInteger(this.#limit) || this.#limit < 1 || this.#limit > 100) throw new TypeError("maxPerScope must be between 1 and 100");
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    const sessionsDirectory = join(this.options.rootDirectory, "sessions");
    await mkdir(sessionsDirectory, { recursive: true });
    for (const scopeHash of await readdir(sessionsDirectory).catch(() => [])) {
      if (!SCOPE_HASH.test(scopeHash)) continue;
      const records = new Map<string, PersistedWorkOrder>();
      const directory = this.directory(scopeHash);
      for (const name of await readdir(directory).catch(() => [])) {
        if (!/^workorder_[a-z0-9]{8,59}\.json$/u.test(name)) continue;
        try {
          const record = JSON.parse(await readFile(join(directory, name), "utf8")) as unknown;
          if (!isPersistedWorkOrder(record, scopeHash) || `${record.ledger.workOrder.workOrderId}.json` !== name) continue;
          records.set(record.ledger.workOrder.workOrderId, record);
        } catch {
          // Untrusted or incomplete files never enter the in-memory projection.
        }
      }
      if (records.size > 0) this.#records.set(scopeHash, records);
    }
    this.#initialized = true;
  }

  async create(scopeHash: string, rawInput: CreateWorkOrderInput): Promise<WorkOrderWorkflow> {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    const workOrderId = this.#id();
    if (!WORK_ORDER_ID.test(workOrderId)) throw new TypeError("Injected Work Order ID is invalid");
    const contracts = createContracts(normalizedInput(rawInput), workOrderId, this.timestamp());
    const record: PersistedWorkOrder = {
      persistenceVersion: 1,
      scopeHash,
      ledger: createAgentRunLedger(contracts.workOrder, contracts.plan),
      generationInput: contracts.generationInput,
      clarification: createClarification(contracts.generationInput.brief.objective),
      directionPreviews: createDirectionPreviews(contracts.plan.designPack.id),
      selectedDirectionId: `direction_${contracts.plan.designPack.id}`,
      directionConfirmed: false,
      artifacts: [],
    };
    appendPlanningArtifacts(record, this.timestamp());
    const records = this.recordsFor(scopeHash);
    if (records.size >= this.#limit) throw new WorkOrderLimitError(this.#limit);
    if (records.has(workOrderId)) throw new Error("Work Order ID already exists");
    records.set(workOrderId, record);
    try { await this.persist(record); } catch (error) { records.delete(workOrderId); throw error; }
    return publicWorkflow(record);
  }

  get(scopeHash: string, workOrderId: string): WorkOrderWorkflow | null {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    if (!WORK_ORDER_ID.test(workOrderId)) return null;
    const record = this.#records.get(scopeHash)?.get(workOrderId);
    return record ? publicWorkflow(record) : null;
  }

  async answerClarifications(scopeHash: string, workOrderId: string, answers: Array<{ questionId: string; answer: string }>): Promise<WorkOrderWorkflow> {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    return this.withLock(`${scopeHash}:${workOrderId}`, async () => {
      const record = this.#records.get(scopeHash)?.get(workOrderId);
      if (!record) throw new WorkOrderNotFoundError();
      const state = decisionState(record);
      if (record.ledger.events.length > 0 || state.clarification.status !== "required") throw new WorkOrderDecisionConflictError("Clarification is no longer editable");
      if (!Array.isArray(answers) || answers.length !== state.clarification.questions.length) throw new TypeError("All clarification questions must be answered once");
      const byId = new Map<string, string>();
      for (const item of answers) {
        if (!item || typeof item.questionId !== "string" || typeof item.answer !== "string" || byId.has(item.questionId)) throw new TypeError("Clarification answer is invalid");
        const answer = item.answer.replace(/\s+/gu, " ").trim();
        if ([...answer].length < 2 || [...answer].length > 240) throw new TypeError("Clarification answer must contain between 2 and 240 characters");
        byId.set(item.questionId, answer);
      }
      if (state.clarification.questions.some((question) => !byId.has(question.questionId))) throw new TypeError("Clarification question ID is invalid");
      const questions = state.clarification.questions.map((question) => ({ ...question, answer: byId.get(question.questionId)! }));
      const workOrder = structuredClone(record.ledger.workOrder);
      const audience = byId.get("clarify_audience");
      const action = byId.get("clarify_action");
      if (audience) workOrder.audience.description = audience;
      if (action) workOrder.audience.decisionOrAction = action;
      const plan = structuredClone(record.ledger.plan);
      record.ledger = createAgentRunLedger(workOrder, plan);
      revisePlan(record);
      record.generationInput.brief.audience = workOrder.audience.description;
      record.generationInput.brief.decisionRequest = workOrder.audience.decisionOrAction;
      record.generationInput.deliverable.audience = workOrder.audience.description;
      record.clarification = { status: "complete", round: 1, maxQuestions: 2, questions };
      record.directionPreviews = state.directionPreviews;
      record.selectedDirectionId = state.selectedDirectionId;
      record.directionConfirmed = state.directionConfirmed;
      appendPlanningArtifacts(record, this.timestamp());
      await this.persist(record);
      return publicWorkflow(record);
    });
  }

  async selectDirection(scopeHash: string, workOrderId: string, directionId: string): Promise<WorkOrderWorkflow> {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    return this.withLock(`${scopeHash}:${workOrderId}`, async () => {
      const record = this.#records.get(scopeHash)?.get(workOrderId);
      if (!record) throw new WorkOrderNotFoundError();
      const state = decisionState(record);
      if (record.ledger.events.length > 0) throw new WorkOrderDecisionConflictError("Direction is no longer editable");
      const direction = state.directionPreviews.find((candidate) => candidate.directionId === directionId);
      if (!direction) throw new TypeError("Direction is not part of this Creation Contract");
      if (state.directionConfirmed && state.selectedDirectionId === directionId) return publicWorkflow(record);
      const workOrder = structuredClone(record.ledger.workOrder);
      workOrder.deliverable.kind = deliverableKind(direction.pack.id);
      const plan = structuredClone(record.ledger.plan);
      plan.designPack = structuredClone(direction.pack);
      record.ledger = createAgentRunLedger(workOrder, plan);
      revisePlan(record);
      record.generationInput.designPack = structuredClone(direction.pack);
      record.generationInput.deliverable.kind = workOrder.deliverable.kind === "research-keynote" ? "keynote" : workOrder.deliverable.kind;
      record.clarification = state.clarification;
      record.directionPreviews = createDirectionPreviews(direction.pack.id);
      record.selectedDirectionId = directionId;
      record.directionConfirmed = true;
      appendPlanningArtifacts(record, this.timestamp());
      await this.persist(record);
      return publicWorkflow(record);
    });
  }

  async approveOutline(scopeHash: string, workOrderId: string, expectedArtifactId: string): Promise<WorkOrderWorkflow> {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    return this.withLock(`${scopeHash}:${workOrderId}`, async () => {
      const record = this.#records.get(scopeHash)?.get(workOrderId);
      if (!record) throw new WorkOrderNotFoundError();
      if (record.ledger.events.length > 0) throw new WorkOrderDecisionConflictError("Outline is no longer editable");
      const decisions = decisionState(record);
      const clarificationReady = decisions.clarification.status === "complete" || decisions.clarification.status === "not-needed";
      if (!clarificationReady || !decisions.directionConfirmed) throw new WorkOrderDecisionConflictError("Complete clarification and confirm a direction before approving the outline");
      const outline = latestArtifactRecord(record, "outline");
      if (!outline || outline.envelope.artifactId !== expectedArtifactId) throw new WorkOrderDecisionConflictError("Outline revision changed; review the latest outline before approving");
      if (outline.envelope.validationStatus === "accepted") return publicWorkflow(record);
      appendArtifactRecord(record, {
        stageId: "stage_outline",
        artifactType: "outline",
        payload: structuredClone(outline.payload),
        validationStatus: "accepted",
        editability: { editable: true, capabilities: ["text", "order"] },
        createdAt: this.timestamp(),
      });
      await this.persist(record);
      return publicWorkflow(record);
    });
  }

  getArtifact(scopeHash: string, workOrderId: string, artifactId: string): { artifact: ArtifactEnvelope; payload: JsonValue } | null {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    if (!WORK_ORDER_ID.test(workOrderId) || !/^artifact_[a-z0-9_]{8,88}$/u.test(artifactId)) return null;
    const record = this.#records.get(scopeHash)?.get(workOrderId);
    const stored = record?.artifacts?.find((artifact) => artifact.envelope.artifactId === artifactId);
    if (!stored || stored.envelope.payloadHash !== payloadDigest(stored.payload)) return null;
    return structuredClone({ artifact: stored.envelope, payload: stored.payload });
  }

  async recordGeneratedOutput(scopeHash: string, workOrderId: string, output: AcceptedDesignDirectorOutput): Promise<void> {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    await this.withLock(`${scopeHash}:${workOrderId}`, async () => {
      const record = this.#records.get(scopeHash)?.get(workOrderId);
      if (!record) return;
      const htmlPayload = { html: output.html, manifest: structuredClone(output.manifest) } as unknown as JsonValue;
      const scenePayload = structuredClone(output.importResult.document) as unknown as JsonValue;
      const htmlExisting = latestArtifactRecord(record, "structured-html");
      if (!htmlExisting || htmlExisting.envelope.payloadHash !== payloadDigest(htmlPayload)) {
        appendArtifactRecord(record, { stageId: "stage_compose", artifactType: "structured-html", payload: htmlPayload, validationStatus: "accepted", editability: { editable: true, capabilities: ["text", "typography", "asset", "frame", "order"] }, createdAt: this.timestamp() });
      }
      const sceneExisting = latestArtifactRecord(record, "scene-ir");
      if (!sceneExisting || sceneExisting.envelope.payloadHash !== payloadDigest(scenePayload)) {
        appendArtifactRecord(record, { stageId: "stage_import", artifactType: "scene-ir", payload: scenePayload, validationStatus: "accepted", editability: { editable: true, capabilities: ["text", "typography", "asset", "frame", "order"], nativeElementRatio: 1 }, createdAt: this.timestamp() });
      }
      record.projectId = output.importResult.document.documentId;
      await this.persist(record);
    });
  }

  async recordQaArtifact(scopeHash: string, workOrderId: string, report: QaReport): Promise<void> {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    await this.withLock(`${scopeHash}:${workOrderId}`, async () => {
      const record = this.#records.get(scopeHash)?.get(workOrderId);
      if (!record) return;
      const payload = structuredClone(report) as unknown as JsonValue;
      const existing = latestArtifactRecord(record, "qa-report");
      if (!existing || existing.envelope.payloadHash !== payloadDigest(payload)) {
        appendArtifactRecord(record, { stageId: "stage_qa", artifactType: "qa-report", payload, validationStatus: report.summary.blocker === 0 && report.summary.error === 0 ? "accepted" : "rejected", editability: { editable: false, capabilities: [] }, createdAt: this.timestamp() });
        await this.persist(record);
      }
    });
  }

  async recordExportArtifact(scopeHash: string, projectId: string, payloadValue: unknown): Promise<void> {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    const record = [...(this.#records.get(scopeHash)?.values() ?? [])].find((candidate) => candidate.projectId === projectId);
    if (!record) return;
    await this.withLock(`${scopeHash}:${record.ledger.workOrder.workOrderId}`, async () => {
      const payload = structuredClone(payloadValue) as JsonValue;
      canonicalJson(payload);
      appendArtifactRecord(record, { stageId: "stage_export", artifactType: "export-report", payload, validationStatus: "accepted", editability: { editable: false, capabilities: [] }, createdAt: this.timestamp() });
      await this.persist(record);
    });
  }

  async confirm(scopeHash: string, workOrderId: string, createJob: JobCreator, readJob: JobReader): Promise<{ workflow: WorkOrderWorkflow; job: GenerationJob }> {
    this.requireInitialized();
    assertScopeHash(scopeHash);
    const key = `${scopeHash}:${workOrderId}`;
    return this.withLock(key, async () => {
      const record = this.#records.get(scopeHash)?.get(workOrderId);
      if (!record) throw new WorkOrderNotFoundError();
      if (record.generationJobId) {
        const existing = readJob(record.generationJobId);
        if (!existing) throw new Error("Work Order generation job is unavailable");
        return { workflow: publicWorkflow(record), job: existing };
      }
      if (!publicWorkflow(record).readyForConfirmation) throw new WorkOrderDecisionConflictError("Complete clarification and confirm a design direction before generation");
      if (replayAgentRunLedger(record.ledger).status === "draft") {
        record.ledger = appendAgentRunEvent(record.ledger, {
          eventId: `event_${workOrderId.slice(10)}_confirmed`, commandId: `confirm_${workOrderId}`,
          type: "plan_confirmed", occurredAt: this.timestamp(), actor: PUBLIC_ACTOR,
          inputArtifactIds: [], outputArtifactIds: [], message: "用户确认 Creation Contract 与执行计划",
        });
        await this.persist(record);
      }
      const job = await createJob(structuredClone(record.generationInput));
      record.generationJobId = job.jobId;
      await this.persist(record);
      return { workflow: publicWorkflow(record), job };
    });
  }

  async recordGenerationTransition(scopeHash: string, workOrderId: string, job: GenerationJob): Promise<void> {
    this.requireInitialized();
    const record = this.#records.get(scopeHash)?.get(workOrderId);
    if (!record) return;
    await this.withLock(`${scopeHash}:${workOrderId}`, async () => {
      if (job.status === "queued" || job.status === "cancelled") return;
      const suffix = job.jobId.slice(4);
      const at = job.updatedAt;
      const append = (event: Parameters<typeof appendAgentRunEvent>[1]) => { record.ledger = appendAgentRunEvent(record.ledger, event); };
      const artifactId = (type: ArtifactType): string => {
        const artifact = latestArtifactRecord(record, type);
        if (!artifact) throw new Error(`Generation stage is missing ${type} artifact evidence`);
        return artifact.envelope.artifactId;
      };
      const complete = (stageId: string, name: string, type: ArtifactType) => append({ eventId: `event_${suffix}_${name}`, commandId: `sync_${job.jobId}_${name}`, stageId, type: "stage_completed", occurredAt: at, actor: SYSTEM_ACTOR, inputArtifactIds: [], outputArtifactIds: [artifactId(type)] });
      const start = (stageId: string, name: string) => append({ eventId: `event_${suffix}_${name}_start`, commandId: `sync_${job.jobId}_${name}_start`, stageId, type: "stage_started", occurredAt: at, actor: SYSTEM_ACTOR, inputArtifactIds: [], outputArtifactIds: [] });
      if (job.status === "analyzing") start("stage_diagnose", "diagnosis");
      if (job.status === "generating") {
        complete("stage_diagnose", "diagnosis", "diagnosis");
        start("stage_direction", "direction");
        complete("stage_direction", "direction", "direction");
        start("stage_outline", "outline");
        complete("stage_outline", "outline", "outline");
        start("stage_compose", "compose");
      }
      if (job.status === "validating") {
        complete("stage_compose", "compose", "structured-html");
        start("stage_import", "import");
        complete("stage_import", "import", "scene-ir");
        start("stage_qa", "qa");
      }
      if (job.status === "completed") {
        complete("stage_qa", "qa", "qa-report");
        if (job.projectId) record.projectId = job.projectId;
      }
      if (job.status === "failed") {
        const projection = replayAgentRunLedger(record.ledger);
        if (projection.activeStageId) append({ eventId: `event_${suffix}_failed`, commandId: `sync_${job.jobId}_stage_failed`, stageId: projection.activeStageId, type: "stage_failed", occurredAt: at, actor: SYSTEM_ACTOR, inputArtifactIds: [], outputArtifactIds: [], diagnosticCode: "generation.failed", message: job.error?.message ?? "Generation failed" });
        append({ eventId: `event_${suffix}_plan_failed`, commandId: `sync_${job.jobId}_plan_failed`, type: "plan_failed", occurredAt: at, actor: SYSTEM_ACTOR, inputArtifactIds: [], outputArtifactIds: [], diagnosticCode: "generation.failed", message: job.error?.message ?? "Generation failed" });
      }
      await this.persist(record);
    });
  }

  async cancelForJob(scopeHash: string, jobId: string): Promise<void> {
    this.requireInitialized();
    const record = [...(this.#records.get(scopeHash)?.values() ?? [])].find((candidate) => candidate.generationJobId === jobId);
    if (!record) return;
    await this.withLock(`${scopeHash}:${record.ledger.workOrder.workOrderId}`, async () => {
      const status = replayAgentRunLedger(record.ledger).status;
      if (["confirmed", "running", "awaiting-input"].includes(status)) {
        record.ledger = appendAgentRunEvent(record.ledger, {
          eventId: `event_${jobId.slice(4)}_cancelled`, commandId: `cancel_${jobId}`, type: "plan_cancelled",
          occurredAt: this.timestamp(), actor: PUBLIC_ACTOR, inputArtifactIds: [], outputArtifactIds: [], message: "用户取消生成任务",
        });
        await this.persist(record);
      }
    });
  }

  private requireInitialized(): void {
    if (!this.#initialized) throw new Error("WorkOrderManager.initialize() must be awaited first");
  }

  private timestamp(): string { return this.#now().toISOString(); }

  private directory(scopeHash: string): string {
    assertScopeHash(scopeHash);
    return join(this.options.rootDirectory, "sessions", scopeHash, "work-orders");
  }

  private recordsFor(scopeHash: string): Map<string, PersistedWorkOrder> {
    let records = this.#records.get(scopeHash);
    if (!records) { records = new Map(); this.#records.set(scopeHash, records); }
    return records;
  }

  private async persist(record: PersistedWorkOrder): Promise<void> {
    const directory = this.directory(record.scopeHash);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, `${record.ledger.workOrder.workOrderId}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.#locks.set(key, queued);
    await previous;
    try { return await operation(); } finally {
      release();
      if (this.#locks.get(key) === queued) this.#locks.delete(key);
    }
  }
}

export class WorkOrderNotFoundError extends Error {
  constructor() { super("Work Order not found"); this.name = "WorkOrderNotFoundError"; }
}

export class WorkOrderLimitError extends Error {
  readonly code = "work_order_limit";
  readonly retryable = false;
  constructor(readonly limit: number) { super(`This anonymous space can keep at most ${limit} Work Orders`); this.name = "WorkOrderLimitError"; }
}

export class WorkOrderDecisionConflictError extends Error {
  readonly code = "creation_contract_incomplete";
  readonly retryable = false;
  constructor(message: string) { super(message); this.name = "WorkOrderDecisionConflictError"; }
}
