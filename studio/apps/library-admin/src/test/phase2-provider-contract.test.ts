import { describe, expect, it, vi } from "vitest";
import { loadOperations } from "../data/providers/operations";
import { loadSyncEvidence } from "../data/sync";

const observedAt = "2026-08-12T04:00:00.000Z";
const unavailableSection = (label: string) => ({
  source: { kind: "unavailable", label },
  items: [],
});

function operationsEnvelope() {
  return {
    source: { kind: "snapshot", label: "local read-only operations" },
    observedAt,
    diagnostics: [],
    submissions: {
      source: { kind: "snapshot", label: "submissions", observedAt },
      items: [{ id: "submission-1", host: "example.test", status: "pending" }],
    },
    discoveries: unavailableSection("discoveries"),
    decisions: unavailableSection("decisions"),
    quality: unavailableSection("quality"),
    origins: unavailableSection("origins"),
    jobs: {
      source: { kind: "snapshot", label: "jobs", observedAt },
      items: [{ id: "job-1", kind: "collect", status: "failed", createdAt: observedAt, updatedAt: observedAt }],
    },
    logs: unavailableSection("logs"),
  };
}

function judgmentDecision() {
  return {
    id: "decision-1",
    discoveryId: "subject-1",
    candidateTitle: "Independent Studio",
    recommendation: "approve",
    confidence: 88,
    reason: "Original work with reusable typography evidence.",
    policyVersion: "opendesign-curation-v1.1",
    model: "fixture-model",
    decidedAt: observedAt,
    reviewStatus: "confirmed",
    finalRecommendation: "approve",
    reviewedBy: "admin",
    reviewedAt: observedAt,
    signals: [],
    aiJudgment: {
      id: "decision-1", holderType: "agent", holderId: "fixture-model",
      subjectId: "subject-1", statement: "approve", asOf: observedAt,
      reason: "Original work with reusable typography evidence.",
      provenance: { source: "daily-ai-curator", aiDecisionId: "decision-1", policyVersion: "opendesign-curation-v1.1", model: "fixture-model" },
    },
    reviewJudgment: {
      id: "review-1", holderType: "user", holderId: "admin",
      subjectId: "subject-1", statement: "approve", asOf: observedAt, recordedAt: observedAt,
      reason: "Evidence verified by operator.", supersedesDecisionId: "decision-1",
      provenance: { source: "admin-api", requestId: "request-1", aiDecisionId: "decision-1" },
    },
  };
}

describe("Phase 2 provider boundaries", () => {
  it("keeps unavailable operations sections independent and checkpoints ordered", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(operationsEnvelope()), { status: 200 }));
    const result = await loadOperations({ fetcher });

    expect(fetcher).toHaveBeenCalledWith("/admin-api/v1/operations", expect.objectContaining({
      method: "GET",
      credentials: "same-origin",
    }));
    expect(result.reviews).toEqual([expect.objectContaining({ id: "submission:submission-1", previewOnly: true })]);
    expect(result.pipelines[0]).toMatchObject({
      id: "job:job-1",
      status: "failed",
      retryFromCheckpointId: "execute",
      previewOnly: true,
    });
    expect(result.pipelines[0]?.checkpoints.map(({ id }) => id)).toEqual(["queued", "execute", "record"]);
    expect(result.reviewSource).toMatchObject({ kind: "snapshot", detail: expect.stringContaining("Partial") });
    expect(result.pipelineSource).toMatchObject({ kind: "snapshot", detail: expect.stringContaining("Partial") });
  });

  it("degrades operations and sync independently", async () => {
    const operationsFetcher = vi.fn(async () => new Response("bad", { status: 503 }));
    const syncFetcher = vi.fn(async () => new Response(JSON.stringify({ invalid: true }), { status: 200 }));

    const [operations, sync] = await Promise.all([
      loadOperations({ fetcher: operationsFetcher }),
      loadSyncEvidence({ fetcher: syncFetcher, now: observedAt }),
    ]);

    expect(operations).toMatchObject({
      reviews: [],
      pipelines: [],
      reviewSource: { kind: "unavailable" },
      pipelineSource: { kind: "unavailable" },
    });
    expect(sync.source.kind).toBe("unavailable");
    expect(sync.sync.nodes).toHaveLength(5);
    expect(sync.sync.nodes.every(({ drift, readOnly }) => drift === "unknown" && readOnly)).toBe(true);
  });

  it("refuses remote operations endpoints before making a request", async () => {
    const fetcher = vi.fn();
    const result = await loadOperations({ endpoint: "https://write.example/admin", fetcher });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.reviewSource.kind).toBe("unavailable");
    expect(result.diagnostics[0]?.message).toMatch(/same-origin/u);
  });

  it("preserves the AI and human five-part judgments across the operations boundary", async () => {
    const envelope = {
      ...operationsEnvelope(),
      decisions: {
        source: { kind: "snapshot", label: "decisions", observedAt },
        items: [judgmentDecision()],
      },
    };
    const result = await loadOperations({
      fetcher: vi.fn(async () => new Response(JSON.stringify(envelope), { status: 200 })),
    });

    expect(result.decisions[0]).toMatchObject({
      aiJudgment: {
        holderType: "agent", holderId: "fixture-model", subjectId: "subject-1",
        statement: "approve", provenance: { source: "daily-ai-curator" },
      },
      reviewJudgment: {
        holderType: "user", holderId: "admin", subjectId: "subject-1",
        statement: "approve", supersedesDecisionId: "decision-1",
        provenance: { source: "admin-api", requestId: "request-1" },
      },
    });
  });
});
