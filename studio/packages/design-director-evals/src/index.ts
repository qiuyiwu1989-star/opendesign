import type {
  DesignDirectorAcceptedOutput,
  DesignDirectorInput,
  DesignDirectorOutput,
} from "@opendesign/studio-design-director";
import { getDesignPack } from "@opendesign/studio-design-packs";

export type GoldenExpectation = {
  expectedStatus: "accepted";
  expectedPack: { id: string; version: string };
  requiredSourceIds: string[];
  requiredCapabilities: Array<"text" | "typography" | "asset" | "frame" | "order">;
  distinctiveStructure: {
    requiredPageRoles: string[];
    forbiddenPackIds: string[];
    rationale: string;
  };
  manualReview: string[];
};

export type EvalFinding = {
  check: string;
  ok: boolean;
  message: string;
};

export type GoldenEvaluation = {
  taskId: string;
  passed: boolean;
  automated: EvalFinding[];
  manualReview: string[];
};

export type SuiteEvaluation = {
  passed: boolean;
  cases: GoldenEvaluation[];
  crossCase: EvalFinding[];
  manualReview: Array<{ taskId: string; checks: string[] }>;
};

export type GoldenCase = { input: DesignDirectorInput; expected: GoldenExpectation };
export type Compiler = (input: unknown) => DesignDirectorOutput;

