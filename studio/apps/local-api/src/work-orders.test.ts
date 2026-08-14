import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { GenerationJob, GenerationJobStatus } from "./generation-jobs.js";
import { WorkOrderDecisionConflictError, WorkOrderLimitError, WorkOrderManager } from "./work-orders.js";

const scopeA = "a".repeat(64);
const scopeB = "b".repeat(64);
const workOrderId = "workorder_aaaaaaaa";
const now = "2026-08-14T04:00:00.000Z";

function job(status: GenerationJobStatus, overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    jobId: "job_aaaaaaaa",
    status,
    createdAt: now,
    updatedAt: now,
    stages: [{ status, at: now }],
    ...overrides,
  };
}

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "opendesign-work-orders-"));
}

async function completeCreationDecisions(manager: WorkOrderManager, scope = scopeA): Promise<void> {
  const workflow = manager.get(scope, workOrderId);
  assert.ok(workflow);
  if (workflow.clarification.status === "required") {
    await manager.answerClarifications(scope, workOrderId, workflow.clarification.questions.map((question) => ({
      questionId: question.questionId,
      answer: question.questionId === "clarify_audience" ? "面向产品负责人与管理层" : "确认是否进入下一阶段并批准试点",
    })));
  }
  await manager.selectDirection(scope, workOrderId, workflow.selectedDirectionId);
}

