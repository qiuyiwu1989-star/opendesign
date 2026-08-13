import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import {
  compileDesignDirector,
  type DesignDirectorAcceptedOutput,
  type DesignDirectorOutput,
} from "@opendesign/studio-design-director";
import { runDeterministicQa } from "@opendesign/studio-qa";
import { exportDocumentToPptx } from "@opendesign/studio-renderers";

import {
  DESIGN_BENCHMARK_SCHEMA_VERSION,
  MANUAL_RUBRIC_DIMENSIONS,
  type BaselineComparison,
  type BaselineDifference,
  type BenchmarkExporter,
  type BenchmarkRunOptions,
  type BenchmarkTaskReport,
  type DesignBenchmarkReport,
  type MachineMetricReport,
  type ManualAestheticRubric,
} from "./types.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function createManualAestheticRubric(): ManualAestheticRubric {
  return {
    aggregation: "prohibited",
    notice: "Aesthetic dimensions require independent human judgment. Do not aggregate them into a single aesthetic or quality score.",
    scale: { minimum: 1, maximum: 5, direction: "higher-is-better-except-template-feel" },
    entries: MANUAL_RUBRIC_DIMENSIONS.map((dimension) => ({
      dimension,
      status: "unreviewed",
      score: null,
      rationale: null,
      reviewer: null,
    })),
  };
}

const fixtureAsset = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const defaultExporter: BenchmarkExporter = async (document, outputPath, generatedAt) => exportDocumentToPptx(document, {
  outputPath,
  generatedAt,
  assetResolver: async () => ({ data: fixtureAsset, mimeType: "image/png" }),
});

function diagnosticCount(output: DesignDirectorOutput): number {
  return output.status === "accepted"
    ? output.diagnostics.length + output.importResult.diagnostics.length
    : output.diagnostics.length;
}

function outputForDeterminism(output: DesignDirectorOutput): unknown {
  return output.status === "accepted"
    ? { status: output.status, html: output.html, manifest: output.manifest, importResult: output.importResult }
    : output;
}

async function runAcceptedTask(
  output: DesignDirectorAcceptedOutput,
  outputPath: string,
  generatedAt: string,
  exporter: BenchmarkExporter,
): Promise<Pick<MachineMetricReport, "sourceCoverage" | "nativeEditability" | "qa" | "export"> & { editabilityReportHash: string }> {
  const coverage = output.manifest.sourceCoverage;
  const sourceComplete = coverage.unusedSourceIds.length === 0
    && coverage.unresolvedSourceIds.length === 0
    && coverage.declaredSourceIds.length === coverage.usedSourceIds.length;
  const qa = runDeterministicQa(output.importResult.document);
  let exportSucceeded = false;
  let artifactBytesPositive = false;
  let exportReport: Awaited<ReturnType<BenchmarkExporter>>["report"] | null = null;
  try {
    const result = await exporter(output.importResult.document, outputPath, generatedAt);
    exportReport = result.report;
    const artifact = await stat(result.outputPath);
    artifactBytesPositive = artifact.isFile() && artifact.size > 0;
    exportSucceeded = artifactBytesPositive;
  } catch {
    exportSucceeded = false;
  }
  const editability = exportReport?.summary ?? {
    totalElements: output.importResult.document.scenes.reduce((sum, scene) => sum + scene.elements.length, 0),
    nativeElements: 0,
    rasterFallbacks: 0,
    omittedElements: output.importResult.document.scenes.reduce((sum, scene) => sum + scene.elements.length, 0),
  };
  const editabilityComplete = exportSucceeded
    && editability.totalElements > 0
    && editability.nativeElements === editability.totalElements
    && editability.rasterFallbacks === 0
    && editability.omittedElements === 0;
  return {
    sourceCoverage: {
      complete: sourceComplete,
      declared: coverage.declaredSourceIds.length,
      used: coverage.usedSourceIds.length,
      unused: coverage.unusedSourceIds.length,
      unresolved: coverage.unresolvedSourceIds.length,
      ratio: coverage.declaredSourceIds.length === 0 ? 0 : coverage.usedSourceIds.length / coverage.declaredSourceIds.length,
    },
    nativeEditability: {
      complete: editabilityComplete,
      totalElements: editability.totalElements,
      nativeElements: editability.nativeElements,
      rasterFallbacks: editability.rasterFallbacks,
      omittedElements: editability.omittedElements,
      ratio: editability.totalElements === 0 ? 0 : editability.nativeElements / editability.totalElements,
    },
    qa: {
      passed: qa.summary.blocker === 0 && qa.summary.error === 0,
      blocker: qa.summary.blocker,
      error: qa.summary.error,
      warning: qa.summary.warning,
      note: qa.summary.note,
    },
    export: { succeeded: exportSucceeded, artifactBytesPositive },
    editabilityReportHash: exportReport ? stableHash(exportReport) : stableHash(null),
  };
}

