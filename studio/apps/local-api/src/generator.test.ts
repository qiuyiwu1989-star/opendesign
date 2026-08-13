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
  assert.deepEqual(generated.document.designPack, { id: "executive-proposal-cn", version: "1.0.0" });
  assert.match(generated.document.provenance?.sources[0]?.contentHash ?? "", /^sha256:[a-f0-9]{64}$/);
  assert.equal(validateSceneDocument(generated.document).ok, true);
});

test("003 local generator pins and applies an explicitly selected Design Pack", () => {
  const generated = generateProjectFromBrief({
    brief: "把一篇研究报告转成可以继续编辑的主题演讲，并保留来源、判断与限制。",
    documentId: "project_research_pack",
    designPack: { id: "research-keynote-cn", version: "1.0.0" },
  });
  assert.deepEqual(generated.document.designPack, { id: "research-keynote-cn", version: "1.0.0" });
  assert.equal(generated.document.selectedDirectionId, "direction_research-keynote-cn");
  assert.equal(generated.document.directions.find((direction) => direction.id === generated.document.selectedDirectionId)?.tokens.accent, "#2161D1");
  assert.throws(() => generateProjectFromBrief({ brief: "这是一个长度足够但设计包无效的测试输入。", designPack: { id: "missing-pack", version: "1.0.0" } }), /Unknown Design Pack/);
});

test("local generator rejects empty or excessively large inputs", () => {
  assert.throws(() => generateProjectFromBrief({ brief: "太短" }), /至少/);
  assert.throws(() => generateProjectFromBrief({ brief: "长".repeat(12_001) }), /12,000/);
});
