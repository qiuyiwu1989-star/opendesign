import type { OperationsDiagnostic } from "./types.js";
import type { OperationsRepository } from "./repository.js";

interface SyncNode {
  location: "database" | "local" | "git" | "github" | "public";
  label: string;
  state: "healthy" | "attention" | "blocked" | "unknown";
  drift: "in-sync" | "ahead" | "behind" | "diverged" | "unknown";
  revision?: string;
  observedAt: string;
  detail: string;
  readOnly: true;
}

export interface SyncEvidenceEnvelope {
  source: { kind: "live" | "unavailable"; label: string; generatedAt: string; detail: string };
  observedAt: string;
  diagnostics: OperationsDiagnostic[];
  sync: {
    state: "attention" | "unknown";
    summary: string;
    nodes: SyncNode[];
    readOnly: true;
  };
}

const UNKNOWN_NODES = [
  ["local", "Local"],
  ["git", "Git"],
  ["github", "GitHub"],
  ["public", "Public"],
] as const;

/** Builds the five-node Phase 2 wire contract without inventing missing evidence. */
export async function readSyncEvidence(
  repository: OperationsRepository,
  signal?: AbortSignal,
  now: () => Date = () => new Date(),
): Promise<SyncEvidenceEnvelope> {
  const observedAt = now().toISOString();
  const database = await repository.readDatabaseSyncEvidence(signal);
  const unknownNodes: SyncNode[] = UNKNOWN_NODES.map(([location, label]) => ({
    location,
    label,
    state: "unknown",
    drift: "unknown",
    observedAt,
    detail: `${label} evidence provider is not configured on the production API.`,
    readOnly: true,
  }));
  const databaseAvailable = database.state === "healthy";
  return {
    source: {
      kind: databaseAvailable ? "live" : "unavailable",
      label: "production sync evidence",
      generatedAt: observedAt,
      detail: "Database evidence is read live; unconfigured locations remain explicitly unknown.",
    },
    observedAt,
    diagnostics: [{
      code: "sync-providers-partial",
      level: "warning",
      message: "Local, Git, GitHub and Public evidence providers are not configured.",
    }],
    sync: {
      state: databaseAvailable ? "attention" : "unknown",
      summary: databaseAvailable
        ? "Database is observable; four sync locations still require evidence providers."
        : "Sync evidence is currently unavailable.",
      nodes: [database, ...unknownNodes],
      readOnly: true,
    },
  };
}
