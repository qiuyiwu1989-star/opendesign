import assert from "node:assert/strict";
import { test } from "node:test";
import proposal from "../../contracts/fixtures/proposal-v0.json" with { type: "json" };
import type { SceneDocument } from "@opendesign/studio-contracts";
import { runDeterministicQa } from "./index.js";

function brokenDocument(): SceneDocument {
  const document = structuredClone(proposal) as SceneDocument;
  const scene = document.scenes[0];
  if (!scene) throw new Error("Fixture has no scenes");
  scene.elements.push(
    {
      id: "broken_oob",
      type: "text",
      role: "body",
      frame: { x: 1590, y: 850, width: 100, height: 100 },
      content: "out",
      color: "#F2F0EA",
      fontSize: 8,
      editable: true,
    },
    {
      id: "broken_collision",
      type: "text",
      role: "body",
      frame: { x: 1590, y: 850, width: 100, height: 100 },
      content: "collision",
      fontSize: 20,
      editable: true,
    },
    {
      id: "broken_image",
      type: "image",
      role: "image",
      frame: { x: 900, y: 700, width: 100, height: 100 },
      editable: true,
    },
  );
  return document;
}

test("golden fixture has no deterministic layout, asset, size, or contrast errors", () => {
  const report = runDeterministicQa(proposal as SceneDocument, { supportedFonts: ["Inter", "Georgia"] });
  assert.equal(report.summary.total, 0);
});

test("QA catches every known deterministic error category", () => {
  const report = runDeterministicQa(brokenDocument(), {
    supportedFonts: ["Arial"],
    exportDegradations: [
      { sceneId: "scene_cover", elementId: "broken_image", outputMode: "raster", reason: "Unsupported effect rasterized." },
      { sceneId: "scene_cover", elementId: "missing_export", outputMode: "omitted", reason: "Asset unavailable during export." },
    ],
  });
  const categories = new Set(report.issues.map((item) => item.category));
  for (const category of [
    "layout.out_of_bounds",
    "layout.collision",
    "readability.font_size",
    "readability.contrast",
    "asset.missing",
    "asset.alt_missing",
    "export.font_fallback",
    "export.raster_fallback",
    "export.omitted",
  ]) {
    assert.ok(categories.has(category as never), `missing ${category}`);
  }
  assert.equal(report.issues.map((item) => item.issueId).join("\n"), report.issues.map((item) => item.issueId).sort().join("\n"));
});

test("QA is deterministic", () => {
  const first = runDeterministicQa(brokenDocument());
  const second = runDeterministicQa(brokenDocument());
  assert.deepEqual(first, second);
});
