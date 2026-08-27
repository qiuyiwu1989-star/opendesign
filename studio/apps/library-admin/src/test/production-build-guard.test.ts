import { describe, expect, it } from "vitest";
import { BUILD_BUDGETS, verifyProductionBuild } from "./production-build-guard";

describe("Control Room production build guard", () => {
  it("accepts a compact manifest and a bounded static application", () => {
    expect(verifyProductionBuild([
      { path: "index.html", bytes: 800 },
      { path: "sites-index.json", bytes: 510_000 },
      { path: "pack-manifest.json", bytes: 16_000 },
      { path: "assets/index-123.js", bytes: 240_000 },
      { path: "assets/index-123.css", bytes: 24_000 },
    ])).toMatchObject({ ok: true, errors: [], compactManifestBytes: 16_000 });
  });

  it("rejects the full Pack index even when it fits the total budget", () => {
    const result = verifyProductionBuild([
      { path: "packs-index.json", bytes: 10 },
      { path: "pack-manifest.json", bytes: 10 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("dist must not contain the full packs-index.json");
  });

  it("enforces manifest, JavaScript and aggregate size budgets independently", () => {
    const result = verifyProductionBuild([
      { path: "pack-manifest.json", bytes: BUILD_BUDGETS.compactPackManifestBytes + 1 },
      { path: "assets/app.js", bytes: BUILD_BUDGETS.javascriptAssetBytes + 1 },
      { path: "sites-index.json", bytes: BUILD_BUDGETS.totalDistBytes },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it("requires exactly one compact manifest", () => {
    expect(verifyProductionBuild([]).errors).toContain(
      "dist must contain exactly one compact pack-manifest.json (found 0)",
    );
    expect(verifyProductionBuild([
      { path: "pack-manifest.json", bytes: 1 },
      { path: "nested/pack-manifest.json", bytes: 1 },
    ]).errors).toContain("dist must contain exactly one compact pack-manifest.json (found 2)");
  });
});
