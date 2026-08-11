import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import proposal from "../../contracts/fixtures/proposal-v0.json" with { type: "json" };
import type { SceneDocument } from "@opendesign/studio-contracts";
import { assertSafePptxAsset, exportDocumentToPng, exportDocumentToPptx, fitTextFontSize, pptxFontFace, pptxTextLanguage, preparePptxText, renderDocumentToHtml, renderSceneToPngBuffer } from "./index.js";

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

test("PPTX exporter rejects image formats affected by the image-size denial-of-service advisories", () => {
  assert.throws(
    () => assertSafePptxAsset({ path: "/tmp/untrusted.icns", mimeType: "image/png" }),
    /PNG or JPEG/,
  );
  assert.throws(
    () => assertSafePptxAsset({ data: "data:image/jxl;base64,AAAA", mimeType: "image/png" }),
    /PNG or JPEG/,
  );
  assert.deepEqual(
    assertSafePptxAsset({ path: "/tmp/safe.png", mimeType: "image/png" }),
    { path: "/tmp/safe.png", mimeType: "image/png" },
  );
});

test("PPTX renderer proactively fits long CJK titles instead of leaving orphan punctuation to Office", () => {
  const title = structuredClone(document.scenes[0]!.elements.find((element) => element.role === "title")!);
  const originalSize = fitTextFontSize(title);
  title.content = "让视觉作品生成之后，仍然可以继续生长。";
  const fittedSize = fitTextFontSize(title);
  assert.ok(fittedSize < originalSize);
  assert.ok(fittedSize >= 35);
});

test("PPTX renderer selects a CJK-capable face without changing Latin typography", () => {
  assert.equal(pptxFontFace("OpenDesign Studio", "Inter, Arial"), "Inter");
  assert.equal(pptxFontFace("生成可编辑的作品", "Inter, Arial"), "Hiragino Sans GB");
  assert.equal(pptxTextLanguage("OpenDesign Studio"), "en-US");
  assert.equal(pptxTextLanguage("生成可编辑的作品"), "zh-CN");
});

test("PPTX renderer wraps CJK body copy at semantic punctuation boundaries", () => {
  const body = document.scenes[0]!.elements.find((element) => element.role === "body")!;
  const prepared = preparePptxText(body, fitTextFontSize(body));
  assert.match(prepared, /\n/);
  assert.ok(prepared.split("\n").every((line) => !/^[，。！？；：、,.!?;:]/u.test(line)));
  assert.ok(prepared.includes("可修错、可编辑"));
});

test("Scene IR canvas renderer emits a full-size PNG without an Office conversion", () => {
  const png = renderSceneToPngBuffer(document, document.scenes[0]!);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1600);
  assert.equal(png.readUInt32BE(20), 900);
});
