import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DesignDirectorInput } from "@opendesign/studio-design-director";

import { runDesignBenchmark } from "./benchmark.js";
import { writeBenchmarkArtifacts } from "./report.js";
import type { BenchmarkCase } from "./types.js";

type SuiteFixture = {
  benchmarkId: string;
  generatedAt: string;
  tasks: Array<{
    scenario: BenchmarkCase["scenario"];
    inputFixture: string;
    correction: BenchmarkCase["correction"];
  }>;
};

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = resolve(packageDirectory, "../../fixtures/design-benchmark");
const fixture = JSON.parse(await readFile(join(fixtureDirectory, "suite.json"), "utf8")) as SuiteFixture;
const cases = await Promise.all(fixture.tasks.map(async (task) => ({
  scenario: task.scenario,
  input: JSON.parse(await readFile(resolve(fixtureDirectory, task.inputFixture), "utf8")) as DesignDirectorInput,
  correction: task.correction,
})));
const temporaryDirectory = await mkdtemp(join(tmpdir(), "opendesign-design-benchmark-"));
try {
  const report = await runDesignBenchmark({
    benchmarkId: fixture.benchmarkId,
    generatedAt: fixture.generatedAt,
    cases,
    outputDirectory: join(temporaryDirectory, "pptx"),
  });
  const paths = await writeBenchmarkArtifacts(report, join(fixtureDirectory, "baseline"));
  console.log(JSON.stringify({ passed: report.passed, summary: report.summary, ...paths }));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
