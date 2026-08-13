import { createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from "node:crypto";

export const PUBLIC_SESSION_COOKIE_NAME = "opendesign_studio_session";

const SESSION_SCOPE_PATTERN = /^scope_[a-f0-9]{64}$/;
const SESSION_ID_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1_000;

declare const sessionScopeBrand: unique symbol;
export type SessionScope = string & { readonly [sessionScopeBrand]: true };

export type PublicSessionClock = { now(): Date };
export type PublicSessionRandom = { bytes(size: number): Uint8Array };

export type PublicSessionPolicy = {
  idleTtlMs: number;
  maximumLifetimeMs: number;
  renewalWindowMs: number;
};

export const DEFAULT_PUBLIC_SESSION_POLICY: Readonly<PublicSessionPolicy> = Object.freeze({
  idleTtlMs: 7 * DAY_MS,
  maximumLifetimeMs: 30 * DAY_MS,
  renewalWindowMs: DAY_MS,
});

export type PublicSessionQuota = {
  projects: number;
  revisions: number;
  assetBytes: number;
  exports: number;
  runningJobs: number;
};

export const DEFAULT_PUBLIC_SESSION_QUOTA: Readonly<PublicSessionQuota> = Object.freeze({
  projects: 20,
  revisions: 100,
  assetBytes: 100 * 1024 * 1024,
  exports: 20,
  runningJobs: 2,
});

export type PublicSessionQuotaUsage = PublicSessionQuota;
export type PublicSessionQuotaDelta = Partial<PublicSessionQuota>;
export type PublicSessionQuotaResource = keyof PublicSessionQuota;

export class PublicSessionQuotaError extends Error {
  readonly code = "session_quota_exceeded";

  constructor(
    readonly resource: PublicSessionQuotaResource,
    readonly limit: number,
    readonly current: number,
    readonly requested: number,
  ) {
    super(`Anonymous session ${resource} quota exceeded`);
    this.name = "PublicSessionQuotaError";
  }
}

export function assertPublicSessionQuota(
  usage: PublicSessionQuotaUsage,
  delta: PublicSessionQuotaDelta,
  limits: PublicSessionQuota = DEFAULT_PUBLIC_SESSION_QUOTA,
): void {
  for (const resource of Object.keys(limits) as PublicSessionQuotaResource[]) {
    const requested = delta[resource] ?? 0;
    if (!Number.isSafeInteger(requested) || requested < 0) throw new Error(`Invalid quota delta for ${resource}`);
    if (usage[resource] + requested > limits[resource]) {
      throw new PublicSessionQuotaError(resource, limits[resource], usage[resource], requested);
    }
  }
}

export type PublicSessionIdentity = {
  scope: SessionScope;
  createdAt: string;
  issuedAt: string;
  expiresAt: string;
  maximumExpiresAt: string;
};

export type PublicSessionRecord = Omit<PublicSessionIdentity, "issuedAt"> & {
  version: 1;
  lastSeenAt: string;
};

export type PublicSessionResolution = {
  identity: PublicSessionIdentity;
  /** Present for a new, invalid, or renewable session. Safe only as an HTTP response header. */
  setCookie?: string;
};

type EncodedSession = {
  v: 1;
  id: string;
  c: number;
  i: number;
  e: number;
  m: number;
};

export type PublicSessionCodecOptions = {
  secret: string | Uint8Array;
  clock?: PublicSessionClock;
  random?: PublicSessionRandom;
  policy?: PublicSessionPolicy;
  cookieName?: string;
};

function unixMilliseconds(date: Date): number {
  const value = date.getTime();
  if (!Number.isSafeInteger(value)) throw new Error("Session clock returned an invalid date");
  return value;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function secretBytes(secret: string | Uint8Array): Buffer {
  const result = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret);
  if (result.byteLength < 32) throw new Error("Public session signing secret must be at least 32 bytes");
  return result;
}

function validatePolicy(policy: PublicSessionPolicy): PublicSessionPolicy {
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid public session policy: ${key}`);
  }
  if (policy.idleTtlMs > policy.maximumLifetimeMs) throw new Error("Session idle TTL exceeds maximum lifetime");
  return { ...policy };
}

export function parseSessionScope(value: string): SessionScope {
  if (!SESSION_SCOPE_PATTERN.test(value)) throw new Error("Invalid session scope");
  return value as SessionScope;
}

export function hashPublicSessionScope(sessionId: string, secret: string | Uint8Array): SessionScope {
  if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) throw new Error("Invalid anonymous session identifier");
  const digest = createHmac("sha256", secretBytes(secret)).update("opendesign-public-scope\0").update(sessionId).digest("hex");
  return parseSessionScope(`scope_${digest}`);
}

export function serializePublicSessionCookie(name: string, token: string, maxAgeSeconds: number): string {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error("Invalid public session cookie name");
  if (!/^[A-Za-z0-9._-]+$/.test(token)) throw new Error("Invalid public session cookie value");
  const boundedMaxAge = Math.max(0, Math.floor(maxAgeSeconds));
  return `${name}=${token}; Path=/; Max-Age=${boundedMaxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) continue;
    const value = pair.slice(separator + 1).trim();
    return value || null;
  }
  return null;
}

function toIdentity(payload: EncodedSession, secret: Buffer): PublicSessionIdentity {
  return {
    scope: hashPublicSessionScope(payload.id, secret),
    createdAt: iso(payload.c),
    issuedAt: iso(payload.i),
    expiresAt: iso(payload.e),
    maximumExpiresAt: iso(payload.m),
  };
}

