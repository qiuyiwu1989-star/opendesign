import type {
  DatabaseClient,
  DatabaseSyncEvidence,
  DiscoveryRow,
  CurationDecisionRow,
  JobRow,
  OperationsDiagnostic,
  OperationsEnvelope,
  OperationsSection,
  OriginRow,
  QualityRow,
  RunLogRow,
  SubmissionRow,
  DecisionRecommendation,
  JudgmentProvenance,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 2_500;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

interface RepositoryOptions {
  timeoutMs?: number;
  limit?: number;
  now?: () => Date;
}

interface SectionSpec<T> {
  key: keyof Pick<OperationsEnvelope, "submissions" | "discoveries" | "decisions" | "quality" | "origins" | "jobs" | "logs">;
  label: string;
  text: string;
  map(row: Record<string, unknown>): T;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const iso = (value: unknown): string | undefined => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return undefined;
};
const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  value === undefined ? {} : { [key]: value } as { [P in K]?: V };

function submission(row: Record<string, unknown>): SubmissionRow {
  return {
    id: String(row.id),
    ...optional("url", text(row.url)), ...optional("host", text(row.host)),
    ...optional("note", text(row.note)), ...optional("status", text(row.status)),
    ...optional("kind", text(row.kind)), ...optional("slug", text(row.slug)),
    ...optional("createdAt", iso(row.created_at)),
    ...optional("hostVoters", number(row.host_voters)),
    ...optional("hostTotal", number(row.host_total)),
  };
}

function discovery(row: Record<string, unknown>): DiscoveryRow {
  return {
    id: String(row.id),
    ...optional("url", text(row.url)), ...optional("host", text(row.host)),
    ...optional("slug", text(row.slug)), ...optional("title", text(row.title)),
    ...optional("source", text(row.source)), ...optional("score", number(row.score)),
    ...optional("status", text(row.status)), ...optional("createdAt", iso(row.created_at)),
  };
}

function decision(row: Record<string, unknown>): CurationDecisionRow {
  const recommendation = row.recommendation;
  const finalRecommendation = row.final_recommendation;
  const mappedFinalRecommendation: DecisionRecommendation | undefined = finalRecommendation === "approve" || finalRecommendation === "review" || finalRecommendation === "reject"
    ? finalRecommendation
    : undefined;
  const reviewStatus = row.review_status;
  const subjectId = String(row.subject_id ?? row.discovery_id);
  const aiProvenance = judgmentProvenance(row.ai_provenance)
    ?? { source: "daily-ai-curator", aiDecisionId: String(row.id) };
  const reviewProvenance = judgmentProvenance(row.review_provenance);
  const reviewEventId = text(row.review_event_id);
  const reviewStatement = row.review_statement;
  const reviewAsOf = iso(row.review_as_of);
  const reviewHolderId = text(row.review_holder_id);
  return {
    id: String(row.id),
    discoveryId: String(row.discovery_id),
    candidateTitle: text(row.candidate_title) ?? "候选站点",
    ...optional("candidateUrl", text(row.candidate_url)),
    recommendation: recommendation === "approve" || recommendation === "reject" ? recommendation : "review",
    ...optional("finalRecommendation", mappedFinalRecommendation),
    confidence: number(row.confidence) ?? 0,
    reason: text(row.reason) ?? "No reason recorded",
    policyVersion: text(row.policy_version) ?? "unknown",
    model: text(row.model) ?? "unknown",
    decidedAt: iso(row.decided_at) ?? new Date(0).toISOString(),
    reviewStatus: reviewStatus === "confirmed" || reviewStatus === "overridden" ? reviewStatus : "pending",
    ...optional("reviewedBy", text(row.reviewed_by)), ...optional("reviewedAt", iso(row.reviewed_at)),
    ...optional("reviewReason", text(row.review_reason)),
    signals: Array.isArray(row.signals) ? row.signals.slice(0, 20) : [],
    aiJudgment: {
      id: String(row.id), holderType: "agent", holderId: text(row.ai_holder_id) ?? text(row.model) ?? "unknown",
      subjectId, statement: recommendation === "approve" || recommendation === "reject" ? recommendation : "review",
      asOf: iso(row.ai_as_of) ?? iso(row.decided_at) ?? new Date(0).toISOString(),
      reason: text(row.reason) ?? "No reason recorded", provenance: aiProvenance,
    },
    ...(reviewEventId && reviewAsOf && reviewHolderId
      && (reviewStatement === "approve" || reviewStatement === "review" || reviewStatement === "reject")
      && reviewProvenance ? {
        reviewJudgment: {
          id: reviewEventId, holderType: "user" as const, holderId: reviewHolderId,
          subjectId, statement: reviewStatement, asOf: reviewAsOf,
          ...optional("recordedAt", iso(row.review_recorded_at)),
          reason: text(row.review_reason) ?? "No review reason recorded",
          provenance: reviewProvenance,
          supersedesDecisionId: String(row.supersedes_decision_id ?? row.id),
        },
      } : {}),
  };
}

function judgmentProvenance(value: unknown): JudgmentProvenance | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const source = text(record.source);
  if (!source) return undefined;
  return {
    source,
    ...optional("requestId", text(record.requestId)),
    ...optional("aiDecisionId", text(record.aiDecisionId)),
    ...optional("policyVersion", text(record.policyVersion)),
    ...optional("model", text(record.model)),
  };
}

