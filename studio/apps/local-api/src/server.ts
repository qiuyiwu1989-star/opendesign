import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname } from "node:path";
import { assertSceneDocument, type DesignPackPin, type DocumentProvenance, type SceneDocument, type ScenePatch } from "@opendesign/studio-contracts";
import { compileDesignDirector } from "@opendesign/studio-design-director";
import { createFixtureModelProvider, generateWithModel } from "@opendesign/studio-model-adapter";
import { approveCandidate, createReviewLedger, replayReviewLedger, submitReview } from "@opendesign/studio-publishing";
import { importStructuredHtml } from "@opendesign/studio-html-importer";
import { LocalExportService, type ExportKind } from "./exports.js";
import { generateProjectFromBrief } from "./generator.js";
import { LocalProjectStore } from "./storage.js";
import { LocalReviewStore } from "./review-store.js";
import { runDeterministicQa } from "@opendesign/studio-qa";
import { loadImage } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignDirectorInput } from "@opendesign/studio-design-director";
import { GenerationJobLimitError, GenerationJobManager, GenerationProviderUnavailableError } from "./generation-jobs.js";
import { createPublicSessionCodec, sessionRecordFromIdentity, type PublicSessionCodec, type SessionScope } from "./public-session.js";
import { configureGenerationProvider, type GenerationProviderConfiguration } from "./model-provider.js";

const JSON_LIMIT = 5 * 1024 * 1024;
const SAFE_IMAGE_MIME = new Set(["image/png", "image/jpeg"]);
const PUBLIC_SESSION_ACTOR = { actorId: "studio_public_session", kind: "human", displayName: "Anonymous Studio Editor" } as const;

async function readJson(request: IncomingMessage, limit = JSON_LIMIT): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limit) throw new Error(`Request body exceeds ${Math.floor(limit / 1024)} KiB`);
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function contentType(path: string): string {
  return ({
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".zip": "application/zip",
    ".pdf": "application/pdf",
  } as Record<string, string>)[extname(path)] ?? "application/octet-stream";
}

export type StudioServerOptions = {
  dataDirectory: string;
  sessionCodec: PublicSessionCodec;
  generationProvider?: GenerationProviderConfiguration;
};

function generationInput(input: { brief?: unknown; title?: unknown; designPack?: unknown }, jobId: string): DesignDirectorInput {
  if (typeof input.brief !== "string") throw new Error("Brief is required");
  const brief = input.brief.replace(/\s+/gu, " ").trim();
  if ([...brief].length < 12 || [...brief].length > 12_000) throw new Error("Brief must contain between 12 and 12,000 characters");
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 120) : brief.slice(0, 64);
  const pin = input.designPack && typeof input.designPack === "object" ? input.designPack as Partial<DesignPackPin> : {};
  const designPack = typeof pin.id === "string" && typeof pin.version === "string"
    ? { id: pin.id, version: pin.version }
    : { id: "executive-proposal-cn", version: "1.0.0" };
  const kind = designPack.id === "research-keynote-cn" ? "keynote" : designPack.id === "editorial-story-graphics-cn" ? "article-graphics" : "proposal";
  return {
    inputVersion: "0.1.0",
    taskId: `studio_${jobId.slice(4, 36)}`,
    title,
    brief: { objective: brief, audience: "内容创作者与决策者", decisionRequest: "确认叙事、设计方向与下一步行动。", constraints: ["不得补造用户未提供的事实"] },
    content: {
      summary: brief,
      keyPoints: [{ id: "point_brief", text: brief.slice(0, 500), sourceIds: ["source_brief"] }],
      callToAction: "人工编辑并确认细节后再交付。",
    },
    sources: [{ sourceId: "source_brief", type: "brief", title: "用户需求", content: brief }],
    brand: { name: "OpenDesign", tone: ["清晰", "克制", "有设计判断"] },
    deliverable: { kind, audience: "内容创作者与决策者", language: "zh-CN", format: "structured-html", pageCount: 6 },
    designPack,
    editability: { requiredCapabilities: ["text", "typography", "asset", "frame", "order"], requireNativeText: true, requireReplaceableImages: true, requireReorderablePages: true },
  };
}

