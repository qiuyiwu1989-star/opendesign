import { createHmac } from "node:crypto";

const DENIED_KEY = /(authorization|cookie|oauth|code|token|secret|password|sql|query|response|body)/i;
const SENSITIVE_VALUE = /(bearer\s+[A-Za-z0-9._~-]+|gh[oprsu]_[A-Za-z0-9]+|postgres(?:ql)?:\/\/[^\s]+)/i;

export function hashAuditIdentifier(value: string, auditKey: string | Buffer, namespace: "ip" | "user-agent"): string {
  if (!value || value.length > 4_096) return `${namespace}:redacted`;
  const key = Buffer.from(auditKey);
  if (key.byteLength < 32) throw new Error("Audit hash key must be at least 32 bytes");
  const digest = createHmac("sha256", key).update(`${namespace}\0${value}`).digest("hex").slice(0, 24);
  return `${namespace}:${digest}`;
}

function safeValue(value: unknown, depth: number): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return SENSITIVE_VALUE.test(value) ? "[REDACTED]" : value.slice(0, 512);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => safeValue(item, depth + 1));
  if (typeof value === "object" && value) {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).slice(0, 40)) {
      output[key] = DENIED_KEY.test(key) ? "[REDACTED]" : safeValue(nested, depth + 1);
    }
    return output;
  }
  return String(value).slice(0, 128);
}

export function sanitizeLogMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return safeValue(metadata, 0) as Record<string, unknown>;
}

export function clientAddress(peerAddress: string | undefined, forwardedFor: string | undefined, trustLoopbackProxy: boolean): string {
  if (!trustLoopbackProxy || (peerAddress !== "127.0.0.1" && peerAddress !== "::1" && peerAddress !== "::ffff:127.0.0.1")) {
    return peerAddress ?? "unknown";
  }
  const first = forwardedFor?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : peerAddress ?? "unknown";
}
