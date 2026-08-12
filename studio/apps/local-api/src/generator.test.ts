import assert from "node:assert/strict";
import test from "node:test";
import { validateSceneDocument } from "@opendesign/studio-contracts";
import { generateProjectFromBrief } from "./generator.js";

test("local generator turns a Brief into a valid six-page Scene IR and storyline", () => {
  const generated = generateProjectFromBrief({
    brief: "独立创作者需要把长文章快速转化为有设计感的提案。生成之后还要修改文字、替换图片，并导出可编辑的 PowerPoint。",
    documentId: "project_generator_test",
  });
  assert.equal(generated.document.scenes.length, 6);
  assert.equal(generated.storyline.length, 6);
  assert.equal(generated.document.documentId, "project_generator_test");
  assert.match(generated.storyline[0]!.headline, /独立创作者/);
  assert.equal(validateSceneDocument(generated.document).ok, true);
});

test("local generator rejects empty or excessively large inputs", () => {
  assert.throws(() => generateProjectFromBrief({ brief: "太短" }), /至少/);
  assert.throws(() => generateProjectFromBrief({ brief: "长".repeat(12_001) }), /12,000/);
});
