import type {
  DataSourceDescriptor,
  PipelineCheckpoint,
  PipelineRun,
  PipelineRunStatus,
  ReviewCase,
  ReviewPriority,
  ReviewStatus,
  SnapshotDiagnostic,
} from "../../domain";
import type {
  OperationsEnvelope,
  OperationsSection,
  OperationsSnapshot,
  RawDiscovery,
  RawJob,
  RawOriginIssue,
  RawQualityIssue,
  RawRunLog,
  RawSubmission,
} from "./types";

const reviewStatus = (status?: string): ReviewStatus => {
  if (["accepted", "approved", "published", "resolved", "done"].includes(status ?? "")) return "resolved";
  if (["rejected", "ignored", "dismissed"].includes(status ?? "")) return "dismissed";
  return "pending";
};

const priority = (severity?: string, fallback: ReviewPriority = "medium"): ReviewPriority => {
  if (severity === "critical" || severity === "error") return "critical";
  if (severity === "high" || severity === "warning") return "high";
  if (severity === "low" || severity === "info") return "low";
  return fallback;
};

function submission(row: RawSubmission): ReviewCase {
  const votes = row.hostVoters ?? row.hostTotal ?? 0;
  return {
    id: `submission:${row.id}`,
    source: "submission",
    status: reviewStatus(row.status),
    priority: votes >= 3 ? "high" : row.kind === "pack" ? "low" : "medium",
    title: row.kind === "pack" ? `${row.slug ?? row.host ?? "资源"} 的完整包请求` : `${row.host ?? row.url ?? "新资源"} 的收录请求`,
    summary: row.note ?? (votes ? `${votes} 个关联请求信号。` : "等待编辑判断的用户投稿。"),
    ...(row.slug ? { assetId: row.slug } : {}),
    ...(row.url ? { url: row.url } : {}),
    ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    evidence: [`kind=${row.kind ?? "collect"}`, `status=${row.status ?? "pending"}`, ...(votes ? [`host_voters=${votes}`] : [])],
    previewOnly: true,
  };
}

function discovery(row: RawDiscovery): ReviewCase {
  const score = row.score ?? 0;
  return {
    id: `discovery:${row.id}`,
    source: "discovery",
    status: reviewStatus(row.status),
    priority: score >= 100 ? "high" : score >= 20 ? "medium" : "low",
    title: row.title ?? row.host ?? row.slug ?? "自动发现候选",
    summary: `来自 ${row.source ?? "未知来源"} 的候选资源${score ? `，信号分 ${score}` : ""}。`,
    ...(row.slug ? { assetId: row.slug } : {}),
    ...(row.url ? { url: row.url } : {}),
    ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    evidence: [`source=${row.source ?? "unknown"}`, `score=${score}`, `status=${row.status ?? "pending"}`],
    previewOnly: true,
  };
}

function quality(row: RawQualityIssue): ReviewCase {
  return {
    id: `quality:${row.id}`,
    source: "quality",
    status: reviewStatus(row.status),
    priority: priority(row.severity),
    title: row.title ?? `${row.assetId ?? "资源"} 的质量问题`,
    summary: row.summary ?? "质量检查发现需要人工判断的问题。",
    ...(row.assetId ? { assetId: row.assetId } : {}),
    ...(row.url ? { url: row.url } : {}),
    ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    ...(row.quality ? { quality: row.quality } : {}),
    evidence: row.evidence.length ? row.evidence : [`severity=${row.severity ?? "unknown"}`],
    previewOnly: true,
  };
}

function origin(row: RawOriginIssue): ReviewCase {
  const unavailable = row.quality?.origin === "unavailable" || ["unavailable", "broken"].includes(row.status ?? "");
  return {
    id: `origin:${row.id}`,
    source: "origin",
    status: reviewStatus(row.status),
    priority: unavailable ? "critical" : "high",
    title: row.title ?? `${row.assetId ?? "资源"} 的来源状态异常`,
    summary: row.summary ?? "来源状态发生变化，需要核对原站与公开页。",
    ...(row.assetId ? { assetId: row.assetId } : {}),
    ...(row.url ? { url: row.url } : {}),
    ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    ...(row.quality ? { quality: row.quality } : {}),
    evidence: row.evidence.length ? row.evidence : [`origin_status=${row.status ?? "unknown"}`],
    previewOnly: true,
  };
}

function pipelineStatus(status?: string): PipelineRunStatus {
  if (status === "pending") return "queued";
  if (status === "running") return "running";
  if (status === "done" || status === "completed") return "completed";
  if (status === "failed" || status === "error") return "failed";
  if (status === "cancelled") return "cancelled";
  return "unknown";
}

