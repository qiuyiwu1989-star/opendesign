import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileDesignDirector,
  validateDesignDirectorInput,
  validateDesignDirectorOutput,
  type DesignDirectorInput,
} from "./index.js";

const packByKind = {
  proposal: "executive-proposal-cn",
  keynote: "research-keynote-cn",
  "article-graphics": "editorial-story-graphics-cn",
} as const;

function input(kind: keyof typeof packByKind = "proposal"): DesignDirectorInput {
  return {
    inputVersion: "0.1.0",
    taskId: `golden_${kind.replaceAll("-", "_")}`,
    title: kind === "proposal" ? "让 AI 生成保持可编辑" : kind === "keynote" ? "结构化生成的证据边界" : "设计判断如何进入每一张配图",
    brief: {
      objective: "用可追溯的证据建立清晰叙事，并保留人工修改权。",
      audience: "产品与设计决策者",
      decisionRequest: "确认进入受控试点",
      constraints: ["不得补造数据", "发布前需要人工确认"],
    },
    content: {
      summary: "Structured HTML 负责生成语义，Scene IR 负责稳定编辑，Design Pack 负责可复用的设计判断。",
      keyPoints: [
        { id: "point_diagnose", text: "设计诊断必须先于视觉生成", sourceIds: ["source_brief"] },
        { id: "point_editable", text: "稳定 ID 与原生对象共同保留人工编辑权", sourceIds: ["source_research"] },
        { id: "point_evidence", text: "所有事实必须绑定来源，证据不足时明确暴露缺口", sourceIds: ["source_brief", "source_research"] },
      ],
      callToAction: "先在三个 Golden Task 中验证，再决定是否扩大模板范围。",
    },
    sources: [
      { sourceId: "source_brief", type: "brief", title: "Studio Brief", sourceRef: "fixture://studio-brief", content: "先诊断，再生成；所有外部事实必须可追溯。" },
      { sourceId: "source_research", type: "document", title: "编辑性研究", sourceRef: "fixture://editability", content: "稳定标识和结构化对象是人工修改与多格式导出的基础。" },
    ],
    brand: { name: "OpenDesign", tone: ["克制", "编辑感"], primaryColor: "#D84A2F" },
    deliverable: { kind, audience: "产品与设计决策者", language: "zh-CN", format: "structured-html", pageCount: 6 },
    designPack: { id: packByKind[kind], version: "1.0.0" },
    editability: {
      requiredCapabilities: ["text", "typography", "asset", "frame", "order"],
      requireNativeText: true,
      requireReplaceableImages: true,
      requireReorderablePages: true,
    },
  };
}

