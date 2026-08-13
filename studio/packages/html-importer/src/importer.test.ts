import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateHtmlImportResult } from "@opendesign/studio-contracts";
import { importStructuredHtml } from "./index.js";

const provenance = {
  sources: [
    { sourceId: "source_brief", type: "brief" as const, title: "Studio 产品简报", sourceRef: "fixture://golden/brief" },
    { sourceId: "source_constraints", type: "manual" as const, title: "安全约束", sourceRef: "fixture://golden/constraints" },
    { sourceId: "source_benchmark", type: "document" as const, title: "验收基线", sourceRef: "fixture://golden/benchmark" },
  ],
  generatedBy: { kind: "skill" as const, name: "opendesign-director", version: "0.3.0" },
};

async function golden(): Promise<string> {
  return readFile(new URL("../../../fixtures/golden-task/structured-html-v01.html", import.meta.url), "utf8");
}

test("003 Golden Structured HTML becomes a valid editable Scene IR without executing markup", async () => {
  const result = importStructuredHtml({ html: await golden(), provenance });
  assert.equal(result.status, "accepted");
  assert.equal(validateHtmlImportResult(result).ok, true);
  assert.equal(result.document?.documentId, "doc_golden_import");
  assert.deepEqual(result.document?.designPack, { id: "executive-proposal-cn", version: "1.0.0" });
  assert.equal(result.document?.scenes.length, 6);
  assert.equal(result.document?.scenes[0]?.elements[1]?.id, "scene_01_title");
  assert.equal(result.document?.scenes[0]?.elements[1]?.content, "让视觉作品在生成之后，继续生长。");
  assert.deepEqual(result.document?.scenes[0]?.elements[1]?.editableCapabilities, ["text", "typography", "frame", "order"]);
  assert.deepEqual(result.document?.provenance, provenance);
});

test("003 executable nodes and handlers reject persistence and remain precisely located", async () => {
  const html = (await golden()).replace("</main>", '<script src="https://bad.example/x.js"></script><p onclick="steal()">unsafe</p></main>');
  const result = importStructuredHtml({ html, provenance });
  assert.equal(result.status, "rejected");
  assert.equal(result.document, undefined);
  assert.equal(result.security.blockedNodeCount, 2);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "security.script_blocked" && diagnostic.sourcePath.startsWith("/html:")));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "security.event_handler_blocked"));
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "node.unsupported" && diagnostic.message.includes("onclick")));
});

test("003 dangerous image URLs and missing alt reject the complete import", async () => {
  const html = (await golden()).replace('<div data-od-element-id="scene_01_shape"', '<img src="https://bad.example/tracker.png" alt="" data-od-element-id="scene_01_shape" data-od-role="image"');
  const result = importStructuredHtml({ html, provenance });
  assert.equal(result.status, "rejected");
  assert.equal(result.document, undefined);
  assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "security.url_blocked"));
});

test("003 duplicate IDs, undeclared sources and unavailable pack pins reject import", async () => {
  const sourceHtml = await golden();
  for (const html of [
    sourceHtml.replace("scene_02_title", "scene_01_title"),
    sourceHtml.replace("source_benchmark", "source_missing"),
    sourceHtml.replace("executive-proposal-cn", "missing-pack"),
  ]) {
    const result = importStructuredHtml({ html, provenance });
    assert.equal(result.status, "rejected");
    assert.equal(result.document, undefined);
  }
});

test("003 malformed frame values and oversized inputs fail closed", async () => {
  const malformed = importStructuredHtml({ html: (await golden()).replace("112,92,540,44", "112,nope,540,44"), provenance });
  assert.equal(malformed.status, "rejected");
  assert.ok(malformed.diagnostics.some((diagnostic) => diagnostic.code === "scene_ir.invalid"));

  const oversized = importStructuredHtml({ html: `<main>${"x".repeat(513 * 1024)}</main>`, provenance });
  assert.equal(oversized.status, "rejected");
  assert.match(oversized.diagnostics[0]?.message ?? "", /512 KiB/);
});
