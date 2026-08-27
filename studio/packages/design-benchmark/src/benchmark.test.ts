import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  type DesignDirectorAcceptedOutput,
  type DesignDirectorInput,
  type DesignDirectorOutput,
} from "@opendesign/studio-design-director";
import { exportDocumentToPptx } from "@opendesign/studio-renderers";

import {
  assertBenchmarkIntegrity,
  benchmarkReportToMarkdown,
  compareBenchmarkBaseline,
  runDesignBenchmark,
  writeBenchmarkArtifacts,
  type BenchmarkCase,
  type BenchmarkExporter,
  type DesignBenchmarkReport,
} from "./index.js";

const fixtureRoot = new URL("../../../fixtures/", import.meta.url);
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

type SuiteFixture = {
  benchmarkId: string;
  generatedAt: string;
  tasks: Array<{
    scenario: BenchmarkCase["scenario"];
    inputFixture: string;
    correction: BenchmarkCase["correction"];
  }>;
};

async function suiteCases(): Promise<{ fixture: SuiteFixture; cases: BenchmarkCase[] }> {
  const fixture = JSON.parse(await readFile(new URL("design-benchmark/suite.json", fixtureRoot), "utf8")) as SuiteFixture;
  const cases = await Promise.all(fixture.tasks.map(async (task) => ({
    scenario: task.scenario,
    input: JSON.parse(await readFile(new URL(`design-benchmark/${task.inputFixture}`, fixtureRoot), "utf8")) as DesignDirectorInput,
    correction: task.correction,
  })));
  return { fixture, cases };
}

const fixtureExporter: BenchmarkExporter = async (document, outputPath, generatedAt) => exportDocumentToPptx(document, {
  outputPath,
  generatedAt,
  assetResolver: async () => ({ data: pixel, mimeType: "image/png" }),
});

async function generate(directory: string): Promise<DesignBenchmarkReport> {
  const { fixture, cases } = await suiteCases();
  return runDesignBenchmark({
    benchmarkId: fixture.benchmarkId,
    generatedAt: fixture.generatedAt,
    cases,
    outputDirectory: join(directory, "pptx"),
    exporter: fixtureExporter,
  });
}

