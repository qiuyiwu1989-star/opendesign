import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  buildUnavailableOperationsEnvelope,
  createOperationsApiMiddleware,
} from "./operations-middleware";

const now = "2026-08-12T05:00:00.000Z";

function request(method: string, url: string): IncomingMessage {
  return Object.assign(new EventEmitter(), { method, url }) as IncomingMessage;
}

function response() {
  const headers = new Map<string, string>();
  let body = "";
  const result = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers.set(name, value); },
    end(value = "") { body += value; },
  };
  return {
    value: result as unknown as ServerResponse,
    headers,
    body: () => body,
    status: () => result.statusCode,
  };
}

describe("buildUnavailableOperationsEnvelope", () => {
  it("returns empty, explicitly unavailable operational evidence", () => {
    expect(buildUnavailableOperationsEnvelope(now)).toEqual({
      source: {
        kind: "unavailable",
        label: "production operations evidence",
        generatedAt: now,
        detail: "Development middleware does not read production review or pipeline data.",
      },
      observedAt: now,
      diagnostics: [{
        code: "operations-provider-unavailable",
        level: "info",
        message: "Development middleware does not read production review or pipeline data.",
      }],
      submissions: {
        source: {
          kind: "unavailable",
          label: "production submissions",
          detail: "Development middleware does not read production review or pipeline data.",
        },
        items: [],
      },
      discoveries: {
        source: {
          kind: "unavailable",
          label: "production discoveries",
          detail: "Development middleware does not read production review or pipeline data.",
        },
        items: [],
      },
      quality: {
        source: {
          kind: "unavailable",
          label: "production quality evidence",
          detail: "Development middleware does not read production review or pipeline data.",
        },
        items: [],
      },
      origins: {
        source: {
          kind: "unavailable",
          label: "production origin evidence",
          detail: "Development middleware does not read production review or pipeline data.",
        },
        items: [],
      },
      jobs: {
        source: {
          kind: "unavailable",
          label: "production jobs",
          detail: "Development middleware does not read production review or pipeline data.",
        },
        items: [],
      },
      logs: {
        source: {
          kind: "unavailable",
          label: "production logs",
          detail: "Development middleware does not read production review or pipeline data.",
        },
        items: [],
      },
    });
  });
});

describe("createOperationsApiMiddleware", () => {
  it("passes unrelated routes through", () => {
    const next = vi.fn();
    createOperationsApiMiddleware(now)(request("GET", "/elsewhere"), response().value, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects non-GET methods", () => {
    const output = response();
    createOperationsApiMiddleware(now)(
      request("POST", "/admin-api/v1/operations"),
      output.value,
      vi.fn(),
    );
    expect(output.status()).toBe(405);
    expect(output.headers.get("allow")).toBe("GET");
    expect(JSON.parse(output.body())).toMatchObject({ readOnly: true });
  });

  it("serves a no-store unavailable envelope for GET", () => {
    const output = response();
    createOperationsApiMiddleware(now)(
      request("GET", "/admin-api/v1/operations?fresh=1"),
      output.value,
      vi.fn(),
    );
    expect(output.status()).toBe(200);
    expect(output.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(output.body())).toMatchObject({
      source: { kind: "unavailable" },
      observedAt: now,
      submissions: { source: { kind: "unavailable" }, items: [] },
      discoveries: { source: { kind: "unavailable" }, items: [] },
      quality: { source: { kind: "unavailable" }, items: [] },
      origins: { source: { kind: "unavailable" }, items: [] },
      jobs: { source: { kind: "unavailable" }, items: [] },
      logs: { source: { kind: "unavailable" }, items: [] },
    });
  });
});
