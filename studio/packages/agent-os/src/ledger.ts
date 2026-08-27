import {
  AGENT_OS_CONTRACT_VERSION,
  AGENT_RUN_LEDGER_VERSION,
  type AgentRunEvent,
  type AgentRunEventType,
  type AgentRunLedger,
  type AgentRunProjection,
  type DesignWorkOrder,
  type ExecutionPlan,
  type ExecutionStageStatus,
  type RunActor,
} from "./types.js";
import { AgentContractError, validateAgentRunEvent, validateDesignWorkOrder, validateExecutionPlan } from "./validation.js";

export type AppendAgentRunEventInput = Omit<AgentRunEvent, "contractVersion" | "sequence" | "workOrderId" | "planId">;

export type AgentRunErrorCode = "command.conflict" | "event.invalid" | "transition.invalid" | "actor.human_required";

export class AgentRunError extends Error {
  readonly code: AgentRunErrorCode;
  constructor(code: AgentRunErrorCode, message: string) {
    super(message);
    this.name = "AgentRunError";
    this.code = code;
  }
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function jsonSnapshot(value: unknown, path = "$", seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") throw new AgentRunError("event.invalid", `${path} contains a non-JSON value`);
  if (seen.has(value)) throw new AgentRunError("event.invalid", `${path} contains a cycle`);
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => jsonSnapshot(item, `${path}[${index}]`, seen));
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new AgentRunError("event.invalid", `${path} must be a plain object`);
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) result[key] = jsonSnapshot((value as Record<string, unknown>)[key], `${path}.${key}`, seen);
    return result;
  } finally {
    seen.delete(value);
  }
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function snapshot<T>(value: T): T {
  return freezeDeep(jsonSnapshot(value) as T);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(jsonSnapshot(left)) === JSON.stringify(jsonSnapshot(right));
}

function requireHuman(actor: RunActor, action: string): void {
  if (actor.kind !== "human") throw new AgentRunError("actor.human_required", `${action} requires a human actor`);
}

function requireState(actual: string, allowed: readonly string[], event: AgentRunEvent): void {
  if (!allowed.includes(actual)) throw new AgentRunError("transition.invalid", `${event.type} is not valid while status is ${actual}`);
}

function transitionStage(statuses: Record<string, ExecutionStageStatus>, event: AgentRunEvent, expected: readonly ExecutionStageStatus[], next: ExecutionStageStatus): void {
  const stageId = event.stageId;
  if (stageId === undefined || !(stageId in statuses)) throw new AgentRunError("transition.invalid", `Unknown stage: ${stageId ?? "missing"}`);
  requireState(statuses[stageId]!, expected, event);
  statuses[stageId] = next;
}

export function createAgentRunLedger(workOrder: DesignWorkOrder, plan: ExecutionPlan): AgentRunLedger {
  const workOrderResult = validateDesignWorkOrder(workOrder);
  const planResult = validateExecutionPlan(plan);
  if (!workOrderResult.ok) throw new AgentContractError("Design Work Order", workOrderResult.issues);
  if (!planResult.ok) throw new AgentContractError("Execution Plan", planResult.issues);
  if (plan.workOrderId !== workOrder.workOrderId) throw new AgentRunError("event.invalid", "Execution Plan belongs to a different Work Order");
  return snapshot({ ledgerVersion: AGENT_RUN_LEDGER_VERSION, workOrder, plan, events: [] });
}