test("005 three scenarios produce reproducible honest machine metrics without an aesthetic total", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-benchmark-"));
  try {
    const report = await generate(directory);
    // The benchmark reports the current fixture state honestly: research and
    // article layouts contain QA collisions, so the suite is not declared green.
    assert.equal(report.passed, false);
    assert.equal(report.summary.taskCount, 3);
    assert.equal(report.summary.contractPassed, 3);
    assert.equal(report.summary.sourceCoverageComplete, 3);
    assert.equal(report.summary.nativeEditabilityComplete, 3);
    assert.equal(report.summary.exportsSucceeded, 3);
    assert.equal(report.summary.correctionFieldsComplete, 3);
    assert.equal(report.summary.deterministicTasks, 3);
    assert.equal(report.summary.qaBlockers, 0);
    assert.equal(report.summary.qaErrors, 19);
    assert.equal(report.summary.qaWarnings, 13);
    assert.deepEqual(
      report.tasks.map((task) => ({
        scenario: task.scenario,
        taskPassed: task.passed,
        qaPassed: task.machine.qa.passed,
        errors: task.machine.qa.error,
        warnings: task.machine.qa.warning,
      })),
      [
        { scenario: "proposal", taskPassed: true, qaPassed: true, errors: 0, warnings: 7 },
        { scenario: "research-keynote", taskPassed: false, qaPassed: false, errors: 7, warnings: 0 },
        { scenario: "article-graphics", taskPassed: false, qaPassed: false, errors: 12, warnings: 6 },
      ],
    );
    assert.ok(report.tasks.every((task) => task.machine.nativeEditability.ratio === 1));
    assert.ok(report.tasks.every((task) => task.machine.qa.blocker === 0));
    assert.ok(report.tasks.every((task) => task.machine.correctionMeasurement.source === "synthetic-fixture"));
    assert.equal(report.manualAestheticRubric.aggregation, "prohibited");
    assert.deepEqual(report.manualAestheticRubric.entries.map((entry) => entry.dimension), [
      "hierarchy",
      "rhythm",
      "composition",
      "brandFit",
      "templateFeel",
    ]);
    assert.ok(report.manualAestheticRubric.entries.every((entry) => entry.score === null));
    assert.doesNotMatch(JSON.stringify(report), /aestheticScore|qualityScore|overallScore|totalScore/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("005 JSON report and Markdown summary preserve evidence and label synthetic correction data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-benchmark-artifacts-"));
  try {
    const report = await generate(directory);
    const { jsonPath, markdownPath } = await writeBenchmarkArtifacts(report, join(directory, "reports"));
    const [json, markdown] = await Promise.all([readFile(jsonPath, "utf8"), readFile(markdownPath, "utf8")]);
    assert.deepEqual(JSON.parse(json), report);
    assert.equal(markdown, benchmarkReportToMarkdown(report));
    assert.match(markdown, /synthetic fixture observations/);
    assert.match(markdown, /No aggregate aesthetic score is computed/);
    assert.match(markdown, /proposal \| pass/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("005 baseline fallback detects metric regressions and evidence drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-benchmark-baseline-"));
  try {
    const baseline = await generate(directory);
    const regressed = structuredClone(baseline);
    regressed.tasks[0]!.machine.nativeEditability.nativeElements -= 1;
    regressed.tasks[0]!.machine.nativeEditability.complete = false;
    regressed.tasks[0]!.evidence.editabilityReportHash = "0".repeat(64);
    regressed.summary.nativeEditabilityComplete -= 1;
    regressed.passed = false;
    const comparison = compareBenchmarkBaseline(baseline, regressed);
    assert.equal(comparison.passed, false);
    const paths = comparison.differences.map((difference) => difference.path);
    assert.ok(paths.includes("/tasks/0/machine/nativeEditability/nativeElements"));
    assert.ok(paths.includes("/tasks/0/evidence/editabilityReportHash"));
    assert.ok(paths.includes("/summary/nativeEditabilityComplete"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("005 integrity gate rejects automated aesthetic judgments and renamed aggregation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-benchmark-tamper-"));
  try {
    const report = await generate(directory);
    const scored = structuredClone(report);
    scored.manualAestheticRubric.entries[0] = {
      dimension: "hierarchy",
      status: "unreviewed",
      score: 5,
      rationale: null,
      reviewer: null,
    } as never;
    assert.throws(() => assertBenchmarkIntegrity(scored), /cannot populate human aesthetic judgments/);

    const aggregated = structuredClone(report) as unknown as Record<string, unknown>;
    aggregated.qualityScore = 0.97;
    assert.throws(() => assertBenchmarkIntegrity(aggregated as unknown as DesignBenchmarkReport), /Forbidden aggregate score/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("005 incomplete correction telemetry and failed export remain honest failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-benchmark-failure-"));
  try {
    const { fixture, cases } = await suiteCases();
    cases[0]!.correction.durationSeconds = Number.NaN;
    const noArtifactExporter: BenchmarkExporter = async (document, outputPath, generatedAt) => ({
      outputPath,
      report: {
        documentId: document.documentId,
        generatedAt,
        renderer: "pptxgenjs",
        defaultMode: "editable",
        summary: { totalElements: 1, nativeElements: 1, rasterFallbacks: 0, omittedElements: 0 },
        elements: [],
      },
    });
    const report = await runDesignBenchmark({
      benchmarkId: fixture.benchmarkId,
      generatedAt: fixture.generatedAt,
      cases: [cases[0]!],
      outputDirectory: directory,
      exporter: noArtifactExporter,
    });
    assert.equal(report.passed, false);
    assert.equal(report.tasks[0]!.machine.correctionMeasurement.fieldsComplete, false);
    assert.equal(report.tasks[0]!.machine.export.succeeded, false);
    assert.equal(report.tasks[0]!.machine.nativeEditability.complete, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("005 determinism metric catches a compiler whose accepted result changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opendesign-benchmark-nondeterminism-"));
  try {
    const { fixture, cases } = await suiteCases();
    const { compileDesignDirector } = await import("@opendesign/studio-design-director");
    let runs = 0;
    const compiler = (input: unknown): DesignDirectorOutput => {
      const output = compileDesignDirector(input);
      runs += 1;
      if (output.status !== "accepted") return output;
      const changed = structuredClone(output) as DesignDirectorAcceptedOutput;
      changed.manifest.diagnosis.risks = [...changed.manifest.diagnosis.risks, `run-${runs}`];
      return changed;
    };
    const report = await runDesignBenchmark({
      benchmarkId: fixture.benchmarkId,
      generatedAt: fixture.generatedAt,
      cases: [cases[0]!],
      outputDirectory: directory,
      exporter: fixtureExporter,
      compiler,
    });
    assert.equal(report.passed, false);
    assert.equal(report.tasks[0]!.machine.determinism.passed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
