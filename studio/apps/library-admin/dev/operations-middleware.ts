import type { IncomingMessage, ServerResponse } from "node:http";

export type OperationsMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

interface UnavailableOperationsSection {
  source: {
    kind: "unavailable";
    label: string;
    detail: string;
  };
  items: [];
}

interface OperationsUnavailableEnvelope {
  source: {
    kind: "unavailable";
    label: string;
    generatedAt: string;
    detail: string;
  };
  observedAt: string;
  diagnostics: Array<{
    code: string;
    level: "info";
    message: string;
  }>;
  submissions: UnavailableOperationsSection;
  discoveries: UnavailableOperationsSection;
  quality: UnavailableOperationsSection;
  origins: UnavailableOperationsSection;
  jobs: UnavailableOperationsSection;
  logs: UnavailableOperationsSection;
}

function observedAt(value?: string): string {
  return value && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString();
}

export function buildUnavailableOperationsEnvelope(now?: string): OperationsUnavailableEnvelope {
  const observed = observedAt(now);
  const detail = "Development middleware does not read production review or pipeline data.";
  const section = (label: string): UnavailableOperationsSection => ({
    source: { kind: "unavailable", label, detail },
    items: [],
  });
  return {
    source: {
      kind: "unavailable",
      label: "production operations evidence",
      generatedAt: observed,
      detail,
    },
    observedAt: observed,
    diagnostics: [{
      code: "operations-provider-unavailable",
      level: "info",
      message: detail,
    }],
    submissions: section("production submissions"),
    discoveries: section("production discoveries"),
    quality: section("production quality evidence"),
    origins: section("production origin evidence"),
    jobs: section("production jobs"),
    logs: section("production logs"),
  };
}

/**
 * Local development endpoint only. It intentionally returns an explicit
 * unavailable envelope and performs no database, RPC, credential, or network
 * access.
 */
export function createOperationsApiMiddleware(now?: string): OperationsMiddleware {
  return (request, response, next) => {
    const path = request.url?.split("?", 1)[0];
    if (path !== "/admin-api/v1/operations") return next();
    if (request.method !== "GET") {
      response.statusCode = 405;
      response.setHeader("allow", "GET");
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "method_not_allowed", readOnly: true }));
      return;
    }
    response.statusCode = 200;
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(buildUnavailableOperationsEnvelope(now)));
  };
}
