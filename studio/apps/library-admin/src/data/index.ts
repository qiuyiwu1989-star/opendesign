import type { AdminSnapshot } from "../domain";
import { createSnapshotAdapter } from "./snapshot";
import { loadOperations } from "./providers/operations";
import { loadSyncEvidence } from "./sync";
import { loadCompactPackManifest } from "./pack";
import type { LoadAdminSnapshotInput, SnapshotAdapterInput } from "./types";

export * from "./aggregate";
export * from "./fixtures";
export * from "./quality";
export * from "./snapshot";
export * from "./session";
export * from "./types";

const DEFAULT_SITE_INDEX_URL = "/sites-index.json";
const DEFAULT_PACK_INDEX_URL = "/pack-manifest.json";

async function fetchSiteIndex(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Unable to load ${url}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Loads the checked-in static library snapshot.  Production queues and sync
 * signals remain unavailable unless explicit, read-only snapshots are injected.
 */
export async function loadAdminSnapshot(
  input: LoadAdminSnapshotInput = {},
): Promise<AdminSnapshot> {
  let siteIndex: unknown;
  try {
    const fetcher = input.fetcher ?? globalThis.fetch;
    if (!fetcher) throw new Error("fetch is unavailable");
    siteIndex = await fetchSiteIndex(input.siteIndexUrl ?? DEFAULT_SITE_INDEX_URL, fetcher);
  } catch (error) {
    if (!input.fallback) throw error;
    siteIndex = input.fallback.siteIndex;
  }

  let packIndex: unknown;
  let packIndexUnavailable = false;
  try {
    const fetcher = input.fetcher ?? globalThis.fetch;
    if (!fetcher) throw new Error("fetch is unavailable");
    const manifest = await loadCompactPackManifest({
      fetcher,
      url: input.packIndexUrl ?? DEFAULT_PACK_INDEX_URL,
    });
    if (!manifest.ids) throw new Error("compact pack manifest unavailable");
    packIndex = Object.fromEntries([...manifest.ids].map((id) => [id, true]));
  } catch {
    packIndex = input.fallback?.packIndex;
    packIndexUnavailable = !packIndex;
  }

  const fallback = input.fallback;
  const shouldLoadOperationalEvidence = input.loadOperationalEvidence !== false;
  const [operationsEvidence, syncEvidence] = shouldLoadOperationalEvidence
    ? await Promise.all([
        loadOperations({
          ...(input.fetcher ? { fetcher: input.fetcher } : {}),
          ...(input.operationsUrl ? { endpoint: input.operationsUrl } : {}),
        }),
        loadSyncEvidence({
          ...(input.fetcher ? { fetcher: input.fetcher } : {}),
          ...(input.syncUrl ? { url: input.syncUrl } : {}),
          ...(input.now ? { now: input.now } : {}),
        }),
      ])
    : [undefined, undefined];
  const adapterInput: SnapshotAdapterInput = {
    siteIndex,
    ...(packIndex ? { packIndex } : {}),
    ...(packIndexUnavailable ? { packIndexUnavailable: true } : {}),
  };
  const operationsReviewsAvailable = operationsEvidence?.reviewSource.kind !== "unavailable";
  const operationsPipelinesAvailable = operationsEvidence?.pipelineSource.kind !== "unavailable";
  const syncAvailable = syncEvidence?.source.kind !== "unavailable";
  const reviews = input.reviews
    ?? (operationsReviewsAvailable ? operationsEvidence?.reviews : undefined)
    ?? fallback?.reviews;
  const decisions = input.decisions
    ?? (operationsReviewsAvailable ? operationsEvidence?.decisions : undefined)
    ?? fallback?.decisions;
  const reviewSource = input.reviewSource
    ?? (operationsReviewsAvailable ? operationsEvidence?.reviewSource : undefined)
    ?? fallback?.reviewSource
    ?? operationsEvidence?.reviewSource;
  const pipelines = input.pipelines
    ?? (operationsPipelinesAvailable ? operationsEvidence?.pipelines : undefined)
    ?? fallback?.pipelines;
  const pipelineSource = input.pipelineSource
    ?? (operationsPipelinesAvailable ? operationsEvidence?.pipelineSource : undefined)
    ?? fallback?.pipelineSource
    ?? operationsEvidence?.pipelineSource;
  const sync = input.sync
    ?? (syncAvailable ? syncEvidence?.sync : undefined)
    ?? fallback?.sync
    ?? syncEvidence?.sync;
  const syncSource = input.syncSource
    ?? (syncAvailable ? syncEvidence?.source : undefined)
    ?? fallback?.syncSource
    ?? syncEvidence?.source;
  const git = input.git ?? fallback?.git;
  const now = input.now ?? fallback?.now;
  if (reviews) adapterInput.reviews = reviews;
  if (decisions) adapterInput.decisions = decisions;
  if (reviewSource) adapterInput.reviewSource = reviewSource;
  if (pipelines) adapterInput.pipelines = pipelines;
  if (pipelineSource) adapterInput.pipelineSource = pipelineSource;
  if (sync) adapterInput.sync = sync;
  if (syncSource) adapterInput.syncSource = syncSource;
  if (git) adapterInput.git = git;
  if (now) adapterInput.now = now;
  return createSnapshotAdapter(adapterInput).load();
}
