import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PatchApplicationError,
  SceneContractError,
  applyPatch,
  assertSceneDocument,
  createRevision,
  validateRevision,
  validateSceneDocument,
  validateStudioIssue,
  type SceneDocument,
} from "./index.js";

const fixtureUrl = new URL("../fixtures/proposal-v0.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as SceneDocument;

function copyFixture(): SceneDocument {
  return structuredClone(fixture);
}

function expectIssue(value: unknown, code: string): void {
  const result = validateSceneDocument(value);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.issues.some((issue) => issue.code === code), `expected issue ${code}: ${JSON.stringify(result.issues)}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

test("the proposal fixture satisfies schema and semantic validation", () => {
  const result = validateSceneDocument(fixture);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.value, fixture);
    assert.deepEqual(result.issues, []);
  }
  assert.doesNotThrow(() => assertSceneDocument(fixture));
});

test("schema validation reports missing fields and unknown properties", () => {
  const missingTitle = copyFixture() as unknown as Record<string, unknown>;
  delete missingTitle.title;
  expectIssue(missingTitle, "schema.required");

  const unknownProperty = { ...copyFixture(), debug: true };
  expectIssue(unknownProperty, "schema.additionalProperties");
});

test("assertSceneDocument exposes normalized contract issues", () => {
  const invalid = copyFixture();
  invalid.selectedDirectionId = "direction_missing";

  assert.throws(
    () => assertSceneDocument(invalid),
    (error: unknown) => {
      assert.ok(error instanceof SceneContractError);
      assert.equal(error.issues[0]?.code, "direction.selected_missing");
      return true;
    },
  );
});

test("IDs are unique across the entire document namespace", () => {
  const invalid = copyFixture();
  invalid.scenes[0]!.elements[0]!.id = invalid.directions[0]!.id;
  expectIssue(invalid, "id.duplicate");
});

test("selectedDirectionId must refer to a declared direction", () => {
  const invalid = copyFixture();
  invalid.selectedDirectionId = "direction_missing";
  expectIssue(invalid, "direction.selected_missing");
});

test("scene orders must be unique and continuous from one", () => {
  const invalid = copyFixture();
  invalid.scenes[1]!.order = 1;
  const result = validateSceneDocument(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) {
    const codes = result.issues.map((issue) => issue.code);
    assert.ok(codes.includes("scene.order_duplicate"));
    assert.ok(codes.includes("scene.order_gap"));
  }
});

test("frames must end inside both canvas boundaries", () => {
  const horizontal = copyFixture();
  horizontal.scenes[0]!.elements[0]!.frame = { x: 1500, y: 0, width: 200, height: 100 };
  expectIssue(horizontal, "frame.horizontal_out_of_bounds");

  const vertical = copyFixture();
  vertical.scenes[0]!.elements[0]!.frame = { x: 0, y: 850, width: 100, height: 100 };
  expectIssue(vertical, "frame.vertical_out_of_bounds");
});

test("text-like elements require non-empty content", () => {
  for (const type of ["text", "metric", "quote"] as const) {
    const invalid = copyFixture();
    const element = invalid.scenes[0]!.elements[0]!;
    element.type = type;
    element.content = "   ";
    expectIssue(invalid, "element.text_content_missing");
  }
});

test("image elements require source and accessible alt text", () => {
  const invalid = copyFixture();
  const element = invalid.scenes[0]!.elements[3]!;
  element.type = "image";
  element.role = "image";
  element.editable = true;
  delete element.assetSrc;
  element.alt = " ";

  const result = validateSceneDocument(invalid);
  assert.equal(result.ok, false);
  if (!result.ok) {
    const codes = result.issues.map((issue) => issue.code);
    assert.ok(codes.includes("element.image_source_missing"));
    assert.ok(codes.includes("element.image_alt_missing"));
  }
});

test("applyPatch changes only the target element and never mutates its input", () => {
  const document = deepFreeze(copyFixture());
  const originalSnapshot = JSON.stringify(document);
  const targetScene = document.scenes[0]!;
  const targetElement = targetScene.elements[1]!;
  const untouchedElement = targetScene.elements[0]!;

  const revised = applyPatch(document, {
    elementId: targetElement.id,
    field: "content",
    value: "A revised title",
  });

  assert.equal(JSON.stringify(document), originalSnapshot);
  assert.notStrictEqual(revised, document);
  assert.strictEqual(revised.directions, document.directions);
  assert.notStrictEqual(revised.scenes, document.scenes);
  assert.notStrictEqual(revised.scenes[0], targetScene);
  assert.strictEqual(revised.scenes[1], document.scenes[1]);
  assert.strictEqual(revised.scenes[0]!.elements[0], untouchedElement);
  assert.notStrictEqual(revised.scenes[0]!.elements[1], targetElement);
  assert.equal(revised.scenes[0]!.elements[1]!.content, "A revised title");
  assert.equal(targetElement.content, "让视觉作品在生成之后，继续生长。");
});

test("applyPatch rejects unknown, non-editable, and incompatible targets", () => {
  const document = copyFixture();
  assert.throws(
    () => applyPatch(document, { elementId: "element_missing", field: "content", value: "x" }),
    PatchApplicationError,
  );
  assert.throws(
    () => applyPatch(document, { elementId: "cover_shape", field: "content", value: "x" }),
    /not editable/,
  );
  assert.throws(
    () => applyPatch(document, { elementId: "cover_title", field: "assetSrc", value: "asset.png" }),
    /only be patched on image/,
  );

  const ambiguous = copyFixture();
  ambiguous.scenes[0]!.elements[2]!.id = "cover_title";
  assert.throws(
    () => applyPatch(ambiguous, { elementId: "cover_title", field: "content", value: "x" }),
    /ambiguous/,
  );
});

test("applyPatch supports image source and alt edits", () => {
  const document = copyFixture();
  const image = document.scenes[0]!.elements[3]!;
  image.type = "image";
  image.role = "image";
  image.editable = true;
  image.assetSrc = "asset-before.png";
  image.alt = "Before";

  const withSource = applyPatch(document, {
    elementId: image.id,
    field: "assetSrc",
    value: "asset-after.png",
  });
  const withAlt = applyPatch(withSource, {
    elementId: image.id,
    field: "alt",
    value: "After",
  });

  assert.equal(withAlt.scenes[0]!.elements[3]!.assetSrc, "asset-after.png");
  assert.equal(withAlt.scenes[0]!.elements[3]!.alt, "After");
  assert.equal(image.assetSrc, "asset-before.png");
  assert.equal(image.alt, "Before");
});

test("applyPatch supports deterministic QA style fixes", () => {
  const document = copyFixture();
  const recolored = applyPatch(document, { elementId: "system_html", field: "color", value: "text" });
  const resized = applyPatch(recolored, { elementId: "system_html", field: "fontSize", value: 36 });
  const element = resized.scenes.flatMap((scene) => scene.elements).find((item) => item.id === "system_html");
  assert.equal(element?.color, "text");
  assert.equal(element?.fontSize, 36);
  assert.throws(
    () => applyPatch(document, { elementId: "system_html", field: "fontSize", value: 6 }),
    PatchApplicationError,
  );
});

test("applyPatch updates typography tokens on one design direction", () => {
  const document = copyFixture();
  const revised = applyPatch(document, { directionId: "direction_editorial", field: "headingFamily", value: "Songti SC, serif" });
  assert.equal(revised.directions[0]!.tokens.headingFamily, "Songti SC, serif");
  assert.equal(revised.directions[1]!.tokens.headingFamily, document.directions[1]!.tokens.headingFamily);
  assert.notEqual(revised, document);
});

test("createRevision applies ordered patches and copies revision input", () => {
  const document = deepFreeze(copyFixture());
  const patches = [
    { elementId: "cover_title", field: "content" as const, value: "First edit" },
    { elementId: "cover_title", field: "content" as const, value: "Final edit" },
    { elementId: "cover_body", field: "content" as const, value: "Updated body" },
  ];

  const result = createRevision(document, {
    revisionId: "revision_001",
    parentRevisionId: "revision_000",
    createdAt: "2026-08-12T10:30:00.000Z",
    reason: "edit",
    patches,
  });

  assert.equal(result.document.scenes[0]!.elements[1]!.content, "Final edit");
  assert.equal(result.document.scenes[0]!.elements[2]!.content, "Updated body");
  assert.equal(document.scenes[0]!.elements[1]!.content, "让视觉作品在生成之后，继续生长。");
  assert.notStrictEqual(result.revision.patches, patches);
  assert.notStrictEqual(result.revision.patches[0], patches[0]);
  patches[0]!.value = "mutated after creation";
  assert.equal(result.revision.patches[0]!.value, "First edit");
});

test("createRevision rejects invalid metadata and invalid resulting documents", () => {
  assert.throws(
    () => createRevision(copyFixture(), {
      revisionId: "revision_bad",
      parentRevisionId: null,
      createdAt: "not-a-date",
      reason: "edit",
      patches: [],
    }),
    /Revision metadata is invalid/,
  );

  assert.throws(
    () => createRevision(copyFixture(), {
      revisionId: "revision_empty_title",
      parentRevisionId: null,
      createdAt: "2026-08-12T10:30:00.000Z",
      reason: "edit",
      patches: [{ elementId: "cover_title", field: "content", value: "" }],
    }),
    SceneContractError,
  );
});

test("revision and issue artifacts have runtime schemas", () => {
  const revision = validateRevision({
    revisionId: "revision_001",
    parentRevisionId: null,
    createdAt: "2026-08-12T10:30:00.000Z",
    reason: "initial",
    patches: [],
  });
  assert.equal(revision.ok, true);
  assert.ok(revision.ok);
  assert.equal(validateRevision({ ...revision.value, createdAt: "yesterday" }).ok, false);

  const issue = validateStudioIssue({
    issueId: "issue_001",
    sceneId: "scene_cover",
    elementIds: ["cover_title"],
    category: "layout.overflow",
    severity: "error",
    message: "Title overflows its frame",
    status: "open",
    safeAutoFix: false,
  });
  assert.equal(issue.ok, true);
  assert.ok(issue.ok);
  assert.equal(validateStudioIssue({ ...issue.value, severity: "urgent" }).ok, false);
});
