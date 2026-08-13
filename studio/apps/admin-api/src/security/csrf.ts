import { randomBytes } from "node:crypto";
import { signToken, verifyToken } from "./signed-token.js";

export interface OAuthStatePayload {
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  returnTo: string;
}

export interface OAuthStateStore {
  put(nonce: string, expiresAt: number): Promise<void>;
  consume(nonce: string): Promise<boolean>;
}

const PURPOSE = "opendesign-github-oauth-state-v1";
export const OAUTH_STATE_TTL_MS = 5 * 60 * 1_000;

export function validateReturnPath(returnTo: string): string {
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("\\") || /[\r\n]/.test(returnTo)) {
    throw new Error("OAuth return path must be same-origin");
  }
  const parsed = new URL(returnTo, "https://same-origin.invalid");
  if (parsed.origin !== "https://same-origin.invalid" || !parsed.pathname.startsWith("/admin")) {
    throw new Error("OAuth return path must stay within /admin");
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export async function createOAuthState(
  returnTo: string,
  secret: string | Buffer,
  store: OAuthStateStore,
  now = Date.now(),
): Promise<string> {
  const payload: OAuthStatePayload = {
    issuedAt: now,
    expiresAt: now + OAUTH_STATE_TTL_MS,
    nonce: randomBytes(24).toString("base64url"),
    returnTo: validateReturnPath(returnTo),
  };
  await store.put(payload.nonce, payload.expiresAt);
  return signToken(payload, secret, PURPOSE);
}

export async function consumeOAuthState(
  token: string,
  secret: string | Buffer,
  store: OAuthStateStore,
  now = Date.now(),
): Promise<OAuthStatePayload | undefined> {
  const payload = verifyToken<OAuthStatePayload>(token, secret, PURPOSE, now);
  if (!payload || !/^[A-Za-z0-9_-]{32}$/.test(payload.nonce)) return undefined;
  try {
    payload.returnTo = validateReturnPath(payload.returnTo);
  } catch {
    return undefined;
  }
  return await store.consume(payload.nonce) ? payload : undefined;
}

export interface RequestOriginEvidence {
  origin?: string | undefined;
  secFetchSite?: string | undefined;
}

export function isSameOriginMutation(evidence: RequestOriginEvidence, expectedOrigin: string): boolean {
  if (evidence.secFetchSite && evidence.secFetchSite !== "same-origin") return false;
  if (!evidence.origin) return false;
  try {
    return new URL(evidence.origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}