export function createStudioServer(options: StudioServerOptions) {
  const store = new LocalProjectStore(options.dataDirectory);
  const reviews = new LocalReviewStore(options.dataDirectory);
  const exports = new LocalExportService(options.dataDirectory);
  const generationProvider = options.generationProvider ?? configureGenerationProvider({ env: {} });
  const jobs = new GenerationJobManager({
    rootDirectory: options.dataDirectory,
    provider: generationProvider.provider,
    projectWriter: async (scope, document) => { await store.createForOwner(scope as SessionScope, document); },
  });
  const jobsReady = jobs.initialize();

  return createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    try {
      await jobsReady;
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/health") {
        json(response, 200, { ok: true, mode: "local-only", ...generationProvider.publicInfo });
        return;
      }
      const session = options.sessionCodec.resolveCookieHeader(request.headers.cookie);
      const scope = session.identity.scope;
      if (session.setCookie) response.setHeader("set-cookie", session.setCookie);
      await store.writeSessionRecord(sessionRecordFromIdentity(session.identity));
      if (request.method === "GET" && url.pathname === "/api/projects") {
        json(response, 200, { projects: await store.listForOwner(scope) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/generation-jobs") {
        const body = await readJson(request, 128 * 1024) as Record<string, unknown>;
        const jobId = `job_${randomUUID().replaceAll("-", "")}`;
        const job = await jobs.create(scope, generationInput(body, jobId));
        json(response, 202, { job });
        return;
      }
      const generationJobMatch = url.pathname.match(/^\/api\/generation-jobs\/(job_[a-z0-9]{8,59})(?:\/(cancel))?$/u);
      if (generationJobMatch && request.method === "GET" && !generationJobMatch[2]) {
        const job = jobs.get(scope, generationJobMatch[1]!);
        json(response, job ? 200 : 404, job ? { job } : { error: "Generation job not found" });
        return;
      }
      if (generationJobMatch && request.method === "POST" && generationJobMatch[2] === "cancel") {
        const job = await jobs.cancel(scope, generationJobMatch[1]!);
        json(response, job ? 200 : 404, job ? { job } : { error: "Generation job not found" });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/qa") {
        const body = await readJson(request) as { document?: SceneDocument };
        if (!body.document) throw new Error("Scene document is required");
        assertSceneDocument(body.document);
        json(response, 200, runDeterministicQa(body.document));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/projects/generate") {
        const body = await readJson(request) as { brief?: string; title?: string; designPack?: DesignPackPin };
        const generated = generateProjectFromBrief({ brief: body.brief ?? "", ...(body.title === undefined ? {} : { title: body.title }), ...(body.designPack === undefined ? {} : { designPack: body.designPack }) });
        await store.createForOwner(scope, generated.document);
        json(response, 201, generated);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/design-director/drafts") {
        const compiled = compileDesignDirector(await readJson(request, 640 * 1024));
        if (compiled.status === "accepted" && compiled.importResult.document) {
          if (await store.readForOwner(scope, compiled.importResult.document.documentId)) {
            json(response, 409, { error: "Project already exists", ...compiled });
            return;
          }
          await store.createForOwner(scope, compiled.importResult.document);
        }
        json(response, compiled.status === "accepted" ? 201 : 422, compiled);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/model/drafts") {
        if (generationProvider.mode !== "fixture") {
          json(response, 404, { error: "Not found" });
          return;
        }
        const body = await readJson(request, 640 * 1024) as { requestId?: string; input?: unknown };
        const generated = await generateWithModel(createFixtureModelProvider(), {
          contractVersion: "0.1.0",
          requestId: body.requestId ?? "studio_fixture_request",
          input: body.input as never,
        });
        if (generated.status === "accepted") {
          const document = generated.output.importResult.document;
          if (await store.readForOwner(scope, document.documentId)) {
            json(response, 409, { error: "Project already exists", ...generated });
            return;
          }
          await store.createForOwner(scope, document);
          const revision = (await store.listRevisionsForOwner(scope, document.documentId))[0];
          if (!revision) throw new Error("Initial revision was not created");
          const reviewId = `review_${document.documentId}`;
          const ledger = createReviewLedger({
            commandId: `create_${document.documentId}`,
            occurredAt: revision.revision.createdAt,
            actor: { actorId: "studio_fixture_model", kind: "agent", displayName: generated.provider.model },
            reviewId,
            draft: {
              revisionId: revision.revision.revisionId,
              designPack: generated.output.manifest.designPack,
              sourceCoverage: generated.output.manifest.sourceCoverage,
              importResult: generated.output.importResult,
              aiOutput: generated,
            },
          });
          await reviews.write(scope, ledger);
          json(response, 201, { generation: generated, review: replayReviewLedger(ledger) });
          return;
        }
        json(response, 422, { generation: generated });
        return;
      }

      const reviewMatch = url.pathname.match(/^\/api\/reviews\/([a-z][a-z0-9_-]{2,63})(?:\/(submit|approve))?$/u);
      if (reviewMatch && request.method === "GET" && !reviewMatch[2]) {
        const ledger = await reviews.read(scope, reviewMatch[1]!);
        json(response, ledger ? 200 : 404, ledger ? { ledger, projection: replayReviewLedger(ledger) } : { error: "Review not found" });
        return;
      }
      if (reviewMatch && request.method === "POST" && reviewMatch[2] === "submit") {
        const ledger = await reviews.read(scope, reviewMatch[1]!);
        if (!ledger) { json(response, 404, { error: "Review not found" }); return; }
        const body = await readJson(request) as { revisionId?: string; currentDocument?: SceneDocument };
        if (!body.revisionId || !body.currentDocument) throw new Error("revisionId and currentDocument are required");
        const next = submitReview(ledger, {
          commandId: `submit_${body.revisionId}`,
          occurredAt: new Date().toISOString(),
          actor: PUBLIC_SESSION_ACTOR,
          currentRevisionId: body.revisionId,
          currentDocument: body.currentDocument,
        });
        await reviews.write(scope, next);
        json(response, 200, { ledger: next, projection: replayReviewLedger(next) });
        return;
      }
      if (reviewMatch && request.method === "POST" && reviewMatch[2] === "approve") {
        const ledger = await reviews.read(scope, reviewMatch[1]!);
        if (!ledger) { json(response, 404, { error: "Review not found" }); return; }
        const body = await readJson(request) as { revisionId?: string; reason?: string };
        if (!body.revisionId || !body.reason) throw new Error("revisionId and reason are required");
        const projection = replayReviewLedger(ledger);
        const document = await store.readForOwner(scope, projection.draft.importResult.document?.documentId ?? "missing");
        if (!document) throw new Error("Current project was not found");
        const currentRevision = (await store.listRevisionsForOwner(scope, document.documentId))[0];
        if (!currentRevision || currentRevision.revision.revisionId !== body.revisionId) throw new Error("Current project revision drifted after review submission");
        const qa = runDeterministicQa(document);
        const digest = createHash("sha256").update(JSON.stringify(document)).digest("hex");
        const next = approveCandidate(ledger, {
          commandId: `approve_${body.revisionId}`,
          occurredAt: new Date().toISOString(),
          actor: PUBLIC_SESSION_ACTOR,
          candidateId: `candidate_${document.documentId}_${body.revisionId.slice(-8)}`,
          expectedRevisionId: body.revisionId,
          currentRevisionId: body.revisionId,
          currentDocument: document,
          reason: body.reason,
          qa,
          artifactHashes: [{ artifactId: "scene-ir", digest: `sha256:${digest}` }],
        });
        await reviews.write(scope, next);
        json(response, 200, { ledger: next, projection: replayReviewLedger(next) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/imports/html") {
        const body = await readJson(request, 640 * 1024) as { html?: string; provenance?: DocumentProvenance };
        if (typeof body.html !== "string") throw new Error("HTML is required");
        if (!body.provenance) throw new Error("Provenance is required");
        const imported = importStructuredHtml({ html: body.html, provenance: body.provenance });
        if (imported.status === "accepted" && imported.document) {
          if (await store.readForOwner(scope, imported.document.documentId)) {
            json(response, 409, { error: "Project already exists", ...imported });
            return;
          }
          await store.createForOwner(scope, imported.document);
        }
        json(response, imported.status === "rejected" ? 422 : 201, imported);
        return;
      }

      const duplicateMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9_-]{2,63})\/duplicate$/);
      if (duplicateMatch && request.method === "POST") {
        const source = await store.readForOwner(scope, duplicateMatch[1]!);
        if (!source) { json(response, 404, { error: "Project not found" }); return; }
        const documentId = `project_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
        const document: SceneDocument = { ...structuredClone(source), documentId, title: `${source.title} · 副本` };
        await store.createForOwner(scope, document);
        json(response, 201, { document });
        return;
      }

      const assetMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9_-]{2,63})\/assets$/);
      if (assetMatch && request.method === "POST") {
        const body = await readJson(request) as { name?: string; mimeType?: string; data?: string };
        if (!body.mimeType || !SAFE_IMAGE_MIME.has(body.mimeType)) throw new Error("Only PNG and JPEG images are supported");
        if (!body.data || !/^[a-zA-Z0-9+/]+={0,2}$/.test(body.data)) throw new Error("Image data is invalid");
        const bytes = Buffer.from(body.data, "base64");
        if (bytes.byteLength === 0 || bytes.byteLength > 4 * 1024 * 1024) throw new Error("Image must be between 1 byte and 4 MB");
        const image = await loadImage(bytes);
        if (image.width < 32 || image.height < 32 || image.width > 8000 || image.height > 8000) throw new Error("Image dimensions must stay between 32 and 8000 pixels");
        const extension = body.mimeType === "image/png" ? "png" : "jpg";
        const assetId = `asset_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
        if (!await store.readForOwner(scope, assetMatch[1]!)) { json(response, 404, { error: "Project not found" }); return; }
        const directory = join(options.dataDirectory, "sessions", scope, "assets", assetMatch[1]!);
        await store.withOwnerQuota(scope, { assetBytes: bytes.byteLength }, async () => {
          await mkdir(directory, { recursive: true });
          await writeFile(join(directory, `${assetId}.${extension}`), bytes, { mode: 0o600 });
        });
        json(response, 201, { assetId, name: body.name?.slice(0, 160) || `${assetId}.${extension}`, mimeType: body.mimeType, width: image.width, height: image.height, url: `/api/assets/${assetMatch[1]}/${assetId}.${extension}` });
        return;
      }

      const assetFileMatch = url.pathname.match(/^\/api\/assets\/([a-z][a-z0-9_-]{2,63})\/(asset_[a-z0-9_]+\.(?:png|jpg))$/);
      if (assetFileMatch && request.method === "GET") {
        if (!await store.readForOwner(scope, assetFileMatch[1]!)) { json(response, 404, { error: "Asset not found" }); return; }
        const path = join(options.dataDirectory, "sessions", scope, "assets", assetFileMatch[1]!, assetFileMatch[2]!);
        const metadata = await stat(path);
        response.writeHead(200, { "content-type": contentType(path), "content-length": metadata.size, "cache-control": "private, max-age=31536000, immutable" });
        createReadStream(path).pipe(response);
        return;
      }

      const projectMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9_-]{2,63})$/);
      if (projectMatch && request.method === "GET") {
        const document = await store.readForOwner(scope, projectMatch[1]!);
        json(response, document ? 200 : 404, document ?? { error: "Project not found" });
        return;
      }
      if (projectMatch && request.method === "PUT") {
        const body = await readJson(request) as { document?: SceneDocument; reason?: "edit" | "qa-fix" | "regenerate"; patches?: ScenePatch[] } | SceneDocument;
        const document = "document" in body && body.document ? body.document : body as SceneDocument;
        const existing = await store.readForOwner(scope, projectMatch[1]!);
        const reason = existing ? ("reason" in body && body.reason ? body.reason : "edit") : "initial";
        const patches = "patches" in body && Array.isArray(body.patches) ? body.patches : [];
        const stored = await store.appendRevisionForOwner(scope, projectMatch[1]!, document, { reason, patches });
        json(response, 200, { document: stored.document, revision: stored.revision, persisted: true });
        return;
      }

      const revisionMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9_-]{2,63})\/revisions$/);
      if (revisionMatch && request.method === "GET") {
        if (!await store.readForOwner(scope, revisionMatch[1]!)) { json(response, 404, { error: "Project not found" }); return; }
        json(response, 200, { revisions: await store.listRevisionsForOwner(scope, revisionMatch[1]!) });
        return;
      }

      const exportMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9_-]{2,63})\/exports$/);
      if (exportMatch && request.method === "POST") {
        const body = await readJson(request) as { kind?: ExportKind };
        if (!body.kind || !["html", "png", "pptx"].includes(body.kind)) throw new Error("Unknown export kind");
        const document = await store.readForOwner(scope, exportMatch[1]!);
        if (!document) { json(response, 404, { error: "Project not found" }); return; }
        const exported = await store.withOwnerQuota(scope, { exports: 1 }, () => exports.create(scope, document, body.kind!));
        json(response, 201, exported);
        return;
      }

      const fileMatch = url.pathname.match(/^\/api\/exports\/(export_[a-z0-9_]+)\/([a-zA-Z0-9._-]+)$/);
      if (fileMatch && request.method === "GET") {
        const path = exports.exportFilePath(scope, fileMatch[1]!, fileMatch[2]!);
        let metadata;
        try { metadata = await stat(path); } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") { json(response, 404, { error: "Export not found" }); return; }
          throw error;
        }
        response.writeHead(200, { "content-type": contentType(path), "content-length": metadata.size, "content-disposition": `attachment; filename=\"${fileMatch[2]}\"` });
        createReadStream(path).pipe(response);
        return;
      }

      json(response, 404, { error: "Not found" });
    } catch (error) {
      const status = error instanceof GenerationJobLimitError ? 429 : error instanceof GenerationProviderUnavailableError ? 503 : 400;
      const code = error instanceof GenerationJobLimitError ? "rate_limited" : error instanceof GenerationProviderUnavailableError ? "provider_unavailable" : "invalid_input";
      json(response, status, { error: error instanceof Error ? error.message : "Unknown error", code, retryable: status !== 400 });
    }
  });
}