describe("Design Director compiler", () => {
  for (const kind of Object.keys(packByKind) as Array<keyof typeof packByKind>) {
    it(`compiles ${kind} through the Structured HTML importer`, () => {
      const result = compileDesignDirector(input(kind));
      assert.equal(result.status, "accepted");
      if (result.status !== "accepted") return;
      assert.equal(result.importResult.status, "accepted");
      assert.equal(result.importResult.document.scenes.length, 6);
      assert.deepEqual(result.importResult.document.designPack, { id: packByKind[kind], version: "1.0.0" });
      assert.match(result.html, new RegExp(`data-od-design-pack-id="${packByKind[kind]}"`, "u"));
      assert.equal(result.manifest.sceneIds.length, 6);
      assert.equal(result.manifest.elementIds.length, 36);
      assert.ok(result.importResult.document.scenes.every((scene) => scene.elements.some((element) => element.type === "image" && element.editableCapabilities?.includes("asset"))));
      assert.deepEqual(validateDesignDirectorOutput(result), { ok: true, value: result, issues: [] });
    });
  }

  it("preserves complete source coverage in HTML, manifest, and Scene IR", () => {
    const result = compileDesignDirector(input());
    assert.equal(result.status, "accepted");
    if (result.status !== "accepted") return;
    assert.deepEqual(result.manifest.sourceCoverage, {
      declaredSourceIds: ["source_brief", "source_research"],
      usedSourceIds: ["source_brief", "source_research"],
      unusedSourceIds: [],
      unresolvedSourceIds: [],
    });
    const importedIds = new Set(result.importResult.document.scenes.flatMap((scene) => scene.elements.flatMap((element) => element.sourceIds ?? [])));
    assert.deepEqual([...importedIds].sort(), ["source_brief", "source_research"]);
    assert.match(result.html, /data-od-source-ids="source_brief source_research"/u);
  });

  it("is deterministic and keeps stable scene and element IDs", () => {
    const first = compileDesignDirector(input());
    const second = compileDesignDirector(structuredClone(input()));
    assert.deepEqual(second, first);
    assert.equal(first.status, "accepted");
    if (first.status !== "accepted") return;
    assert.equal(first.manifest.documentId, "doc_golden_proposal");
    assert.equal(first.manifest.sceneIds[0], "golden_proposal_s01");
    assert.equal(first.manifest.elementIds[0], "golden_proposal_p01_shape");
    assert.deepEqual(first.manifest.sceneIds, first.importResult.document.scenes.map((scene) => scene.id));
  });

  it("uses materially different compositions across the three Design Packs", () => {
    const proposal = compileDesignDirector(input("proposal"));
    const keynote = compileDesignDirector(input("keynote"));
    const graphics = compileDesignDirector(input("article-graphics"));
    assert.equal(proposal.status, "accepted");
    assert.equal(keynote.status, "accepted");
    assert.equal(graphics.status, "accepted");
    if (proposal.status !== "accepted" || keynote.status !== "accepted" || graphics.status !== "accepted") return;
    assert.match(proposal.html, /data-od-frame="80,72,16,756"/u);
    assert.match(keynote.html, /data-od-frame="1488,72,16,756"/u);
    assert.match(graphics.html, /data-od-frame="260,106,1080,12"/u);
    assert.match(graphics.html, /data-od-align="center"/u);
  });

  it("fails closed for an unknown pack", () => {
    const value = input();
    value.designPack = { id: "unknown-pack", version: "1.0.0" };
    const result = compileDesignDirector(value);
    assert.equal(result.status, "rejected");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "pack.unknown"));
    assert.ok(!("html" in result));
  });

  it("fails closed when a key point cites a missing source", () => {
    const value = input();
    value.content.keyPoints[0]!.sourceIds = ["source_missing"];
    const result = compileDesignDirector(value);
    assert.equal(result.status, "rejected");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "source.unresolved"));
  });

  it("fails closed when a declared source is unused", () => {
    const value = input();
    value.sources.push({ sourceId: "source_unused", type: "manual", title: "未使用来源", content: "这份来源没有支撑任何输入事实点。" });
    const result = compileDesignDirector(value);
    assert.equal(result.status, "rejected");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "source.coverage_incomplete"));
  });

  it("fails closed for overlong input", () => {
    const value = input();
    value.sources[0]!.content = "x".repeat(12_001);
    const result = compileDesignDirector(value);
    assert.equal(result.status, "rejected");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "input.schema_invalid"));
  });

  it("fails closed for illegal editability requirements", () => {
    const value = input();
    value.editability.requireNativeText = false;
    value.editability.requiredCapabilities = ["text", "frame"];
    const result = compileDesignDirector(value);
    assert.equal(result.status, "rejected");
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "editability.native_text_required"));
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "editability.requirement_missing"));
  });

  it("input validator rejects additional fields instead of silently ignoring them", () => {
    const value: Record<string, unknown> = { ...input(), executeScript: true };
    const result = validateDesignDirectorInput(value);
    assert.equal(result.ok, false);
  });

  it("escapes user content instead of creating executable markup", () => {
    const value = input();
    value.title = '<script>alert("no")</script>';
    value.content.summary = '<img src="https://attacker.invalid/a.png">';
    const result = compileDesignDirector(value);
    assert.equal(result.status, "accepted");
    if (result.status !== "accepted") return;
    assert.doesNotMatch(result.html, /<script>|<img src="https:/u);
    assert.match(result.html, /&lt;script&gt;/u);
    assert.equal(result.importResult.security.blockedNodeCount, 0);
  });
});