function failedAcceptedMetrics(): Pick<MachineMetricReport, "sourceCoverage" | "nativeEditability" | "qa" | "export"> {
  return {
    sourceCoverage: { complete: false, declared: 0, used: 0, unused: 0, unresolved: 0, ratio: 0 },
    nativeEditability: { complete: false, totalElements: 0, nativeElements: 0, rasterFallbacks: 0, omittedElements: 0, ratio: 0 },
    qa: { passed: false, blocker: 0, error: 0, warning: 0, note: 0 },
    export: { succeeded: false, artifactBytesPositive: false },
  };
}

export async function runDesignBenchmark(options: BenchmarkRunOptions): Promise<DesignBenchmarkReport> {
  if (!options.benchmarkId.trim()) throw new Error("benchmarkId is required");
  if (!Number.isFinite(Date.parse(options.generatedAt))) throw new Error("generatedAt must be an ISO timestamp");
  const compiler = options.compiler ?? compileDesignDirector;
  const exporter = options.exporter ?? defaultExporter;
  const tasks: BenchmarkTaskReport[] = [];

  for (const benchmarkCase of options.cases) {
    const first = compiler(structuredClone(benchmarkCase.input));
    const second = compiler(structuredClone(benchmarkCase.input));
    const firstOutputHash = stableHash(outputForDeterminism(first));
    const deterministic = firstOutputHash === stableHash(outputForDeterminism(second));
    const importerAccepted = first.status === "accepted" && first.importResult.status === "accepted";
    const contractPassed = importerAccepted && diagnosticCount(first) === 0;
    const correctionFields = [benchmarkCase.correction.operationCount, benchmarkCase.correction.durationSeconds];
    const correctionFieldsComplete = correctionFields.filter((value) => Number.isFinite(value) && value >= 0).length;
    const acceptedMetrics = first.status === "accepted"
      ? await runAcceptedTask(first, join(options.outputDirectory, `${benchmarkCase.scenario}.pptx`), options.generatedAt, exporter)
      : { ...failedAcceptedMetrics(), editabilityReportHash: null };
    const machine: MachineMetricReport = {
      contract: {
        passed: contractPassed,
        compilerAccepted: first.status === "accepted",
        importerAccepted,
        diagnosticCount: diagnosticCount(first),
      },
      sourceCoverage: acceptedMetrics.sourceCoverage,
      nativeEditability: acceptedMetrics.nativeEditability,
      qa: acceptedMetrics.qa,
      export: acceptedMetrics.export,
      correctionMeasurement: {
        source: "synthetic-fixture",
        operationCount: benchmarkCase.correction.operationCount,
        durationSeconds: benchmarkCase.correction.durationSeconds,
        requiredFields: ["operationCount", "durationSeconds"],
        completeFields: correctionFieldsComplete,
        fieldsComplete: correctionFieldsComplete === 2,
      },
      determinism: { passed: deterministic, repeatRuns: 2, outputHash: firstOutputHash },
    };
    const passed = machine.contract.passed
      && machine.sourceCoverage.complete
      && machine.nativeEditability.complete
      && machine.qa.passed
      && machine.export.succeeded
      && machine.correctionMeasurement.fieldsComplete
      && machine.determinism.passed;
    tasks.push({
      taskId: benchmarkCase.input.taskId,
      scenario: benchmarkCase.scenario,
      passed,
      evidence: {
        inputHash: stableHash(benchmarkCase.input),
        outputHash: firstOutputHash,
        documentHash: first.status === "accepted" ? stableHash(first.importResult.document) : null,
        editabilityReportHash: acceptedMetrics.editabilityReportHash,
      },
      machine,
    });
  }

  const report: DesignBenchmarkReport = {
    schemaVersion: DESIGN_BENCHMARK_SCHEMA_VERSION,
    benchmarkId: options.benchmarkId,
    generatedAt: options.generatedAt,
    passed: tasks.length > 0 && tasks.every((task) => task.passed),
    summary: {
      taskCount: tasks.length,
      contractPassed: tasks.filter((task) => task.machine.contract.passed).length,
      sourceCoverageComplete: tasks.filter((task) => task.machine.sourceCoverage.complete).length,
      nativeEditabilityComplete: tasks.filter((task) => task.machine.nativeEditability.complete).length,
      qaBlockers: tasks.reduce((sum, task) => sum + task.machine.qa.blocker, 0),
      qaErrors: tasks.reduce((sum, task) => sum + task.machine.qa.error, 0),
      qaWarnings: tasks.reduce((sum, task) => sum + task.machine.qa.warning, 0),
      exportsSucceeded: tasks.filter((task) => task.machine.export.succeeded).length,
      correctionFieldsComplete: tasks.filter((task) => task.machine.correctionMeasurement.fieldsComplete).length,
      deterministicTasks: tasks.filter((task) => task.machine.determinism.passed).length,
    },
    tasks,
    manualAestheticRubric: createManualAestheticRubric(),
  };
  assertBenchmarkIntegrity(report);
  return report;
}

