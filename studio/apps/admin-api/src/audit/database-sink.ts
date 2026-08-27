import type { DatabaseClient } from "../data/types.js";
import type { AuditEvent, AuditSink, AuditWriteResult } from "./types.js";

export class DatabaseAuditSink implements AuditSink {
  constructor(
    private readonly client: DatabaseClient,
    private readonly timeoutMs = 1_500,
  ) {}

  async write(event: AuditEvent): Promise<AuditWriteResult> {
    try {
      const result = await this.client.query<{ event_id: string }>({
        text: "select event_id from opendesign_admin_read.write_audit_event($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
        values: [event.requestId, event.occurredAt, event.actorId ?? null, event.action,
          event.outcome, event.route, event.latencyMs, event.sourceIpHash ?? null,
          JSON.stringify({ ...event.metadata, userAgentHash: event.userAgentHash ?? null })],
        timeoutMs: Math.max(100, Math.min(this.timeoutMs, 5_000)), maxRows: 1,
      });
      const eventId = result.rows[0]?.event_id;
      return eventId ? { written: true, eventId } : { written: false, errorCode: "rejected" };
    } catch {
      return { written: false, errorCode: "unavailable" };
    }
  }
}
