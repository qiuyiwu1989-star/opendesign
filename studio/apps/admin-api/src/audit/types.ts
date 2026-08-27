export type AuditOutcome = "success" | "denied" | "failure";

export interface AuditEventInput {
  requestId: string;
  occurredAt: string;
  actorId?: string;
  action: string;
  outcome: AuditOutcome;
  route: string;
  latencyMs: number;
  sourceIpHash?: string;
  userAgentHash?: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface AuditEvent {
  requestId: string;
  occurredAt: string;
  actorId?: string;
  action: string;
  outcome: AuditOutcome;
  route: string;
  latencyMs: number;
  sourceIpHash?: string;
  userAgentHash?: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}

export interface AuditWriteResult {
  written: boolean;
  eventId?: string;
  errorCode?: "unavailable" | "rejected";
}

/** Narrow interface: callers cannot execute SQL or claim an unwritten event. */
export interface AuditSink {
  write(event: AuditEvent): Promise<AuditWriteResult>;
}
