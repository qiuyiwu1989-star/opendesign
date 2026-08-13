import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import test from "node:test";
import type { AdminApiConfig, LocalPasswordVerifier } from "../auth/index.js";
import type { AuditEvent, AuditSink } from "../audit/index.js";
import type { DecisionRecommendation } from "../data/index.js";
import type { RateLimiter } from "../security/index.js";
import { createAdminApiServer, type DecisionReviewHandler, type EvidenceHandler } from "../server.js";

const config: AdminApiConfig = {
  publicOrigin: "https://admin.example",
  adminUsername: "admin",
  passwordHash: "unused-by-injected-verifier",
  signingSecret: "test-signing-secret-that-is-at-least-32-bytes",
  host: "127.0.0.1",
  port: 8790,
  sessionTtlSeconds: 900,
};

const verifier: LocalPasswordVerifier = { verify: async (password) => password === "correct-password" };

function reviewedResult(input: { decisionId: string; reason: string }, recommendation: DecisionRecommendation = "approve") {
  return {
    outcome: "reviewed" as const,
    decisionId: input.decisionId,
    reviewStatus: "confirmed" as const,
    recommendation,
    reviewedAt: "2026-08-13T09:00:00.000Z",
    reviewedBy: "admin",
    reviewEventId: `review-${input.decisionId}`,
    subjectId: `subject-${input.decisionId}`,
    reason: input.reason,
    provenance: { source: "admin-api", requestId: `request-${input.decisionId}`, aiDecisionId: input.decisionId },
  };
}

