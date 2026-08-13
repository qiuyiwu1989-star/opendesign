import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "../../../packages/contracts/fixtures/proposal-v0.json" with { type: "json" };
import type { SceneDocument } from "@opendesign/studio-contracts";
import { hashPublicSessionScope, PublicSessionQuotaError, type PublicSessionRecord } from "./public-session.js";
import { cleanupExpiredSessionScopes, LocalProjectStore } from "./storage.js";

const document = fixture as SceneDocument;
const scopeSecret = "test-only-session-scope-key-with-at-least-thirty-two-bytes";
const sessionId = (fill: number) => Buffer.from(new Uint8Array(32).fill(fill)).toString("base64url");
const scope = (fill: number) => hashPublicSessionScope(sessionId(fill), scopeSecret);

function sessionRecord(ownerScope: ReturnType<typeof scope>, createdAt: string, expiresAt: string, maximumExpiresAt: string): PublicSessionRecord {
  return { version: 1, scope: ownerScope, createdAt, lastSeenAt: createdAt, expiresAt, maximumExpiresAt };
}

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

test("owner-scoped projects and revisions are isolated and legacy demo data never leaks into anonymous lists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-owner-store-"));
  try {
    const store = new LocalProjectStore(directory);
    const first = scope(1);
    const second = scope(2);
    await store.create(document);
    await store.createForOwner(first, document);

    assert.equal((await store.list()).length, 1);
    assert.equal((await store.listForOwner(first)).length, 1);
    assert.equal((await store.listForOwner(second)).length, 0);
    assert.equal(await store.readForOwner(second, document.documentId), null);
    assert.equal((await store.listRevisionsForOwner(first, document.documentId)).length, 1);
    assert.equal((await store.listRevisionsForOwner(second, document.documentId)).length, 0);

    const revised = structuredClone(document);
    revised.title = "Only first owner sees this";
    await store.appendRevisionForOwner(first, document.documentId, revised, { reason: "edit", patches: [] });
    assert.equal((await store.readForOwner(first, document.documentId))?.title, revised.title);
    assert.equal(await store.readForOwner(second, document.documentId), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("owner-scoped create enforces reusable project and revision quotas without partial writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-owner-quota-"));
  try {
    const owner = scope(3);
    const store = new LocalProjectStore(directory, { projects: 1, revisions: 1, assetBytes: 0, exports: 0, runningJobs: 0 });
    await store.createForOwner(owner, document);

    const secondDocument = structuredClone(document);
    secondDocument.documentId = "doc_second_project";
    await assert.rejects(
      () => store.createForOwner(owner, secondDocument),
      (error) => error instanceof PublicSessionQuotaError && error.resource === "projects",
    );
    await assert.rejects(
      () => store.appendRevisionForOwner(owner, document.documentId, document, { reason: "edit", patches: [] }),
      (error) => error instanceof PublicSessionQuotaError && error.resource === "revisions",
    );
    assert.equal((await store.listForOwner(owner)).length, 1);
    assert.equal((await store.listRevisionsForOwner(owner, document.documentId)).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("session metadata and owner documents use atomic files with no raw session identifier in paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-owner-atomic-"));
  try {
    const owner = scope(4);
    const rawId = sessionId(4);
    const now = "2026-08-14T00:00:00.000Z";
    const record = sessionRecord(owner, now, "2026-08-21T00:00:00.000Z", "2026-09-13T00:00:00.000Z");
    let randomCounter = 0;
    const store = new LocalProjectStore(
      directory,
      undefined,
      { now: () => new Date(now) },
      { uuid: () => `${(++randomCounter).toString().padStart(8, "0")}-0000-4000-8000-000000000000` },
    );
    await store.writeSessionRecord(record);
    await store.createForOwner(owner, document);

    const metadataText = await readFile(join(directory, "sessions", owner, "session.json"), "utf8");
    assert.equal(metadataText.includes(rawId), false);
    assert.deepEqual(await store.readSessionRecord(owner), record);
    assert.match((await store.listRevisionsForOwner(owner, document.documentId))[0]!.revision.revisionId, /_00000002$/);
    const allNames = await import("node:fs/promises").then(({ readdir }) => readdir(join(directory, "sessions", owner, "projects")));
    assert.deepEqual(allNames, [`${document.documentId}.json`]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("expired session cleanup reports before deletion, preserves live and unsafe scopes, and supports dry-run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-owner-cleanup-"));
  try {
    const expired = scope(5);
    const live = scope(6);
    const clock = { now: () => new Date("2026-08-14T00:00:00.000Z") };
    const store = new LocalProjectStore(directory, undefined, clock);
    await mkdir(join(directory, "sessions"), { recursive: true });
    await store.writeSessionRecord(sessionRecord(live, "2026-08-10T00:00:00.000Z", "2026-08-17T00:00:00.000Z", "2026-09-09T00:00:00.000Z"));
    await store.createForOwner(live, document);
    await mkdir(join(directory, "sessions", expired), { recursive: true });
    await writeFile(join(directory, "sessions", expired, "session.json"), `${JSON.stringify(sessionRecord(expired, "2026-08-01T00:00:00.000Z", "2026-08-08T00:00:00.000Z", "2026-08-31T00:00:00.000Z"))}\n`);
    await store.createForOwner(expired, document);
    await mkdir(join(directory, "sessions", "not-a-scope"), { recursive: true });
    const outside = await mkdtemp(join(tmpdir(), "opendesign-cleanup-outside-"));
    await symlink(outside, join(directory, "sessions", scope(7)));

    const observed: string[] = [];
    const preview = await cleanupExpiredSessionScopes(directory, { clock, dryRun: true, onSummary: (summary) => { observed.push(`before:${summary.scope}:${summary.removed}`); } });
    assert.equal(preview.expired, 1);
    assert.equal(preview.removed, 0);
    assert.equal(preview.skippedUnsafe, 2);
    assert.deepEqual(observed, [`before:${expired}:false`]);
    assert.equal((await store.listForOwner(expired)).length, 1);

    const deleted = await cleanupExpiredSessionScopes(directory, { clock, onSummary: (summary) => { observed.push(`before:${summary.scope}:${summary.removed}`); } });
    assert.equal(deleted.removed, 1);
    assert.equal(deleted.summaries[0]?.removed, true);
    assert.deepEqual(observed.at(-1), `before:${expired}:false`);
    assert.equal((await store.listForOwner(expired)).length, 0);
    assert.equal((await store.listForOwner(live)).length, 1);
    assert.equal(await readFile(join(outside, "sentinel"), "utf8").catch(() => "safe"), "safe");
    await rm(outside, { recursive: true, force: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
