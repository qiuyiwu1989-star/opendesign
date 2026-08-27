import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import proposal from "../../contracts/fixtures/proposal-v0.json" with { type: "json" };
import type { SceneDocument } from "@opendesign/studio-contracts";
import { runDeterministicQa } from "./index.js";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(packageDirectory, "artifacts", "golden-proposal-v0-qa.json");
const report = runDeterministicQa(proposal as SceneDocument);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, summary: report.summary }));
