import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "../../../packages/contracts/fixtures/proposal-v0.json" with { type: "json" };
import type { SceneDocument } from "@opendesign/studio-contracts";
import { LocalProjectStore } from "./storage.js";

const document = fixture as SceneDocument;

test("local project store writes atomically and reads a validated Scene document", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-store-"));
  try {
    const store = new LocalProjectStore(directory);
    assert.equal(await store.read(document.documentId), null);
    await store.write(document.documentId, document);
    assert.deepEqual(await store.read(document.documentId), document);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("local project store rejects traversal and mismatched document identity", async () => {
  const store = new LocalProjectStore(join(tmpdir(), "unused-opendesign-store"));
  await assert.rejects(() => store.read("../escape"), /Invalid project ID/);
  await assert.rejects(() => store.write("different_project", document), /does not match/);
});

test("local project store lists projects and keeps full revision snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-history-"));
  try {
    const store = new LocalProjectStore(directory);
    await store.create(document);
    const revised = structuredClone(document);
    revised.title = "Revised Studio project";
    await store.appendRevision(document.documentId, revised, { reason: "edit", patches: [] });
    const projects = await store.list();
    const revisions = await store.listRevisions(document.documentId);
    assert.equal(projects[0]?.title, "Revised Studio project");
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0]?.revision.reason, "edit");
    assert.equal(revisions[0]?.revision.parentRevisionId, revisions[1]?.revision.revisionId);
    assert.equal(revisions[1]?.document.title, document.title);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
