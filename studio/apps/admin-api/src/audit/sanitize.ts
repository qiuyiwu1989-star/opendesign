import type { AuditEvent, AuditEventInput } from "./types.js";

const SENSITIVE_WORDS = new Set([
  "cookie", "token", "secret", "password", "passphrase", "authorization",
  "oauth", "code", "sql", "query", "body",
]);
const SAFE_METADATA_KEYS = new Set(["method", "statusCode", "section", "reason", "sessionAgeSeconds"]);

function bounded(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function optionalBounded(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const result = bounded(value, max);
  return result || undefined;
}

function metadata(input?: Readonly<Record<string, unknown>>): AuditEvent["metadata"] {
  const output: Record<string, string | number | boolean | null> = {};
  if (!input) return output;
  for (const [key, value] of Object.entries(input).slice(0, 16)) {
    if (!SAFE_METADATA_KEYS.has(key) || (key !== "statusCode" && isSensitiveKey(key))) continue;
    if (value === null || typeof value === "boolean") output[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) output[key] = value;
    else if (typeof value === "string") output[key] = bounded(value, 200);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
  return words.some((word) => SENSITIVE_WORDS.has(word));
}

export function sanitizeAuditEvent(input: AuditEventInput): AuditEvent {
  const requestId = bounded(input.requestId, 128);
  const action = bounded(input.action, 80);
  const route = bounded(input.route.split("?", 1)[0] ?? "", 200);
  if (!requestId || !action || !route || Number.isNaN(Date.parse(input.occurredAt))) {
    throw new Error("invalid audit event identity");
  }
  return {
    requestId,
    occurredAt: new Date(input.occurredAt).toISOString(),
    ...optional("actorId", optionalBounded(input.actorId, 40)),
    action,
    outcome: input.outcome,
    route,
    latencyMs: Math.max(0, Math.min(Math.round(input.latencyMs), 600_000)),
    ...optional("sourceIpHash", optionalBounded(input.sourceIpHash, 128)),
    ...optional("userAgentHash", optionalBounded(input.userAgentHash, 128)),
    metadata: metadata(input.metadata),
  };
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return value === undefined ? {} : { [key]: value } as { [P in K]?: V };
}
