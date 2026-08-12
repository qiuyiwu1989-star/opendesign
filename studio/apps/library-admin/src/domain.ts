/**
 * Stable, UI-facing domain contract for OpenDesign Control Room.
 *
 * Every collection carries provenance at the AdminSnapshot boundary.  A value
 * labelled `snapshot` is checked-in or build-time data; it is never evidence
 * of current production state.
 */
export type DataSourceState = "live" | "snapshot" | "unavailable";

export type EvidenceTier = "E0" | "E1" | "E2" | "E3";
export type CurationStatus = "unreviewed" | "accepted" | "recommended";
export type OriginStatus = "alive" | "changed" | "degraded" | "unavailable";
export type ReviewSource = "discovery" | "submission" | "quality" | "origin";
export type SignalState = "healthy" | "attention" | "blocked" | "unknown";

export interface DataSourceDescriptor {
  kind: DataSourceState;
  label: string;
  generatedAt?: string;
  detail?: string;
}

export interface QualityAxes {
  evidence: EvidenceTier;
  curation: CurationStatus;
  origin: OriginStatus;
}

export interface LibraryAsset {
  id: string;
  title: string;
  url: string;
  imageUrl?: string;
  tags: string[];
  status: string;
  quality: QualityAxes;
  hasSpec: boolean;
  hasPack: boolean;
  publicPath: string;
  packPath?: string;
  updatedAt?: string;
}

export type ReviewStatus = "pending" | "resolved" | "dismissed";
export type ReviewPriority = "critical" | "high" | "medium" | "low";

export interface ReviewCase {
  id: string;
  source: ReviewSource;
  status: ReviewStatus;
  priority: ReviewPriority;
  title: string;
  summary: string;
  assetId?: string;
  url?: string;
  createdAt?: string;
  quality?: QualityAxes;
  evidence: string[];
  previewOnly: true;
}

export type PipelineRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export type PipelineCheckpointStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "unknown";

export interface PipelineCheckpoint {
  id: string;
  label: string;
  status: PipelineCheckpointStatus;
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
}

export interface PipelineRun {
  id: string;
  kind: string;
  label: string;
  status: PipelineRunStatus;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  checkpoints: PipelineCheckpoint[];
  retryFromCheckpointId?: string;
  previewOnly: true;
}

export type SyncLocation = "database" | "local" | "git" | "github" | "public";
export type SyncDrift = "in-sync" | "ahead" | "behind" | "diverged" | "unknown";

export interface SyncNode {
  location: SyncLocation;
  label: string;
  state: SignalState;
  drift: SyncDrift;
  revision?: string;
  observedAt?: string;
  detail?: string;
}

export interface SyncSnapshot {
  state: SignalState;
  summary: string;
  branch?: string;
  localRevision?: string;
  nodes: SyncNode[];
  readOnly: true;
}

export type TodayActionKind = "review" | "quality" | "pipeline" | "sync";

export interface TodayAction {
  id: string;
  kind: TodayActionKind;
  priority: ReviewPriority;
  title: string;
  summary: string;
  target: "review" | "assets" | "pipelines" | "sync";
  targetId?: string;
  count?: number;
  previewOnly: true;
}

export interface ContentFunnel {
  totalAssets: number;
  withSpec: number;
  withPack: number;
  accepted: number;
  recommended: number;
  pendingReviews: number;
}

export interface TodaySnapshot {
  state: SignalState;
  topActions: TodayAction[];
  funnel: ContentFunnel;
  pipelineSignal: SignalState;
  syncSignal: SignalState;
}

export interface SnapshotDiagnostic {
  code: string;
  level: "info" | "warning" | "error";
  message: string;
}

export interface AdminSnapshotSources {
  library: DataSourceDescriptor;
  reviews: DataSourceDescriptor;
  pipelines: DataSourceDescriptor;
  sync: DataSourceDescriptor;
}

export interface AdminSnapshot {
  source: DataSourceDescriptor;
  sources: AdminSnapshotSources;
  generatedAt: string;
  assets: LibraryAsset[];
  reviews: ReviewCase[];
  pipelines: PipelineRun[];
  sync: SyncSnapshot;
  today: TodaySnapshot;
  diagnostics: SnapshotDiagnostic[];
}

export interface AdminDataAdapter {
  readonly id: string;
  load(): Promise<AdminSnapshot>;
}
