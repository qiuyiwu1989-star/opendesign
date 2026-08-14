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
import { createPublicSessionCodec } from "./public-session.js";
import { configureGenerationProvider } from "./model-provider.js";

const TEST_SESSION_SECRET = "test-only-studio-session-signing-secret-32-bytes-minimum";
function createTestStudioServer(dataDirectory: string) {
  return createStudioServer({
    dataDirectory,
    sessionCodec: createPublicSessionCodec({ secret: TEST_SESSION_SECRET, random: { bytes: (size) => new Uint8Array(size).fill(7) } }),
  });
}

function createFixtureTestStudioServer(dataDirectory: string) {
  return createStudioServer({
    dataDirectory,
    sessionCodec: createPublicSessionCodec({ secret: TEST_SESSION_SECRET, random: { bytes: (size) => new Uint8Array(size).fill(8) } }),
    generationProvider: configureGenerationProvider({ env: { STUDIO_GENERATION_MODE: "fixture" } }),
  });
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0]!;
}

async function withCookie(url: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, headers: { ...init.headers, cookie } });
}

async function approveCurrentOutline(base: string, cookie: string, workOrderId: string): Promise<void> {
  const workflow = await withCookie(`${base}/api/work-orders/${workOrderId}`, cookie).then((response) => response.json()) as { workflow: { outlineReview: { artifactId?: string } } };
  assert.ok(workflow.workflow.outlineReview.artifactId);
  const response = await withCookie(`${base}/api/work-orders/${workOrderId}/outline`, cookie, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "approve", expectedArtifactId: workflow.workflow.outlineReview.artifactId }),
  });
  assert.equal(response.status, 200);
}

