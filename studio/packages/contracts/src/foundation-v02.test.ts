import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PatchApplicationError,
  applyPatch,
  validateDesignPack,
  validateHtmlImportResult,
  validateRevision,
  validateSceneDocument,
  validateStructuredHtmlContract,
  type DesignPack,
  type HtmlImportResult,
  type SceneDocument,
  type StructuredHtmlContract,
} from "./index.js";

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")) as T;
}

const pack = fixture<DesignPack>("design-pack-v01.json");
const manifest = fixture<StructuredHtmlContract>("structured-html-v01.json");
const document = fixture<SceneDocument>("proposal-v0.json");

test("002 Structured HTML manifest requires stable IDs, pack pin, provenance, capabilities and export hints", () => {
  assert.equal(validateStructuredHtmlContract(manifest).ok, true);

  const missingPin = structuredClone(manifest) as unknown as Record<string, unknown>;
  delete missingPin.designPack;
  assert.equal(validateStructuredHtmlContract(missingPin).ok, false);

  const duplicateId = structuredClone(manifest);
  duplicateId.scenes[0]!.elements[0]!.id = duplicateId.scenes[0]!.id;
  const duplicateResult = validateStructuredHtmlContract(duplicateId);
  assert.equal(duplicateResult.ok, false);
  if (!duplicateResult.ok) assert.ok(duplicateResult.issues.some((issue) => issue.code === "id.duplicate"));

  const undeclaredSource = structuredClone(manifest);
  undeclaredSource.scenes[0]!.elements[0]!.sourceIds = ["source_missing"];
  const sourceResult = validateStructuredHtmlContract(undeclaredSource);
  assert.equal(sourceResult.ok, false);
  if (!sourceResult.ok) assert.ok(sourceResult.issues.some((issue) => issue.code === "provenance.source_missing"));
});

test("002 Structured HTML contract cannot carry scripts, event handlers, URLs or arbitrary tags", () => {
  for (const unsafe of [
    { ...structuredClone(manifest), html: "<script>alert(1)</script>" },
    { ...structuredClone(manifest), onclick: "steal()" },
    { ...structuredClone(manifest), href: "javascript:steal()" },
  ]) {
    const result = validateStructuredHtmlContract(unsafe);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "schema.additionalProperties"));
  }

  const unsupported = structuredClone(manifest) as unknown as { scenes: Array<{ elements: Array<{ tagName: string }> }> };
  unsupported.scenes[0]!.elements[0]!.tagName = "script";
  assert.equal(validateStructuredHtmlContract(unsupported).ok, false);
});

test("002 Design Pack schema validates machine-readable design DNA and Agent annotation", () => {
  assert.equal(validateDesignPack(pack).ok, true);

  const unknownRole = structuredClone(pack);
  unknownRole.narrativeArc[0]!.role = "missing-role";
  const roleResult = validateDesignPack(unknownRole);
  assert.equal(roleResult.ok, false);
  if (!roleResult.ok) assert.ok(roleResult.issues.some((issue) => issue.code === "narrative.role_missing"));

  const unsafeScheme = structuredClone(pack) as unknown as { assetStrategy: { allowedSchemes: string[] } };
  unsafeScheme.assetStrategy.allowedSchemes = ["javascript"];
  assert.equal(validateDesignPack(unsafeScheme).ok, false);
});

test("002 HTML import result always treats HTML as untrusted and reports unsupported content", () => {
  const partial: HtmlImportResult = {
    importVersion: "0.1.0",
    status: "partial",
    document,
    diagnostics: [{
      diagnosticId: "diag_script", code: "security.script_blocked", severity: "error", disposition: "blocked",
      message: "Script was blocked", sourcePath: "/html/body/script", nodeName: "script",
    }],
    security: { untrustedInput: true, executableContent: "blocked", blockedNodeCount: 1 },
  };
  assert.equal(validateHtmlImportResult(partial).ok, true);

  assert.equal(validateHtmlImportResult({ ...partial, status: "accepted", document: undefined }).ok, false);
  assert.equal(validateHtmlImportResult({ ...partial, status: "partial", diagnostics: [] }).ok, false);
  assert.equal(validateHtmlImportResult({ ...partial, security: { ...partial.security, untrustedInput: false } }).ok, false);
});