export function replayAgentRunLedger(ledger: AgentRunLedger): AgentRunProjection {
  if (ledger.ledgerVersion !== AGENT_RUN_LEDGER_VERSION) throw new AgentRunError("event.invalid", "Unsupported run ledger version");
  const workOrderResult = validateDesignWorkOrder(ledger.workOrder);
  const planResult = validateExecutionPlan(ledger.plan);
  if (!workOrderResult.ok) throw new AgentContractError("Design Work Order", workOrderResult.issues);
  if (!planResult.ok) throw new AgentContractError("Execution Plan", planResult.issues);
  const stageStatuses = Object.fromEntries(ledger.plan.stages.map((stage) => [stage.stageId, "queued" as const])) as Record<string, ExecutionStageStatus>;
  let status: AgentRunProjection["status"] = "draft";
  let activeStageId: string | undefined;
  const commandIds = new Set<string>();
  ledger.events.forEach((event, index) => {
    const validation = validateAgentRunEvent(event);
    if (!validation.ok) throw new AgentContractError("Agent run event", validation.issues);
    if (event.sequence !== index + 1 || event.workOrderId !== ledger.workOrder.workOrderId || event.planId !== ledger.plan.planId || commandIds.has(event.commandId)) throw new AgentRunError("event.invalid", `Invalid event envelope at sequence ${event.sequence}`);
    commandIds.add(event.commandId);
    if (event.type === "plan_confirmed") {
      requireState(status, ["draft"], event);
      requireHuman(event.actor, "Plan confirmation");
      status = "confirmed";
      return;
    }
    if (event.type === "stage_started") {
      requireState(status, ["confirmed", "running"], event);
      const stageIndex = ledger.plan.stages.findIndex((stage) => stage.stageId === event.stageId);
      if (stageIndex < 0 || ledger.plan.stages.slice(0, stageIndex).some((stage) => stageStatuses[stage.stageId] !== "completed")) throw new AgentRunError("transition.invalid", "Stages must start in plan order after prior stages complete");
      if (activeStageId !== undefined) throw new AgentRunError("transition.invalid", `Stage ${activeStageId} is already active`);
      transitionStage(stageStatuses, event, ["queued"], "running");
      activeStageId = event.stageId;
      status = "running";
      return;
    }
    if (event.type === "stage_awaiting_input") {
      transitionStage(stageStatuses, event, ["running"], "awaiting-input");
      status = "awaiting-input";
      return;
    }
    if (event.type === "stage_resumed") {
      requireHuman(event.actor, "Stage resume");
      transitionStage(stageStatuses, event, ["awaiting-input"], "running");
      status = "running";
      return;
    }
    if (event.type === "stage_completed") {
      transitionStage(stageStatuses, event, ["running"], "completed");
      activeStageId = undefined;
      status = "running";
      return;
    }
    if (event.type === "stage_failed") {
      transitionStage(stageStatuses, event, ["running", "awaiting-input"], "failed");
      activeStageId = undefined;
      status = "failed";
      return;
    }
    if (event.type === "plan_completed") {
      requireState(status, ["running"], event);
      if (Object.values(stageStatuses).some((stageStatus) => stageStatus !== "completed")) throw new AgentRunError("transition.invalid", "Plan cannot complete before every stage completes");
      status = "completed";
      return;
    }
    if (event.type === "plan_failed") {
      requireState(status, ["failed"], event);
      status = "failed";
      return;
    }
    if (event.type === "plan_cancelled") {
      requireState(status, ["confirmed", "running", "awaiting-input"], event);
      requireHuman(event.actor, "Plan cancellation");
      Object.keys(stageStatuses).forEach((stageId) => {
        if (stageStatuses[stageId] === "queued" || stageStatuses[stageId] === "running" || stageStatuses[stageId] === "awaiting-input") stageStatuses[stageId] = "cancelled";
      });
      activeStageId = undefined;
      status = "cancelled";
    }
  });
  const result: AgentRunProjection = {
    workOrderId: ledger.workOrder.workOrderId,
    planId: ledger.plan.planId,
    status,
    stageStatuses: snapshot(stageStatuses),
    lastSequence: ledger.events.length,
  };
  if (activeStageId !== undefined) result.activeStageId = activeStageId;
  return snapshot(result);
}

function materializeEvent(ledger: AgentRunLedger, input: AppendAgentRunEventInput): AgentRunEvent {
  const event: AgentRunEvent = {
    ...input,
    contractVersion: AGENT_OS_CONTRACT_VERSION,
    sequence: ledger.events.length + 1,
    workOrderId: ledger.workOrder.workOrderId,
    planId: ledger.plan.planId,
  };
  return snapshot(event);
}

export function appendAgentRunEvent(ledger: AgentRunLedger, input: AppendAgentRunEventInput): AgentRunLedger {
  const existing = ledger.events.find((event) => event.commandId === input.commandId);
  if (existing !== undefined) {
    const comparable: AppendAgentRunEventInput = (({ contractVersion: _contract, sequence: _sequence, workOrderId: _workOrder, planId: _plan, ...rest }) => rest)(existing);
    if (sameJson(comparable, input)) return ledger;
    throw new AgentRunError("command.conflict", `Command ${input.commandId} already exists with different content`);
  }
  const next = snapshot<AgentRunLedger>({ ...ledger, events: [...ledger.events, materializeEvent(ledger, input)] });
  replayAgentRunLedger(next);
  return next;
}

export type RunEventInputFor<T extends AgentRunEventType> = AppendAgentRunEventInput & { type: T };