export function sessionRecordFromIdentity(identity: PublicSessionIdentity): PublicSessionRecord {
  return {
    version: 1,
    scope: parseSessionScope(identity.scope),
    createdAt: identity.createdAt,
    lastSeenAt: identity.issuedAt,
    expiresAt: identity.expiresAt,
    maximumExpiresAt: identity.maximumExpiresAt,
  };
}

export function isPublicSessionExpired(
  value: Pick<PublicSessionRecord, "expiresAt" | "maximumExpiresAt">,
  now: Date = new Date(),
): boolean {
  const current = unixMilliseconds(now);
  const expires = Date.parse(value.expiresAt);
  const maximum = Date.parse(value.maximumExpiresAt);
  return !Number.isFinite(expires) || !Number.isFinite(maximum) || current >= expires || current >= maximum;
}

export class PublicSessionCodec {
  readonly policy: PublicSessionPolicy;
  readonly cookieName: string;
  private readonly secret: Buffer;
  private readonly clock: PublicSessionClock;
  private readonly random: PublicSessionRandom;

  constructor(options: PublicSessionCodecOptions) {
    this.secret = secretBytes(options.secret);
    this.clock = options.clock ?? { now: () => new Date() };
    this.random = options.random ?? { bytes: (size) => nodeRandomBytes(size) };
    this.policy = validatePolicy(options.policy ?? DEFAULT_PUBLIC_SESSION_POLICY);
    this.cookieName = options.cookieName ?? PUBLIC_SESSION_COOKIE_NAME;
    serializePublicSessionCookie(this.cookieName, "validation", 0);
  }

  issue(): { identity: PublicSessionIdentity; token: string; setCookie: string } {
    const now = unixMilliseconds(this.clock.now());
    const random = Buffer.from(this.random.bytes(SESSION_ID_BYTES));
    if (random.byteLength !== SESSION_ID_BYTES) throw new Error("Session random source returned the wrong number of bytes");
    const payload: EncodedSession = {
      v: 1,
      id: random.toString("base64url"),
      c: now,
      i: now,
      e: now + this.policy.idleTtlMs,
      m: now + this.policy.maximumLifetimeMs,
    };
    return this.result(payload);
  }

  verify(token: string): PublicSessionIdentity | null {
    const payload = this.decode(token);
    if (!payload) return null;
    const now = unixMilliseconds(this.clock.now());
    if (now >= payload.e || now >= payload.m) return null;
    return toIdentity(payload, this.secret);
  }

  resolveCookieHeader(header: string | undefined): PublicSessionResolution {
    const token = cookieValue(header, this.cookieName);
    const payload = token ? this.decode(token) : null;
    const now = unixMilliseconds(this.clock.now());
    if (!payload || now >= payload.e || now >= payload.m) {
      const issued = this.issue();
      return { identity: issued.identity, setCookie: issued.setCookie };
    }

    if (payload.e - now > this.policy.renewalWindowMs) return { identity: toIdentity(payload, this.secret) };

    const renewed: EncodedSession = {
      ...payload,
      i: now,
      e: Math.min(now + this.policy.idleTtlMs, payload.m),
    };
    const result = this.result(renewed);
    return { identity: result.identity, setCookie: result.setCookie };
  }

  private result(payload: EncodedSession): { identity: PublicSessionIdentity; token: string; setCookie: string } {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.secret).update(`v1.${encoded}`).digest("base64url");
    const token = `v1.${encoded}.${signature}`;
    const now = unixMilliseconds(this.clock.now());
    return {
      identity: toIdentity(payload, this.secret),
      token,
      setCookie: serializePublicSessionCookie(this.cookieName, token, Math.max(0, Math.ceil((payload.e - now) / 1_000))),
    };
  }

  private decode(token: string): EncodedSession | null {
    const pieces = token.split(".");
    const encoded = pieces[1];
    const suppliedSignature = pieces[2];
    if (pieces.length !== 3 || pieces[0] !== "v1" || !encoded || !suppliedSignature) return null;
    const expected = createHmac("sha256", this.secret).update(`v1.${encoded}`).digest();
    let supplied: Buffer;
    try { supplied = Buffer.from(suppliedSignature, "base64url"); } catch { return null; }
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) return null;
    try {
      const candidate = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<EncodedSession>;
      if (
        candidate.v !== 1
        || typeof candidate.id !== "string"
        || !/^[A-Za-z0-9_-]{43}$/.test(candidate.id)
        || !Number.isSafeInteger(candidate.c)
        || !Number.isSafeInteger(candidate.i)
        || !Number.isSafeInteger(candidate.e)
        || !Number.isSafeInteger(candidate.m)
        || candidate.c! > candidate.i!
        || candidate.i! > candidate.e!
        || candidate.e! > candidate.m!
        || candidate.m! - candidate.c! !== this.policy.maximumLifetimeMs
      ) return null;
      return candidate as EncodedSession;
    } catch {
      return null;
    }
  }
}

export function createPublicSessionCodec(options: PublicSessionCodecOptions): PublicSessionCodec {
  return new PublicSessionCodec(options);
}

export function createPublicSession(codec: PublicSessionCodec): ReturnType<PublicSessionCodec["issue"]> {
  return codec.issue();
}

export function renewPublicSession(codec: PublicSessionCodec, cookieHeader: string | undefined): PublicSessionResolution {
  return codec.resolveCookieHeader(cookieHeader);
}
