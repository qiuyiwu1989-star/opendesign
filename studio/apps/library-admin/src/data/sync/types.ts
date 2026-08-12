import type {
  DataSourceDescriptor,
  SignalState,
  SnapshotDiagnostic,
  SyncDrift,
  SyncLocation,
  SyncSnapshot,
} from "../../domain";

export const SYNC_API_PATH = "/admin-api/v1/sync";

export interface ReadOnlySyncNode {
  location: SyncLocation;
  label: string;
  state: SignalState;
  drift: SyncDrift;
  revision?: string;
  observedAt: string;
  detail?: string;
  readOnly: true;
}

export interface ReadOnlySyncSnapshot extends Omit<SyncSnapshot, "nodes"> {
  nodes: ReadOnlySyncNode[];
}

export interface SyncApiResponse {
  source: DataSourceDescriptor;
  observedAt: string;
  diagnostics: SnapshotDiagnostic[];
  sync: ReadOnlySyncSnapshot;
}

export interface LoadSyncEvidenceOptions {
  url?: string;
  fetcher?: typeof fetch;
  now?: string;
}

export class SyncResponseValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid sync response: ${issues.join("; ")}`);
    this.name = "SyncResponseValidationError";
    this.issues = issues;
  }
}
