import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createCanvas } from "@napi-rs/canvas";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import fixture from "../../../packages/contracts/fixtures/proposal-v0.json" with { type: "json" };
import { createStudioServer } from "./server.js";

test("local API persists a project and returns a real HTML export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-api-"));
  const server = createStudioServer({ dataDirectory: directory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const health = await fetch(`${base}/api/health`).then((response) => response.json()) as { ok: boolean };
    assert.equal(health.ok, true);

    const saved = await fetch(`${base}/api/projects/doc_studio_v0`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: fixture, reason: "edit", patches: [] }),
    });
    assert.equal(saved.status, 200);

    const exported = await fetch(`${base}/api/projects/doc_studio_v0/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "html" }),
    });
    assert.equal(exported.status, 201);
    const result = await exported.json() as { files: Array<{ downloadUrl: string }> };
    const html = await fetch(`${base}${result.files[0]!.downloadUrl}`).then((response) => response.text());
    assert.match(html, /data-scene-id="scene_cover"/);
    assert.match(html, /让视觉作品在生成之后/);

    const pngExport = await fetch(`${base}/api/projects/doc_studio_v0/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "png" }),
    });
    assert.equal(pngExport.status, 201);
    const pngResult = await pngExport.json() as { renderer: string; files: Array<{ downloadUrl: string }>; bundle: { downloadUrl: string } };
    assert.equal(pngResult.renderer, "scene-ir-native-canvas");
    assert.equal(pngResult.files.length, 6);
    const pngBytes = await fetch(`${base}${pngResult.files[0]!.downloadUrl}`).then((response) => response.arrayBuffer()) as ArrayBuffer;
    const png = new Uint8Array(pngBytes);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const zipBuffer = await fetch(`${base}${pngResult.bundle.downloadUrl}`).then((response) => response.arrayBuffer());
    const zipBytes = new Uint8Array(zipBuffer as ArrayBuffer);
    assert.deepEqual([...zipBytes.subarray(0, 4)], [80, 75, 3, 4]);

    const qaResponse = await fetch(`${base}/api/qa`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: fixture }),
    });
    assert.equal(qaResponse.status, 200);
    const qa = await qaResponse.json() as { documentId: string; summary: { total: number } };
    assert.equal(qa.documentId, "doc_studio_v0");

    const sampleCanvas = createCanvas(64, 64);
    const sampleContext = sampleCanvas.getContext("2d");
    sampleContext.fillStyle = "#E34A2F";
    sampleContext.fillRect(0, 0, 64, 64);
    const assetResponse = await fetch(`${base}/api/projects/doc_studio_v0/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "sample.png", mimeType: "image/png", data: sampleCanvas.toBuffer("image/png").toString("base64") }),
    });
    assert.equal(assetResponse.status, 201);
    const asset = await assetResponse.json() as { width: number; height: number; url: string };
    assert.deepEqual({ width: asset.width, height: asset.height }, { width: 64, height: 64 });
    const assetBytes = new Uint8Array(await fetch(`${base}${asset.url}`).then((response) => response.arrayBuffer()) as ArrayBuffer);
    assert.deepEqual([...assetBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const revisions = await fetch(`${base}/api/projects/doc_studio_v0/revisions`).then((response) => response.json()) as { revisions: Array<{ revision: { reason: string } }> };
    assert.equal(revisions.revisions.length, 1);
    assert.equal(revisions.revisions[0]?.revision.reason, "initial");
    const projects = await fetch(`${base}/api/projects`).then((response) => response.json()) as { projects: Array<{ projectId: string }> };
    assert.equal(projects.projects[0]?.projectId, "doc_studio_v0");
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

test("local API creates a new generated project from a Brief", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-generator-api-"));
  const server = createStudioServer({ dataDirectory: directory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/projects/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: "把一篇关于创造者教育的文章转化为可以继续编辑的提案。内容要呈现作者身份，并说明 AI 时代为什么更需要主动创造。" }),
    });
    assert.equal(response.status, 201);
    const generated = await response.json() as { document: { documentId: string; scenes: unknown[]; designPack: { id: string; version: string }; provenance: { sources: Array<{ contentHash: string }> }; directions: Array<{ id: string; tokens: { accent: string } }> }; storyline: unknown[] };
    assert.match(generated.document.documentId, /^project_/);
    assert.equal(generated.document.scenes.length, 6);
    assert.equal(generated.storyline.length, 6);
    assert.deepEqual(generated.document.designPack, { id: "executive-proposal-cn", version: "1.0.0" });
    assert.match(generated.document.provenance.sources[0]?.contentHash ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.equal(generated.document.directions[0]?.tokens.accent, "#D84A2F");
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

test("003 local API imports inert Structured HTML with diagnostics and persists only accepted documents", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-import-api-"));
  const server = createStudioServer({ dataDirectory: directory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const provenance = {
    sources: [
      { sourceId: "source_brief", type: "brief", title: "Brief" },
      { sourceId: "source_constraints", type: "manual", title: "Constraints" },
      { sourceId: "source_benchmark", type: "document", title: "Benchmark" },
    ],
    generatedBy: { kind: "skill", name: "opendesign-director", version: "0.3.0" },
  };
  try {
    const html = await readFile(new URL("../../../fixtures/golden-task/structured-html-v01.html", import.meta.url), "utf8");
    const accepted = await fetch(`${base}/api/imports/html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ html, provenance }) });
    assert.equal(accepted.status, 201);
    const result = await accepted.json() as { status: string; document: { documentId: string } };
    assert.equal(result.status, "accepted");
    assert.equal(result.document.documentId, "doc_golden_import");
    const revisions = await fetch(`${base}/api/projects/doc_golden_import/revisions`).then((response) => response.json()) as { revisions: Array<{ revision: { reason: string } }> };
    assert.equal(revisions.revisions[0]?.revision.reason, "initial");

    const dangerous = html.replace('data-od-document-id="doc_golden_import"', 'data-od-document-id="doc_rejected_import"').replace("scene_01_title", "scene_02_title");
    const rejected = await fetch(`${base}/api/imports/html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ html: dangerous, provenance }) });
    assert.equal(rejected.status, 422);
    const rejectedBody = await rejected.json() as { status: string; diagnostics: Array<{ code: string }> };
    assert.equal(rejectedBody.status, "rejected");
    assert.ok(rejectedBody.diagnostics.some((diagnostic) => diagnostic.code === "id.duplicate"));
    assert.equal((await fetch(`${base}/api/projects/doc_rejected_import`)).status, 404);

    const executable = html.replace('data-od-document-id="doc_golden_import"', 'data-od-document-id="doc_script_import"').replace("</main>", '<script>alert(1)</script></main>');
    const scriptResponse = await fetch(`${base}/api/imports/html`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ html: executable, provenance }) });
    assert.equal(scriptResponse.status, 422);
    const scriptBody = await scriptResponse.json() as { status: string; diagnostics: Array<{ code: string }> };
    assert.equal(scriptBody.status, "rejected");
    assert.ok(scriptBody.diagnostics.some((diagnostic) => diagnostic.code === "security.script_blocked"));
    assert.equal((await fetch(`${base}/api/projects/doc_script_import`)).status, 404);
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

test("local API duplicates a project with independent identity and history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-duplicate-api-"));
  const server = createStudioServer({ dataDirectory: directory });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    await fetch(`${base}/api/projects/doc_studio_v0`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: fixture, reason: "edit", patches: [] }),
    });
    const response = await fetch(`${base}/api/projects/doc_studio_v0/duplicate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 201);
    const duplicate = await response.json() as { document: { documentId: string; title: string } };
    assert.notEqual(duplicate.document.documentId, "doc_studio_v0");
    assert.match(duplicate.document.title, /副本$/);
    const revisions = await fetch(`${base}/api/projects/${duplicate.document.documentId}/revisions`).then((result) => result.json()) as { revisions: unknown[] };
    assert.equal(revisions.revisions.length, 1);
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});
