import { describe, expect, it, vi } from "vitest";
import { DECISION_REVIEW_ENDPOINT, submitDecisionReview } from "./provider";

const reviewed = {
  decisionId: "decision-ad",
  reviewStatus: "confirmed",
  recommendation: "reject",
  reviewedAt: "2026-08-13T09:00:00.000Z",
  reviewedBy: "admin",
};

describe("decision review provider", () => {
  it("posts the frozen same-origin JSON contract and parses the direct decision response", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(reviewed), { status: 200 }));
    const result = await submitDecisionReview({ decisionId: "decision-ad", action: "confirm", reason: "广告证据成立" }, fetcher);

    expect(fetcher).toHaveBeenCalledWith(DECISION_REVIEW_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ decisionId: "decision-ad", action: "confirm", reason: "广告证据成立" }),
    });
    expect(result).toEqual({ ok: true, decision: reviewed });
  });

  it.each([
    [401, "unauthenticated", "登录已失效"],
    [409, "conflict", "其他审查者"],
    [429, "rate_limited", "提交过于频繁"],
    [503, "unavailable", "暂时不可用"],
  ] as const)("maps HTTP %s to an explicit %s failure", async (status, reason, message) => {
    const result = await submitDecisionReview(
      { decisionId: "decision-ad", action: "override", recommendation: "approve", reason: "人工确认原创" },
      vi.fn(async () => new Response("", { status })),
    );
    expect(result).toMatchObject({ ok: false, reason, message: expect.stringContaining(message) });
  });

  it("rejects wrappers and incomplete audit records instead of inventing success", async () => {
    const wrapped = vi.fn(async () => new Response(JSON.stringify({ decision: reviewed }), { status: 200 }));
    const incomplete = vi.fn(async () => new Response(JSON.stringify({ ...reviewed, reviewedBy: "" }), { status: 200 }));

    await expect(submitDecisionReview({ decisionId: "decision-ad", action: "confirm", reason: "确认" }, wrapped))
      .resolves.toMatchObject({ ok: false, reason: "invalid_response" });
    await expect(submitDecisionReview({ decisionId: "decision-ad", action: "confirm", reason: "确认" }, incomplete))
      .resolves.toMatchObject({ ok: false, reason: "invalid_response" });
  });

  it("rejects a successful-looking record that does not match the requested transition", async () => {
    const wrongDecision = vi.fn(async () => new Response(JSON.stringify({ ...reviewed, decisionId: "decision-other" }), { status: 200 }));
    const wrongTransition = vi.fn(async () => new Response(JSON.stringify({ ...reviewed, reviewStatus: "overridden" }), { status: 200 }));

    await expect(submitDecisionReview({ decisionId: "decision-ad", action: "confirm", reason: "确认" }, wrongDecision))
      .resolves.toMatchObject({ ok: false, reason: "invalid_response" });
    await expect(submitDecisionReview({ decisionId: "decision-ad", action: "confirm", reason: "确认" }, wrongTransition))
      .resolves.toMatchObject({ ok: false, reason: "invalid_response" });
  });
});
