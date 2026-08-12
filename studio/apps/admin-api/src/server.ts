import { randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createSessionManager,
  expiredSessionCookie,
  readSessionCookie,
  sessionCookie,
  type AdminApiConfig,
  type LocalPasswordVerifier,
  type SessionClaims,
} from "./auth/index.js";
import { sanitizeAuditEvent, type AuditSink } from "./audit/index.js";
import { applySecurityHeaders, errorJson, hasRequestBody, json, originMatches } from "./http/index.js";
import {
  clientAddress,
  FixedWindowRateLimiter,
  hashAuditIdentifier,
  isSameOriginMutation,
  type RateLimiter,
} from "./security/index.js";

const API_PREFIX = "/admin-api/v1";
const EVIDENCE_TIMEOUT_MS = 5_000;
const ROUTES = new Map<string, ReadonlySet<string>>([
  [`${API_PREFIX}/session`, new Set(["GET"])],
  [`${API_PREFIX}/login`, new Set(["POST"])],
  [`${API_PREFIX}/logout`, new Set(["POST"])],
  [`${API_PREFIX}/operations`, new Set(["GET"])],
  [`${API_PREFIX}/sync`, new Set(["GET"])],
  [`${API_PREFIX}/health/live`, new Set(["GET"])],
  [`${API_PREFIX}/health/ready`, new Set(["GET"])],
]);

export interface EvidenceContext {
  requestId: string;
  actor: Pick<SessionClaims, "actorId">;
  signal: AbortSignal;
}

export type EvidenceHandler = (context: EvidenceContext) => Promise<unknown>;

export interface AdminApiServerOptions {
  config: AdminApiConfig;
  passwordVerifier: LocalPasswordVerifier;
  evidence?: {
    operations?: EvidenceHandler;
    sync?: EvidenceHandler;
  };
  readiness?: () => Promise<boolean>;
  audit?: AuditSink;
  auditHashKey?: string;
  onAuditFailure?: (requestId: string) => void;
  rateLimiters?: {
    auth?: RateLimiter;
    read?: RateLimiter;
  };
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}

function methodAllowed(response: ServerResponse, allowed: ReadonlySet<string>, requestId: string): void {
  response.setHeader("allow", [...allowed].join(", "));
  errorJson(response, 405, "method_not_allowed", requestId);
}

function noQuery(url: URL): boolean {
  return [...url.searchParams].length === 0;
}

