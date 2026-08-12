import { describe, expect, it, vi } from "vitest";
import {
  createSnapshotAdapter,
  loadAdminSnapshot,
  parseStaticSiteIndex,
  SnapshotValidationError,
  syntheticGitFixture,
  syntheticPipelineFixture,
  syntheticReviewFixture,
  syntheticSiteIndexFixture,
  syntheticSnapshotFixture,
} from "./index";

describe("Control Room read-only snapshot adapter", () => {
  it("keeps static library data explicitly labelled as a snapshot", async () => {
    const snapshot = await createSnapshotAdapter(syntheticSnapshotFixture).load();

    expect(snapshot.source).toMatchObject({
      kind: "snapshot",
      label: "sites-index.json + packs-index.json",
      generatedAt: syntheticSiteIndexFixture._meta.built_at,
    });
    expect(snapshot.sources.library.kind).toBe("snapshot");
    expect(snapshot.sources.reviews.kind).toBe("snapshot");
    expect(snapshot.sources.pipelines.kind).toBe("snapshot");
    expect(snapshot.sources.sync.kind).toBe("snapshot");
    expect(snapshot.source.kind).not.toBe("live");
  });

  it("does not fabricate production review, pipeline, or sync data", async () => {
    const snapshot = await createSnapshotAdapter({
      siteIndex: syntheticSiteIndexFixture,
      now: "2026-08-12T01:00:00.000Z",
    }).load();

    expect(snapshot.sources.reviews.kind).toBe("unavailable");
    expect(snapshot.sources.pipelines.kind).toBe("unavailable");
    expect(snapshot.sources.sync.kind).toBe("unavailable");
    expect(snapshot.pipelines).toEqual([]);
    expect(snapshot.sync.nodes.map((node) => node.drift)).toEqual([
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "reviews-live-unavailable",
        "pipelines-live-unavailable",
        "sync-snapshot-unavailable",
      ]),
    );
  });

  it("maps evidence, curation, and origin as three independent axes", async () => {
    const snapshot = await createSnapshotAdapter(syntheticSnapshotFixture).load();

    expect(snapshot.assets.map((asset) => [asset.id, asset.quality])).toEqual([
      ["fixture-complete", { evidence: "E3", curation: "accepted", origin: "changed" }],
      ["fixture-spec", { evidence: "E2", curation: "accepted", origin: "changed" }],
      ["fixture-preview-missing", { evidence: "E0", curation: "accepted", origin: "degraded" }],
    ]);
    expect(snapshot.assets.every((asset) => "evidence" in asset.quality && "curation" in asset.quality && "origin" in asset.quality)).toBe(true);
  });

  it("unifies supplied submissions with asset-derived quality reviews", async () => {
    const snapshot = await createSnapshotAdapter(syntheticSnapshotFixture).load();

    expect(snapshot.reviews.map((review) => review.source)).toEqual(
      expect.arrayContaining(["submission", "quality"]),
    );
    expect(snapshot.reviews.every((review) => review.previewOnly)).toBe(true);
    expect(snapshot.reviews).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "quality",
        assetId: "fixture-preview-missing",
        evidence: ["image is empty"],
      }),
    ]));
  });

  it("preserves ordered pipeline checkpoints and marks the run preview-only", async () => {
    const snapshot = await createSnapshotAdapter(syntheticSnapshotFixture).load();
    const run = snapshot.pipelines.find((item) => item.id === syntheticPipelineFixture[0]?.id);

    expect(run?.checkpoints.map(({ label, status }) => ({ label, status }))).toEqual([
      { label: "Discover", status: "completed" },
      { label: "Extract", status: "failed" },
      { label: "Validate", status: "pending" },
    ]);
    expect(run).toMatchObject({ retryFromCheckpointId: "extract", previewOnly: true });
  });

  it("models Local, Git, GitHub and Public drift without write capabilities", async () => {
    const snapshot = await createSnapshotAdapter(syntheticSnapshotFixture).load();

    expect(snapshot.sync.readOnly).toBe(true);
    expect(snapshot.sync.nodes.map((node) => node.location)).toEqual([
      "database",
      "local",
      "git",
      "github",
      "public",
    ]);
    expect(snapshot.sync.nodes.find((node) => node.location === "git")?.drift).toBe("in-sync");
    expect(snapshot.sync.nodes.find((node) => node.location === "github")?.drift).toBe("diverged");
    expect(snapshot.sync.nodes.find((node) => node.location === "public")?.drift).toBe("diverged");
    expect(syntheticGitFixture).not.toHaveProperty("token");
  });

  it("orders Today around the three highest-priority actions", async () => {
    const snapshot = await createSnapshotAdapter(syntheticSnapshotFixture).load();

    expect(snapshot.today.topActions).toHaveLength(3);
    expect(snapshot.today.topActions.map((action) => action.title)).toEqual([
      "检查失败管线",
      "检查同步漂移",
      "清理统一审阅箱",
    ]);
    expect(snapshot.today.topActions.every((action) => action.previewOnly)).toBe(true);
  });

  it("rejects malformed site records instead of silently treating them as an empty library", () => {
    expect(() => parseStaticSiteIndex({ sites: [{ id: "missing-title-and-url" }] })).toThrowError(SnapshotValidationError);
    expect(() => parseStaticSiteIndex({ sites: "not-an-array" })).toThrowError(/sites must be an array/);
  });

  it("loads through a read-only GET and falls back to a labelled local fixture on failure", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const snapshot = await loadAdminSnapshot({
      fetcher,
      siteIndexUrl: "/test-sites-index.json",
      fallback: syntheticSnapshotFixture,
    });

    expect(fetcher).toHaveBeenCalledWith("/test-sites-index.json", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    expect(snapshot.source.kind).toBe("snapshot");
    expect(snapshot.source.label).toBe("sites-index.json + packs-index.json");
    expect(snapshot.assets).toHaveLength(syntheticSiteIndexFixture.sites.length);
    expect(snapshot.reviews).toEqual(expect.arrayContaining(syntheticReviewFixture));
  });
});
