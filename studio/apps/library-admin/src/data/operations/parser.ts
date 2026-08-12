import type { QualityAxes, SnapshotDiagnostic } from "../../domain";
import type {
  OperationsEnvelope,
  OperationsSection,
  OperationsSource,
  RawDiscovery,
  RawJob,
  RawOriginIssue,
  RawQualityIssue,
  RawRunLog,
  RawSubmission,
} from "./types";

export class OperationsValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid operations response: ${issues.join("; ")}`);
    this.name = "OperationsValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const string = (value: unknown) => typeof value === "string" && value.trim() ? value : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const pick = (record: Record<string, unknown>, camel: string, snake: string) => record[camel] ?? record[snake];

function source(value: unknown, path: string): OperationsSource {
  if (!isRecord(value)) throw new OperationsValidationError([`${path} must be an object`]);
  const kind = value.kind;
  const label = string(value.label);
  if ((kind !== "live" && kind !== "snapshot" && kind !== "unavailable") || !label) {
    throw new OperationsValidationError([`${path} requires kind live|snapshot|unavailable and label`]);
  }
  const observedAt = string(pick(value, "observedAt", "observed_at"));
  const detail = string(value.detail);
  return { kind, label, ...(observedAt ? { observedAt } : {}), ...(detail ? { detail } : {}) };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function qualityAxes(value: unknown): QualityAxes | undefined {
  if (!isRecord(value)) return undefined;
  const evidence = value.evidence;
  const curation = value.curation;
  const origin = value.origin;
  if (!["E0", "E1", "E2", "E3"].includes(String(evidence))
    || !["unreviewed", "accepted", "recommended"].includes(String(curation))
    || !["alive", "changed", "degraded", "unavailable"].includes(String(origin))) return undefined;
  return { evidence, curation, origin } as QualityAxes;
}

function base(value: unknown, path: string): Record<string, unknown> & { id: string } {
  if (!isRecord(value) || !string(value.id)) throw new OperationsValidationError([`${path} requires a non-empty id`]);
  return value as Record<string, unknown> & { id: string };
}

function parseSubmission(value: unknown, path: string): RawSubmission {
  const row = base(value, path);
  const createdAt = string(pick(row, "createdAt", "created_at"));
  const hostVoters = number(pick(row, "hostVoters", "host_voters"));
  const hostTotal = number(pick(row, "hostTotal", "host_total"));
  return { id: row.id, ...optionalStrings(row, ["url", "host", "note", "status", "kind", "slug"]), ...(createdAt ? { createdAt } : {}), ...(hostVoters !== undefined ? { hostVoters } : {}), ...(hostTotal !== undefined ? { hostTotal } : {}) };
}

function optionalStrings(row: Record<string, unknown>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap((key) => { const value = string(row[key]); return value ? [[key, value]] : []; }));
}

function parseDiscovery(value: unknown, path: string): RawDiscovery {
  const row = base(value, path);
  const createdAt = string(pick(row, "createdAt", "created_at"));
  const score = number(row.score);
  return { id: row.id, ...optionalStrings(row, ["url", "host", "slug", "title", "source", "status"]), ...(score !== undefined ? { score } : {}), ...(createdAt ? { createdAt } : {}) };
}

function parseIssue(value: unknown, path: string): RawQualityIssue {
  const row = base(value, path);
  const assetId = string(pick(row, "assetId", "asset_id"));
  const createdAt = string(pick(row, "createdAt", "created_at"));
  const quality = qualityAxes(row.quality);
  return { id: row.id, ...optionalStrings(row, ["title", "summary", "severity", "status", "url"]), ...(assetId ? { assetId } : {}), ...(createdAt ? { createdAt } : {}), evidence: strings(row.evidence), ...(quality ? { quality } : {}) };
}

function parseOrigin(value: unknown, path: string): RawOriginIssue {
  const issue = parseIssue(value, path);
  const { severity: _severity, ...origin } = issue;
  return origin;
}

function parseJob(value: unknown, path: string): RawJob {
  const row = base(value, path);
  const createdAt = string(pick(row, "createdAt", "created_at"));
  const updatedAt = string(pick(row, "updatedAt", "updated_at"));
  return { id: row.id, ...optionalStrings(row, ["kind", "slug", "url", "status", "result"]), ...(createdAt ? { createdAt } : {}), ...(updatedAt ? { updatedAt } : {}) };
}

function parseLog(value: unknown, path: string): RawRunLog {
  const row = base(value, path);
  const startedAt = string(pick(row, "startedAt", "started_at"));
  const finishedAt = string(pick(row, "finishedAt", "finished_at"));
  return { id: row.id, ...optionalStrings(row, ["kind", "status", "summary", "details"]), ...(startedAt ? { startedAt } : {}), ...(finishedAt ? { finishedAt } : {}) };
}

type ItemParser<T> = (value: unknown, path: string) => T;
function section<T>(root: Record<string, unknown>, key: string, parse: ItemParser<T>, diagnostics: SnapshotDiagnostic[]): OperationsSection<T> {
  try {
    const value = root[key];
    if (!isRecord(value)) throw new OperationsValidationError([`${key} must be an object`]);
    const sectionSource = source(value.source, `${key}.source`);
    if (!Array.isArray(value.items)) throw new OperationsValidationError([`${key}.items must be an array`]);
    const items = value.items.map((item, index) => parse(item, `${key}.items[${index}]`));
    return { source: sectionSource, items };
  } catch (error) {
    diagnostics.push({ code: `operations-${key}-invalid`, level: "warning", message: error instanceof Error ? error.message : `${key} is invalid` });
    return { source: { kind: "unavailable", label: key, detail: "Invalid or missing section" }, items: [] };
  }
}

function diagnostic(value: unknown, index: number): SnapshotDiagnostic {
  if (!isRecord(value)) throw new OperationsValidationError([`diagnostics[${index}] must be an object`]);
  const code = string(value.code);
  const message = string(value.message);
  const level = value.level;
  if (!code || !message || (level !== "info" && level !== "warning" && level !== "error")) {
    throw new OperationsValidationError([`diagnostics[${index}] is invalid`]);
  }
  return { code, level, message };
}

/** Strict at the envelope boundary; malformed sections degrade independently. */
export function parseOperationsEnvelope(input: unknown): OperationsEnvelope {
  if (!isRecord(input)) throw new OperationsValidationError(["root must be an object"]);
  const rootSource = source(input.source, "source");
  const observedAt = string(pick(input, "observedAt", "observed_at"));
  if (!observedAt) throw new OperationsValidationError(["observedAt is required"]);
  if (!Array.isArray(input.diagnostics)) throw new OperationsValidationError(["diagnostics must be an array"]);
  const diagnostics = input.diagnostics.map(diagnostic);
  return {
    source: rootSource,
    observedAt,
    diagnostics,
    submissions: section(input, "submissions", parseSubmission, diagnostics),
    discoveries: section(input, "discoveries", parseDiscovery, diagnostics),
    quality: section(input, "quality", parseIssue, diagnostics),
    origins: section(input, "origins", parseOrigin, diagnostics),
    jobs: section(input, "jobs", parseJob, diagnostics),
    logs: section(input, "logs", parseLog, diagnostics),
  };
}
