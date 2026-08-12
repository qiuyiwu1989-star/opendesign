import { describe, expect, it, vi } from "vitest";
import {
  COMPACT_PACK_MANIFEST_SCHEMA,
  createCompactPackManifest,
  loadCompactPackManifest,
  parseCompactPackManifest,
} from "./manifest";

const provenance = {
  generatedAt: "2026-08-12T12:00:00.000Z",
  sourceBytes: 4_071_396,
  sourceRevision: "ff546db",
};

describe("compact Pack manifest", () => {
  it("emits only sorted ids and explicit build provenance", () => {
    const manifest = createCompactPackManifest({ stripe: { files: ["large"] }, apple: { secret: "discard me" } }, provenance);

    expect(manifest).toEqual({
      schema: COMPACT_PACK_MANIFEST_SCHEMA,
      packIds: ["apple", "stripe"],
      provenance: {
        source: "packs-index.json",
        generatedAt: provenance.generatedAt,
        sourceCount: 2,
        sourceBytes: provenance.sourceBytes,
        sourceRevision: provenance.sourceRevision,
      },
    });
    expect(JSON.stringify(manifest)).not.toContain("files");
    expect(JSON.stringify(manifest)).not.toContain("secret");
  });

  it("keeps valid Pack membership when one record is malformed", () => {
    const parsed = parseCompactPackManifest({
      schema: COMPACT_PACK_MANIFEST_SCHEMA,
      packIds: ["apple", "Bad ID", "stripe", "apple", null],
      provenance: { source: "packs-index.json", generatedAt: provenance.generatedAt, sourceCount: 5 },
    });

    expect(parsed.state).toBe("degraded");
    expect([...parsed.ids ?? []]).toEqual(["apple", "stripe"]);
    expect(parsed.diagnostics.map(({ code }) => code)).toEqual([
      "pack-manifest-invalid-id",
      "pack-manifest-invalid-id",
      "pack-manifest-count-mismatch",
    ]);
  });

  it("marks structural and provenance failures unavailable", () => {
    const results = [
      parseCompactPackManifest([]),
      parseCompactPackManifest({ schema: "future", packIds: [] }),
      parseCompactPackManifest({ schema: COMPACT_PACK_MANIFEST_SCHEMA, packIds: [], provenance: {} }),
    ];

    expect(results.every(({ state }) => state === "unavailable")).toBe(true);
    expect(results.every(({ ids }) => ids === undefined)).toBe(true);
  });

  it("uses one same-origin GET and represents request failure instead of throwing", async () => {
    const fetcher = vi.fn(async () => new Response("offline", { status: 503 }));
    const result = await loadCompactPackManifest({ fetcher });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/pack-manifest.json", {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    expect(result).toMatchObject({
      state: "unavailable",
      diagnostics: [{ code: "pack-manifest-request-failed", level: "warning" }],
    });
  });

  it("never accepts absolute or traversal-like Pack ids", () => {
    expect(() => createCompactPackManifest({ "../escape": {}, "https://write.example": {} }, provenance)).toThrow(/invalid pack ids/);
  });
});