function jobCheckpoints(row: RawJob): PipelineCheckpoint[] {
  const status = pipelineStatus(row.status);
  const queue: PipelineCheckpoint = { id: "queued", label: "Queued", status: status === "queued" ? "running" : "completed", ...(row.createdAt ? { startedAt: row.createdAt } : {}) };
  const execute: PipelineCheckpoint = {
    id: "execute",
    label: "Execute",
    status: status === "queued" ? "pending" : status === "running" ? "running" : status === "completed" ? "completed" : status === "failed" ? "failed" : "unknown",
    ...(status !== "queued" && row.createdAt ? { startedAt: row.createdAt } : {}),
    ...(status === "completed" || status === "failed" ? row.updatedAt ? { finishedAt: row.updatedAt } : {} : {}),
    ...(row.result ? { detail: row.result } : {}),
  };
  const record: PipelineCheckpoint = {
    id: "record",
    label: "Record result",
    status: status === "completed" ? "completed" : status === "failed" ? "skipped" : "pending",
    ...(status === "completed" && row.updatedAt ? { finishedAt: row.updatedAt } : {}),
  };
  return [queue, execute, record];
}

function job(row: RawJob): PipelineRun {
  const status = pipelineStatus(row.status);
  return {
    id: `job:${row.id}`,
    kind: row.kind ?? "unknown",
    label: `${row.kind ?? "Job"}${row.slug ? ` · ${row.slug}` : ""}`,
    status,
    ...(row.createdAt ? { createdAt: row.createdAt } : {}),
    ...(status !== "queued" && row.createdAt ? { startedAt: row.createdAt } : {}),
    ...(status === "completed" || status === "failed" ? row.updatedAt ? { finishedAt: row.updatedAt } : {} : {}),
    ...(row.result ? { summary: row.result } : {}),
    checkpoints: jobCheckpoints(row),
    ...(status === "failed" ? { retryFromCheckpointId: "execute" } : {}),
    previewOnly: true,
  };
}

function log(row: RawRunLog): PipelineRun {
  const status = pipelineStatus(row.status);
  const runStatus = row.status === "skipped" ? "cancelled" : status;
  const executeStatus = runStatus === "completed" ? "completed" : runStatus === "failed" ? "failed" : runStatus === "cancelled" ? "skipped" : "unknown";
  return {
    id: `log:${row.id}`,
    kind: row.kind ?? "cron",
    label: `${row.kind ?? "Automation"} run`,
    status: runStatus,
    ...(row.startedAt ? { createdAt: row.startedAt, startedAt: row.startedAt } : {}),
    ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
    checkpoints: [
      { id: "started", label: "Started", status: "completed", ...(row.startedAt ? { startedAt: row.startedAt, finishedAt: row.startedAt } : {}) },
      { id: "execute", label: "Execute", status: executeStatus, ...(row.startedAt ? { startedAt: row.startedAt } : {}), ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}), ...(row.details ? { detail: row.details } : {}) },
      { id: "recorded", label: "Recorded", status: "completed", ...(row.finishedAt ? { finishedAt: row.finishedAt } : {}) },
    ],
    ...(runStatus === "failed" ? { retryFromCheckpointId: "execute" } : {}),
    previewOnly: true,
  };
}

function descriptor(sections: OperationsSection<unknown>[], label: string, diagnostics: SnapshotDiagnostic[]): DataSourceDescriptor {
  const available = sections.filter((section) => section.source.kind !== "unavailable");
  const kind = sections.some((section) => section.source.kind === "live") ? "live" : available.length ? "snapshot" : "unavailable";
  const unavailableCount = sections.length - available.length;
  if (unavailableCount) diagnostics.push({ code: `${label.toLowerCase().replace(/\s+/g, "-")}-partial`, level: "warning", message: `${unavailableCount}/${sections.length} ${label} sections unavailable.` });
  const observedAt = sections.map((section) => section.source.observedAt).filter((value): value is string => Boolean(value)).sort().at(-1);
  return { kind, label, ...(observedAt ? { generatedAt: observedAt } : {}), ...(unavailableCount ? { detail: "Partial read-only evidence; inspect diagnostics." } : {}) };
}

/** Converts validated RPC-shaped rows into the Phase 1 UI domain. */
export function adaptOperationsEnvelope(envelope: OperationsEnvelope): OperationsSnapshot {
  const diagnostics = [...envelope.diagnostics];
  const reviews = [
    ...envelope.submissions.items.map(submission),
    ...envelope.discoveries.items.map(discovery),
    ...envelope.quality.items.map(quality),
    ...envelope.origins.items.map(origin),
  ];
  const pipelines = [...envelope.jobs.items.map(job), ...envelope.logs.items.map(log)]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || a.id.localeCompare(b.id));
  return {
    reviews,
    pipelines,
    reviewSource: descriptor([envelope.submissions, envelope.discoveries, envelope.quality, envelope.origins], "Operations reviews", diagnostics),
    pipelineSource: descriptor([envelope.jobs, envelope.logs], "Operations pipelines", diagnostics),
    diagnostics,
    observedAt: envelope.observedAt,
  };
}
