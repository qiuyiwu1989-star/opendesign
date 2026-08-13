import { describe, expect, it } from "vitest";
import { DecisionReviewRepository } from "./decision-review-repository.js";
import type { DatabaseClient, DatabaseQuery } from "./types.js";

describe("DecisionReviewRepository", () => {
  it("calls only the bounded review function with positional parameters", async () => {
    let captured: DatabaseQuery<unknown> | undefined;
    const client: DatabaseClient = {
      async query<T>(query: DatabaseQuery<T>) {
        captured = query;
        return { rows: [{
          outcome: "reviewed", decision_id: "decision-1", review_status: "overridden",
          recommendation: "reject", reviewed_at: new Date("2026-08-13T09:00:00Z"), reviewed_by: "admin",
          review_event_id: "review-1", subject_id: "subject-1", review_reason: "发现隐藏广告跳转",
          review_provenance: { source: "admin-api", requestId: "request-1", aiDecisionId: "decision-1" },
        }] as T[], rowCount: 1 };
      },
    };
    const result = await new DecisionReviewRepository(client, { timeoutMs: 99_999 }).review({
      decisionId: "decision-1", reviewedBy: "admin", action: "override",
      recommendation: "reject", reason: "发现隐藏广告跳转", requestId: "request-1",
    });
    expect(result).toEqual({
      outcome: "reviewed", decisionId: "decision-1", reviewStatus: "overridden",
      recommendation: "reject", reviewedAt: "2026-08-13T09:00:00.000Z", reviewedBy: "admin",
      reviewEventId: "review-1", subjectId: "subject-1", reason: "发现隐藏广告跳转",
      provenance: { source: "admin-api", requestId: "request-1", aiDecisionId: "decision-1" },
    });
    expect(captured?.text).toContain("opendesign_admin_read.review_curation_decision($1::uuid,$2,$3,$4,$5,$6)");
    expect(captured?.values).toEqual(["decision-1", "admin", "override", "reject", "发现隐藏广告跳转", "request-1"]);
    expect(captured?.timeoutMs).toBe(5_000);
    expect(captured?.maxRows).toBe(1);
  });

  it("surfaces duplicate review and hides database errors", async () => {
    const duplicate: DatabaseClient = {
      query: async <T,>() => ({ rows: [{ outcome: "already_reviewed" }] as T[], rowCount: 1 }),
    };
    expect(await new DecisionReviewRepository(duplicate).review({
      decisionId: "decision-1", reviewedBy: "admin", action: "confirm", reason: "人工确认原有结论", requestId: "request-duplicate",
    })).toEqual({ outcome: "already_reviewed" });
    const broken: DatabaseClient = { query: async () => { throw new Error("database password leaked"); } };
    expect(await new DecisionReviewRepository(broken).review({
      decisionId: "decision-1", reviewedBy: "admin", action: "confirm", reason: "人工确认原有结论", requestId: "request-broken",
    })).toEqual({ outcome: "unavailable" });
  });

  it("rejects a success row whose provenance is not bound to the reviewed decision", async () => {
    const client: DatabaseClient = {
      query: async <T,>() => ({ rows: [{
        outcome: "reviewed", decision_id: "decision-1", review_status: "confirmed",
        recommendation: "approve", reviewed_at: new Date("2026-08-13T09:00:00Z"), reviewed_by: "admin",
        review_event_id: "review-1", subject_id: "subject-1", review_reason: "人工核验证据",
        review_provenance: { source: "admin-api", requestId: "request-1", aiDecisionId: "decision-other" },
      }] as T[], rowCount: 1 }),
    };

    expect(await new DecisionReviewRepository(client).review({
      decisionId: "decision-1", reviewedBy: "admin", action: "confirm",
      reason: "人工核验证据", requestId: "request-1",
    })).toEqual({ outcome: "unavailable" });
  });
});
