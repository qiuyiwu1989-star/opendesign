import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import proposal from "../../contracts/fixtures/proposal-v0.json" with { type: "json" };
import type { SceneDocument } from "@opendesign/studio-contracts";
import { exportDocumentToPptx } from "./index.js";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactDirectory = resolve(packageDirectory, "artifacts");
const result = await exportDocumentToPptx(proposal as SceneDocument, {
  outputPath: resolve(artifactDirectory, "golden-proposal-v0.pptx"),
  generatedAt: "2026-08-12T00:00:00.000Z",
});
await writeFile(
  resolve(artifactDirectory, "golden-proposal-v0-editability.json"),
  `${JSON.stringify(result.report, null, 2)}\n`,
  "utf8",
);
console.log(JSON.stringify({ outputPath: result.outputPath, report: resolve(artifactDirectory, "golden-proposal-v0-editability.json") }));