test("local API persists a project and returns a real HTML export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-api-"));
  const server = createTestStudioServer(directory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const healthResponse = await fetch(`${base}/api/health`);
    assert.equal(healthResponse.headers.get("set-cookie"), null);
    const health = await healthResponse.json() as { ok: boolean };
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
  const server = createTestStudioServer(directory);
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
  const server = createTestStudioServer(directory);
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

test("004 local API compiles a Design Director Skill draft and persists only accepted Scene IR", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-director-api-"));
  const server = createTestStudioServer(directory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const input = {
    inputVersion: "0.1.0",
    taskId: "api_director_test",
    title: "Studio 设计闭环",
    brief: { objective: "把已有内容编译为可安全导入且能继续人工编辑的提案。", audience: "产品负责人", decisionRequest: "确认下一阶段实现路径。" },
    content: { summary: "先诊断目标和证据边界，再生成结构化 HTML，并由 importer 建立 Scene IR。", keyPoints: [{ id: "point_path", text: "生成与人工编辑必须共享可追溯事实源", sourceIds: ["source_brief"] }], callToAction: "确认后进入人工编辑与 QA。" },
    sources: [{ sourceId: "source_brief", type: "brief", title: "产品简报", sourceRef: "fixture://api/design-director", content: "Studio 使用 Scene IR 作为编辑、QA 和导出的事实源。" }],
    brand: { name: "OpenDesign", tone: ["清晰", "克制"] },
    deliverable: { kind: "proposal", audience: "产品负责人", language: "zh-CN", format: "structured-html", pageCount: 6 },
    designPack: { id: "executive-proposal-cn", version: "1.0.0" },
    editability: { requiredCapabilities: ["text", "typography", "asset", "frame", "order"], requireNativeText: true, requireReplaceableImages: true, requireReorderablePages: true },
  };
  try {
    const accepted = await fetch(`${base}/api/design-director/drafts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    assert.equal(accepted.status, 201);
    const result = await accepted.json() as { status: string; manifest: { compiler: { deterministic: boolean }; sourceCoverage: { unresolvedSourceIds: string[] } }; importResult: { document: { documentId: string } } };
    assert.equal(result.status, "accepted");
    assert.equal(result.manifest.compiler.deterministic, true);
    assert.deepEqual(result.manifest.sourceCoverage.unresolvedSourceIds, []);
    assert.equal((await fetch(`${base}/api/projects/${result.importResult.document.documentId}`)).status, 200);

    const rejected = await fetch(`${base}/api/design-director/drafts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, taskId: "api_director_bad", designPack: { id: "unknown-pack", version: "1.0.0" } }) });
    assert.equal(rejected.status, 422);
    const rejectedBody = await rejected.json() as { status: string; diagnostics: Array<{ code: string }> };
    assert.equal(rejectedBody.status, "rejected");
    assert.ok(rejectedBody.diagnostics.some((diagnostic) => diagnostic.code === "pack.unknown"));
    assert.equal((await fetch(`${base}/api/projects/doc_api_director_bad`)).status, 404);
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

test("005 fixture model draft can be human-edited, reviewed, and approved only as an unpublished candidate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-model-review-api-"));
  const server = createFixtureTestStudioServer(directory);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const input = {
    inputVersion: "0.1.0",
    taskId: "model_review_test",
    title: "人工确认闭环",
    brief: { objective: "让模型生成的结构化 HTML 在人工编辑后进入可追踪审核。", audience: "产品负责人", decisionRequest: "确认候选，不自动发布。" },
    content: { summary: "模型只提供候选输入，compiler 与 importer 决定能否进入 Studio。", keyPoints: [{ id: "point_gate", text: "人工修改必须形成新 revision 后再审批", sourceIds: ["source_brief"] }], callToAction: "确认后仅形成发布候选。" },
    sources: [{ sourceId: "source_brief", type: "brief", title: "产品简报", sourceRef: "fixture://api/model-review", content: "候选与生产发布必须分层，并保留来源与修订证据。" }],
    brand: { name: "OpenDesign", tone: ["清晰", "克制"] },
    deliverable: { kind: "proposal", audience: "产品负责人", language: "zh-CN", format: "structured-html", pageCount: 6 },
    designPack: { id: "executive-proposal-cn", version: "1.0.0" },
    editability: { requiredCapabilities: ["text", "typography", "asset", "frame", "order"], requireNativeText: true, requireReplaceableImages: true, requireReorderablePages: true },
  };
  try {
    const generatedResponse = await fetch(`${base}/api/model/drafts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: "model_review_request", input }) });
    assert.equal(generatedResponse.status, 201);
    const generated = await generatedResponse.json() as { generation: { status: string; provider: { id: string }; output: { importResult: { document: typeof fixture } } }; review: { reviewId: string; status: string } };
    assert.equal(generated.generation.status, "accepted");
    assert.equal(generated.generation.provider.id, "fixture");
    assert.equal(generated.review.status, "draft");

    const document = structuredClone(generated.generation.output.importResult.document);
    const firstText = document.scenes.flatMap((scene) => scene.elements).find((element) => element.content !== undefined);
    assert.ok(firstText);
    firstText.content = `${firstText.content} · 人工已核对`;
    const savedResponse = await fetch(`${base}/api/projects/${document.documentId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ document, reason: "edit", patches: [] }) });
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json() as { revision: { revisionId: string } };

    const submittedResponse = await fetch(`${base}/api/reviews/${generated.review.reviewId}/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revisionId: saved.revision.revisionId, currentDocument: document, actor: { actorId: "human_test", kind: "human" } }) });
    assert.equal(submittedResponse.status, 200);
    const submitted = await submittedResponse.json() as { projection: { status: string; reviewRevisionId: string } };
    assert.equal(submitted.projection.status, "in_review");
    assert.equal(submitted.projection.reviewRevisionId, saved.revision.revisionId);

    const approvedResponse = await fetch(`${base}/api/reviews/${generated.review.reviewId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revisionId: saved.revision.revisionId, reason: "人工已经核对内容、来源、设计细节与 QA。", actor: { actorId: "human_test", kind: "human" } }) });
    assert.equal(approvedResponse.status, 200);
    const approved = await approvedResponse.json() as { projection: { status: string; candidate: { notPublished: boolean; document: typeof fixture; artifactHashes: Array<{ digest: string }> } } };
    assert.equal(approved.projection.status, "approved_candidate");
    assert.equal(approved.projection.candidate.notPublished, true);
    assert.match(approved.projection.candidate.artifactHashes[0]?.digest ?? "", /^sha256:[a-f0-9]{64}$/u);
    assert.match(approved.projection.candidate.document.scenes.flatMap((scene) => scene.elements).find((element) => element.id === firstText.id)?.content ?? "", /人工已核对/u);
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

test("local API duplicates a project with independent identity and history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-duplicate-api-"));
  const server = createTestStudioServer(directory);
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