test("creates a private draft Creation Contract without starting generation", async () => {
  const directory = await temporaryDirectory();
  try {
    const manager = new WorkOrderManager({ rootDirectory: directory, now: () => new Date(now), id: () => workOrderId });
    await manager.initialize();
    const workflow = await manager.create(scopeA, { brief: "把一篇关于 Agent 设计工作流的文章做成六页可编辑提案。" });
    assert.equal(workflow.projection.status, "draft");
    assert.equal(workflow.events.length, 0);
    assert.equal(workflow.plan.designPack.id, "executive-proposal-cn");
    assert.deepEqual(workflow.plan.capabilityPins.map((pin) => pin.id), ["opendesign-design-director", "narrative-architect", "art-director", "design-critic"]);
    assert.deepEqual(workflow.plan.stages.map((stage) => stage.kind), ["diagnose", "direction", "compose", "import", "qa", "edit", "review", "export"]);
    assert.equal(workflow.clarification.questions.length, 2);
    assert.equal(workflow.directionPreviews.length, 3);
    assert.equal(new Set(workflow.directionPreviews.map((direction) => direction.pack.id)).size, 3);
    assert.equal(workflow.readyForConfirmation, false);
    assert.equal(manager.get(scopeB, workOrderId), null);
    const persisted = JSON.parse(await readFile(join(directory, "sessions", scopeA, "work-orders", `${workOrderId}.json`), "utf8")) as { generationInput: { brief: { objective: string }; taskId: string }; scopeHash: string };
    assert.equal(persisted.scopeHash, scopeA);
    assert.equal(persisted.generationInput.taskId, workOrderId);
    assert.match(persisted.generationInput.brief.objective, /Agent 设计工作流/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires one bounded clarification round and an explicit real direction before confirmation", async () => {
  const directory = await temporaryDirectory();
  try {
    const manager = new WorkOrderManager({ rootDirectory: directory, now: () => new Date(now), id: () => workOrderId });
    await manager.initialize();
    const created = await manager.create(scopeA, { brief: "把这些材料整理成一套清晰、可编辑并可以导出的六页提案。" });
    await assert.rejects(() => manager.confirm(scopeA, workOrderId, async () => job("queued"), () => null), WorkOrderDecisionConflictError);
    const clarified = await manager.answerClarifications(scopeA, workOrderId, created.clarification.questions.map((question) => ({
      questionId: question.questionId,
      answer: question.questionId === "clarify_audience" ? "给业务负责人和评审委员会看" : "批准方案并确定下周的执行负责人",
    })));
    assert.equal(clarified.clarification.status, "complete");
    assert.equal(clarified.readyForConfirmation, false);
    await assert.rejects(() => manager.answerClarifications(scopeA, workOrderId, []), WorkOrderDecisionConflictError);
    const direction = clarified.directionPreviews.find((item) => item.pack.id === "research-keynote-cn");
    assert.ok(direction);
    const ready = await manager.selectDirection(scopeA, workOrderId, direction.directionId);
    assert.equal(ready.directionConfirmed, true);
    assert.equal(ready.readyForConfirmation, true);
    assert.equal(ready.plan.designPack.id, "research-keynote-cn");
    assert.equal(ready.workOrder.audience.description, "给业务负责人和评审委员会看");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an unapproved Design Pack before persisting a Work Order", async () => {
  const directory = await temporaryDirectory();
  try {
    const manager = new WorkOrderManager({ rootDirectory: directory, id: () => workOrderId });
    await manager.initialize();
    await assert.rejects(
      () => manager.create(scopeA, { brief: "把产品内容整理为一套可编辑提案，并保留来源和人工确认。", designPack: { id: "unknown-pack", version: "1.0.0" } }),
      /not available in the approved catalog/u,
    );
    assert.equal(manager.get(scopeA, workOrderId), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bounds persisted Work Orders per anonymous scope", async () => {
  const directory = await temporaryDirectory();
  try {
    let index = 0;
    const manager = new WorkOrderManager({ rootDirectory: directory, maxPerScope: 1, id: () => `workorder_${String(++index).padStart(8, "0")}` });
    await manager.initialize();
    await manager.create(scopeA, { brief: "把已有材料制作成一份可以编辑并由人工确认的提案。" });
    await assert.rejects(
      () => manager.create(scopeA, { brief: "第二个任务不应该绕过匿名空间的持久化数量边界。" }),
      WorkOrderLimitError,
    );
    await manager.create(scopeB, { brief: "另一个匿名空间拥有独立的任务数量配额与持久化目录。" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("requires human plan confirmation, starts one job idempotently, and records automatic stages", async () => {
  const directory = await temporaryDirectory();
  try {
    const manager = new WorkOrderManager({ rootDirectory: directory, now: () => new Date(now), id: () => workOrderId });
    await manager.initialize();
    await manager.create(scopeA, { brief: "把现有内容整理为有证据边界、可编辑并可导出的商业提案。" });
    await completeCreationDecisions(manager);
    let creates = 0;
    const jobs = new Map<string, GenerationJob>();
    const createJob = async () => {
      creates += 1;
      const created = job("queued");
      jobs.set(created.jobId, created);
      return created;
    };
    const first = await manager.confirm(scopeA, workOrderId, createJob, (jobId) => jobs.get(jobId) ?? null);
    assert.equal(first.workflow.projection.status, "confirmed");
    assert.equal(first.workflow.events[0]?.type, "plan_confirmed");
    assert.equal(first.workflow.events[0]?.actor.kind, "human");
    assert.equal(first.workflow.generationJobId, "job_aaaaaaaa");

    const second = await manager.confirm(scopeA, workOrderId, createJob, (jobId) => jobs.get(jobId) ?? null);
    assert.equal(second.job.jobId, first.job.jobId);
    assert.equal(creates, 1);

    for (const status of ["analyzing", "generating", "validating", "completed"] as const) {
      await manager.recordGenerationTransition(scopeA, workOrderId, job(status, status === "completed" ? { projectId: "project_aaaaaaaa" } : {}));
    }
    const completed = manager.get(scopeA, workOrderId);
    assert.ok(completed);
    for (const stageId of ["stage_diagnose", "stage_direction", "stage_compose", "stage_import", "stage_qa"]) {
      assert.equal(completed.projection.stageStatuses[stageId], "completed");
    }
    assert.equal(completed.projection.stageStatuses.stage_edit, "queued");
    assert.equal(completed.projection.status, "running");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restores only valid owner-scoped Work Orders and records human cancellation", async () => {
  const directory = await temporaryDirectory();
  try {
    const first = new WorkOrderManager({ rootDirectory: directory, now: () => new Date(now), id: () => workOrderId });
    await first.initialize();
    await first.create(scopeA, { brief: "为产品负责人制作一套说明 Agent Studio 路径的六页提案。" });
    await completeCreationDecisions(first);
    const createdJob = job("queued");
    await first.confirm(scopeA, workOrderId, async () => createdJob, () => null);
    await first.recordGenerationTransition(scopeA, workOrderId, job("analyzing"));

    const restored = new WorkOrderManager({ rootDirectory: directory, now: () => new Date(now) });
    await restored.initialize();
    assert.equal(restored.get(scopeA, workOrderId)?.projection.status, "running");
    assert.equal(restored.get(scopeB, workOrderId), null);
    await restored.cancelForJob(scopeA, createdJob.jobId);
    const cancelled = restored.get(scopeA, workOrderId);
    assert.equal(cancelled?.projection.status, "cancelled");
    assert.equal(cancelled?.events.at(-1)?.actor.kind, "human");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
