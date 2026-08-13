import type {
  DataSourceDescriptor,
  SignalState,
  SnapshotDiagnostic,
  SyncDrift,
  SyncLocation,
} from "../../domain";
import {
  SyncResponseValidationError,
  type ReadOnlySyncNode,
  type ReadOnlySyncSnapshot,
  type SyncApiResponse,
} from "./types";

const SOURCE_KINDS = new Set(["live", "snapshot", "unavailable"]);
const SIGNAL_STATES = new Set<SignalState>(["healthy", "attention", "blocked", "unknown"]);
const SYNC_DRIFTS = new Set<SyncDrift>(["in-sync", "ahead", "behind", "diverged", "unknown"]);
const SYNC_LOCATIONS: readonly SyncLocation[] = ["database", "local", "git", "github", "public"];
const DIAGNOSTIC_LEVELS = new Set(["info", "warning", "error"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  path: string,
  issues: string[],
): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${path} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function optionalString(value: unknown, path: string, issues: string[]): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path, issues);
}

function timestamp(value: unknown, path: string, issues: string[]): string | undefined {
  const parsed = requiredString(value, path, issues);
  if (parsed && Number.isNaN(Date.parse(parsed))) {
    issues.push(`${path} must be an ISO-compatible timestamp`);
    return undefined;
  }
  return parsed;
}

function parseSource(value: unknown, issues: string[]): DataSourceDescriptor | undefined {
  if (!isRecord(value)) {
    issues.push("source must be an object");
    return undefined;
  }
  const kind = requiredString(value.kind, "source.kind", issues);
  const label = requiredString(value.label, "source.label", issues);
  const generatedAt = value.generatedAt === undefined
    ? undefined
    : timestamp(value.generatedAt, "source.generatedAt", issues);
  const detail = optionalString(value.detail, "source.detail", issues);
  if (kind && !SOURCE_KINDS.has(kind)) issues.push("source.kind has an unsupported value");
  if (!kind || !label || !SOURCE_KINDS.has(kind)) return undefined;
  return {
    kind: kind as DataSourceDescriptor["kind"],
    label,
    ...(generatedAt ? { generatedAt } : {}),
    ...(detail ? { detail } : {}),
  };
}

function parseDiagnostics(value: unknown, issues: string[]): SnapshotDiagnostic[] | undefined {
  if (!Array.isArray(value)) {
    issues.push("diagnostics must be an array");
    return undefined;
  }
  const diagnostics: SnapshotDiagnostic[] = [];
  value.forEach((item, index) => {
    const path = `diagnostics[${index}]`;
    if (!isRecord(item)) {
      issues.push(`${path} must be an object`);
      return;
    }
    const code = requiredString(item.code, `${path}.code`, issues);
    const level = requiredString(item.level, `${path}.level`, issues);
    const message = requiredString(item.message, `${path}.message`, issues);
    if (level && !DIAGNOSTIC_LEVELS.has(level)) issues.push(`${path}.level has an unsupported value`);
    if (code && level && message && DIAGNOSTIC_LEVELS.has(level)) {
      diagnostics.push({ code, level: level as SnapshotDiagnostic["level"], message });
    }
  });
  return diagnostics;
}

function parseNode(value: unknown, index: number, issues: string[]): ReadOnlySyncNode | undefined {
  const path = `sync.nodes[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  const location = requiredString(value.location, `${path}.location`, issues);
  const label = requiredString(value.label, `${path}.label`, issues);
  const state = requiredString(value.state, `${path}.state`, issues);
  const drift = requiredString(value.drift, `${path}.drift`, issues);
  const observedAt = timestamp(value.observedAt, `${path}.observedAt`, issues);
  const revision = optionalString(value.revision, `${path}.revision`, issues);
  const detail = optionalString(value.detail, `${path}.detail`, issues);
  if (value.readOnly !== true) issues.push(`${path}.readOnly must be true`);
  if (location && !SYNC_LOCATIONS.includes(location as SyncLocation)) {
    issues.push(`${path}.location has an unsupported value`);
  }
  if (state && !SIGNAL_STATES.has(state as SignalState)) issues.push(`${path}.state has an unsupported value`);
  if (drift && !SYNC_DRIFTS.has(drift as SyncDrift)) issues.push(`${path}.drift has an unsupported value`);
  if (
    !location || !label || !state || !drift || !observedAt
    || !SYNC_LOCATIONS.includes(location as SyncLocation)
    || !SIGNAL_STATES.has(state as SignalState)
    || !SYNC_DRIFTS.has(drift as SyncDrift)
    || value.readOnly !== true
  ) return undefined;
  return {
    location: location as SyncLocation,
    label,
    state: state as SignalState,
    drift: drift as SyncDrift,
    ...(revision ? { revision } : {}),
    observedAt,
    ...(detail ? { detail } : {}),
    readOnly: true,
  };
}

function parseSync(value: unknown, issues: string[]): ReadOnlySyncSnapshot | undefined {
  if (!isRecord(value)) {
    issues.push("sync must be an object");
    return undefined;
  }
  const state = requiredString(value.state, "sync.state", issues);
  const summary = requiredString(value.summary, "sync.summary", issues);
  const branch = optionalString(value.branch, "sync.branch", issues);
  const localRevision = optionalString(value.localRevision, "sync.localRevision", issues);
  if (value.readOnly !== true) issues.push("sync.readOnly must be true");
  if (state && !SIGNAL_STATES.has(state as SignalState)) issues.push("sync.state has an unsupported value");
  if (!Array.isArray(value.nodes)) {
    issues.push("sync.nodes must be an array");
    return undefined;
  }
  const nodes = value.nodes.flatMap((item, index) => {
    const node = parseNode(item, index, issues);
    return node ? [node] : [];
  });
  const locations = nodes.map((node) => node.location);
  for (const location of SYNC_LOCATIONS) {
    const count = locations.filter((candidate) => candidate === location).length;
    if (count !== 1) issues.push(`sync.nodes must contain exactly one ${location} node`);
  }
  if (nodes.length !== SYNC_LOCATIONS.length) issues.push("sync.nodes must contain exactly five nodes");
  if (!state || !summary || !SIGNAL_STATES.has(state as SignalState) || value.readOnly !== true) {
    return undefined;
  }
  return {
    state: state as SignalState,
    summary,
    ...(branch ? { branch } : {}),
    ...(localRevision ? { localRevision } : {}),
    nodes,
    readOnly: true,
  };
}

export function parseSyncApiResponse(input: unknown): SyncApiResponse {
  const issues: string[] = [];
  if (!isRecord(input)) throw new SyncResponseValidationError(["root must be an object"]);
  const source = parseSource(input.source, issues);
  const observedAt = timestamp(input.observedAt, "observedAt", issues);
  const diagnostics = parseDiagnostics(input.diagnostics, issues);
  const sync = parseSync(input.sync, issues);
  if (issues.length || !source || !observedAt || !diagnostics || !sync) {
    throw new SyncResponseValidationError(issues.slice(0, 40));
  }
  return { source, observedAt, diagnostics, sync };
}
