import { describe, expect, it, vi } from "vitest";
import { loadSyncEvidence, parseSyncApiResponse } from ".";

const observedAt = "2026-08-12T04:00:00.000Z";

function validResponse() {
  return {
    source: { kind: "snapshot", label: "test", generatedAt: observedAt },
    observedAt,
    diagnostics: [],
    sync: {
      state: "healthy",
      summary: "in sync",
      branch: "feature/test",
      localRevision: "abc123",
      readOnly: true,
      nodes: ["database", "local", "git", "github", "public"].map((location) => ({
        location,
        label: location,
        state: "healthy",
        drift: "in-sync",
        revision: "abc123",
        observedAt,
        readOnly: true,
      })),
    },
  };
}

describe("parseSyncApiResponse", () => {
  it("accepts a complete read-only five-node response", () => {
    const parsed = parseSyncApiResponse(validResponse());
    expect(parsed.sync.nodes).toHaveLength(5);
    expect(parsed.sync.nodes.every((node) => node.readOnly)).toBe(true);
  });

  it("rejects missing timestamps and writable nodes", () => {
    const invalid = validResponse();
    delete (invalid.sync.nodes[0] as { observedAt?: string }).observedAt;
    (invalid.sync.nodes[1] as { readOnly: boolean }).readOnly = false;
    expect(() => parseSyncApiResponse(invalid)).toThrow(/observedAt|readOnly/u);
  });

  it("rejects duplicate or missing locations", () => {
    const invalid = validResponse();
    invalid.sync.nodes[4]!.location = "github";
    expect(() => parseSyncApiResponse(invalid)).toThrow(/exactly one public/u);
  });
});

describe("loadSyncEvidence", () => {
  it("uses same-origin GET and parses the response", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(validResponse()), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const result = await loadSyncEvidence({ fetcher });
    expect(fetcher).toHaveBeenCalledWith("/admin-api/v1/sync", expect.objectContaining({
      method: "GET",
      credentials: "same-origin",
    }));
    expect(result.source.kind).toBe("snapshot");
  });

  it("degrades endpoint failures to explicit unknown nodes", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    const result = await loadSyncEvidence({ fetcher, now: observedAt });
    expect(result.source.kind).toBe("unavailable");
    expect(result.sync.nodes).toHaveLength(5);
    expect(result.sync.nodes.every((node) => node.drift === "unknown")).toBe(true);
  });
});
