import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { AdminApiConfig, GitHubOAuthAdapter } from "../auth/index.js";
import type { AuditEvent, AuditSink } from "../audit/index.js";
import type { RateLimiter } from "../security/index.js";
import { createAdminApiServer, type EvidenceHandler } from "../server.js";

const config: AdminApiConfig = {
  publicOrigin: "https://admin.example",
  githubClientId: "client",
  githubClientSecret: "secret",
  allowedGitHubUserIds: new Set([123]),
  signingSecret: "test-signing-secret-that-is-at-least-32-bytes",
  host: "127.0.0.1",
  port: 8790,
  sessionTtlSeconds: 900,
  stateTtlSeconds: 300,
};

function oauthFor(userId = 123): GitHubOAuthAdapter {
  return {
    createAuthorizationUrl: ({ state }) => `https://github.example/authorize?state=${encodeURIComponent(state)}`,
    authenticate: async () => ({ githubUserId: userId, login: "curator" }),
  };
}

async function withServer(
  callback: (baseUrl: string) => Promise<void>,
  input: {
    oauth?: GitHubOAuthAdapter;
    operations?: EvidenceHandler;
    sync?: EvidenceHandler;
    readiness?: () => Promise<boolean>;
    audit?: AuditSink;
    auditHashKey?: string;
    onAuditFailure?: (requestId: string) => void;
    readLimiter?: RateLimiter;
  } = {},
): Promise<void> {
  const server = createAdminApiServer({
    config,
    oauth: input.oauth ?? oauthFor(),
    evidence: { ...(input.operations ? { operations: input.operations } : {}), ...(input.sync ? { sync: input.sync } : {}) },
    ...(input.readiness ? { readiness: input.readiness } : {}),
    ...(input.audit && input.auditHashKey && input.onAuditFailure ? {
      audit: input.audit,
      auditHashKey: input.auditHashKey,
      onAuditFailure: input.onAuditFailure,
    } : {}),
    ...(input.readLimiter ? { rateLimiters: { read: input.readLimiter } } : {}),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function login(baseUrl: string): Promise<string> {
  const start = await fetch(`${baseUrl}/admin-api/v1/auth/github/start?return=${encodeURIComponent("/admin/reviews")}`, { redirect: "manual" });
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const callback = await fetch(`${baseUrl}/admin-api/v1/auth/github/callback?code=test&state=${encodeURIComponent(state)}`, { redirect: "manual" });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/admin/reviews");
  return callback.headers.get("set-cookie")!.split(";")[0]!;
}

test("security headers and fail-closed route, method, query, and body handling", async () => {
  await withServer(async (baseUrl) => {
    const live = await fetch(`${baseUrl}/admin-api/v1/health/live`);
    assert.equal(live.status, 200);
    assert.equal(live.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(live.headers.get("x-frame-options"), "DENY");
    assert.ok(live.headers.get("x-request-id"));
    assert.equal((await fetch(`${baseUrl}/unknown`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/session`, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/session?extra=1`)).status, 400);
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/logout`, { method: "POST", headers: { origin: config.publicOrigin }, body: "x" })).status, 400);
  });
});

test("evidence remains behind authentication and unavailable handlers return 503", async () => {
  let calls = 0;
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/operations`)).status, 401);
    assert.equal(calls, 0);
    const cookie = await login(baseUrl);
    const response = await fetch(`${baseUrl}/admin-api/v1/operations`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { source: { kind: "database" }, reviews: [] });
    assert.equal(calls, 1);
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/sync`, { headers: { cookie } })).status, 503);
  }, { operations: async ({ actor }) => { calls += 1; assert.equal(actor.githubUserId, 123); return { source: { kind: "database" }, reviews: [] }; } });
});

test("disallowed immutable GitHub ids cannot receive a session", async () => {
  await withServer(async (baseUrl) => {
    const start = await fetch(`${baseUrl}/admin-api/v1/auth/github/start`, { redirect: "manual" });
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const callback = await fetch(`${baseUrl}/admin-api/v1/auth/github/callback?code=test&state=${encodeURIComponent(state)}`, { redirect: "manual" });
    assert.equal(callback.status, 403);
    assert.equal(callback.headers.get("set-cookie"), null);
  }, { oauth: oauthFor(999) });
});

test("OAuth state is single-use and logout requires exact origin then invalidates", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await login(baseUrl);
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/session`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/logout`, { method: "POST", headers: { cookie } })).status, 403);
    const logout = await fetch(`${baseUrl}/admin-api/v1/logout`, { method: "POST", headers: { cookie, origin: config.publicOrigin } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
    const session = await fetch(`${baseUrl}/admin-api/v1/session`, { headers: { cookie } });
    assert.deepEqual(await session.json(), { authenticated: false });
  });
});

test("readiness checks the database dependency instead of handler presence alone", async () => {
  const evidence = async () => ({ ok: true });
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin-api/v1/health/ready`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "database_unavailable");
  }, { operations: evidence, sync: evidence, readiness: async () => false });
});

test("rate limiting fails closed before session or evidence work", async () => {
  const denied: RateLimiter = {
    consume: () => ({ allowed: false, limit: 1, remaining: 0, retryAfterSeconds: 9 }),
  };
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin-api/v1/session`);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "9");
    assert.equal(response.headers.get("x-ratelimit-remaining"), "0");
  }, { readLimiter: denied });
});

test("audits completed requests with hashed identifiers and reports sink failure", async () => {
  let captured: AuditEvent | undefined;
  let finishAudit!: () => void;
  const audited = new Promise<void>((resolve) => { finishAudit = resolve; });
  const sink: AuditSink = {
    write: async (event) => { captured = event; finishAudit(); return { written: false, errorCode: "unavailable" }; },
  };
  let failedRequestId = "";
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin-api/v1/health/live`, { headers: { "user-agent": "server-test" } });
    assert.equal(response.status, 200);
    await audited;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(captured?.route, "/admin-api/v1/health/live");
    assert.match(captured?.sourceIpHash ?? "", /^ip:[a-f0-9]{24}$/u);
    assert.match(captured?.userAgentHash ?? "", /^user-agent:[a-f0-9]{24}$/u);
    assert.equal(captured?.metadata.statusCode, 200);
    assert.equal(failedRequestId, captured?.requestId);
  }, {
    audit: sink,
    auditHashKey: "audit-hash-key-that-is-at-least-32-bytes",
    onAuditFailure: (requestId) => { failedRequestId = requestId; },
  });
});
