import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import proposal from "../../contracts/fixtures/proposal-v0.json" with { type: "json" };
import type { SceneDocument } from "@opendesign/studio-contracts";
import { exportDocumentToPng, exportDocumentToPptx, renderDocumentToHtml } from "./index.js";

const document = proposal as SceneDocument;

test("HTML renderer preserves scene and element identities", () => {
  const html = renderDocumentToHtml(document);
  assert.match(html, /data-scene-id="scene_cover"/);
  assert.match(html, /data-element-id="cover_title"/);
  assert.match(html, /让视觉作品在生成之后/);
  assert.equal((html.match(/<section/g) ?? []).length, 6);
});

test("PNG exporter delegates one deterministic request per scene", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-png-adapter-"));
  const requests: Array<{ outputPath: string; html: string }> = [];
  try {
    const result = await exportDocumentToPng(document, {
      outputDirectory: join(directory, "pages"),
      adapter: {
        name: "memory-test",
        async capture(request) {
          requests.push({ outputPath: request.outputPath, html: request.html });
        },
      },
    });
    assert.equal(result.pages.length, 6);
    assert.equal(requests.length, 6);
    assert.match(requests[0]?.outputPath ?? "", /01-scene_cover\.png$/);
    assert.match(requests[0]?.html ?? "", /width:1600px/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PPTX exporter creates native editable objects and no page raster fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-renderer-"));
  const outputPath = join(directory, "proposal.pptx");
  try {
    const result = await exportDocumentToPptx(document, { outputPath, generatedAt: "2026-08-12T00:00:00.000Z" });
    const bytes = await readFile(outputPath);
    assert.ok(bytes.byteLength > 10_000);
    const expectedElements = document.scenes.reduce((total, scene) => total + scene.elements.length, 0);
    assert.equal(result.report.summary.totalElements, expectedElements);
    assert.equal(result.report.summary.nativeElements, expectedElements);
    assert.equal(result.report.summary.rasterFallbacks, 0);
    assert.equal(result.report.summary.omittedElements, 0);
    assert.ok(result.report.elements.every((item) => item.outputMode === "native"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
