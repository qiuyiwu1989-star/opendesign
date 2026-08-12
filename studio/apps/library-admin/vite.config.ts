import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const libraryFiles = ["sites-index.json", "packs-index.json"];
const rootFile = (name: string) => resolve(import.meta.dirname, "../../..", name);

function librarySnapshots(): Plugin {
  return {
    name: "library-snapshots",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
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
    },
  };
}

export default defineConfig({
  plugins: [react(), librarySnapshots()],
  test: { environment: "jsdom", css: true },
});
