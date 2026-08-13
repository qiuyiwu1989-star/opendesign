import type { DesignPackPin, EditableCapability } from "@opendesign/studio-contracts";

export const AGENT_OS_CONTRACT_VERSION = "0.1.0" as const;
export const CAPABILITY_MANIFEST_VERSION = "0.1.0" as const;
export const AGENT_RUN_LEDGER_VERSION = "0.1.0" as const;

export type ContractVersion = typeof AGENT_OS_CONTRACT_VERSION;
export type IsoTimestamp = string;
export type Sha256Digest = `sha256:${string}`;
export type CapabilityPin = { id: string; version: string };

export type WorkOrderSource = {
  sourceId: string;
  type: "brief" | "article" | "document" | "url" | "manual";
  title: string;
  sourceRef?: string;
  contentHash?: Sha256Digest;
};

export type DesignWorkOrder = {
  contractVersion: ContractVersion;
  workOrderId: string;
  createdAt: IsoTimestamp;
  title: string;
  objective: string;
  audience: { description: string; decisionOrAction: string };
  deliverable: {
    kind: "proposal" | "research-keynote" | "article-graphics";
    formats: Array<"html" | "pptx" | "pdf" | "png">;
    language: "zh-CN" | "en";
    pageCount?: { min: number; max: number };
  };
  sources: WorkOrderSource[];
  brand: { name: string; assetIds: string[]; guidance: string[] };
  constraints: string[];
  successCriteria: string[];
  confidentiality: "public" | "private";
};

export type PlanStageKind =
  | "diagnose"
  | "research"
  | "outline"
  | "direction"
  | "compose"
  | "import"
  | "qa"
  | "edit"
  | "review"
  | "export";

export type ExecutionStage = {
  stageId: string;
  order: number;
  kind: PlanStageKind;
  objective: string;
  skillPins: CapabilityPin[];
  toolIds: string[];
  requiredArtifactTypes: ArtifactType[];
  expectedArtifactTypes: ArtifactType[];
  approval: "none" | "human-before" | "human-after";
  maxAttempts: number;
};

export type ExecutionPlan = {
  contractVersion: ContractVersion;
  planId: string;
  workOrderId: string;
  revision: number;
  createdAt: IsoTimestamp;
  status: "draft";
  designPack: DesignPackPin;
  industryKit?: CapabilityPin;
  capabilityPins: CapabilityPin[];
  stages: ExecutionStage[];
  budget: { maxDurationSeconds: number; maxModelCalls: number; maxImageCalls: number };
};

export type EvidenceLicense = "unknown" | "reference-only" | "permissive" | "owned" | "generated" | "restricted";
export type EvidenceTrust = "user-provided" | "library-verified" | "external-unverified" | "generated";

export type EvidenceSource = {
  sourceId: string;
  title: string;
  contentHash: Sha256Digest;
  trust: EvidenceTrust;
  license: EvidenceLicense;
  capturedAt: IsoTimestamp;
  sourceRef?: string;
};

export type EvidenceClaim = {
  claimId: string;
  statement: string;
  sourceIds: string[];
  kind: "fact" | "inference" | "recommendation" | "gap";
};

export type EvidenceBundle = {
  contractVersion: ContractVersion;
  evidenceBundleId: string;
  workOrderId: string;
  createdAt: IsoTimestamp;
  sources: EvidenceSource[];
  claims: EvidenceClaim[];
};

export type ArtifactType =
  | "diagnosis"
  | "outline"
  | "direction"
  | "structured-html"
  | "scene-ir"
  | "qa-report"
  | "export-report";

export type ArtifactEnvelope = {
  contractVersion: ContractVersion;
  artifactId: string;
  workOrderId: string;
  planId: string;
  stageId: string;
  artifactType: ArtifactType;
  revisionId: string;
  createdAt: IsoTimestamp;
  payloadHash: Sha256Digest;
  payloadRef: string;
  designPack: DesignPackPin;
  skillPins: CapabilityPin[];
  sourceCoverage: {
    declaredSourceIds: string[];
    usedSourceIds: string[];
    unresolvedSourceIds: string[];
  };
  editability: {
    editable: boolean;
    capabilities: EditableCapability[];
    nativeElementRatio?: number;
  };
  validationStatus: "draft" | "accepted" | "rejected";
};

