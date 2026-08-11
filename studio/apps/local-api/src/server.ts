import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname } from "node:path";
import type { SceneDocument } from "@opendesign/studio-contracts";
import { LocalExportService, type ExportKind } from "./exports.js";
import { LocalProjectStore } from "./storage.js";

const JSON_LIMIT = 5 * 1024 * 1024;

async function readJson(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > JSON_LIMIT) throw new Error("Request body exceeds 5 MB");
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

      const projectMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9_-]{2,63})$/);
      if (projectMatch && request.method === "GET") {
        const document = await store.read(projectMatch[1]!);
        json(response, document ? 200 : 404, document ?? { error: "Project not found" });
        return;
      }
      if (projectMatch && request.method === "PUT") {
        const document = await store.write(projectMatch[1]!, await readJson(request) as SceneDocument);
        json(response, 200, { document, persisted: true });
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
