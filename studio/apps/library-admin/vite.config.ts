import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCompactPackManifest } from "./src/data/pack";
import { createSyncApiMiddleware } from "./dev";
import { createOperationsApiMiddleware } from "./dev/operations-middleware";

const libraryFiles = ["sites-index.json"];
const rootFile = (name: string) => resolve(import.meta.dirname, "../../..", name);
const execFileAsync = promisify(execFile);

async function compactPackManifest() {
  const sourcePath = rootFile("packs-index.json");
  const [source, sourceStat] = await Promise.all([readFile(sourcePath, "utf8"), stat(sourcePath)]);
  let sourceRevision: string | undefined;
  try {
    sourceRevision = (await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: resolve(import.meta.dirname, "../../.."),
      encoding: "utf8",
    })).stdout.trim();
  } catch { /* build provenance remains valid without a Git revision */ }
  return JSON.stringify(createCompactPackManifest(JSON.parse(source), {
    generatedAt: sourceStat.mtime.toISOString(),
    sourceBytes: sourceStat.size,
    ...(sourceRevision ? { sourceRevision } : {}),
  }));
}

function librarySnapshots(): Plugin {
  return {
    name: "library-snapshots",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === "/pack-manifest.json") {
          void compactPackManifest().then(body => {
            response.setHeader("content-type", "application/json; charset=utf-8");
            response.end(body);
          }).catch(next);
          return;
        }
        const name = libraryFiles.find(file => request.url === `/${file}`);
        if (!name) return next();
        void readFile(rootFile(name)).then(body => {
          response.setHeader("content-type", "application/json; charset=utf-8");
          response.end(body);
        }).catch(next);
      });
    },
    async generateBundle() {
      for (const name of libraryFiles) this.emitFile({ type: "asset", fileName: name, source: await readFile(rootFile(name)) });
      this.emitFile({ type: "asset", fileName: "pack-manifest.json", source: await compactPackManifest() });
    },
  };
}

export default defineConfig({
  base: "/admin/",
  plugins: [react(), librarySnapshots(), {
    name: "read-only-admin-api",
    configureServer(server) {
      server.middlewares.use(createOperationsApiMiddleware());
      server.middlewares.use(createSyncApiMiddleware({ repoRoot: resolve(import.meta.dirname, "../../..") }));
    },
  }],
  test: { environment: "jsdom", css: true },
});