function sameMembers(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function finding(check: string, ok: boolean, success: string, failure: string): EvalFinding {
  return { check, ok, message: ok ? success : failure };
}

function attributeValues(html: string, name: string): string[] {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const expression = new RegExp(`${escapedName}=(?:"([^"]*)"|'([^']*)')`, "gu");
  return [...html.matchAll(expression)].map((match) => match[1] ?? match[2] ?? "");
}

function executableMarkup(html: string): string[] {
  const hits: string[] = [];
  if (/<\s*(?:script|iframe|object|embed|link|base|form)\b/iu.test(html)) hits.push("executable-or-remote tag");
  if (/\son[a-z]+\s*=/iu.test(html)) hits.push("event handler");
  if (/\b(?:src|href)\s*=\s*["'](?:https?:|\/\/|data:|javascript:)/iu.test(html)) hits.push("remote or executable URL");
  return hits;
}

function allElements(output: DesignDirectorAcceptedOutput) {
  return output.importResult.document.scenes.flatMap((scene) => scene.elements);
}

function evaluateAccepted(input: DesignDirectorInput, expected: GoldenExpectation, output: DesignDirectorAcceptedOutput): EvalFinding[] {
  const pack = getDesignPack(expected.expectedPack.id, expected.expectedPack.version);
  const elements = allElements(output);
  const elementIds = elements.map((element) => element.id);
  const sceneIds = output.importResult.document.scenes.map((scene) => scene.id);
  const declaredSources = input.sources.map((source) => source.sourceId);
  const elementSourceIds = elements.flatMap((element) => element.sourceIds ?? []);
  const pageRoles = attributeValues(output.html, "data-od-page-role");
  const layouts = attributeValues(output.html, "data-od-layout");
  const forbiddenPacks = expected.distinctiveStructure.forbiddenPackIds;
  const unsafe = executableMarkup(output.html);
  const textElements = elements.filter((element) => element.type !== "image" && element.type !== "shape");
  const imageElements = elements.filter((element) => element.type === "image");
  const packCapabilities = pack?.agentAnnotation.requiredCapabilities ?? [];
  const requiredRolesPresent = expected.distinctiveStructure.requiredPageRoles.every((role) => pageRoles.includes(role));
  const packStructureApplied = pack !== undefined
    ? requiredRolesPresent
      && layouts.length === input.deliverable.pageCount
      && layouts.every((layout) => layout === pack.designDna.composition.grid)
      && sameMembers(output.manifest.diagnosis.designPrinciples, pack.designDna.principles)
    : false;
  const elementCapabilitiesValid = elements.every((element) => {
    const capabilities = element.editableCapabilities ?? [];
    if (!capabilities.includes("frame") || !capabilities.includes("order")) return false;
    if (element.type === "image") return capabilities.includes("asset");
    if (element.type === "shape") return true;
    return capabilities.includes("text") && capabilities.includes("typography");
  });
  const imagePolicySatisfied = !input.editability.requireReplaceableImages
    || (pack?.editability.image === "replaceable" && imageElements.every((element) => element.editableCapabilities?.includes("asset")));

  return [
    finding("output-contract", output.diagnostics.length === 0 && output.importResult.status === "accepted" && output.importResult.diagnostics.length === 0, "Compiler and importer accepted without diagnostics.", "Accepted output contains compiler or importer diagnostics."),
    finding("pack-selection", output.manifest.designPack.id === expected.expectedPack.id && output.manifest.designPack.version === expected.expectedPack.version && !forbiddenPacks.includes(output.manifest.designPack.id), `Selected ${expected.expectedPack.id}@${expected.expectedPack.version}.`, "Selected Pack does not match the task judgment."),
    finding("pack-is-structural", packStructureApplied, "Pack narrative roles, grid and design principles are present; the result is not distinguished by color alone.", "Pack-specific narrative roles, grid or design principles are missing."),
    finding("source-coverage", sameMembers(output.manifest.sourceCoverage.declaredSourceIds, expected.requiredSourceIds) && sameMembers(output.manifest.sourceCoverage.usedSourceIds, expected.requiredSourceIds) && output.manifest.sourceCoverage.unusedSourceIds.length === 0 && output.manifest.sourceCoverage.unresolvedSourceIds.length === 0, "Every required source is declared and used exactly once in the coverage sets.", "Source coverage has missing, unused or unresolved IDs."),
    finding("element-provenance", elements.length > 0 && elements.every((element) => (element.sourceIds?.length ?? 0) > 0) && elementSourceIds.every((sourceId) => declaredSources.includes(sourceId)), "Every imported element has declared provenance.", "An imported element lacks provenance or references an undeclared source."),
    finding("stable-identifiers", new Set(sceneIds).size === sceneIds.length && new Set(elementIds).size === elementIds.length && sameMembers(sceneIds, output.manifest.sceneIds) && sameMembers(elementIds, output.manifest.elementIds), "Scene and element IDs are unique and match the manifest.", "Stable IDs are duplicated or diverge from the manifest."),
    finding("editability-envelope", Boolean(pack) && expected.requiredCapabilities.every((capability) => packCapabilities.includes(capability)) && elementCapabilitiesValid && textElements.every((element) => element.exportHint?.pptx === "native") && imagePolicySatisfied, "Pack and imported elements preserve the requested native editability envelope.", "Pack or imported elements do not preserve the requested editability capabilities."),
    finding("security-boundary", unsafe.length === 0 && output.importResult.security.executableContent === "blocked" && output.importResult.security.blockedNodeCount === 0 && elements.every((element) => !element.assetSrc || element.assetSrc.startsWith("asset://") || element.assetSrc.startsWith("/api/assets/")), "HTML contains no scripts, event handlers or remote assets.", `Unsafe HTML markers found: ${unsafe.join(", ") || "asset policy violation"}.`),
    finding("diagnosis-evidence-boundary", expected.requiredSourceIds.every((sourceId) => output.manifest.diagnosis.evidenceBoundary.includes(sourceId)) && output.manifest.diagnosis.risks.length > 0, "Diagnosis names its evidence boundary and human-confirmation risks.", "Diagnosis omits source boundaries or human-confirmation risks."),
  ];
}

export function evaluateGoldenCase(golden: GoldenCase, compile: Compiler): GoldenEvaluation {
  const output = compile(golden.input);
  const automated: EvalFinding[] = [
    finding("accepted-status", output.status === golden.expected.expectedStatus, "Golden task was accepted.", `Expected ${golden.expected.expectedStatus}, received ${output.status}.`),
  ];
  if (output.status === "accepted") automated.push(...evaluateAccepted(golden.input, golden.expected, output));
  else automated.push({ check: "rejection-diagnostics", ok: false, message: output.diagnostics.map((diagnostic) => `${diagnostic.code} ${diagnostic.path}`).join("; ") });
  return { taskId: golden.input.taskId, passed: automated.every((item) => item.ok), automated, manualReview: [...golden.expected.manualReview] };
}

export function evaluateGoldenSuite(cases: readonly GoldenCase[], compile: Compiler): SuiteEvaluation {
  const evaluations = cases.map((golden) => evaluateGoldenCase(golden, compile));
  const outputs = cases.map((golden) => compile(golden.input));
  const accepted = outputs.filter((output): output is DesignDirectorAcceptedOutput => output.status === "accepted");
  const packIds = accepted.map((output) => output.manifest.designPack.id);
  const roleFingerprints = accepted.map((output) => attributeValues(output.html, "data-od-page-role").join("|"));
  const layoutFingerprints = accepted.map((output) => attributeValues(output.html, "data-od-layout").join("|"));
  const crossCase = [
    finding("three-distinct-pack-pins", accepted.length === cases.length && new Set(packIds).size === cases.length, "All three task families use distinct pinned Packs.", "Task families collapsed onto the same Pack."),
    finding("three-distinct-narratives", accepted.length === cases.length && new Set(roleFingerprints).size === cases.length, "All three task families have distinct narrative role sequences.", "Task families differ only cosmetically; narrative sequences are identical."),
    finding("three-distinct-layout-systems", accepted.length === cases.length && new Set(layoutFingerprints).size === cases.length, "All three task families use distinct Pack grid systems.", "Task families reuse an identical layout system."),
  ];
  return {
    passed: evaluations.every((evaluation) => evaluation.passed) && crossCase.every((item) => item.ok),
    cases: evaluations,
    crossCase,
    manualReview: evaluations.map((evaluation) => ({ taskId: evaluation.taskId, checks: evaluation.manualReview })),
  };
}

export function assertHonestRejection(output: DesignDirectorOutput, expectedCode: string, expectedPath: string): void {
  if (output.status !== "rejected") throw new Error(`Expected rejection ${expectedCode}, but compiler accepted the input.`);
  if (!(expectedCode && output.diagnostics.some((diagnostic) => diagnostic.code === expectedCode && diagnostic.path === expectedPath))) {
    throw new Error(`Missing precise diagnostic ${expectedCode} at ${expectedPath}.`);
  }
  if ("html" in output || "manifest" in output || "importResult" in output) throw new Error("Rejected output leaked publishable artifacts.");
}