test("006 public API isolates projects and generation jobs between anonymous cookie spaces", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-session-api-"));
  let fill = 10;
  const server = createStudioServer({
    dataDirectory: directory,
    sessionCodec: createPublicSessionCodec({
      secret: TEST_SESSION_SECRET,
      random: { bytes: (size) => new Uint8Array(size).fill(fill++) },
    }),
    generationProvider: configureGenerationProvider({ env: { STUDIO_GENERATION_MODE: "fixture" } }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const sessionA = await fetch(`${base}/api/projects`);
    const sessionB = await fetch(`${base}/api/projects`);
    const cookieA = cookieFrom(sessionA);
    const cookieB = cookieFrom(sessionB);
    assert.notEqual(cookieA, cookieB);
    assert.match(sessionA.headers.get("set-cookie") ?? "", /HttpOnly; Secure; SameSite=Lax/u);

    const saved = await withCookie(`${base}/api/projects/doc_studio_v0`, cookieA, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: fixture, reason: "edit", patches: [] }),
    });
    assert.equal(saved.status, 200);
    const projectsA = await withCookie(`${base}/api/projects`, cookieA).then((response) => response.json()) as { projects: Array<{ projectId: string }> };
    const projectsB = await withCookie(`${base}/api/projects`, cookieB).then((response) => response.json()) as { projects: Array<{ projectId: string }> };
    assert.deepEqual(projectsA.projects.map((project) => project.projectId), ["doc_studio_v0"]);
    assert.deepEqual(projectsB.projects, []);
    assert.equal((await withCookie(`${base}/api/projects/doc_studio_v0`, cookieB)).status, 404);
    assert.equal((await withCookie(`${base}/api/projects/doc_studio_v0/revisions`, cookieB)).status, 404);
    assert.equal((await withCookie(`${base}/api/projects/doc_studio_v0/exports`, cookieB, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "html" }) })).status, 404);

    const exported = await withCookie(`${base}/api/projects/doc_studio_v0/exports`, cookieA, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "html" }) });
    assert.equal(exported.status, 201);
    const exportBody = await exported.json() as { files: Array<{ downloadUrl: string }> };
    assert.equal((await withCookie(`${base}${exportBody.files[0]!.downloadUrl}`, cookieB)).status, 404);

    assert.equal((await withCookie(`${base}/api/generation-jobs`, cookieA, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: "把公开 Studio 的匿名隔离与可编辑生成能力整理成一份六页提案。" }),
    })).status, 404);
    const planned = await withCookie(`${base}/api/work-orders`, cookieA, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: "面向产品负责人，把公开 Studio 的匿名隔离能力整理成六页提案，让他们确认下一阶段。" }),
    }).then((response) => response.json()) as { workflow: { workOrder: { workOrderId: string }; selectedDirectionId: string } };
    await withCookie(`${base}/api/work-orders/${planned.workflow.workOrder.workOrderId}/direction`, cookieA, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ directionId: planned.workflow.selectedDirectionId }),
    });
    await approveCurrentOutline(base, cookieA, planned.workflow.workOrder.workOrderId);
    const body = await withCookie(`${base}/api/work-orders/${planned.workflow.workOrder.workOrderId}/confirm`, cookieA, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    }).then((response) => response.json()) as { job: { jobId: string } };
    assert.equal((await withCookie(`${base}/api/generation-jobs/${body.job.jobId}`, cookieB)).status, 404);

    let completed: { job: { status: string; projectId?: string } } | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      completed = await withCookie(`${base}/api/generation-jobs/${body.job.jobId}`, cookieA).then((response) => response.json()) as typeof completed;
      if (completed?.job.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(completed?.job.status, "completed");
    assert.ok(completed?.job.projectId);
    assert.equal((await withCookie(`${base}/api/projects/${completed.job.projectId}`, cookieA)).status, 200);
    assert.equal((await withCookie(`${base}/api/projects/${completed.job.projectId}`, cookieB)).status, 404);
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

test("007 Creation Contract stays private and requires explicit confirmation before generation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-work-order-api-"));
  let fill = 40;
  const server = createStudioServer({
    dataDirectory: directory,
    sessionCodec: createPublicSessionCodec({
      secret: TEST_SESSION_SECRET,
      random: { bytes: (size) => new Uint8Array(size).fill(fill++) },
    }),
    generationProvider: configureGenerationProvider({ env: { STUDIO_GENERATION_MODE: "fixture" } }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const cookieA = cookieFrom(await fetch(`${base}/api/projects`));
    const cookieB = cookieFrom(await fetch(`${base}/api/projects`));
    const createdResponse = await withCookie(`${base}/api/work-orders`, cookieA, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief: "把 Agent Studio 的方法整理成一套六页可编辑、可导出的商业提案。" }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { workflow: { workOrder: { workOrderId: string }; plan: { capabilityPins: Array<{ id: string }>; stages: Array<{ kind: string }> }; projection: { status: string }; events: unknown[]; artifacts: Array<{ artifactId: string; artifactType: string }>; outlineReview: { status: string }; clarification: { questions: Array<{ questionId: string }> }; directionPreviews: Array<{ directionId: string }>; selectedDirectionId: string; readyForConfirmation: boolean; generationJobId?: string } };
    assert.equal(created.workflow.projection.status, "draft");
    assert.equal(created.workflow.events.length, 0);
    assert.equal(created.workflow.generationJobId, undefined);
    assert.equal(created.workflow.clarification.questions.length, 2);
    assert.equal(created.workflow.directionPreviews.length, 3);
    assert.equal(created.workflow.readyForConfirmation, false);
    assert.deepEqual(created.workflow.plan.capabilityPins.map((pin) => pin.id), ["opendesign-design-director", "narrative-architect", "art-director", "design-critic"]);
    assert.deepEqual(created.workflow.plan.stages.slice(0, 5).map((stage) => stage.kind), ["diagnose", "direction", "outline", "compose", "import"]);
    assert.deepEqual(created.workflow.artifacts.map((artifact) => artifact.artifactType), ["diagnosis"]);
    assert.equal(created.workflow.outlineReview.status, "unavailable");
    const workOrderUrl = `${base}/api/work-orders/${created.workflow.workOrder.workOrderId}`;
    assert.equal((await withCookie(workOrderUrl, cookieB)).status, 404);
    assert.equal((await withCookie(`${base}${created.workflow.artifacts[0]!.artifactId ? `/api/work-orders/${created.workflow.workOrder.workOrderId}/artifacts/${created.workflow.artifacts[0]!.artifactId}` : ""}`, cookieB)).status, 404);

    assert.equal((await withCookie(`${workOrderUrl}/confirm`, cookieA, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 409);
    assert.equal((await withCookie(`${workOrderUrl}/clarifications`, cookieB, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers: [] }) })).status, 404);
    const answers = created.workflow.clarification.questions.map((question) => ({ questionId: question.questionId, answer: question.questionId === "clarify_audience" ? "面向产品负责人与管理层" : "确认方案并批准下一阶段" }));
    assert.equal((await withCookie(`${workOrderUrl}/clarifications`, cookieA, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answers }) })).status, 200);
    assert.equal((await withCookie(`${workOrderUrl}/direction`, cookieA, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ directionId: created.workflow.selectedDirectionId }) })).status, 200);
    assert.equal((await withCookie(`${workOrderUrl}/confirm`, cookieA, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 409);
    await approveCurrentOutline(base, cookieA, created.workflow.workOrder.workOrderId);
    const confirmedResponse = await withCookie(`${workOrderUrl}/confirm`, cookieA, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(confirmedResponse.status, 202);
    const confirmed = await confirmedResponse.json() as { workflow: { projection: { status: string }; events: Array<{ type: string; actor: { kind: string } }>; generationJobId: string }; job: { jobId: string } };
    assert.equal(confirmed.workflow.projection.status, "confirmed");
    assert.equal(confirmed.workflow.events[0]?.type, "plan_confirmed");
    assert.equal(confirmed.workflow.events[0]?.actor.kind, "human");
    assert.equal(confirmed.workflow.generationJobId, confirmed.job.jobId);
    const repeated = await withCookie(`${workOrderUrl}/confirm`, cookieA, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((response) => response.json()) as { job: { jobId: string } };
    assert.equal(repeated.job.jobId, confirmed.job.jobId);

    let completed: { job: { status: string; projectId?: string } } | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      completed = await withCookie(`${base}/api/generation-jobs/${confirmed.job.jobId}`, cookieA).then((response) => response.json()) as typeof completed;
      if (completed?.job.status === "completed" || completed?.job.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(completed?.job.status, "completed");
    const final = await withCookie(workOrderUrl, cookieA).then((response) => response.json()) as { workflow: { projection: { stageStatuses: Record<string, string> }; artifacts: Array<{ artifactId: string; artifactType: string }>; events: Array<{ outputArtifactIds: string[] }> } };
    assert.equal(final.workflow.projection.stageStatuses.stage_qa, "completed");
    assert.equal(final.workflow.projection.stageStatuses.stage_edit, "queued");
    assert.deepEqual(final.workflow.artifacts.slice(-3).map((artifact) => artifact.artifactType), ["structured-html", "scene-ir", "qa-report"]);
    const knownArtifactIds = new Set(final.workflow.artifacts.map((artifact) => artifact.artifactId));
    assert.ok(final.workflow.events.flatMap((event) => event.outputArtifactIds).every((artifactId) => knownArtifactIds.has(artifactId)));
    const sceneArtifact = final.workflow.artifacts.find((artifact) => artifact.artifactType === "scene-ir");
    assert.ok(sceneArtifact);
    assert.equal((await withCookie(`${workOrderUrl}/artifacts/${sceneArtifact.artifactId}`, cookieA)).status, 200);

    assert.ok(completed?.job.projectId);
    const exportResponse = await withCookie(`${base}/api/projects/${completed.job.projectId}/exports`, cookieA, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "html" }),
    });
    assert.equal(exportResponse.status, 201);
    const afterExport = await withCookie(workOrderUrl, cookieA).then((response) => response.json()) as { workflow: { artifacts: Array<{ artifactType: string }> } };
    assert.equal(afterExport.workflow.artifacts.at(-1)?.artifactType, "export-report");
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

test("009 Agent change API keeps proposals private and only writes a revision after explicit acceptance", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-agent-change-api-"));
  let fill = 70;
  const server = createStudioServer({
    dataDirectory: directory,
    sessionCodec: createPublicSessionCodec({ secret: TEST_SESSION_SECRET, random: { bytes: (size) => new Uint8Array(size).fill(fill++) } }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const cookieA = cookieFrom(await fetch(`${base}/api/projects`));
    const cookieB = cookieFrom(await fetch(`${base}/api/projects`));
    assert.equal((await withCookie(`${base}/api/projects/${fixture.documentId}`, cookieA, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: fixture }) })).status, 200);
    const scene = fixture.scenes[0]!;
    const title = scene.elements.find((element) => element.role === "title")!;
    const endpoint = `${base}/api/projects/${fixture.documentId}/agent-changes`;
    assert.equal((await withCookie(endpoint, cookieA, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction: "帮我优化一下", target: { kind: "scene", sceneId: scene.id } }) })).status, 422);
    const createdResponse = await withCookie(endpoint, cookieA, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction: "标题改成：先保留人工版本，再评审 Agent 修改", target: { kind: "element", sceneId: scene.id, elementId: title.id } }) });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { candidate: { candidateId: string; status: string; diffs: Array<{ before: string; after: string }> } };
    assert.equal(created.candidate.status, "proposed");
    assert.equal(created.candidate.diffs[0]?.before, title.content);
    assert.equal((await withCookie(`${base}/api/projects/${fixture.documentId}/revisions`, cookieA).then((response) => response.json()) as { revisions: unknown[] }).revisions.length, 1);
    assert.equal((await withCookie(endpoint, cookieB)).status, 404);
    assert.equal((await withCookie(`${endpoint}/${created.candidate.candidateId}/accept`, cookieB, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "跨空间接受应失败" }) })).status, 404);

    const acceptedResponse = await withCookie(`${endpoint}/${created.candidate.candidateId}/accept`, cookieA, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "已经对比前后内容并确认采用" }) });
    assert.equal(acceptedResponse.status, 200);
    const accepted = await acceptedResponse.json() as { candidate: { status: string; notPublished: boolean }; revision: { reason: string }; document: typeof fixture };
    assert.equal(accepted.candidate.status, "accepted");
    assert.equal(accepted.candidate.notPublished, true);
    assert.equal(accepted.revision.reason, "regenerate");
    assert.equal(accepted.document.scenes[0]?.elements.find((element) => element.id === title.id)?.content, "先保留人工版本，再评审 Agent 修改");
    assert.equal((await withCookie(`${base}/api/projects/${fixture.documentId}/revisions`, cookieA).then((response) => response.json()) as { revisions: unknown[] }).revisions.length, 2);
  } finally {
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
  }
});
