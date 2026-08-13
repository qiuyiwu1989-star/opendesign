const COOKIE_VALUE = /^[A-Za-z0-9._~-]+$/;
const COOKIE_NAME = /^__Host-[A-Za-z0-9_-]+$/;

export const ADMIN_SESSION_COOKIE = "__Host-opendesign_admin_session";

export interface SessionCookieOptions {
  maxAgeSeconds: number;
}

function requireCookieName(name: string): void {
  if (!COOKIE_NAME.test(name)) throw new Error("Admin cookies must use a __Host- name");
}

export function serializeSessionCookie(
  value: string,
  options: SessionCookieOptions,
  name = ADMIN_SESSION_COOKIE,
): string {
  requireCookieName(name);
  if (!COOKIE_VALUE.test(value)) throw new Error("Session cookie is not an opaque token value");
  if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 1 || options.maxAgeSeconds > 86_400) {
    throw new Error("Session cookie max age must be between 1 second and 24 hours");
  }
  return `${name}=${value}; Path=/; Max-Age=${options.maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

export function expireSessionCookie(name = ADMIN_SESSION_COOKIE): string {
  requireCookieName(name);
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export function readCookie(cookieHeader: string | undefined, name = ADMIN_SESSION_COOKIE): string | undefined {
  requireCookieName(name);
  if (!cookieHeader || cookieHeader.length > 8_192) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return COOKIE_VALUE.test(value) ? value : undefined;
  }
  return undefined;
}
