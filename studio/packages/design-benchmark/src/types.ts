import type {
  DesignDirectorInput,
  DesignDirectorOutput,
} from "@opendesign/studio-design-director";
import type { PptxExportResult } from "@opendesign/studio-renderers";

export const DESIGN_BENCHMARK_SCHEMA_VERSION = "0.1.0" as const;

export type BenchmarkScenario = "proposal" | "research-keynote" | "article-graphics";

export type SyntheticCorrectionObservation = {
  /** Fixture evidence only. It must never be presented as a real user study. */
  source: "synthetic-fixture";
  operationCount: number;
  durationSeconds: number;
};

export type BenchmarkCase = {
  scenario: BenchmarkScenario;
  input: DesignDirectorInput;
  correction: SyntheticCorrectionObservation;
};

export type BenchmarkCompiler = (input: unknown) => DesignDirectorOutput;

export type BenchmarkExporter = (
  document: Extract<DesignDirectorOutput, { status: "accepted" }>["importResult"]["document"],
  outputPath: string,
  generatedAt: string,
) => Promise<PptxExportResult>;

export type MachineMetricReport = {
  contract: {
    passed: boolean;
    compilerAccepted: boolean;
    importerAccepted: boolean;
    diagnosticCount: number;
  };
  sourceCoverage: {
    complete: boolean;
    declared: number;
    used: number;
    unused: number;
    unresolved: number;
    ratio: number;
  };
  nativeEditability: {
    complete: boolean;
    totalElements: number;
    nativeElements: number;
    rasterFallbacks: number;
    omittedElements: number;
    ratio: number;
  };
  qa: {
    passed: boolean;
    blocker: number;
    error: number;
    warning: number;
    note: number;
  };
  export: {
    succeeded: boolean;
    artifactBytesPositive: boolean;
  };
  correctionMeasurement: {
    source: "synthetic-fixture";
    operationCount: number;
    durationSeconds: number;
    requiredFields: readonly ["operationCount", "durationSeconds"];
    completeFields: number;
    fieldsComplete: boolean;
  };
  determinism: {
    passed: boolean;
    repeatRuns: 2;
    outputHash: string;
  };
};

export type BenchmarkTaskReport = {
  taskId: string;
  scenario: BenchmarkScenario;
  passed: boolean;
  evidence: {
    inputHash: string;
    outputHash: string;
    documentHash: string | null;
    editabilityReportHash: string | null;
  };
  machine: MachineMetricReport;
};

export const MANUAL_RUBRIC_DIMENSIONS = [
  "hierarchy",
  "rhythm",
  "composition",
  "brandFit",
  "templateFeel",
] as const;

export type ManualRubricDimension = typeof MANUAL_RUBRIC_DIMENSIONS[number];

export type ManualRubricEntry = {
  dimension: ManualRubricDimension;
  status: "unreviewed";
  score: null;
  rationale: null;
  reviewer: null;
};

export type ManualAestheticRubric = {
  aggregation: "prohibited";
  notice: string;
  scale: {
    minimum: 1;
    maximum: 5;
    direction: "higher-is-better-except-template-feel";
  };
  entries: ManualRubricEntry[];
};

export type BenchmarkSuiteSummary = {
  taskCount: number;
  contractPassed: number;
  sourceCoverageComplete: number;
  nativeEditabilityComplete: number;
  qaBlockers: number;
  qaErrors: number;
  qaWarnings: number;
  exportsSucceeded: number;
  correctionFieldsComplete: number;
  deterministicTasks: number;
};

export type DesignBenchmarkReport = {
  schemaVersion: typeof DESIGN_BENCHMARK_SCHEMA_VERSION;
  benchmarkId: string;
  generatedAt: string;
  passed: boolean;
  summary: BenchmarkSuiteSummary;
  tasks: BenchmarkTaskReport[];
  manualAestheticRubric: ManualAestheticRubric;
};

export type BenchmarkRunOptions = {
  benchmarkId: string;
  generatedAt: string;
  cases: readonly BenchmarkCase[];
  outputDirectory: string;
  compiler?: BenchmarkCompiler;
  exporter?: BenchmarkExporter;
};

export type BaselineDifference = {
  path: string;
  expected: unknown;
  actual: unknown;
};

export type BaselineComparison = {
  passed: boolean;
  differences: BaselineDifference[];
};