async function withServer(
  callback: (baseUrl: string) => Promise<void>,
  input: {
    operations?: EvidenceHandler;
    sync?: EvidenceHandler;
    readiness?: () => Promise<boolean>;
    audit?: AuditSink;
    auditHashKey?: string;
    onAuditFailure?: (requestId: string) => void;
    readLimiter?: RateLimiter;
    authLimiter?: RateLimiter;
    passwordVerifier?: LocalPasswordVerifier;
    decisionReview?: DecisionReviewHandler;
  } = {},
): Promise<void> {
  const server = createAdminApiServer({
    config,
    passwordVerifier: input.passwordVerifier ?? verifier,
    evidence: { ...(input.operations ? { operations: input.operations } : {}), ...(input.sync ? { sync: input.sync } : {}) },
    ...(input.decisionReview ? { decisionReview: input.decisionReview } : {}),
    ...(input.readiness ? { readiness: input.readiness } : {}),
    ...(input.audit && input.auditHashKey && input.onAuditFailure ? {
      audit: input.audit,
      auditHashKey: input.auditHashKey,
      onAuditFailure: input.onAuditFailure,
    } : {}),
    ...((input.readLimiter || input.authLimiter) ? { rateLimiters: {
      ...(input.readLimiter ? { read: input.readLimiter } : {}),
      ...(input.authLimiter ? { auth: input.authLimiter } : {}),
    } } : {}),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function chunkedReview(baseUrl: string, cookie: string, body: string): Promise<number> {
  const target = new URL(`${baseUrl}/admin-api/v1/decisions/review`);
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest(target, {
      method: "POST",
      headers: {
        cookie,
        origin: config.publicOrigin,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
      },
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.write(body.slice(0, 5));
    request.end(body.slice(5));
  });
}

async function login(baseUrl: string, username = "admin", password = "correct-password"): Promise<Response> {
  return fetch(`${baseUrl}/admin-api/v1/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: config.publicOrigin, "sec-fetch-site": "same-origin" },
    body: JSON.stringify({ username, password }),
  });
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

test("local login requires exact same-origin JSON and returns one opaque session", async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/login`, { method: "POST" })).status, 403);
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/login`, {
      method: "POST", headers: { origin: config.publicOrigin, "content-type": "text/plain" }, body: "x",
    })).status, 400);
    assert.equal((await login(baseUrl, "admin", "wrong-password")).status, 401);
    assert.equal((await login(baseUrl, "root", "correct-password")).status, 401);
    const response = await login(baseUrl);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie") ?? "", /__Host-opendesign_admin=.*HttpOnly.*Secure.*SameSite=Strict/u);
    assert.deepEqual((await response.json() as { actor: unknown }).actor, { actorId: "admin", login: "admin" });
  });
});

test("evidence remains behind authentication and unavailable handlers return 503", async () => {
  let calls = 0;
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/operations`)).status, 401);
    assert.equal(calls, 0);
    const loginResponse = await login(baseUrl);
    const cookie = loginResponse.headers.get("set-cookie")!.split(";")[0]!;
    const response = await fetch(`${baseUrl}/admin-api/v1/operations`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { source: { kind: "database" }, reviews: [] });
    assert.equal(calls, 1);
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/sync`, { headers: { cookie } })).status, 503);
  }, { operations: async ({ actor }) => { calls += 1; assert.equal(actor.actorId, "admin"); return { source: { kind: "database" }, reviews: [] }; } });
});

test("logout requires exact origin then invalidates the local session", async () => {
  await withServer(async (baseUrl) => {
    const loginResponse = await login(baseUrl);
    const cookie = loginResponse.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/session`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/logout`, { method: "POST", headers: { cookie } })).status, 403);
    const logout = await fetch(`${baseUrl}/admin-api/v1/logout`, { method: "POST", headers: { cookie, origin: config.publicOrigin, "sec-fetch-site": "same-origin" } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/u);
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

test("rate limiting fails closed before password verification or evidence work", async () => {
  const denied: RateLimiter = { consume: () => ({ allowed: false, limit: 1, remaining: 0, retryAfterSeconds: 9 }) };
  let passwordCalls = 0;
  await withServer(async (baseUrl) => {
    const response = await login(baseUrl);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "9");
    assert.equal(passwordCalls, 0);
  }, { authLimiter: denied, passwordVerifier: { verify: async () => { passwordCalls += 1; return true; } } });
});

test("audits completed requests with hashed identifiers and reports sink failure", async () => {
  let captured: AuditEvent | undefined;
  let finishAudit!: () => void;
  const audited = new Promise<void>((resolve) => { finishAudit = resolve; });
  const sink: AuditSink = { write: async (event) => { captured = event; finishAudit(); return { written: false, errorCode: "unavailable" }; } };
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

test("decision review requires authentication, exact same-origin JSON and a configured handler", async () => {
  let calls = 0;
  await withServer(async (baseUrl) => {
    const body = JSON.stringify({ decisionId: "decision-1", action: "confirm", reason: "人工确认质量合格" });
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
      method: "POST", headers: { origin: config.publicOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" }, body,
    })).status, 401);
    const loginResponse = await login(baseUrl);
    const cookie = loginResponse.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
      method: "POST", headers: { cookie, origin: "https://attacker.example", "sec-fetch-site": "cross-site", "content-type": "application/json" }, body,
    })).status, 403);
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
      method: "POST", headers: { cookie, origin: config.publicOrigin, "sec-fetch-site": "same-origin", "content-type": "text/plain" }, body,
    })).status, 400);
    assert.equal(calls, 0);
  }, { decisionReview: async () => { calls += 1; return { outcome: "unavailable" }; } });
  await withServer(async (baseUrl) => {
    const loginResponse = await login(baseUrl);
    const cookie = loginResponse.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal((await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
      method: "POST",
      headers: { cookie, origin: config.publicOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ decisionId: "decision-1", action: "confirm", reason: "人工确认质量合格" }),
    })).status, 503);
  });
});

test("decision review validates confirm and override bodies and fails closed for chunked JSON", async () => {
  const inputs: unknown[] = [];
  await withServer(async (baseUrl) => {
    const loginResponse = await login(baseUrl);
    const cookie = loginResponse.headers.get("set-cookie")!.split(";")[0]!;
    const headers = { cookie, origin: config.publicOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const invalidBodies = [
      { decisionId: "decision-1", action: "confirm", reason: "短" },
      { decisionId: "decision-1", action: "confirm", recommendation: "approve", reason: "不允许多余字段" },
      { decisionId: "decision-1", action: "override", reason: "覆盖必须给最终建议" },
      { decisionId: "decision-1", action: "override", recommendation: "maybe", reason: "建议枚举不合法" },
    ];
    for (const body of invalidBodies) {
      assert.equal((await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
        method: "POST", headers, body: JSON.stringify(body),
      })).status, 400);
    }
    assert.equal(await chunkedReview(baseUrl, cookie, JSON.stringify({
      decisionId: "decision-1", action: "confirm", reason: "分块请求应该拒绝",
    })), 400);
    assert.equal(inputs.length, 0);
  }, { decisionReview: async (input) => { inputs.push(input); return { outcome: "unavailable" }; } });
});

test("decision review accepts a 1000-character Unicode reason within its 8 KiB lane and rejects larger bodies", async () => {
  const reasons: string[] = [];
  await withServer(async (baseUrl) => {
    const loginResponse = await login(baseUrl);
    const cookie = loginResponse.headers.get("set-cookie")!.split(";")[0]!;
    const headers = { cookie, origin: config.publicOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const reason = "设".repeat(1_000);
    const accepted = await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
      method: "POST", headers,
      body: JSON.stringify({ decisionId: "decision-unicode", action: "confirm", reason }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(reasons[0], reason);
    const rejected = await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
      method: "POST", headers,
      body: JSON.stringify({ decisionId: "decision-large", action: "confirm", reason: "设".repeat(3_000) }),
    });
    assert.equal(rejected.status, 400);
    assert.equal(reasons.length, 1);
  }, {
    decisionReview: async (input) => {
      reasons.push(input.reason);
      return reviewedResult(input);
    },
  });
});

test("decision review confirms original advice, overrides explicitly, and rejects repeats", async () => {
  let calls = 0;
  await withServer(async (baseUrl) => {
    const loginResponse = await login(baseUrl);
    const cookie = loginResponse.headers.get("set-cookie")!.split(";")[0]!;
    const headers = { cookie, origin: config.publicOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" };
    const confirm = await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
      method: "POST", headers, body: JSON.stringify({ decisionId: "decision-confirm", action: "confirm", reason: "证据充分，确认原建议" }),
    });
    assert.equal(confirm.status, 200);
    assert.deepEqual(await confirm.json(), {
      decisionId: "decision-confirm", reviewStatus: "confirmed", recommendation: "approve",
      reviewedAt: "2026-08-13T09:00:00.000Z", reviewedBy: "admin",
      reviewEventId: "review-decision-confirm", subjectId: "subject-decision-confirm",
      reason: "证据充分，确认原建议",
      provenance: { source: "admin-api", requestId: "request-decision-confirm", aiDecisionId: "decision-confirm" },
    });
    const override = await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
      method: "POST", headers, body: JSON.stringify({ decisionId: "decision-override", action: "override", recommendation: "reject", reason: "发现隐藏广告跳转" }),
    });
    assert.equal(override.status, 200);
    assert.equal((await override.json() as { recommendation: string }).recommendation, "reject");
    const repeated = await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
      method: "POST", headers, body: JSON.stringify({ decisionId: "decision-repeat", action: "confirm", reason: "不允许重复复核" }),
    });
    assert.equal(repeated.status, 409);
    assert.equal(calls, 3);
  }, {
    decisionReview: async (input, context) => {
      calls += 1;
      assert.equal(context.actor.actorId, "admin");
      if (input.decisionId === "decision-repeat") return { outcome: "already_reviewed" };
      const result = reviewedResult(input, input.action === "confirm" ? "approve" : input.recommendation!);
      return { ...result, reviewStatus: input.action === "confirm" ? "confirmed" as const : "overridden" as const };
    },
  });
});

test("decision review audit records outcome but never the review reason", async () => {
  const events: AuditEvent[] = [];
  await withServer(async (baseUrl) => {
    const loginResponse = await login(baseUrl);
    const cookie = loginResponse.headers.get("set-cookie")!.split(";")[0]!;
    const reason = "这是敏感的人工复核说明正文";
    const response = await fetch(`${baseUrl}/admin-api/v1/decisions/review`, {
      method: "POST",
      headers: { cookie, origin: config.publicOrigin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ decisionId: "decision-audit", action: "confirm", reason }),
    });
    assert.equal(response.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reviewEvent = events.find((event) => event.route === "/admin-api/v1/decisions/review");
    assert.ok(reviewEvent);
    assert.equal(reviewEvent.actorId, "admin");
    assert.equal(reviewEvent.metadata.statusCode, 200);
    assert.equal(JSON.stringify(reviewEvent).includes(reason), false);
  }, {
    decisionReview: async (input) => reviewedResult(input),
    audit: { write: async (event) => { events.push(event); return { written: true, eventId: "event" }; } },
    auditHashKey: "audit-hash-key-that-is-at-least-32-bytes",
    onAuditFailure: () => undefined,
  });
});
