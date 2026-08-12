import type {
  DataSourceDescriptor,
  PipelineRun,
  ReviewCase,
  SyncSnapshot,
} from "../domain";

export interface StaticSiteIndexEntry {
  id: string;
  title: string;
  url: string;
  image?: string;
  tags?: string[];
  status?: string;
  has_spec?: boolean;
  has_pack?: boolean;
}

export interface StaticSiteIndex {
  _meta?: {
    version?: string;
    built_at?: string;
    count?: number;
  };
  sites: StaticSiteIndexEntry[];
}

export interface GitReadOnlySnapshot {
  branch?: string;
  localRevision?: string;
  localObservedAt?: string;
  gitRevision?: string;
  gitObservedAt?: string;
  githubRevision?: string;
  githubObservedAt?: string;
  publicRevision?: string;
  publicObservedAt?: string;
  dirty?: boolean;
}

export interface SnapshotAdapterInput {
  siteIndex: unknown;
  packIndex?: unknown;
  packIndexUnavailable?: boolean;
  reviews?: readonly ReviewCase[];
  reviewSource?: DataSourceDescriptor;
  pipelines?: readonly PipelineRun[];
  pipelineSource?: DataSourceDescriptor;
  sync?: SyncSnapshot;
  syncSource?: DataSourceDescriptor;
  git?: GitReadOnlySnapshot;
  now?: string;
}

export interface LoadAdminSnapshotInput {
  siteIndexUrl?: string;
  packIndexUrl?: string;
  fetcher?: typeof fetch;
  fallback?: SnapshotAdapterInput;
  reviews?: readonly ReviewCase[];
  reviewSource?: DataSourceDescriptor;
  pipelines?: readonly PipelineRun[];
  pipelineSource?: DataSourceDescriptor;
  sync?: SyncSnapshot;
  syncSource?: DataSourceDescriptor;
  git?: GitReadOnlySnapshot;
  now?: string;
  operationsUrl?: string;
  syncUrl?: string;
  loadOperationalEvidence?: boolean;
}

export class SnapshotValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid library snapshot: ${issues.join("; ")}`);
    this.name = "SnapshotValidationError";
    this.issues = issues;
  }
}
