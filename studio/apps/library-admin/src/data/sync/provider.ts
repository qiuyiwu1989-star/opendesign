import type { SnapshotDiagnostic, SyncLocation } from "../../domain";
import { parseSyncApiResponse } from "./parser";
import {
  SYNC_API_PATH,
  type LoadSyncEvidenceOptions,
  type ReadOnlySyncNode,
  type SyncApiResponse,
} from "./types";

const LOCATIONS: ReadonlyArray<[SyncLocation, string]> = [
  ["database", "Database"],
  ["local", "Local"],
  ["git", "Git"],
  ["github", "GitHub"],
  ["public", "Public"],
];

function safeNow(value?: string): string {
  return value && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString();
}

export function unavailableSyncResponse(
  detail = "Read-only sync evidence is unavailable",
  observedAt?: string,
): SyncApiResponse {
  const now = safeNow(observedAt);
  const nodes: ReadOnlySyncNode[] = LOCATIONS.map(([location, label]) => ({
    location,
    label,
    state: "unknown",
    drift: "unknown",
    observedAt: now,
    detail,
    readOnly: true,
  }));
  const diagnostics: SnapshotDiagnostic[] = [{
    code: "sync-provider-unavailable",
    level: "warning",
    message: detail,
  }];
  return {
    source: {
      kind: "unavailable",
      label: "read-only sync evidence",
      generatedAt: now,
      detail,
    },
    observedAt: now,
    diagnostics,
    sync: {
      state: "unknown",
      summary: "只读同步证据不可用，所有位置均标记为未知。",
      nodes,
      readOnly: true,
    },
  };
}

export async function loadSyncEvidence(
  options: LoadSyncEvidenceOptions = {},
): Promise<SyncApiResponse> {
  const fetcher = options.fetcher ?? globalThis.fetch;
  if (!fetcher) return unavailableSyncResponse("fetch is unavailable", options.now);
  try {
    const response = await fetcher(options.url ?? SYNC_API_PATH, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      return unavailableSyncResponse(`Sync endpoint returned HTTP ${response.status}`, options.now);
    }
    return parseSyncApiResponse(await response.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown provider error";
    return unavailableSyncResponse(`Sync endpoint unavailable: ${message}`, options.now);
  }
}
