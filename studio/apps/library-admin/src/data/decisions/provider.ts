import type { DecisionRecommendation, DecisionReviewStatus } from "../../domain";

export const DECISION_REVIEW_ENDPOINT = "/admin-api/v1/decisions/review";

export type DecisionReviewRequest =
  | { decisionId: string; action: "confirm"; reason: string }
  | { decisionId: string; action: "override"; recommendation: DecisionRecommendation; reason: string };

export interface ReviewedDecision {
  decisionId: string;
  reviewStatus: Exclude<DecisionReviewStatus, "pending">;
  recommendation: DecisionRecommendation;
  reviewedAt: string;
  reviewedBy: string;
}

export type DecisionReviewFailure =
  | "unauthenticated"
  | "conflict"
  | "rate_limited"
  | "invalid_response"
  | "unavailable";

export type DecisionReviewResult =
  | { ok: true; decision: ReviewedDecision }
  | { ok: false; reason: DecisionReviewFailure; message: string };

const failureMessages: Record<DecisionReviewFailure, string> = {
  unauthenticated: "登录已失效，请重新登录后再提交。",
  conflict: "这条判断已被其他审查者处理，请刷新后核对最新记录。",
  rate_limited: "提交过于频繁，请稍后再试。",
  invalid_response: "服务器已响应，但返回的审计记录格式不正确。",
  unavailable: "终审服务暂时不可用，请保留理由并稍后重试。",
};

function failure(reason: DecisionReviewFailure): DecisionReviewResult {
  return { ok: false, reason, message: failureMessages[reason] };
}

function parseReviewedDecision(payload: unknown): ReviewedDecision | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const value = payload as Record<string, unknown>;
  if (
    typeof value.decisionId !== "string"
    || !["confirmed", "overridden"].includes(String(value.reviewStatus))
    || !["approve", "review", "reject"].includes(String(value.recommendation))
    || typeof value.reviewedAt !== "string"
    || !Number.isFinite(Date.parse(value.reviewedAt))
    || typeof value.reviewedBy !== "string"
    || !value.reviewedBy.trim()
  ) return undefined;
  return {
    decisionId: value.decisionId,
    reviewStatus: value.reviewStatus as ReviewedDecision["reviewStatus"],
    recommendation: value.recommendation as DecisionRecommendation,
    reviewedAt: value.reviewedAt,
    reviewedBy: value.reviewedBy,
  };
}

export async function submitDecisionReview(
  request: DecisionReviewRequest,
  fetcher: typeof fetch = fetch,
): Promise<DecisionReviewResult> {
  try {
    const response = await fetcher(DECISION_REVIEW_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (response.status === 401) return failure("unauthenticated");
    if (response.status === 409) return failure("conflict");
    if (response.status === 429) return failure("rate_limited");
    if (!response.ok) return failure("unavailable");
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return failure("invalid_response");
    }
    const decision = parseReviewedDecision(payload);
    if (!decision || decision.decisionId !== request.decisionId) return failure("invalid_response");
    if (request.action === "confirm" && decision.reviewStatus !== "confirmed") return failure("invalid_response");
    if (request.action === "override" && (decision.reviewStatus !== "overridden" || decision.recommendation !== request.recommendation)) return failure("invalid_response");
    return { ok: true, decision };
  } catch {
    return failure("unavailable");
  }
}
