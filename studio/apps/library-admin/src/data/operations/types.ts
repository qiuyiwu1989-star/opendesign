import type {
  DataSourceDescriptor,
  CurationDecision,
  PipelineRun,
  QualityAxes,
  ReviewCase,
  SnapshotDiagnostic,
} from "../../domain";

/** Read-only provenance emitted by the same-origin Admin API. */
export interface OperationsSource {
  kind: DataSourceDescriptor["kind"];
  label: string;
  observedAt?: string;
  detail?: string;
}

export interface OperationsSection<T> {
  source: OperationsSource;
  items: T[];
}

export interface RawSubmission {
  id: string;
  url?: string;
  host?: string;
  note?: string;
  status?: string;
  kind?: string;
  slug?: string;
  createdAt?: string;
  hostVoters?: number;
  hostTotal?: number;
}

export interface RawDiscovery {
  id: string;
  url?: string;
  host?: string;
  slug?: string;
  title?: string;
  source?: string;
  score?: number;
  status?: string;
  createdAt?: string;
}

export interface RawCurationDecision {
  id: string;
  discoveryId: string;
  candidateTitle: string;
  candidateUrl?: string;
  recommendation: "approve" | "review" | "reject";
  confidence: number;
  reason: string;
  policyVersion: string;
  model: string;
  decidedAt: string;
  reviewStatus: "pending" | "confirmed" | "overridden";
  finalRecommendation?: "approve" | "review" | "reject";
  reviewedBy?: string;
  reviewedAt?: string;
  signals: CurationDecision["signals"];
}

export interface RawQualityIssue {
  id: string;
  assetId?: string;
  title?: string;
  summary?: string;
  severity?: string;
  status?: string;
  url?: string;
  createdAt?: string;
  evidence: string[];
  quality?: QualityAxes;
}

export interface RawOriginIssue {
  id: string;
  assetId?: string;
  title?: string;
  summary?: string;
  status?: string;
  url?: string;
  createdAt?: string;
  evidence: string[];
  quality?: QualityAxes;
}

export interface RawJob {
  id: string;
  kind?: string;
  slug?: string;
  url?: string;
  status?: string;
  result?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RawRunLog {
  id: string;
  kind?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  details?: string;
}

export interface OperationsEnvelope {
  source: OperationsSource;
  observedAt: string;
  diagnostics: SnapshotDiagnostic[];
  submissions: OperationsSection<RawSubmission>;
  discoveries: OperationsSection<RawDiscovery>;
  decisions: OperationsSection<RawCurationDecision>;
  quality: OperationsSection<RawQualityIssue>;
  origins: OperationsSection<RawOriginIssue>;
  jobs: OperationsSection<RawJob>;
  logs: OperationsSection<RawRunLog>;
}

export interface OperationsSnapshot {
  reviews: ReviewCase[];
  pipelines: PipelineRun[];
  decisions: CurationDecision[];
  reviewSource: DataSourceDescriptor;
  pipelineSource: DataSourceDescriptor;
  diagnostics: SnapshotDiagnostic[];
  observedAt?: string;
}
