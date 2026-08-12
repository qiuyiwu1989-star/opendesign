import { randomBytes as nodeRandomBytes } from "node:crypto";
import type { GitHubActor } from "./github.js";
import { createSignedTokenCodec, type SignedTokenCodec } from "./signed-token.js";

export const SESSION_COOKIE_NAME = "__Host-opendesign_admin";

export interface SessionClaims extends GitHubActor {
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface SessionManager {
  create(actor: GitHubActor): { token: string; claims: SessionClaims };
  verify(token: string | undefined): SessionClaims | undefined;
  invalidate(token: string | undefined): void;
}

export function createSessionManager(input: {
  secret: string;
  ttlSeconds: number;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}): SessionManager {
  const codec = createSignedTokenCodec(input.secret, "admin-session");
  const sessions = new Map<string, SessionClaims>();
  const now = input.now ?? Date.now;
  const randomBytes = input.randomBytes ?? nodeRandomBytes;

  const sessionIdFrom = (token: string | undefined): string | undefined => {
    if (!token || token.length > 512) return undefined;
    return codec.verify(token);
  };
  const prune = () => {
    const timestamp = now();
    for (const [id, claims] of sessions) if (claims.expiresAt <= timestamp) sessions.delete(id);
  };
  return {
    create(actor) {
      prune();
      const sessionId = randomBytes(32).toString("base64url");
      const issuedAt = now();
      const claims: SessionClaims = { ...actor, sessionId, issuedAt, expiresAt: issuedAt + input.ttlSeconds * 1_000 };
      sessions.set(sessionId, claims);
      return { token: codec.sign(sessionId), claims };
    },
    verify(token) {
      const sessionId = sessionIdFrom(token);
      if (!sessionId) return undefined;
      const claims = sessions.get(sessionId);
      if (!claims) return undefined;
      if (claims.expiresAt <= now()) {
        sessions.delete(sessionId);
        return undefined;
      }
      return { ...claims };
    },
    invalidate(token) {
      const sessionId = sessionIdFrom(token);
      if (sessionId) sessions.delete(sessionId);
    },
  };
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader || cookieHeader.length > 8192) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE_NAME) return part.slice(separator + 1).trim();
  }
  return undefined;
}

export interface OAuthStateClaims {
  returnPath: string;
  issuedAt: number;
  expiresAt: number;
}

export interface OAuthStateManager {
  create(returnPath: string): string;
  consume(token: string): OAuthStateClaims | undefined;
}

export function createOAuthStateManager(input: {
  secret: string;
  ttlSeconds: number;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}): OAuthStateManager {
  const codec: SignedTokenCodec = createSignedTokenCodec(input.secret, "github-oauth-state");
  const records = new Map<string, OAuthStateClaims>();
  const now = input.now ?? Date.now;
  const randomBytes = input.randomBytes ?? nodeRandomBytes;
  return {
    create(returnPath) {
      const nonce = randomBytes(32).toString("base64url");
      const issuedAt = now();
      records.set(nonce, { returnPath, issuedAt, expiresAt: issuedAt + input.ttlSeconds * 1_000 });
      return codec.sign(nonce);
    },
    consume(token) {
      if (!token || token.length > 512) return undefined;
      const nonce = codec.verify(token);
      if (!nonce) return undefined;
      const claims = records.get(nonce);
      records.delete(nonce);
      if (!claims || claims.expiresAt <= now()) return undefined;
      return { ...claims };
    },
  };
}
