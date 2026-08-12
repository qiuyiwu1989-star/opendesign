import { randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createOAuthStateManager,
  createSessionManager,
  expiredSessionCookie,
  readSessionCookie,
  sessionCookie,
  type AdminApiConfig,
  type GitHubOAuthAdapter,
  type SessionClaims,
} from "./auth/index.js";
import { applySecurityHeaders, assertExactQuery, errorJson, hasRequestBody, json, originMatches, redirect, safeReturnPath } from "./http/index.js";

const API_PREFIX = "/admin-api/v1";
const EVIDENCE_TIMEOUT_MS = 5_000;
const ROUTES = new Map<string, ReadonlySet<string>>([
  [`${API_PREFIX}/session`, new Set(["GET"])],
  [`${API_PREFIX}/auth/github/start`, new Set(["GET"])],
  [`${API_PREFIX}/auth/github/callback`, new Set(["GET"])],
  [`${API_PREFIX}/logout`, new Set(["POST"])],
  [`${API_PREFIX}/operations`, new Set(["GET"])],
  [`${API_PREFIX}/sync`, new Set(["GET"])],
  [`${API_PREFIX}/health/live`, new Set(["GET"])],
  [`${API_PREFIX}/health/ready`, new Set(["GET"])],
]);

export interface EvidenceContext {
  requestId: string;
  actor: Pick<SessionClaims, "githubUserId">;
  signal: AbortSignal;
}

export type EvidenceHandler = (context: EvidenceContext) => Promise<unknown>;

export interface AdminApiServerOptions {
  config: AdminApiConfig;
  oauth: GitHubOAuthAdapter;
  evidence?: {
    operations?: EvidenceHandler;
    sync?: EvidenceHandler;
  };
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}

function callbackUrl(config: AdminApiConfig): string {
  return `${config.publicOrigin}${API_PREFIX}/auth/github/callback`;
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
  const sessions = createSessionManager({
    secret: config.signingSecret,
    ttlSeconds: config.sessionTtlSeconds,
    ...(options.now ? { now: options.now } : {}),
    ...(options.randomBytes ? { randomBytes: options.randomBytes } : {}),
  });
  const states = createOAuthStateManager({
    secret: config.signingSecret,
    ttlSeconds: config.stateTtlSeconds,
    ...(options.now ? { now: options.now } : {}),
    ...(options.randomBytes ? { randomBytes: options.randomBytes } : {}),
  });

  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 10_000, headersTimeout: 10_000 }, async (request, response) => {
    const requestId = randomUUID();
    applySecurityHeaders(response, requestId);

    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
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
      if (hasRequestBody(request)) {
        errorJson(response, 400, "request_body_not_allowed", requestId);
        return;
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
        json(response, 200, { ok: true, requestId });
        return;
      }

      const sessionToken = readSessionCookie(request.headers.cookie);
      const actor = sessions.verify(sessionToken);
      if (url.pathname === `${API_PREFIX}/session`) {
        if (!noQuery(url)) { errorJson(response, 400, "invalid_query", requestId); return; }
        json(response, 200, actor
          ? { authenticated: true, actor: { githubUserId: actor.githubUserId, login: actor.login, ...(actor.avatarUrl ? { avatarUrl: actor.avatarUrl } : {}) }, expiresAt: new Date(actor.expiresAt).toISOString() }
          : { authenticated: false });
        return;
      }

      if (url.pathname === `${API_PREFIX}/auth/github/start`) {
        if (!assertExactQuery(url, new Set(["return"]))) { errorJson(response, 400, "invalid_query", requestId); return; }
        const returnPath = safeReturnPath(url.searchParams.get("return"));
        if (!returnPath) { errorJson(response, 400, "invalid_return_path", requestId); return; }
        const state = states.create(returnPath);
        redirect(response, options.oauth.createAuthorizationUrl({ state, redirectUri: callbackUrl(config) }));
        return;
      }

      if (url.pathname === `${API_PREFIX}/auth/github/callback`) {
        if (!assertExactQuery(url, new Set(["code", "state"]))) { errorJson(response, 400, "invalid_query", requestId); return; }
        const code = url.searchParams.get("code");
        const stateToken = url.searchParams.get("state");
        if (!code || code.length > 1024 || !stateToken) { errorJson(response, 400, "invalid_oauth_callback", requestId); return; }
        const state = states.consume(stateToken);
        if (!state) { errorJson(response, 400, "invalid_oauth_state", requestId); return; }
        const abort = AbortSignal.timeout(EVIDENCE_TIMEOUT_MS);
        let identity;
        try {
          identity = await options.oauth.authenticate({ code, redirectUri: callbackUrl(config), signal: abort });
        } catch {
          errorJson(response, 502, "github_identity_unavailable", requestId);
          return;
        }
        if (!config.allowedGitHubUserIds.has(identity.githubUserId)) {
          errorJson(response, 403, "identity_not_allowed", requestId);
          return;
        }
        const session = sessions.create(identity);
        response.setHeader("set-cookie", sessionCookie(session.token, config.sessionTtlSeconds));
        redirect(response, state.returnPath);
        return;
      }

      if (url.pathname === `${API_PREFIX}/logout`) {
        if (!noQuery(url)) { errorJson(response, 400, "invalid_query", requestId); return; }
        if (!originMatches(request, config.publicOrigin)) { errorJson(response, 403, "origin_required", requestId); return; }
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
        json(response, 200, await handler({ requestId, actor: { githubUserId: actor.githubUserId }, signal: controller.signal }));
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
