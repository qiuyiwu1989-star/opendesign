import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compileDesignDirector,
  type DesignDirectorInput,
} from "@opendesign/studio-design-director";

import {
  assertHonestRejection,
  evaluateGoldenCase,
  evaluateGoldenSuite,
  type GoldenCase,
  type GoldenExpectation,
} from "./index.js";

const fixtureRoot = new URL("../../../fixtures/design-director/", import.meta.url);

async function fixture(name: string): Promise<GoldenCase> {
  const [input, expected] = await Promise.all([
    readFile(new URL(`${name}/input.json`, fixtureRoot), "utf8"),
    readFile(new URL(`${name}/expected.json`, fixtureRoot), "utf8"),
  ]);
  return { input: JSON.parse(input) as DesignDirectorInput, expected: JSON.parse(expected) as GoldenExpectation };
}

test("004 three offline Golden tasks compile and satisfy deterministic evaluation", async () => {
  const cases = await Promise.all([fixture("proposal"), fixture("research-keynote"), fixture("article-graphics")]);
  const result = evaluateGoldenSuite(cases, compileDesignDirector);
  assert.equal(result.passed, true, JSON.stringify(result, null, 2));
  assert.equal(result.cases.length, 3);
  assert.equal(result.manualReview.length, 3);
  assert.ok(result.manualReview.every((item) => item.checks.length >= 4));
});

test("004 each Golden independently checks Pack judgment, evidence, editability, security and import", async () => {
  for (const name of ["proposal", "research-keynote", "article-graphics"]) {
    const result = evaluateGoldenCase(await fixture(name), compileDesignDirector);
    assert.equal(result.passed, true, `${name}: ${JSON.stringify(result.automated, null, 2)}`);
    assert.deepEqual(new Set(result.automated.map((item) => item.check)), new Set([
      "accepted-status",
      "output-contract",
      "pack-selection",
      "pack-is-structural",
      "source-coverage",
      "element-provenance",
      "stable-identifiers",
      "editability-envelope",
      "security-boundary",
      "diagnosis-evidence-boundary",
    ]));
  }
});

test("004 diagnostics fail closed for source, Pack, deliverable and editability violations", async () => {
  const golden = await fixture("proposal");
  const unknownSource = structuredClone(golden.input);
  unknownSource.content.keyPoints[0]!.sourceIds = ["source_missing"];
  assertHonestRejection(compileDesignDirector(unknownSource), "source.unresolved", "/content/keyPoints/0/sourceIds");

  const unknownPack = structuredClone(golden.input);
  unknownPack.designPack = { id: "unknown-pack", version: "1.0.0" };
  assertHonestRejection(compileDesignDirector(unknownPack), "pack.unknown", "/designPack");

  const wrongTaskPack = structuredClone(golden.input);
  wrongTaskPack.designPack = { id: "research-keynote-cn", version: "1.0.0" };
  assertHonestRejection(compileDesignDirector(wrongTaskPack), "pack.deliverable_mismatch", "/designPack/id");

  const rasterText = structuredClone(golden.input);
  rasterText.editability.requireNativeText = false;
  assertHonestRejection(compileDesignDirector(rasterText), "editability.native_text_required", "/editability/requireNativeText");
});

test("004 oversized and malformed requests return precise diagnostics without artifacts", async () => {
  const golden = await fixture("proposal");
  const oversized = structuredClone(golden.input);
  oversized.sources[0]!.content = "x".repeat(12_001);
  assertHonestRejection(compileDesignDirector(oversized), "input.schema_invalid", "/sources/0/content");

  const malformed = structuredClone(golden.input) as unknown as Record<string, unknown>;
  delete malformed.designPack;
  assertHonestRejection(compileDesignDirector(malformed), "input.schema_invalid", "/");
});

test("004 harness detects cosmetic-only structure, incomplete evidence and executable markup", async () => {
  const golden = await fixture("proposal");
  const compiled = compileDesignDirector(golden.input);
  assert.equal(compiled.status, "accepted");
  if (compiled.status !== "accepted") return;

  const tampered = structuredClone(compiled);
  tampered.html = tampered.html
    .replaceAll('data-od-page-role="executive-summary"', 'data-od-page-role="cover"')
    .replace("</main>", '<script src="https://tracker.invalid/a.js"></script></main>');
  tampered.manifest.sourceCoverage.usedSourceIds = tampered.manifest.sourceCoverage.usedSourceIds.slice(1);
  const result = evaluateGoldenCase(golden, () => tampered);

  assert.equal(result.passed, false);
  for (const check of ["pack-is-structural", "source-coverage", "security-boundary"]) {
    assert.equal(result.automated.find((item) => item.check === check)?.ok, false, `expected ${check} to fail`);
  }
});