function quality(row: Record<string, unknown>): QualityRow {
  const evidence = Array.isArray(row.evidence)
    ? row.evidence.filter((item): item is string => typeof item === "string").slice(0, 20)
    : [];
  return {
    id: String(row.id),
    ...optional("assetId", text(row.asset_id)), ...optional("title", text(row.title)),
    ...optional("summary", text(row.summary)), ...optional("severity", text(row.severity)),
    ...optional("status", text(row.status)), ...optional("url", text(row.url)),
    ...optional("createdAt", iso(row.created_at)), evidence,
  };
}

function origin(row: Record<string, unknown>): OriginRow {
  const { severity: _severity, ...result } = quality(row);
  return result;
}

function job(row: Record<string, unknown>): JobRow {
  return {
    id: String(row.id),
    ...optional("kind", text(row.kind)), ...optional("slug", text(row.slug)),
    ...optional("url", text(row.url)), ...optional("status", text(row.status)),
    ...optional("result", text(row.result)), ...optional("createdAt", iso(row.created_at)),
    ...optional("updatedAt", iso(row.updated_at)),
  };
}

function log(row: Record<string, unknown>): RunLogRow {
  return {
    id: String(row.id),
    ...optional("kind", text(row.kind)), ...optional("status", text(row.status)),
    ...optional("startedAt", iso(row.started_at)), ...optional("finishedAt", iso(row.finished_at)),
    ...optional("summary", text(row.summary)), ...optional("details", text(row.details)),
  };
}

const SECTIONS: readonly SectionSpec<unknown>[] = [
  { key: "submissions", label: "production submissions", text: "select id, url, host, note, status, kind, slug, created_at, host_voters, host_total from opendesign_admin_read.submissions order by created_at desc, id desc limit $1", map: submission },
  { key: "discoveries", label: "production discoveries", text: "select id, url, host, slug, title, source, score, status, created_at from opendesign_admin_read.discoveries order by score desc, created_at desc, id desc limit $1", map: discovery },
  { key: "decisions", label: "production curation decisions", text: "select id, discovery_id, subject_id, candidate_title, candidate_url, recommendation, final_recommendation, confidence, reason, policy_version, model, decided_at, review_status, reviewed_by, reviewed_at, review_reason, signals, ai_holder_type, ai_holder_id, ai_statement, ai_as_of, ai_provenance, review_event_id, review_holder_type, review_holder_id, review_statement, review_as_of, review_recorded_at, review_provenance, supersedes_decision_id from opendesign_admin_read.curation_decisions order by decided_at desc, id desc limit $1", map: decision },
  { key: "quality", label: "production quality evidence", text: "select id, asset_id, title, summary, severity, status, url, created_at, evidence from opendesign_admin_read.quality_issues order by created_at desc, id desc limit $1", map: quality },
  { key: "origins", label: "production origin evidence", text: "select id, asset_id, title, summary, status, url, created_at, evidence from opendesign_admin_read.origin_issues order by created_at desc, id desc limit $1", map: origin },
  { key: "jobs", label: "production jobs", text: "select id, kind, slug, url, status, result, created_at, updated_at from opendesign_admin_read.jobs order by created_at desc, id desc limit $1", map: job },
  { key: "logs", label: "production logs", text: "select id, kind, status, started_at, finished_at, summary, details from opendesign_admin_read.run_logs order by started_at desc, id desc limit $1", map: log },
];

