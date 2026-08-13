import { describe, expect, it } from "vitest";
import { OperationsRepository } from "./repository.js";
import type { DatabaseClient, DatabaseQuery } from "./types.js";

const now = new Date("2026-08-12T08:00:00.000Z");

describe("OperationsRepository", () => {
  it("uses parameterized, bounded queries and emits a Phase 2 envelope", async () => {
    const queries: DatabaseQuery<unknown>[] = [];
    const client: DatabaseClient = {
      async query<T>(query: DatabaseQuery<T>) {
        queries.push(query);
        const rows = query.text.includes(".jobs ")
          ? [{ id: "job-1", kind: "collect", slug: "example", status: "failed", result: "render failed", created_at: now, updated_at: now }]
          : query.text.includes(".run_logs ")
            ? [{ id: "log-1", kind: "jobrunner", status: "error", started_at: now, finished_at: now, summary: "failed", details: "at render" }]
            : [];
        return { rows: rows as T[], rowCount: rows.length };
      },
    };
    const envelope = await new OperationsRepository(client, {
      limit: 999, timeoutMs: 99_999, now: () => now,
    }).readOperations();
    expect(queries).toHaveLength(7);
    expect(queries.every((query) => query.values[0] === 200 && query.maxRows === 200)).toBe(true);
    expect(queries.every((query) => query.timeoutMs === 10_000 && /limit \$1/u.test(query.text))).toBe(true);
    expect(envelope.jobs.items[0]).toEqual({
      id: "job-1", kind: "collect", slug: "example", status: "failed", result: "render failed",
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
    expect(envelope.logs.items[0]?.details).toBe("at render");
    expect(envelope.observedAt).toBe(now.toISOString());
  });

  it("degrades sections independently without leaking database errors", async () => {
    const client: DatabaseClient = {
      query: async <T,>(query: DatabaseQuery<T>) => {
        if (query.text.includes(".discoveries ")) throw new Error("password leaked in driver detail");
        return { rows: [], rowCount: 0 };
      },
    };
    const envelope = await new OperationsRepository(client, { now: () => now }).readOperations();
    expect(envelope.discoveries.source.kind).toBe("unavailable");
    expect(envelope.submissions.source.kind).toBe("live");
    expect(JSON.stringify(envelope)).not.toContain("password leaked");
  });

  it("returns bounded database sync evidence", async () => {
    const client: DatabaseClient = {
      async query<T>(query: DatabaseQuery<T>) {
        expect(query.values).toEqual([1]);
        expect(query.maxRows).toBe(1);
        return { rows: [{ revision: "db123", observed_at: now, detail: "watermarks" }] as T[], rowCount: 1 };
      },
    };
    const evidence = await new OperationsRepository(client, { now: () => now }).readDatabaseSyncEvidence();
    expect(evidence).toMatchObject({ location: "database", revision: "db123", readOnly: true });
  });

  it("maps AI and human judgment provenance without collapsing the event chain", async () => {
    const client: DatabaseClient = {
      async query<T>(query: DatabaseQuery<T>) {
        const rows = query.text.includes(".curation_decisions ") ? [{
          id: "decision-1", discovery_id: "subject-1", subject_id: "subject-1",
          candidate_title: "Independent Studio", recommendation: "approve", confidence: 88,
          reason: "AI evidence", policy_version: "v1", model: "model-1", decided_at: now,
          review_status: "confirmed", final_recommendation: "approve", reviewed_by: "admin",
          reviewed_at: now, review_reason: "Human evidence", signals: [],
          ai_holder_id: "model-1", ai_as_of: now,
          ai_provenance: { source: "daily-ai-curator", aiDecisionId: "decision-1" },
          review_event_id: "review-1", review_holder_id: "admin", review_statement: "approve",
          review_as_of: now, review_recorded_at: now,
          review_provenance: { source: "admin-api", requestId: "request-1" },
          supersedes_decision_id: "decision-1",
        }] : [];
        return { rows: rows as T[], rowCount: rows.length };
      },
    };
    const envelope = await new OperationsRepository(client, { now: () => now }).readOperations();

    expect(envelope.decisions.items[0]).toMatchObject({
      aiJudgment: { holderType: "agent", holderId: "model-1", subjectId: "subject-1", statement: "approve" },
      reviewJudgment: { holderType: "user", holderId: "admin", subjectId: "subject-1", supersedesDecisionId: "decision-1" },
    });
  });
});
