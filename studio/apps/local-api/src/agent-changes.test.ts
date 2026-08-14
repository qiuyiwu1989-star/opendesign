import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "../../../packages/contracts/fixtures/proposal-v0.json" with { type: "json" };
import type { SceneDocument } from "@opendesign/studio-contracts";
import { hashPublicSessionScope } from "./public-session.js";
import { LocalProjectStore } from "./storage.js";
import { AgentChangeConflictError, AgentChangeInstructionError, AgentChangeLimitError, AgentChangeManager, AgentChangeNotFoundError } from "./agent-changes.js";

const document = fixture as SceneDocument;
const secret = "test-only-agent-change-scope-secret-at-least-32-bytes";
const scope = (fill: number) => hashPublicSessionScope(Buffer.from(new Uint8Array(32).fill(fill)).toString("base64url"), secret);

test("009 creates a page-level candidate without mutating the project, then accepts it as one revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-agent-change-"));
  try {
    let candidateIndex = 0;
    const store = new LocalProjectStore(directory);
    const owner = scope(1);
    await store.createForOwner(owner, document);
    const manager = new AgentChangeManager({ rootDirectory: directory, store, id: () => `change_${String(++candidateIndex).padStart(8, "0")}` });
    const before = await store.currentRevisionForOwner(owner, document.documentId);
    assert.ok(before);
    const scene = document.scenes[0]!;
    const title = scene.elements.find((element) => element.role === "title")!;
    const candidate = await manager.create(owner, document.documentId, { instruction: "请把这一页标题改成：设计判断必须先于视觉执行", target: { kind: "scene", sceneId: scene.id } });
    assert.equal(candidate.status, "proposed");
    assert.equal(candidate.baseRevisionId, before.revision.revisionId);
    assert.deepEqual(candidate.diffs, [{ elementId: title.id, field: "content", before: title.content, after: "设计判断必须先于视觉执行" }]);
    assert.equal((await store.listRevisionsForOwner(owner, document.documentId)).length, 1);
    assert.equal((await store.readForOwner(owner, document.documentId))?.scenes[0]?.elements.find((element) => element.id === title.id)?.content, title.content);

    const accepted = await manager.accept(owner, document.documentId, candidate.candidateId, "这条标题准确表达了本页判断");
    assert.equal(accepted.candidate.status, "accepted");
    assert.equal(accepted.revision.reason, "regenerate");
    assert.equal(accepted.document.scenes[0]?.elements.find((element) => element.id === title.id)?.content, "设计判断必须先于视觉执行");
    assert.equal((await store.listRevisionsForOwner(owner, document.documentId)).length, 2);
    const repeated = await manager.accept(owner, document.documentId, candidate.candidateId, "重复请求仍返回同一决定");
    assert.equal(repeated.revision.revisionId, accepted.revision.revisionId);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("009 supports an explicit element target and rejection never writes a revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-agent-change-reject-"));
  try {
    const store = new LocalProjectStore(directory);
    const owner = scope(2);
    await store.createForOwner(owner, document);
    const manager = new AgentChangeManager({ rootDirectory: directory, store, id: () => "change_bbbbbbbb" });
    const element = document.scenes[0]!.elements.find((item) => item.role === "title")!;
    const candidate = await manager.create(owner, document.documentId, { instruction: "改为：保留人工判断，再让 Agent 提出候选", target: { kind: "element", sceneId: document.scenes[0]!.id, elementId: element.id } });
    const rejected = await manager.reject(owner, document.documentId, candidate.candidateId, "当前表达更适合目标受众");
    assert.equal(rejected.candidate.status, "rejected");
    assert.equal((await store.listRevisionsForOwner(owner, document.documentId)).length, 1);
    await assert.rejects(() => manager.accept(owner, document.documentId, candidate.candidateId, "尝试反转已经拒绝的决定"), AgentChangeConflictError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("009 marks a stale candidate conflicted and never overwrites a newer human revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-agent-change-drift-"));
  try {
    const store = new LocalProjectStore(directory);
    const owner = scope(3);
    await store.createForOwner(owner, document);
    const manager = new AgentChangeManager({ rootDirectory: directory, store, id: () => "change_cccccccc" });
    const scene = document.scenes[0]!;
    const candidate = await manager.create(owner, document.documentId, { instruction: "标题改成：Agent 修改必须先显示差异", target: { kind: "scene", sceneId: scene.id } });
    const human = structuredClone(document);
    human.title = "人工刚刚保存的新版本";
    await store.appendRevisionForOwner(owner, document.documentId, human, { reason: "edit", patches: [] });
    await assert.rejects(() => manager.accept(owner, document.documentId, candidate.candidateId, "希望采用 Agent 标题"), AgentChangeConflictError);
    assert.equal((await store.readForOwner(owner, document.documentId))?.title, "人工刚刚保存的新版本");
    assert.equal((await manager.list(owner, document.documentId))[0]?.status, "conflicted");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("009 isolates candidates by owner and fails closed for unknown instructions and malformed files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-agent-change-safety-"));
  try {
    const store = new LocalProjectStore(directory);
    const first = scope(4);
    const second = scope(5);
    await store.createForOwner(first, document);
    const manager = new AgentChangeManager({ rootDirectory: directory, store, id: () => "change_dddddddd" });
    await assert.rejects(() => manager.create(first, document.documentId, { instruction: "帮我优化一下", target: { kind: "scene", sceneId: document.scenes[0]!.id } }), AgentChangeInstructionError);
    const candidate = await manager.create(first, document.documentId, { instruction: "改成：一个可以被审查的修改候选", target: { kind: "scene", sceneId: document.scenes[0]!.id } });
    assert.deepEqual(await manager.list(second, document.documentId), []);
    await assert.rejects(() => manager.accept(second, document.documentId, candidate.candidateId, "另一匿名空间不能接受"), AgentChangeNotFoundError);
    const badDirectory = join(directory, "sessions", first, "agent-changes", document.documentId);
    await mkdir(badDirectory, { recursive: true });
    await writeFile(join(badDirectory, "change_eeeeeeee.json"), "{\"status\":\"accepted\"}\n");
    assert.deepEqual((await manager.list(first, document.documentId)).map((item) => item.candidateId), [candidate.candidateId]);
    const candidatePath = join(badDirectory, `${candidate.candidateId}.json`);
    const tampered = JSON.parse(await readFile(candidatePath, "utf8")) as { proposedDocument: SceneDocument };
    tampered.proposedDocument.title = "候选快照夹带的额外修改";
    await writeFile(candidatePath, `${JSON.stringify(tampered)}\n`);
    await assert.rejects(() => manager.accept(first, document.documentId, candidate.candidateId, "不应接受被篡改的候选快照"), AgentChangeInstructionError);
    const limited = new AgentChangeManager({ rootDirectory: directory, store, maxPerScope: 1, id: () => "change_ffffffff" });
    await assert.rejects(() => limited.create(first, document.documentId, { instruction: "改成：第二个候选不能绕过空间配额", target: { kind: "scene", sceneId: document.scenes[0]!.id } }), AgentChangeLimitError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
