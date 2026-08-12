/** Database boundary kept independent from a concrete PostgreSQL driver. */
export type QueryValue = string | number | boolean | Date | null;

export interface DatabaseQuery<T> {
  readonly text: string;
  readonly values: readonly QueryValue[];
  readonly timeoutMs: number;
  readonly maxRows: number;
  readonly signal?: AbortSignal;
}

export interface DatabaseQueryResult<T> {
  readonly rows: readonly T[];
  readonly rowCount: number;
}

export interface DatabaseClient {
  query<T>(query: DatabaseQuery<T>): Promise<DatabaseQueryResult<T>>;
}

export type SourceKind = "live" | "snapshot" | "unavailable";

export interface OperationsSource {
  kind: SourceKind;
  label: string;
  observedAt?: string;
  detail?: string;
}

export interface OperationsSection<T> {
  source: OperationsSource;
  items: T[];
}

export interface OperationsDiagnostic {
  code: string;
  level: "info" | "warning" | "error";
  message: string;
}

export interface SubmissionRow {
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

export interface DiscoveryRow {
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

export interface QualityRow {
  id: string;
  assetId?: string;
  title?: string;
  summary?: string;
  severity?: string;
  status?: string;
  url?: string;
  createdAt?: string;
  evidence: string[];
  quality?: {
    evidence: "E0" | "E1" | "E2" | "E3";
    curation: "unreviewed" | "accepted" | "recommended";
    origin: "alive" | "changed" | "degraded" | "unavailable";
  };
}

export type OriginRow = Omit<QualityRow, "severity">;

export interface JobRow {
  id: string;
  kind?: string;
  slug?: string;
  url?: string;
  status?: string;
  result?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RunLogRow {
  id: string;
  kind?: string;
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  details?: string;
}

/** Wire-compatible with the Phase 2 operations parser. */
export interface OperationsEnvelope {
  source: OperationsSource;
  observedAt: string;
  diagnostics: OperationsDiagnostic[];
  submissions: OperationsSection<SubmissionRow>;
  discoveries: OperationsSection<DiscoveryRow>;
  quality: OperationsSection<QualityRow>;
  origins: OperationsSection<OriginRow>;
  jobs: OperationsSection<JobRow>;
  logs: OperationsSection<RunLogRow>;
}

export interface DatabaseSyncEvidence {
  location: "database";
  label: "Database";
  state: "healthy" | "unknown";
  drift: "unknown";
  revision?: string;
  observedAt: string;
  detail: string;
  readOnly: true;
}