test("002 scene schema carries optional pack, provenance and editability hints without breaking v0 fixtures", () => {
  assert.equal(validateSceneDocument(document).ok, true);
  const enhanced = structuredClone(document);
  enhanced.designPack = { id: pack.id, version: pack.version };
  enhanced.provenance = manifest.provenance;
  const title = enhanced.scenes[0]!.elements[1]!;
  title.editableCapabilities = ["text", "typography", "frame", "order"];
  title.exportHint = { html: "native", pptx: "native" };
  title.sourceIds = ["source_brief"];
  assert.equal(validateSceneDocument(enhanced).ok, true);

  const invalidFocalPoint = structuredClone(enhanced) as unknown as { scenes: Array<{ elements: Array<Record<string, unknown>> }> };
  invalidFocalPoint.scenes[0]!.elements[1]!.focalPoint = { x: 2, y: 0.5 };
  assert.equal(validateSceneDocument(invalidFocalPoint).ok, false);
});

test("002 patches immutably persist text, font, image, frame and order fields", () => {
  const editable = structuredClone(document);
  const target = editable.scenes[0]!.elements[3]!;
  target.type = "image";
  target.role = "image";
  target.editable = true;
  target.assetSrc = "asset://before";
  target.alt = "Before";
  target.editableCapabilities = ["asset", "frame", "order"];
  const frozen = Object.freeze(editable);
  const patches = [
    { elementId: target.id, field: "assetSrc" as const, value: "asset://after" },
    { elementId: target.id, field: "imageFit" as const, value: "cover" as const },
    { elementId: target.id, field: "focalPoint" as const, value: { x: 0.25, y: 0.75 } },
    { elementId: target.id, field: "frame" as const, value: { x: 1200, y: 100, width: 200, height: 600 } },
    { elementId: target.id, field: "zIndex" as const, value: 7 },
  ];
  const revised = patches.reduce(applyPatch, frozen);
  patches[2]!.value = { x: 1, y: 1 } as never;
  patches[3]!.value = { x: 0, y: 0, width: 10, height: 10 } as never;
  const next = revised.scenes[0]!.elements[3]!;
  assert.equal(target.assetSrc, "asset://before");
  assert.equal(next.assetSrc, "asset://after");
  assert.equal(next.imageFit, "cover");
  assert.deepEqual(next.focalPoint, { x: 0.25, y: 0.75 });
  assert.deepEqual(next.frame, { x: 1200, y: 100, width: 200, height: 600 });
  assert.equal(next.zIndex, 7);

  const text = structuredClone(document);
  text.scenes[0]!.elements[1]!.editableCapabilities = ["text", "typography", "frame", "order"];
  const styled = [
    { elementId: "cover_title", field: "fontFamily" as const, value: "Noto Serif SC" },
    { elementId: "cover_title", field: "fontWeight" as const, value: 700 },
    { elementId: "cover_title", field: "lineHeight" as const, value: 1.15 },
  ].reduce(applyPatch, text);
  assert.equal(styled.scenes[0]!.elements[1]!.fontFamily, "Noto Serif SC");
  assert.equal(styled.scenes[0]!.elements[1]!.fontWeight, 700);
  assert.equal(styled.scenes[0]!.elements[1]!.lineHeight, 1.15);
});

test("002 capabilities reject unauthorized patch fields and revision schema rejects invalid ranges", () => {
  const restricted = structuredClone(document);
  restricted.scenes[0]!.elements[1]!.editableCapabilities = ["text"];
  assert.throws(() => applyPatch(restricted, { elementId: "cover_title", field: "fontSize", value: 40 }), PatchApplicationError);

  assert.equal(validateRevision({
    revisionId: "revision_frame", parentRevisionId: null, createdAt: "2026-08-13T00:00:00.000Z", reason: "edit",
    patches: [{ elementId: "cover_title", field: "frame", value: { x: 0, y: 0, width: -1, height: 100 } }],
  }).ok, false);
  assert.equal(validateRevision({
    revisionId: "revision_focal", parentRevisionId: null, createdAt: "2026-08-13T00:00:00.000Z", reason: "edit",
    patches: [{ elementId: "cover_title", field: "focalPoint", value: { x: -0.1, y: 1.1 } }],
  }).ok, false);
});
