import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import type { DesignDirectorInput } from "@opendesign/studio-design-director";
import {
  ModelProviderFailure,
  createFixtureModelProvider,
  type ModelProvider,
} from "@opendesign/studio-model-adapter";
import {
  GenerationJobLimitError,
  GenerationJobManager,
  GenerationProviderUnavailableError,
  type GenerationJobStatus,
} from "./generation-jobs.js";

const scopeA = `scope_${"a".repeat(64)}`;
const scopeB = `scope_${"b".repeat(64)}`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-jobs-"));
  directories.push(directory);
  return directory;
}

function input(taskId = "job_task_01"): DesignDirectorInput {
  return {
    inputVersion: "0.1.0",
    taskId,
    title: "让生成结果保持可编辑",
    brief: { objective: "生成一份有来源且可继续编辑的提案。", audience: "产品与设计决策者", constraints: ["不得补造事实"] },
    content: {
      summary: "结构化 HTML 连接内容、设计与人工修改。",
      keyPoints: [
        { id: "point_diagnose", text: "先诊断需求，再生成内容", sourceIds: ["source_brief"] },
        { id: "point_edit", text: "生成后仍可逐元素修改", sourceIds: ["source_research"] },
      ],
      callToAction: "人工确认后再交付。",
    },
    sources: [
      { sourceId: "source_brief", type: "brief", title: "用户需求", content: "用户要求生成后可以人工编辑。" },
      { sourceId: "source_research", type: "document", title: "编辑性研究", content: "原生文字和替换式图片降低修改成本。" },
    ],
    brand: { name: "OpenDesign", tone: ["克制", "编辑感"] },
    deliverable: { kind: "proposal", audience: "产品与设计决策者", language: "zh-CN", format: "structured-html", pageCount: 6 },
    designPack: { id: "executive-proposal-cn", version: "1.0.0" },
    editability: {
      requiredCapabilities: ["text", "typography", "asset", "frame", "order"],
      requireNativeText: true,
      requireReplaceableImages: true,
      requireReorderablePages: true,
    },
  };
}

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `job_${String(index).padStart(8, "0")}`;
}

function managerOptions(rootDirectory: string, overrides: Partial<ConstructorParameters<typeof GenerationJobManager>[0]> = {}) {
  return {
    rootDirectory,
    provider: createFixtureModelProvider(),
    projectWriter: async () => undefined,
    id: ids("job_aaaaaaaa", "job_bbbbbbbb", "job_cccccccc"),
    ...overrides,
  };
}