export class OperationsRepository {
  readonly #client: DatabaseClient;
  readonly #timeoutMs: number;
  readonly #limit: number;
  readonly #now: () => Date;

  constructor(client: DatabaseClient, options: RepositoryOptions = {}) {
    this.#client = client;
    this.#timeoutMs = Math.max(100, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 10_000));
    this.#limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
    this.#now = options.now ?? (() => new Date());
  }

  async #section<T>(spec: SectionSpec<T>, observedAt: string, diagnostics: OperationsDiagnostic[], signal?: AbortSignal): Promise<OperationsSection<T>> {
    try {
      const result = await this.#client.query<Record<string, unknown>>({
        text: spec.text,
        values: [this.#limit],
        timeoutMs: this.#timeoutMs,
        maxRows: this.#limit,
        ...(signal ? { signal } : {}),
      });
      if (result.rows.length > this.#limit) throw new Error("database adapter exceeded the hard row limit");
      return {
        source: { kind: "live", label: spec.label, observedAt },
        items: result.rows.map(spec.map),
      };
    } catch {
      diagnostics.push({
        code: `database-${String(spec.key)}-unavailable`,
        level: "warning",
        message: `${spec.label} could not be read.`,
      });
      return {
        source: { kind: "unavailable", label: spec.label, detail: "Read-only database query failed." },
        items: [],
      };
    }
  }

  async readOperations(signal?: AbortSignal): Promise<OperationsEnvelope> {
    const observedAt = this.#now().toISOString();
    const diagnostics: OperationsDiagnostic[] = [];
    const results = await Promise.all(SECTIONS.map((spec) => this.#section(spec, observedAt, diagnostics, signal)));
    const [submissions, discoveries, decisions, qualitySection, origins, jobs, logs] = results;
    const available = results.filter((section) => section.source.kind === "live").length;
    return {
      source: {
        kind: available ? "live" : "unavailable",
        label: "production operations evidence",
        observedAt,
        ...(available < results.length ? { detail: `${available}/${results.length} read-only sections available.` } : {}),
      },
      observedAt,
      diagnostics,
      submissions: submissions as OperationsSection<SubmissionRow>,
      discoveries: discoveries as OperationsSection<DiscoveryRow>,
      decisions: decisions as OperationsSection<CurationDecisionRow>,
      quality: qualitySection as OperationsSection<QualityRow>,
      origins: origins as OperationsSection<OriginRow>,
      jobs: jobs as OperationsSection<JobRow>,
      logs: logs as OperationsSection<RunLogRow>,
    };
  }

  async readDatabaseSyncEvidence(signal?: AbortSignal): Promise<DatabaseSyncEvidence> {
    const observedAt = this.#now().toISOString();
    try {
      const result = await this.#client.query<Record<string, unknown>>({
        text: "select revision, observed_at, detail from opendesign_admin_read.database_sync limit $1",
        values: [1], timeoutMs: this.#timeoutMs, maxRows: 1,
        ...(signal ? { signal } : {}),
      });
      const row = result.rows[0];
      if (!row) throw new Error("database sync view returned no evidence");
      return {
        location: "database", label: "Database", state: "healthy", drift: "unknown",
        ...optional("revision", text(row.revision)),
        observedAt: iso(row.observed_at) ?? observedAt,
        detail: text(row.detail) ?? "Read-only operational database evidence.", readOnly: true,
      };
    } catch {
      return {
        location: "database", label: "Database", state: "unknown", drift: "unknown",
        observedAt, detail: "Read-only database sync evidence is unavailable.", readOnly: true,
      };
    }
  }
}