export function assertBenchmarkIntegrity(report: DesignBenchmarkReport): void {
  if (report.manualAestheticRubric.aggregation !== "prohibited") throw new Error("Aesthetic aggregation must remain prohibited");
  const forbiddenFields = new Set(["aestheticScore", "qualityScore", "overallScore", "totalScore"]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (forbiddenFields.has(key)) throw new Error(`Forbidden aggregate score field: ${key}`);
      visit(item);
    }
  };
  visit(report);
  const dimensions = report.manualAestheticRubric.entries.map((entry) => entry.dimension);
  if (stableHash(dimensions) !== stableHash(MANUAL_RUBRIC_DIMENSIONS)) throw new Error("Manual rubric dimensions were changed or reordered");
  if (report.manualAestheticRubric.entries.some((entry) => entry.status !== "unreviewed" || entry.score !== null || entry.rationale !== null || entry.reviewer !== null)) {
    throw new Error("Automated benchmark cannot populate human aesthetic judgments");
  }
  if (report.tasks.some((task) => task.machine.correctionMeasurement.source !== "synthetic-fixture")) {
    throw new Error("Correction telemetry in an offline benchmark must be labeled synthetic-fixture");
  }
}

function compareValue(expected: unknown, actual: unknown, path: string, differences: BaselineDifference[]): void {
  if (Object.is(expected, actual)) return;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) differences.push({ path: `${path}/length`, expected: expected.length, actual: actual.length });
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) compareValue(expected[index], actual[index], `${path}/${index}`, differences);
    return;
  }
  if (expected !== null && actual !== null && typeof expected === "object" && typeof actual === "object") {
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    const keys = new Set([...Object.keys(expectedRecord), ...Object.keys(actualRecord)]);
    for (const key of [...keys].sort()) compareValue(expectedRecord[key], actualRecord[key], `${path}/${key}`, differences);
    return;
  }
  differences.push({ path: path || "/", expected, actual });
}

export function compareBenchmarkBaseline(expected: DesignBenchmarkReport, actual: DesignBenchmarkReport): BaselineComparison {
  assertBenchmarkIntegrity(expected);
  assertBenchmarkIntegrity(actual);
  const differences: BaselineDifference[] = [];
  compareValue(expected, actual, "", differences);
  return { passed: differences.length === 0, differences };
}