export function createAdminApiServer(options: AdminApiServerOptions) {
  const config = options.config;
  if (config.host !== "127.0.0.1") throw new Error("Admin API may bind only to 127.0.0.1");
  const auditParts = [options.audit, options.auditHashKey, options.onAuditFailure].filter(Boolean).length;
  if (auditParts !== 0 && auditParts !== 3) {
    throw new Error("Audit sink, audit hash key and failure reporter must be configured together");
  }
  const authLimiter = options.rateLimiters?.auth ?? new FixedWindowRateLimiter(5, 15 * 60_000);
  const readLimiter = options.rateLimiters?.read ?? new FixedWindowRateLimiter(120, 60_000);
  const sessions = createSessionManager({
    secret: config.signingSecret,
    ttlSeconds: config.sessionTtlSeconds,
    ...(options.now ? { now: options.now } : {}),
    ...(options.randomBytes ? { randomBytes: options.randomBytes } : {}),
  });
  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 10_000, headersTimeout: 10_000 }, async (request, response) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let actorId: string | undefined;
    let auditRoute = "/unknown";
    applySecurityHeaders(response, requestId);
    if (options.audit && options.auditHashKey) {
      const peer = request.socket.remoteAddress;
      const address = clientAddress(peer, request.headers["x-forwarded-for"] as string | undefined, true);
      const sourceIpHash = hashAuditIdentifier(address, options.auditHashKey, "ip");
      const userAgentHash = hashAuditIdentifier(request.headers["user-agent"] ?? "unknown", options.auditHashKey, "user-agent");
      response.once("finish", () => {
        const statusCode = response.statusCode;
        const outcome = statusCode < 400 ? "success" : statusCode === 401 || statusCode === 403 || statusCode === 429 ? "denied" : "failure";
        const event = sanitizeAuditEvent({
          requestId,
          occurredAt: new Date(startedAt).toISOString(),
          ...(actorId ? { actorId } : {}),
          action: `${request.method ?? "UNKNOWN"} ${auditRoute}`,
          outcome,
          route: auditRoute,
          latencyMs: Date.now() - startedAt,
          sourceIpHash,
          userAgentHash,
          metadata: { method: request.method ?? "UNKNOWN", statusCode },
        });
        void options.audit!.write(event).then((result) => {
          if (!result.written) options.onAuditFailure!(requestId);
        }).catch(() => options.onAuditFailure!(requestId));
      });
    }

    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      auditRoute = url.pathname;
      const allowed = ROUTES.get(url.pathname);
      if (!allowed) {
        errorJson(response, 404, "not_found", requestId);
        return;
      }
      const method = request.method ?? "";
      if (!allowed.has(method)) {
        methodAllowed(response, allowed, requestId);
        return;
      }
      const isLogin = url.pathname === `${API_PREFIX}/login`;
      if (!isLogin && hasRequestBody(request)) {
        errorJson(response, 400, "request_body_not_allowed", requestId);
        return;
      }

      if (!url.pathname.startsWith(`${API_PREFIX}/health/`)) {
        const authRoute = isLogin || url.pathname === `${API_PREFIX}/logout`;
        const address = clientAddress(request.socket.remoteAddress, request.headers["x-forwarded-for"] as string | undefined, true);
        const decision = (authRoute ? authLimiter : readLimiter).consume(address);
        response.setHeader("x-ratelimit-limit", decision.limit);
        response.setHeader("x-ratelimit-remaining", decision.remaining);
        if (!decision.allowed) {
          response.setHeader("retry-after", decision.retryAfterSeconds);
          errorJson(response, 429, "rate_limit_exceeded", requestId);
          return;
        }
      }

      if (url.pathname === `${API_PREFIX}/health/live`) {
        if (!noQuery(url)) { errorJson(response, 400, "invalid_query", requestId); return; }
        json(response, 200, { ok: true, requestId });
        return;
      }
      if (url.pathname === `${API_PREFIX}/health/ready`) {
        if (!noQuery(url)) { errorJson(response, 400, "invalid_query", requestId); return; }
        const missing = (["operations", "sync"] as const).filter((key) => !options.evidence?.[key]);
        if (missing.length) {
          json(response, 503, { ok: false, error: { code: "evidence_unavailable", requestId }, missing });
          return;
        }
        if (options.readiness) {
          let ready = false;
          try {
            ready = await Promise.race([
              options.readiness(),
              new Promise<boolean>((resolve) => setTimeout(() => resolve(false), EVIDENCE_TIMEOUT_MS)),
            ]);
          } catch {
            ready = false;
          }
          if (!ready) {
            errorJson(response, 503, "database_unavailable", requestId);
            return;
          }
        }
        json(response, 200, { ok: true, requestId });
        return;
      }

      const sessionToken = readSessionCookie(request.headers.cookie);
      const actor = sessions.verify(sessionToken);
      actorId = actor?.actorId;
      if (url.pathname === `${API_PREFIX}/session`) {
        if (!noQuery(url)) { errorJson(response, 400, "invalid_query", requestId); return; }
        json(response, 200, actor
          ? { authenticated: true, actor: { actorId: actor.actorId, login: actor.login }, expiresAt: new Date(actor.expiresAt).toISOString() }
          : { authenticated: false });
        return;
      }

      if (isLogin) {
        if (!noQuery(url)) { errorJson(response, 400, "invalid_query", requestId); return; }
        if (!originMatches(request, config.publicOrigin) || !isSameOriginMutation({
          origin: request.headers.origin,
          secFetchSite: request.headers["sec-fetch-site"],
        }, config.publicOrigin)) { errorJson(response, 403, "origin_required", requestId); return; }
        const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
        const contentLength = Number(request.headers["content-length"] ?? "0");
        if (contentType !== "application/json" || !Number.isSafeInteger(contentLength) || contentLength < 1 || contentLength > 2048) {
          errorJson(response, 400, "invalid_login_request", requestId); return;
        }
        let body = "";
        for await (const chunk of request) {
          body += chunk.toString("utf8");
          if (Buffer.byteLength(body, "utf8") > 2048) { errorJson(response, 413, "request_too_large", requestId); return; }
        }
        let credentials: unknown;
        try { credentials = JSON.parse(body); } catch { errorJson(response, 400, "invalid_login_request", requestId); return; }
        if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) { errorJson(response, 400, "invalid_login_request", requestId); return; }
        const fields = credentials as Record<string, unknown>;
        const keys = Object.keys(fields);
        if (keys.length !== 2 || !keys.includes("username") || !keys.includes("password")
            || typeof fields.username !== "string" || typeof fields.password !== "string") {
          errorJson(response, 400, "invalid_login_request", requestId); return;
        }
        const passwordMatches = await options.passwordVerifier.verify(fields.password);
        if (fields.username !== config.adminUsername || !passwordMatches) {
          errorJson(response, 401, "invalid_credentials", requestId); return;
        }
        const session = sessions.create({ actorId: config.adminUsername, login: config.adminUsername });
        response.setHeader("set-cookie", sessionCookie(session.token, config.sessionTtlSeconds));
        json(response, 200, { authenticated: true, actor: { actorId: session.claims.actorId, login: session.claims.login }, expiresAt: new Date(session.claims.expiresAt).toISOString() });
        return;
      }

      if (url.pathname === `${API_PREFIX}/logout`) {
        if (!noQuery(url)) { errorJson(response, 400, "invalid_query", requestId); return; }
        if (!originMatches(request, config.publicOrigin) || !isSameOriginMutation({
          origin: request.headers.origin,
          secFetchSite: request.headers["sec-fetch-site"],
        }, config.publicOrigin)) { errorJson(response, 403, "origin_required", requestId); return; }
        sessions.invalidate(sessionToken);
        response.setHeader("set-cookie", expiredSessionCookie());
        json(response, 200, { ok: true, requestId });
        return;
      }

      if (!noQuery(url)) { errorJson(response, 400, "invalid_query", requestId); return; }
      if (!actor) {
        errorJson(response, 401, "authentication_required", requestId);
        return;
      }
      const evidenceKey = url.pathname === `${API_PREFIX}/operations` ? "operations" : "sync";
      const handler = options.evidence?.[evidenceKey];
      if (!handler) {
        errorJson(response, 503, "evidence_unavailable", requestId);
        return;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), EVIDENCE_TIMEOUT_MS);
      try {
        json(response, 200, await handler({ requestId, actor: { actorId: actor.actorId }, signal: controller.signal }));
      } catch {
        errorJson(response, 503, "evidence_unavailable", requestId);
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      if (!response.headersSent) errorJson(response, 500, "internal_error", requestId);
      else response.destroy();
    }
  });
  server.keepAliveTimeout = 5_000;
  return server;
}

export function defaultRandomBytes(size: number): Buffer {
  return nodeRandomBytes(size);
}
