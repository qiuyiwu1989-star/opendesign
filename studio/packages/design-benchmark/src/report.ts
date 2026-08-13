import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { assertBenchmarkIntegrity } from "./benchmark.js";
import type { DesignBenchmarkReport } from "./types.js";

function yes(value: boolean): string {
  return value ? "pass" : "fail";
}

export function benchmarkReportToMarkdown(report: DesignBenchmarkReport): string {
  assertBenchmarkIntegrity(report);
  const rows = report.tasks.map((task) => [
    task.scenario,
    yes(task.machine.contract.passed),
    `${task.machine.sourceCoverage.used}/${task.machine.sourceCoverage.declared}`,
    `${task.machine.nativeEditability.nativeElements}/${task.machine.nativeEditability.totalElements}`,
    `${task.machine.qa.blocker}/${task.machine.qa.error}/${task.machine.qa.warning}`,
    yes(task.machine.export.succeeded),
    String(task.machine.correctionMeasurement.operationCount),
    String(task.machine.correctionMeasurement.durationSeconds),
    yes(task.machine.determinism.passed),
  ].join(" | "));
  const rubric = report.manualAestheticRubric.entries.map((entry) => `- ${entry.dimension}: unreviewed`).join("\n");
  return [
    `# Design benchmark: ${report.benchmarkId}`,
    "",
    `Status: **${report.passed ? "pass" : "fail"}**`,
    "",
    "## Machine metrics",
    "",
    "Scenario | Contract | Sources | Native | QA blocker/error/warning | Export | Operations* | Correction seconds* | Deterministic",
    "--- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---",
    ...rows,
    "",
    "\\* Operations and correction time are synthetic fixture observations, not measured user-study results.",
    "",
    "## Human aesthetic rubric",
    "",
    report.manualAestheticRubric.notice,
    "",
    rubric,
    "",
    "No aggregate aesthetic score is computed.",
    "",
  ].join("\n");
}

export async function writeBenchmarkArtifacts(report: DesignBenchmarkReport, outputDirectory: string): Promise<{ jsonPath: string; markdownPath: string }> {
  assertBenchmarkIntegrity(report);
  await mkdir(outputDirectory, { recursive: true });
  const jsonPath = join(outputDirectory, "benchmark-report.json");
  const markdownPath = join(outputDirectory, "benchmark-summary.md");
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, benchmarkReportToMarkdown(report), "utf8"),
  ]);
  return { jsonPath, markdownPath };
}
