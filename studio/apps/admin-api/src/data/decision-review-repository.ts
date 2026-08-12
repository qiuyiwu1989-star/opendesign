import type {
  DatabaseClient,
  DecisionRecommendation,
  DecisionReviewInput,
  DecisionReviewResult,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 2_500;

interface DecisionReviewRepositoryOptions {
  timeoutMs?: number;
}

interface ReviewRow {
  outcome?: unknown;
  decision_id?: unknown;
  review_status?: unknown;
  recommendation?: unknown;
  reviewed_at?: unknown;
  reviewed_by?: unknown;
}

function recommendation(value: unknown): DecisionRecommendation | undefined {
  return value === "approve" || value === "review" || value === "reject" ? value : undefined;
}

function iso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return undefined;
}

/** Write boundary limited to the one security-definer review function. */
export class DecisionReviewRepository {
  readonly #client: DatabaseClient;
  readonly #timeoutMs: number;

  constructor(client: DatabaseClient, options: DecisionReviewRepositoryOptions = {}) {
    this.#client = client;
    this.#timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 5_000));
  }

  async review(input: DecisionReviewInput, signal?: AbortSignal): Promise<DecisionReviewResult> {
    try {
      const result = await this.#client.query<ReviewRow>({
        text: "select outcome, decision_id, review_status, recommendation, reviewed_at, reviewed_by from opendesign_admin_read.review_curation_decision($1::uuid,$2,$3,$4,$5)",
        values: [input.decisionId, input.reviewedBy, input.action, input.recommendation ?? null, input.reason],
        timeoutMs: this.#timeoutMs,
        maxRows: 1,
        ...(signal ? { signal } : {}),
      });
      const row = result.rows[0];
      if (!row) return { outcome: "unavailable" };
      if (row.outcome === "not_found" || row.outcome === "already_reviewed") return { outcome: row.outcome };
      const finalRecommendation = recommendation(row.recommendation);
      const reviewedAt = iso(row.reviewed_at);
      if (row.outcome !== "reviewed"
          || typeof row.decision_id !== "string"
          || (row.review_status !== "confirmed" && row.review_status !== "overridden")
          || !finalRecommendation
          || !reviewedAt
          || typeof row.reviewed_by !== "string") {
        return { outcome: "unavailable" };
      }
      return {
        outcome: "reviewed",
        decisionId: row.decision_id,
        reviewStatus: row.review_status,
        recommendation: finalRecommendation,
        reviewedAt,
        reviewedBy: row.reviewed_by,
      };
    } catch {
      return { outcome: "unavailable" };
    }
  }
}