describe("persistent scoped generation jobs", () => {
  it("runs the deterministic state machine and persists only after compiler/import acceptance", async () => {
    const directory = await temporaryDirectory();
    const writes: Array<{ scope: string; projectId: string }> = [];
    let tick = 0;
    const manager = new GenerationJobManager(managerOptions(directory, {
      now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
      projectWriter: async (scope, document) => { writes.push({ scope, projectId: document.documentId }); },
    }));
    await manager.initialize();
    const created = await manager.create(scopeA, input());
    assert.equal(created.status, "queued");
    assert.doesNotMatch(JSON.stringify(created), /scope_|source_brief|结构化 HTML/u);
    await manager.drain();

    const completed = manager.get(scopeA, created.jobId);
    assert.ok(completed);
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.stages.map((stage) => stage.status), ["queued", "analyzing", "generating", "validating", "completed"]);
    assert.equal(completed.projectId, "doc_job_task_01");
    assert.deepEqual(writes, [{ scope: scopeA, projectId: "doc_job_task_01" }]);
    assert.equal(manager.activeCount(scopeA), 0);
  });

  it("enforces ownership by scope and never includes scope in public projections", async () => {
    const manager = new GenerationJobManager(managerOptions(await temporaryDirectory()));
    await manager.initialize();
    const created = await manager.create(scopeA, input());
    assert.equal(manager.get(scopeB, created.jobId), null);
    assert.equal(await manager.cancel(scopeB, created.jobId), null);
    assert.deepEqual(manager.list(scopeB), []);
    assert.doesNotMatch(JSON.stringify(manager.list(scopeA)), /scope_/u);
    await manager.drain();
  });

  it("limits each scope to two active jobs while another scope remains independent", async () => {
    const directory = await temporaryDirectory();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const manager = new GenerationJobManager(managerOptions(directory, {
      stageYield: async (status) => { if (status === "analyzing") await blocked; },
    }));
    await manager.initialize();
    await manager.create(scopeA, input("job_task_01"));
    await manager.create(scopeA, input("job_task_02"));
    await assert.rejects(() => manager.create(scopeA, input("job_task_03")), GenerationJobLimitError);
    const other = await manager.create(scopeB, input("job_task_04"));
    assert.match(other.jobId, /^job_/u);
    release();
    await manager.drain();
  });

  it("cancels an active provider request and treats terminal cancellation as idempotent", async () => {
    const directory = await temporaryDirectory();
    let reachedGenerating!: () => void;
    const generating = new Promise<void>((resolve) => { reachedGenerating = resolve; });
    const provider: ModelProvider = {
      providerId: "abortable-provider",
      model: "model-v1",
      async generate({ signal }) {
        reachedGenerating();
        return await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    };
    const manager = new GenerationJobManager(managerOptions(directory, { provider }));
    await manager.initialize();
    const created = await manager.create(scopeA, input());
    await generating;
    const cancelled = await manager.cancel(scopeA, created.jobId);
    assert.equal(cancelled?.status, "cancelled");
    assert.deepEqual(await manager.cancel(scopeA, created.jobId), cancelled);
    await manager.drain();
    assert.equal(manager.get(scopeA, created.jobId)?.status, "cancelled");
    assert.equal(manager.activeCount(scopeA), 0);
  });

  it("serializes cancellation against a stage transition without reviving the job", async () => {
    const directory = await temporaryDirectory();
    let reachedAnalyzing!: () => void;
    const analyzing = new Promise<void>((resolve) => { reachedAnalyzing = resolve; });
    const manager = new GenerationJobManager(managerOptions(directory, {
      stageYield: async (status) => {
        if (status === "analyzing") reachedAnalyzing();
      },
    }));
    await manager.initialize();
    const created = await manager.create(scopeA, input());
    await analyzing;
    await manager.cancel(scopeA, created.jobId);
    await manager.drain();
    const cancelled = manager.get(scopeA, created.jobId);
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(cancelled?.stages.at(-1)?.status, "cancelled");
    assert.equal(cancelled?.stages.filter((stage) => stage.status === "cancelled").length, 1);
  });

  it("restores non-terminal persisted work as queued after restart", async () => {
    const directory = await temporaryDirectory();
    let block!: () => void;
    let reachedAnalyzing!: () => void;
    const gate = new Promise<void>((resolve) => { block = resolve; });
    const analyzing = new Promise<void>((resolve) => { reachedAnalyzing = resolve; });
    const first = new GenerationJobManager(managerOptions(directory, {
      stageYield: async (status) => {
        if (status === "analyzing") {
          reachedAnalyzing();
          await gate;
        }
      },
    }));
    await first.initialize();
    const created = await first.create(scopeA, input());
    await analyzing;

    const second = new GenerationJobManager(managerOptions(directory, { id: ids("job_dddddddd") }));
    await second.initialize();
    await second.drain();
    const restored = second.get(scopeA, created.jobId);
    assert.equal(restored?.status, "completed");
    assert.deepEqual(restored?.stages.map((stage) => stage.status), ["queued", "analyzing", "queued", "analyzing", "generating", "validating", "completed"]);
    block();
    await first.drain();
  });

  it("fails closed when no provider is configured", async () => {
    const manager = new GenerationJobManager(managerOptions(await temporaryDirectory(), { provider: null }));
    await manager.initialize();
    await assert.rejects(() => manager.create(scopeA, input()), GenerationProviderUnavailableError);
    assert.deepEqual(manager.list(scopeA), []);
  });

  it("stores a stable redacted error and never writes a project for rejected output", async () => {
    const directory = await temporaryDirectory();
    const secret = "sk-sensitive-provider-credential";
    let writes = 0;
    const provider: ModelProvider = {
      providerId: "failing-provider",
      model: "model-v1",
      async generate() {
        throw new ModelProviderFailure("provider.failure", `authorization=Bearer-${secret} password=hunter2`, { retryable: true });
      },
    };
    const manager = new GenerationJobManager(managerOptions(directory, {
      provider,
      projectWriter: async () => { writes += 1; },
    }));
    await manager.initialize();
    const created = await manager.create(scopeA, input());
    await manager.drain();
    const failed = manager.get(scopeA, created.jobId);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.error?.code, "provider.failure");
    assert.equal(failed?.error?.retryable, true);
    assert.doesNotMatch(JSON.stringify(failed), /hunter2|sensitive-provider-credential/u);
    assert.equal(writes, 0);
    const persisted = await readFile(join(directory, "sessions", scopeA, "generation-jobs", `${created.jobId}.json`), "utf8");
    assert.doesNotMatch(persisted, /hunter2|sensitive-provider-credential/u);
  });

  it("fails closed at the deterministic document gate before persisting a project", async () => {
    const directory = await temporaryDirectory();
    let writes = 0;
    const checks: Array<{ accepted: boolean; documentId: string }> = [];
    const manager = new GenerationJobManager(managerOptions(directory, {
      documentGate: async () => ({ accepted: false, code: "qa_failed", message: "2 layout errors", retryable: false }),
      onDocumentChecked: async (_scope, _input, document, gate) => { checks.push({ accepted: gate.accepted, documentId: document.documentId }); },
      projectWriter: async () => { writes += 1; },
    }));
    await manager.initialize();
    const created = await manager.create(scopeA, input());
    await manager.drain();
    const failed = manager.get(scopeA, created.jobId);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.error?.code, "qa_failed");
    assert.equal(failed?.error?.retryable, false);
    assert.equal(writes, 0);
    assert.deepEqual(checks, [{ accepted: false, documentId: "doc_job_task_01" }]);
  });

  it("rejects untrusted scope paths before touching disk", async () => {
    const manager = new GenerationJobManager(managerOptions(await temporaryDirectory()));
    await manager.initialize();
    await assert.rejects(() => manager.create("../../etc", input()), /Invalid session scope hash/u);
    assert.throws(() => manager.get("not-a-scope", "job_aaaaaaaa"), /Invalid session scope hash/u);
  });
});
