import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignedTokenPayload {
  issuedAt: number;
  expiresAt: number;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function requireSecret(secret: string | Buffer): Buffer {
  const bytes = Buffer.from(secret);
  if (bytes.byteLength < 32) throw new Error("Signing secret must be at least 32 bytes");
  return bytes;
}

function signature(body: string, secret: Buffer, purpose: string): Buffer {
  return createHmac("sha256", secret).update(`${purpose}\0${body}`).digest();
}

export function signToken<T extends SignedTokenPayload>(payload: T, secret: string | Buffer, purpose: string): string {
  if (!purpose || purpose.length > 64) throw new Error("Invalid token purpose");
  if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= payload.issuedAt) {
    throw new Error("Invalid token lifetime");
  }
  const key = requireSecret(secret);
  const body = base64url(JSON.stringify(payload));
  return `${body}.${signature(body, key, purpose).toString("base64url")}`;
}

export function verifyToken<T extends SignedTokenPayload>(
  token: string,
  secret: string | Buffer,
  purpose: string,
  now = Date.now(),
): T | undefined {
  if (token.length > 4_096) return undefined;
  const [body, provided, extra] = token.split(".");
  if (!body || !provided || extra) return undefined;
  const key = requireSecret(secret);
  const actual = Buffer.from(provided, "base64url");
  const expected = signature(body, key, purpose);
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) return undefined;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<T>;
    if (!Number.isSafeInteger(parsed.issuedAt) || !Number.isSafeInteger(parsed.expiresAt)) return undefined;
    if ((parsed.issuedAt as number) > now || (parsed.expiresAt as number) <= now) return undefined;
    return parsed as T;
  } catch {
    return undefined;
  }
}
