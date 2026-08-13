import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ADMIN_API_SECURITY_HEADERS,
  ADMIN_SESSION_COOKIE,
  FixedWindowRateLimiter,
  adminJsonHeaders,
  clientAddress,
  consumeOAuthState,
  createAdminSession,
  createOAuthState,
  expireSessionCookie,
  hashAuditIdentifier,
  isSameOriginMutation,
  readCookie,
  sanitizeLogMetadata,
  serializeSessionCookie,
  type SessionInvalidationStore,
  verifyActiveAdminSession,
  verifyAdminSession,
} from "./index.js";

const secret = "s".repeat(32);
const auditKey = "a".repeat(32);

test("JSON headers prevent storage, framing, sniffing and broad content loading", () => {
  const headers = adminJsonHeaders("request-123");
  assert.equal(headers["cache-control"], "no-store, max-age=0");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.match(headers["content-security-policy"]!, /default-src 'none'/);
  assert.match(headers["content-security-policy"]!, /frame-ancestors 'none'/);
  assert.equal(headers["x-request-id"], "request-123");
  assert.equal(ADMIN_API_SECURITY_HEADERS["cross-origin-resource-policy"], "same-origin");
  assert.throws(() => adminJsonHeaders("bad\r\nheader"));
});

test("session cookie is host-only, short-lived, opaque, HttpOnly, Secure and strict same-site", () => {
  const cookie = serializeSessionCookie("opaque_value-1.signature", { maxAgeSeconds: 1_800 });
  assert.match(cookie, new RegExp(`^${ADMIN_SESSION_COOKIE}=`));
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.equal(readCookie(`another=a; ${ADMIN_SESSION_COOKIE}=opaque_value-1.signature`), "opaque_value-1.signature");
  assert.match(expireSessionCookie(), /Max-Age=0/);
  assert.throws(() => serializeSessionCookie("not;opaque", { maxAgeSeconds: 60 }));
  assert.throws(() => serializeSessionCookie("opaque", { maxAgeSeconds: 90_000 }));
});

test("signed session rejects tampering, expiry, nonnumeric authority and invalidation", async () => {
  const now = 1_700_000_000_000;
  const session = createAdminSession("123456", secret, now, 60_000);
  assert.equal(verifyAdminSession(session.token, secret, now)?.actorId, "123456");
  assert.equal(verifyAdminSession(`${session.token}x`, secret, now), undefined);
  assert.equal(verifyAdminSession(session.token, secret, now + 60_000), undefined);
  assert.throws(() => createAdminSession("user-name", secret, now, 60_000));

  const invalidated = new Set<string>();
  const store: SessionInvalidationStore = {
    invalidate: async (id: string) => { invalidated.add(id); },
    isInvalidated: async (id: string) => invalidated.has(id),
  };
  assert.ok(await verifyActiveAdminSession(session.token, secret, store, now));
  await store.invalidate(session.payload.sessionId, session.payload.expiresAt);
  assert.equal(await verifyActiveAdminSession(session.token, secret, store, now), undefined);
});

test("OAuth state is signed, single-use, short-lived and return path bound", async () => {
  const now = 1_700_000_000_000;
  const pending = new Set<string>();
  const store = {
    put: async (nonce: string) => { pending.add(nonce); },
    consume: async (nonce: string) => pending.delete(nonce),
  };
  const token = await createOAuthState("/admin/review?case=12", secret, store, now);
  assert.equal((await consumeOAuthState(token, secret, store, now))?.returnTo, "/admin/review?case=12");
  assert.equal(await consumeOAuthState(token, secret, store, now), undefined);
  assert.equal(await consumeOAuthState(`${token}x`, secret, store, now), undefined);
  await assert.rejects(createOAuthState("https://evil.example/admin", secret, store, now));
  await assert.rejects(createOAuthState("//evil.example/admin", secret, store, now));
});

test("logout mutation requires explicit same origin evidence in addition to Strict cookie", () => {
  assert.equal(isSameOriginMutation({ origin: "https://opendesign.cc", secFetchSite: "same-origin" }, "https://opendesign.cc"), true);
  assert.equal(isSameOriginMutation({ origin: "https://evil.example", secFetchSite: "cross-site" }, "https://opendesign.cc"), false);
  assert.equal(isSameOriginMutation({ secFetchSite: "same-origin" }, "https://opendesign.cc"), false);
});

test("rate limiter closes a full window and provides retry evidence", () => {
  const limiter = new FixedWindowRateLimiter(2, 10_000);
  assert.equal(limiter.consume("ip:one", 0).allowed, true);
  assert.equal(limiter.consume("ip:one", 1).allowed, true);
  assert.deepEqual(limiter.consume("ip:one", 2), { allowed: false, limit: 2, remaining: 0, retryAfterSeconds: 10 });
  assert.equal(limiter.consume("ip:one", 10_000).allowed, true);
  assert.equal(limiter.consume("ip:two", 2).allowed, true);
});

test("audit hashing is stable, namespaced and does not expose raw values", () => {
  const ip = hashAuditIdentifier("203.0.113.8", auditKey, "ip");
  assert.equal(ip, hashAuditIdentifier("203.0.113.8", auditKey, "ip"));
  assert.notEqual(ip, hashAuditIdentifier("203.0.113.8", auditKey, "user-agent"));
  assert.doesNotMatch(ip, /203\.0\.113\.8/);
  assert.equal(clientAddress("198.51.100.2", "203.0.113.8", true), "198.51.100.2");
  assert.equal(clientAddress("127.0.0.1", "203.0.113.8, 127.0.0.1", true), "203.0.113.8");
});

test("structured log metadata denies secret-bearing keys and values", () => {
  const sanitized = sanitizeLogMetadata({
    route: "/admin-api/v1/session",
    cookie: "session=top-secret",
    nested: { accessToken: "github-token", message: "safe" },
    accidental: "Bearer highly-secret-value",
  });
  assert.equal(sanitized.route, "/admin-api/v1/session");
  assert.equal(sanitized.cookie, "[REDACTED]");
  assert.deepEqual(sanitized.nested, { accessToken: "[REDACTED]", message: "safe" });
  assert.equal(sanitized.accidental, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(sanitized), /top-secret|github-token|highly-secret/);
});
