import { adaptOperationsEnvelope } from "../operations/adapter";
import { parseOperationsEnvelope } from "../operations/parser";
import type { OperationsSnapshot } from "../operations/types";

export const OPERATIONS_ENDPOINT = "/admin-api/v1/operations";

export type OperationsFetcher = (input: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

export interface OperationsProviderOptions {
  endpoint?: string;
  fetcher?: OperationsFetcher;
}

export type OperationsProviderResult = OperationsSnapshot;

function unavailable(error: unknown): OperationsProviderResult {
  const message = error instanceof Error ? error.message : "Unknown operations provider failure";
  return {
    reviews: [],
    pipelines: [],
    reviewSource: { kind: "unavailable", label: "Operations reviews", detail: message },
    pipelineSource: { kind: "unavailable", label: "Operations pipelines", detail: message },
    diagnostics: [{ code: "operations-provider-unavailable", level: "warning", message }],
  };
}

function assertSameOriginPath(endpoint: string): void {
  if (!endpoint.startsWith("/") || endpoint.startsWith("//") || endpoint.includes("://")) {
    throw new Error("Operations endpoint must be a same-origin absolute path");
  }
}

/**
 * Loads operational evidence through a credential-free, same-origin GET.
 * Network and validation failures become explicit unavailable state.
 */
export async function loadOperations(options: OperationsProviderOptions = {}): Promise<OperationsProviderResult> {
  try {
    const endpoint = options.endpoint ?? OPERATIONS_ENDPOINT;
    assertSameOriginPath(endpoint);
    const fetcher = options.fetcher ?? globalThis.fetch;
    if (!fetcher) throw new Error("fetch is unavailable");
    const response = await fetcher(endpoint, { method: "GET", headers: { accept: "application/json" }, cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`Unable to load ${endpoint}: HTTP ${response.status}`);
    return adaptOperationsEnvelope(parseOperationsEnvelope(await response.json()));
  } catch (error) {
    return unavailable(error);
  }
}
