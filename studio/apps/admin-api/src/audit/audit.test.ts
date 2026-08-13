import { describe, expect, it } from "vitest";
import type { DatabaseClient, DatabaseQuery } from "../data/types.js";
import { DatabaseAuditSink } from "./database-sink.js";
import { sanitizeAuditEvent } from "./sanitize.js";

describe("audit lane", () => {
  it("removes sensitive and unapproved metadata and strips query strings", () => {
    const event = sanitizeAuditEvent({
      requestId: "request-1", occurredAt: "2026-08-12T08:00:00Z", actorId: "1234",
      action: "operations.read", outcome: "success", route: "/admin-api/v1/operations?code=secret",
      latencyMs: 12.4, sourceIpHash: "ip-hash", userAgentHash: "ua-hash",
      metadata: { method: "GET", statusCode: 200, token: "secret", oauthCode: "secret", accessToken: "secret", arbitrary: "drop" },
    });
    expect(event.route).toBe("/admin-api/v1/operations");
    expect(event.metadata).toEqual({ method: "GET", statusCode: 200 });
    expect(JSON.stringify(event)).not.toContain("secret");
  });

  it("writes only through the bounded audit function", async () => {
    let captured: DatabaseQuery<unknown> | undefined;
    const client: DatabaseClient = {
      async query<T>(query: DatabaseQuery<T>) {
        captured = query;
        return { rows: [{ event_id: "event-1" }] as T[], rowCount: 1 };
      },
    };
    const event = sanitizeAuditEvent({
      requestId: "request-1", occurredAt: "2026-08-12T08:00:00Z",
      action: "session.read", outcome: "success", route: "/admin-api/v1/session", latencyMs: 5,
    });
    expect(await new DatabaseAuditSink(client).write(event)).toEqual({ written: true, eventId: "event-1" });
    expect(captured?.text).toContain("opendesign_admin_read.write_audit_event");
    expect(captured?.maxRows).toBe(1);
    expect(captured?.values).toHaveLength(9);
  });

  it("reports audit failure instead of pretending success", async () => {
    const client: DatabaseClient = { query: async () => { throw new Error("offline"); } };
    const event = sanitizeAuditEvent({
      requestId: "request-1", occurredAt: "2026-08-12T08:00:00Z",
      action: "session.read", outcome: "failure", route: "/admin-api/v1/session", latencyMs: 5,
    });
    expect(await new DatabaseAuditSink(client).write(event)).toEqual({ written: false, errorCode: "unavailable" });
  });
});
