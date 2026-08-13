import { randomBytes } from "node:crypto";
import { signToken, verifyToken } from "./signed-token.js";

export interface AdminSessionPayload {
  issuedAt: number;
  expiresAt: number;
  sessionId: string;
  actorId: string;
  version: 1;
}

const PURPOSE = "opendesign-admin-session-v1";
export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1_000;

export function createAdminSession(
  actorId: string,
  secret: string | Buffer,
  now = Date.now(),
  ttlMs = DEFAULT_SESSION_TTL_MS,
): { token: string; payload: AdminSessionPayload } {
  if (!/^[1-9][0-9]{0,19}$/.test(actorId)) throw new Error("Actor id must be an immutable numeric GitHub id");
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 60_000 || ttlMs > 86_400_000) throw new Error("Invalid session TTL");
  const payload: AdminSessionPayload = {
    issuedAt: now,
    expiresAt: now + ttlMs,
    sessionId: randomBytes(24).toString("base64url"),
    actorId,
    version: 1,
  };
  return { token: signToken(payload, secret, PURPOSE), payload };
}

export function verifyAdminSession(token: string, secret: string | Buffer, now = Date.now()): AdminSessionPayload | undefined {
  const payload = verifyToken<AdminSessionPayload>(token, secret, PURPOSE, now);
  if (!payload || payload.version !== 1 || !/^[1-9][0-9]{0,19}$/.test(payload.actorId) || !/^[A-Za-z0-9_-]{32}$/.test(payload.sessionId)) {
    return undefined;
  }
  return payload;
}

export interface SessionInvalidationStore {
  invalidate(sessionId: string, expiresAt: number): Promise<void>;
  isInvalidated(sessionId: string): Promise<boolean>;
}

export async function verifyActiveAdminSession(
  token: string,
  secret: string | Buffer,
  store: SessionInvalidationStore,
  now = Date.now(),
): Promise<AdminSessionPayload | undefined> {
  const payload = verifyAdminSession(token, secret, now);
  if (!payload || await store.isInvalidated(payload.sessionId)) return undefined;
  return payload;
}