export type RunActor = { actorId: string; kind: "human" | "agent" | "system" };
export type AgentRunEventType =
  | "plan_confirmed"
  | "stage_started"
  | "stage_awaiting_input"
  | "stage_resumed"
  | "stage_completed"
  | "stage_failed"
  | "plan_completed"
  | "plan_failed"
  | "plan_cancelled";

export type AgentRunEvent = {
  contractVersion: ContractVersion;
  eventId: string;
  commandId: string;
  sequence: number;
  workOrderId: string;
  planId: string;
  stageId?: string;
  type: AgentRunEventType;
  occurredAt: IsoTimestamp;
  actor: RunActor;
  inputArtifactIds: string[];
  outputArtifactIds: string[];
  diagnosticCode?: string;
  message?: string;
};

export type ReviewCandidate = {
  contractVersion: ContractVersion;
  candidateId: string;
  workOrderId: string;
  planId: string;
  artifactId: string;
  revisionId: string;
  createdAt: IsoTimestamp;
  createdBy: RunActor;
  status: "awaiting-human" | "approved" | "changes-requested" | "rejected";
  diff: { baseRevisionId: string; currentRevisionId: string; changedElementIds: string[] };
  qa: { reportArtifactId: string; blocker: number; error: number; warning: number };
  export: { reportArtifactId: string; succeeded: boolean; artifactIds: string[] };
  sourceCoverage: ArtifactEnvelope["sourceCoverage"];
  decidedBy?: RunActor;
  decisionReason?: string;
  notPublished: true;
};

export type FeedbackEvent = {
  contractVersion: ContractVersion;
  feedbackId: string;
  workOrderId: string;
  occurredAt: IsoTimestamp;
  actor: RunActor;
  target: { kind: "artifact" | "skill" | "design-pack" | "stage"; id: string; version?: string };
  signal: "accepted" | "rejected" | "modified";
  reason?: string;
  measurement?: { operationCount: number; durationSeconds: number };
  visibility: "private" | "aggregate-only";
  changesHistoricalJudgment: false;
};

export type CapabilityKind = "skill" | "design-pack" | "industry-kit" | "tool-adapter" | "eval-suite";

export type CapabilityManifest = {
  manifestVersion: typeof CAPABILITY_MANIFEST_VERSION;
  id: string;
  version: string;
  kind: CapabilityKind;
  name: string;
  summary: string;
  lifecycle: "draft" | "evaluated" | "approved" | "deprecated";
  compatibility: { workOrderContract: ContractVersion; artifactContract: ContractVersion };
  permissions: {
    network: "none" | "allowlisted";
    fileRead: boolean;
    fileWrite: boolean;
    model: boolean;
    publish: false;
  };
  provenance: { sourceRef: string; license: string; reviewedAt?: IsoTimestamp };
  taskKinds: DesignWorkOrder["deliverable"]["kind"][];
  inputs: string[];
  outputs: string[];
  stages: PlanStageKind[];
  stoppingConditions: string[];
  evalSuiteIds: string[];
};

export type AgentRunLedger = {
  ledgerVersion: typeof AGENT_RUN_LEDGER_VERSION;
  workOrder: DesignWorkOrder;
  plan: ExecutionPlan;
  events: readonly AgentRunEvent[];
};

export type ExecutionStageStatus = "queued" | "running" | "awaiting-input" | "completed" | "failed" | "cancelled";
export type AgentRunProjection = {
  workOrderId: string;
  planId: string;
  status: "draft" | "confirmed" | "running" | "awaiting-input" | "completed" | "failed" | "cancelled";
  stageStatuses: Readonly<Record<string, ExecutionStageStatus>>;
  activeStageId?: string;
  lastSequence: number;
};

export type ExecutionBundle = {
  workOrder: DesignWorkOrder;
  plan: ExecutionPlan;
  evidence: EvidenceBundle;
  artifacts: ArtifactEnvelope[];
  candidate?: ReviewCandidate;
};
