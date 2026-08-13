import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname } from "node:path";
import { assertSceneDocument, type DesignPackPin, type DocumentProvenance, type SceneDocument, type ScenePatch } from "@opendesign/studio-contracts";
import { compileDesignDirector } from "@opendesign/studio-design-director";
import { importStructuredHtml } from "@opendesign/studio-html-importer";
import { LocalExportService, type ExportKind } from "./exports.js";
import { generateProjectFromBrief } from "./generator.js";
import { LocalProjectStore } from "./storage.js";
import { runDeterministicQa } from "@opendesign/studio-qa";
import { loadImage } from "@napi-rs/canvas";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const JSON_LIMIT = 5 * 1024 * 1024;
const SAFE_IMAGE_MIME = new Set(["image/png", "image/jpeg"]);

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

export function createStudioServer(options: { dataDirectory: string }) {
  const store = new LocalProjectStore(options.dataDirectory);
  const exports = new LocalExportService(options.dataDirectory);

  return createServer(async (request, response) => {
    response.setHeader("cache-control", "no-store");
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/health") {
        json(response, 200, { ok: true, mode: "local-only" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/projects") {
        json(response, 200, { projects: await store.list() });
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
        await store.create(generated.document);
        json(response, 201, generated);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/design-director/drafts") {
        const compiled = compileDesignDirector(await readJson(request, 640 * 1024));
        if (compiled.status === "accepted" && compiled.importResult.document) {
          if (await store.read(compiled.importResult.document.documentId)) {
            json(response, 409, { error: "Project already exists", ...compiled });
            return;
          }
          await store.create(compiled.importResult.document);
        }
        json(response, compiled.status === "accepted" ? 201 : 422, compiled);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/imports/html") {
        const body = await readJson(request, 640 * 1024) as { html?: string; provenance?: DocumentProvenance };
        if (typeof body.html !== "string") throw new Error("HTML is required");
        if (!body.provenance) throw new Error("Provenance is required");
        const imported = importStructuredHtml({ html: body.html, provenance: body.provenance });
        if (imported.status === "accepted" && imported.document) {
          if (await store.read(imported.document.documentId)) {
            json(response, 409, { error: "Project already exists", ...imported });
            return;
          }
          await store.create(imported.document);
        }
        json(response, imported.status === "rejected" ? 422 : 201, imported);
        return;
      }

      const duplicateMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9_-]{2,63})\/duplicate$/);
      if (duplicateMatch && request.method === "POST") {
        const source = await store.read(duplicateMatch[1]!);
        if (!source) { json(response, 404, { error: "Project not found" }); return; }
        const documentId = `project_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
        const document: SceneDocument = { ...structuredClone(source), documentId, title: `${source.title} · 副本` };
        await store.create(document);
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
        const directory = join(options.dataDirectory, "assets", assetMatch[1]!);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `${assetId}.${extension}`), bytes, { mode: 0o600 });
        json(response, 201, { assetId, name: body.name?.slice(0, 160) || `${assetId}.${extension}`, mimeType: body.mimeType, width: image.width, height: image.height, url: `/api/assets/${assetMatch[1]}/${assetId}.${extension}` });
        return;
      }

      const assetFileMatch = url.pathname.match(/^\/api\/assets\/([a-z][a-z0-9_-]{2,63})\/(asset_[a-z0-9_]+\.(?:png|jpg))$/);
      if (assetFileMatch && request.method === "GET") {
        const path = join(options.dataDirectory, "assets", assetFileMatch[1]!, assetFileMatch[2]!);
        const metadata = await stat(path);
        response.writeHead(200, { "content-type": contentType(path), "content-length": metadata.size, "cache-control": "private, max-age=31536000, immutable" });
        createReadStream(path).pipe(response);
        return;
      }

      const projectMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9_-]{2,63})$/);
      if (projectMatch && request.method === "GET") {
        const document = await store.read(projectMatch[1]!);
        json(response, document ? 200 : 404, document ?? { error: "Project not found" });
        return;
      }
      if (projectMatch && request.method === "PUT") {
        const body = await readJson(request) as { document?: SceneDocument; reason?: "edit" | "qa-fix" | "regenerate"; patches?: ScenePatch[] } | SceneDocument;
        const document = "document" in body && body.document ? body.document : body as SceneDocument;
        const existing = await store.read(projectMatch[1]!);
        const reason = existing ? ("reason" in body && body.reason ? body.reason : "edit") : "initial";
        const patches = "patches" in body && Array.isArray(body.patches) ? body.patches : [];
        const stored = await store.appendRevision(projectMatch[1]!, document, { reason, patches });
        json(response, 200, { document: stored.document, revision: stored.revision, persisted: true });
        return;
      }

      const revisionMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9_-]{2,63})\/revisions$/);
      if (revisionMatch && request.method === "GET") {
        json(response, 200, { revisions: await store.listRevisions(revisionMatch[1]!) });
        return;
      }

      const exportMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9_-]{2,63})\/exports$/);
      if (exportMatch && request.method === "POST") {
        const body = await readJson(request) as { kind?: ExportKind };
        if (!body.kind || !["html", "png", "pptx"].includes(body.kind)) throw new Error("Unknown export kind");
        const document = await store.read(exportMatch[1]!);
        if (!document) { json(response, 404, { error: "Project not found" }); return; }
        json(response, 201, await exports.create(document, body.kind));
        return;
      }

      const fileMatch = url.pathname.match(/^\/api\/exports\/(export_[a-z0-9_]+)\/([a-zA-Z0-9._-]+)$/);
      if (fileMatch && request.method === "GET") {
        const path = exports.exportFilePath(fileMatch[1]!, fileMatch[2]!);
        const metadata = await stat(path);
        response.writeHead(200, { "content-type": contentType(path), "content-length": metadata.size, "content-disposition": `attachment; filename=\"${fileMatch[2]}\"` });
        createReadStream(path).pipe(response);
        return;
      }

      json(response, 404, { error: "Not found" });
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : "Unknown error" });
    }
  });
}
