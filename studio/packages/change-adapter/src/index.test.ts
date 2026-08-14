import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../../contracts/fixtures/proposal-v0.json" with { type: "json" };
import type { SceneDocument } from "@opendesign/studio-contracts";
import {
  CHANGE_ADAPTER_CONTRACT_VERSION,
  CHANGE_CANDIDATE_VERSION,
  createFixtureChangeProvider,
  proposeChangeWithModel,
  type ChangeProvider,
  type ChangeRequest,
} from "./index.js";

const document = fixture as SceneDocument;

function request(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    contractVersion: CHANGE_ADAPTER_CONTRACT_VERSION,
    requestId: "change_eval_001",
    projectId: document.documentId,
    baseRevisionId: "revision_eval_001",
    document,
    instruction: "把封面标题改得更有决策感。",
    target: { kind: "element", sceneId: "scene_cover", elementId: "cover_title" },
    ...overrides,
  };
}

function candidate(patches: unknown[], extra: Record<string, unknown> = {}) {
  return {
    candidateVersion: CHANGE_CANDIDATE_VERSION,
    rationale: "让核心主张更聚焦，同时保留原有布局。",
    patches,
    ...extra,
  };
}

test("011 accepts a legal local patch without mutating or publishing the base document", async () => {
  const base = structuredClone(document);
  const result = await proposeChangeWithModel(
    createFixtureChangeProvider(candidate([{ elementId: "cover_title", field: "content", value: "先证明闭环，再扩大能力。" }])),
    request(),
  );

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.equal(result.notPublished, true);
  assert.deepEqual(document, base);
  assert.equal(result.diffs.length, 1);
  assert.equal(result.diffs[0]?.before, "让视觉作品在生成之后，继续生长。");
  assert.equal(result.diffs[0]?.after, "先证明闭环，再扩大能力。");
  assert.equal(result.proposedDocument.scenes[0]?.elements.find((item) => item.id === "cover_title")?.content, "先证明闭环，再扩大能力。");
});

test("011 rejects full documents, extra authority and unsupported fields", async () => {
  for (const untrusted of [
    document,
    candidate([{ elementId: "cover_title", field: "content", value: "新标题" }], { publish: true }),
    candidate([{ elementId: "cover_title", field: "directionId", value: "direction_research" }]),
  ]) {
    const result = await proposeChangeWithModel(createFixtureChangeProvider(untrusted), request());
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.equal(result.error.code, "candidate.invalid");
  }
});

test("011 rejects cross-target and capability-escalating patches", async () => {
  const outside = await proposeChangeWithModel(
    createFixtureChangeProvider(candidate([{ elementId: "problem_title", field: "content", value: "越权修改" }])),
    request(),
  );
  assert.equal(outside.status, "rejected");
  if (outside.status === "rejected") assert.equal(outside.error.code, "candidate.out_of_scope");

  const restricted = structuredClone(document);
  const title = restricted.scenes[0]?.elements.find((item) => item.id === "cover_title");
  assert.ok(title);
  title.editableCapabilities = ["text"];
  const escalation = await proposeChangeWithModel(
    createFixtureChangeProvider(candidate([{ elementId: "cover_title", field: "fontSize", value: 84 }])),
    request({ document: restricted }),
  );
  assert.equal(escalation.status, "rejected");
  if (escalation.status === "rejected") assert.equal(escalation.error.code, "candidate.rejected");
});

test("011 rejects dangerous assets, invalid geometry and duplicate field patches", async () => {
  const cases = [
    candidate([{ elementId: "cover_title", field: "assetSrc", value: "https://tracker.example/pixel.png" }]),
    candidate([{ elementId: "cover_title", field: "frame", value: { x: -10, y: 0, width: 500, height: 200 } }]),
    candidate([
      { elementId: "cover_title", field: "content", value: "第一个标题" },
      { elementId: "cover_title", field: "content", value: "第二个标题" },
    ]),
  ];
  const expected = ["candidate.invalid", "candidate.rejected", "candidate.invalid"];
  for (const [index, untrusted] of cases.entries()) {
    const result = await proposeChangeWithModel(createFixtureChangeProvider(untrusted), request());
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.equal(result.error.code, expected[index]);
  }
});

test("011 enforces candidate byte and patch limits", async () => {
  const tooLarge = await proposeChangeWithModel(
    createFixtureChangeProvider(candidate([{ elementId: "cover_title", field: "content", value: "字".repeat(2_000) }])),
    request(),
    { maxCandidateBytes: 512 },
  );
  assert.equal(tooLarge.status, "rejected");
  if (tooLarge.status === "rejected") assert.equal(tooLarge.error.code, "candidate.too_large");

  const tooMany = await proposeChangeWithModel(
    createFixtureChangeProvider(candidate(Array.from({ length: 13 }, (_, index) => ({ elementId: "cover_title", field: "fontSize", value: 60 + index })))),
    request(),
  );
  assert.equal(tooMany.status, "rejected");
  if (tooMany.status === "rejected") assert.equal(tooMany.error.code, "candidate.invalid");
});

test("011 maps timeout and caller abort without trusting provider output", async () => {
  const pending: ChangeProvider = {
    providerId: "fixture",
    model: "change-fixture-v1",
    propose: async ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })),
  };
  const timedOut = await proposeChangeWithModel(pending, request(), { timeoutMs: 100 });
  assert.equal(timedOut.status, "rejected");
  if (timedOut.status === "rejected") assert.equal(timedOut.error.code, "provider.timeout");

  const controller = new AbortController();
  const abortedPromise = proposeChangeWithModel(pending, request({ signal: controller.signal }), { timeoutMs: 1_000 });
  controller.abort(new Error("cancelled by test"));
  const aborted = await abortedPromise;
  assert.equal(aborted.status, "rejected");
  if (aborted.status === "rejected") assert.equal(aborted.error.code, "request.aborted");
});

test("011 redacts provider credentials and bodies from failures", async () => {
  const provider: ChangeProvider = {
    providerId: "fixture",
    model: "change-fixture-v1",
    propose: async () => { throw new Error("api_key=test-only-credential-value\nraw upstream body"); },
  };
  const result = await proposeChangeWithModel(provider, request());
  assert.equal(result.status, "rejected");
  assert.doesNotMatch(JSON.stringify(result), /test-only-credential-value|raw upstream body/u);
});
