import type { AdminSnapshot } from "../domain";
import { createSnapshotAdapter } from "./snapshot";
import type { LoadAdminSnapshotInput, SnapshotAdapterInput } from "./types";

export * from "./aggregate";
export * from "./fixtures";
export * from "./snapshot";
export * from "./types";

const DEFAULT_SITE_INDEX_URL = "/sites-index.json";
const DEFAULT_PACK_INDEX_URL = "/packs-index.json";

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
    packIndex = await fetchSiteIndex(input.packIndexUrl ?? DEFAULT_PACK_INDEX_URL, fetcher);
  } catch {
    packIndex = input.fallback?.packIndex;
    packIndexUnavailable = !packIndex;
  }

  const fallback = input.fallback;
  const adapterInput: SnapshotAdapterInput = {
    siteIndex,
    ...(packIndex ? { packIndex } : {}),
    ...(packIndexUnavailable ? { packIndexUnavailable: true } : {}),
  };
  const reviews = input.reviews ?? fallback?.reviews;
  const reviewSource = input.reviewSource ?? fallback?.reviewSource;
  const pipelines = input.pipelines ?? fallback?.pipelines;
  const pipelineSource = input.pipelineSource ?? fallback?.pipelineSource;
  const sync = input.sync ?? fallback?.sync;
  const syncSource = input.syncSource ?? fallback?.syncSource;
  const git = input.git ?? fallback?.git;
  const now = input.now ?? fallback?.now;
  if (reviews) adapterInput.reviews = reviews;
  if (reviewSource) adapterInput.reviewSource = reviewSource;
  if (pipelines) adapterInput.pipelines = pipelines;
  if (pipelineSource) adapterInput.pipelineSource = pipelineSource;
  if (sync) adapterInput.sync = sync;
  if (syncSource) adapterInput.syncSource = syncSource;
  if (git) adapterInput.git = git;
  if (now) adapterInput.now = now;
  return createSnapshotAdapter(adapterInput).load();
}
