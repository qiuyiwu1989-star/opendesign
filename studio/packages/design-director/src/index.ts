import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import {
  STRUCTURED_HTML_ATTRIBUTES,
  STRUCTURED_HTML_CONTRACT_VERSION,
  type DesignPack,
  type DesignPackPin,
  type EditableCapability,
  type HtmlImportResult,
  type SceneDocument,
  type SourceProvenance,
} from "@opendesign/studio-contracts";
import { getDesignPack } from "@opendesign/studio-design-packs";
import { importStructuredHtml } from "@opendesign/studio-html-importer";

import inputSchema from "../design-director-input.schema.json" with { type: "json" };
import outputSchema from "../design-director-output.schema.json" with { type: "json" };

export const DESIGN_DIRECTOR_INPUT_VERSION = "0.1.0" as const;
export const DESIGN_DIRECTOR_OUTPUT_VERSION = "0.1.0" as const;
export const DESIGN_DIRECTOR_COMPILER_VERSION = "0.1.0" as const;
export const designDirectorInputSchema = inputSchema;
export const designDirectorOutputSchema = outputSchema;

export type DesignDirectorSource = Omit<SourceProvenance, "capturedAt"> & { content: string };

export type DesignDirectorInput = {
  inputVersion: typeof DESIGN_DIRECTOR_INPUT_VERSION;
  taskId: string;
  title: string;
  brief: {
    objective: string;
    audience: string;
    decisionRequest?: string;
    constraints?: string[];
  };
  content: {
    summary: string;
    keyPoints: Array<{ id: string; text: string; sourceIds: string[] }>;
    callToAction?: string;
  };
  sources: DesignDirectorSource[];
  brand: {
    name: string;
    tone: string[];
    primaryColor?: string;
    logoAssetSrc?: string;
  };
  deliverable: {
    kind: "proposal" | "keynote" | "article-graphics";
    audience: string;
    language: "zh-CN" | "en";
    format: "structured-html";
    pageCount: number;
  };
  designPack: DesignPackPin;
  editability: {
    requiredCapabilities: EditableCapability[];
    requireNativeText: boolean;
    requireReplaceableImages: boolean;
    requireReorderablePages: boolean;
  };
};

export type DesignDirectorDiagnostic = {
  code: string;
  severity: "error";
  path: string;
  message: string;
};

export type DesignDirectorSourceCoverage = {
  declaredSourceIds: string[];
  usedSourceIds: string[];
  unusedSourceIds: string[];
  unresolvedSourceIds: string[];
};

export type DesignDirectorManifest = {
  taskId: string;
  documentId: string;
  compiler: { name: "opendesign-design-director"; version: typeof DESIGN_DIRECTOR_COMPILER_VERSION; deterministic: true };
  designPack: DesignPackPin;
  sceneIds: string[];
  elementIds: string[];
  sourceCoverage: DesignDirectorSourceCoverage;
  diagnosis: {
    objective: string;
    audience: string;
    designPrinciples: string[];
    evidenceBoundary: string;
    risks: string[];
  };
};

export type AcceptedHtmlImportResult = HtmlImportResult & {
  status: "accepted";
  document: SceneDocument;
};

export type DesignDirectorAcceptedOutput = {
  outputVersion: typeof DESIGN_DIRECTOR_OUTPUT_VERSION;
  status: "accepted";
  html: string;
  manifest: DesignDirectorManifest;
  diagnostics: readonly [];
  importResult: AcceptedHtmlImportResult;
};

export type DesignDirectorRejectedOutput = {
  outputVersion: typeof DESIGN_DIRECTOR_OUTPUT_VERSION;
  status: "rejected";
  diagnostics: DesignDirectorDiagnostic[];
};

export type DesignDirectorOutput = DesignDirectorAcceptedOutput | DesignDirectorRejectedOutput;

export type DesignDirectorValidation<T> =
  | { ok: true; value: T; issues: readonly [] }
  | { ok: false; issues: readonly DesignDirectorDiagnostic[] };

const ajv = new Ajv2020({ allErrors: true, strict: true });
const inputValidator = ajv.compile(inputSchema);
const outputValidator = ajv.compile(outputSchema);
const MAX_INPUT_BYTES = 96 * 1024;
const MAX_SOURCE_CONTENT_CHARS = 48_000;
const REQUIRED_PACK_BY_DELIVERABLE: Record<DesignDirectorInput["deliverable"]["kind"], string> = {
  proposal: "executive-proposal-cn",
  keynote: "research-keynote-cn",
  "article-graphics": "editorial-story-graphics-cn",
};
const A = STRUCTURED_HTML_ATTRIBUTES;

function schemaDiagnostics(errors: ErrorObject[] | null | undefined): DesignDirectorDiagnostic[] {
  return (errors ?? []).map((error) => ({
    code: "input.schema_invalid",
    severity: "error",
    path: error.instancePath || "/",
    message: error.message ?? `failed ${error.keyword} validation`,
  }));
}

function validateSchema<T>(value: unknown, validator: ValidateFunction): DesignDirectorValidation<T> {
  if (validator(value)) return { ok: true, value: value as T, issues: [] };
  return { ok: false, issues: schemaDiagnostics(validator.errors) };
}

function semanticInputDiagnostics(input: DesignDirectorInput): DesignDirectorDiagnostic[] {
  const issues: DesignDirectorDiagnostic[] = [];
  const report = (code: string, path: string, message: string): void => {
    issues.push({ code, severity: "error", path, message });
  };
  const serializedBytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (serializedBytes > MAX_INPUT_BYTES) report("input.too_large", "/", `Input exceeds ${MAX_INPUT_BYTES} bytes`);
  const sourceCharacters = input.sources.reduce((sum, source) => sum + source.content.length, 0);
  if (sourceCharacters > MAX_SOURCE_CONTENT_CHARS) report("input.too_large", "/sources", `Source content exceeds ${MAX_SOURCE_CONTENT_CHARS} characters`);

  const sourceIds = new Set<string>();
  input.sources.forEach((source, index) => {
    if (sourceIds.has(source.sourceId)) report("source.duplicate", `/sources/${index}/sourceId`, `Source ${source.sourceId} is duplicated`);
    sourceIds.add(source.sourceId);
  });
  const pointIds = new Set<string>();
  input.content.keyPoints.forEach((point, pointIndex) => {
    if (pointIds.has(point.id)) report("content.id_duplicate", `/content/keyPoints/${pointIndex}/id`, `Key point ${point.id} is duplicated`);
    pointIds.add(point.id);
    point.sourceIds.forEach((sourceId) => {
      if (!sourceIds.has(sourceId)) report("source.unresolved", `/content/keyPoints/${pointIndex}/sourceIds`, `Source ${sourceId} is not declared`);
    });
  });

  const pack = getDesignPack(input.designPack.id, input.designPack.version);
  if (!pack) {
    report("pack.unknown", "/designPack", `Design Pack ${input.designPack.id}@${input.designPack.version} is unavailable`);
    return issues;
  }
  const expectedPack = REQUIRED_PACK_BY_DELIVERABLE[input.deliverable.kind];
  if (pack.id !== expectedPack) report("pack.deliverable_mismatch", "/designPack/id", `${input.deliverable.kind} requires ${expectedPack}`);
  const supported = new Set(pack.agentAnnotation.requiredCapabilities);
  const missingCapabilities = input.editability.requiredCapabilities.filter((capability) => !supported.has(capability));
  if (missingCapabilities.length) report("editability.unsupported", "/editability/requiredCapabilities", `Pack does not support: ${missingCapabilities.join(", ")}`);
  for (const capability of pack.agentAnnotation.requiredCapabilities) {
    if (!input.editability.requiredCapabilities.includes(capability)) report("editability.requirement_missing", "/editability/requiredCapabilities", `Required capability ${capability} must be preserved`);
  }
  if (!input.editability.requireNativeText) report("editability.native_text_required", "/editability/requireNativeText", "Design Director output must preserve native text");
  if (!input.editability.requireReplaceableImages) report("editability.replaceable_images_required", "/editability/requireReplaceableImages", "Design Director output must preserve replaceable images");
  if (!input.editability.requireReorderablePages) report("editability.reorder_required", "/editability/requireReorderablePages", "Design Director output must preserve page order editing");
  return issues;
}

export function validateDesignDirectorInput(value: unknown): DesignDirectorValidation<DesignDirectorInput> {
  const result = validateSchema<DesignDirectorInput>(value, inputValidator);
  if (!result.ok) return result;
  const issues = semanticInputDiagnostics(result.value);
  return issues.length ? { ok: false, issues } : result;
}

export function validateDesignDirectorOutput(value: unknown): DesignDirectorValidation<DesignDirectorOutput> {
  return validateSchema<DesignDirectorOutput>(value, outputValidator);
}

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function attr(name: string, value: string | number): string {
  return `${name}="${escapeAttribute(String(value))}"`;
}

function sentence(value: string, maximum: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= maximum) return normalized;
  return `${normalized.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function provenance(input: DesignDirectorInput): SourceProvenance[] {
  return input.sources.map(({ content: _content, ...source }) => source);
}

function elementMarkup(config: {
  tag: "h1" | "p" | "div" | "img";
  id: string;
  role: "eyebrow" | "title" | "body" | "caption" | "shape" | "image";
  frame: string;
  capabilities: EditableCapability[];
  sourceIds: string[];
  content?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  color?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  assetSrc?: string;
  alt?: string;
  zIndex: number;
}): string {
  const attributes = [
    attr(A.elementId, config.id),
    attr(A.role, config.role),
    attr(A.frame, config.frame),
    attr(A.editableCapabilities, config.capabilities.join(" ")),
    attr(A.exportPptx, "native"),
    attr(A.sourceIds, config.sourceIds.join(" ")),
    attr(A.zIndex, config.zIndex),
  ];
  if (config.fontSize !== undefined) attributes.push(attr(A.fontSize, config.fontSize));
  if (config.fontWeight !== undefined) attributes.push(attr(A.fontWeight, config.fontWeight));
  if (config.fontFamily !== undefined) attributes.push(attr(A.fontFamily, config.fontFamily));
  if (config.color !== undefined) attributes.push(attr(A.color, config.color));
  if (config.fill !== undefined) attributes.push(attr(A.fill, config.fill));
  if (config.align !== undefined) attributes.push(attr(A.align, config.align));
  if (config.assetSrc !== undefined) attributes.push(attr("src", config.assetSrc), attr("alt", config.alt ?? ""), attr(A.imageFit, "cover"), attr(A.focalPoint, "0.5,0.5"));
  if (config.tag === "img") return `    <img ${attributes.join(" ")}>`;
  return `    <${config.tag} ${attributes.join(" ")}>${escapeText(config.content ?? "")}</${config.tag}>`;
}

type LayoutProfile = {
  shape: string;
  eyebrow: string;
  title: string;
  body: string;
  asset: string;
  source: string;
  align: "left" | "center";
};

function layoutProfile(packId: string, order: number): LayoutProfile {
  if (packId === "research-keynote-cn") {
    return {
      shape: "1488,72,16,756",
      eyebrow: "112,92,1240,52",
      title: order % 2 === 0 ? "112,178,1040,250" : "240,178,1110,250",
      body: order % 2 === 0 ? "112,478,1120,190" : "240,478,1110,190",
      asset: "1130,486,250,170",
      source: "112,766,1240,58",
      align: "left",
    };
  }
  if (packId === "editorial-story-graphics-cn") {
    return {
      shape: "260,106,1080,12",
      eyebrow: "260,154,1080,52",
      title: "260,238,1080,220",
      body: "300,510,1000,160",
      asset: "260,438,1080,250",
      source: "300,768,1000,58",
      align: "center",
    };
  }
  return {
    shape: "80,72,16,756",
    eyebrow: "128,92,1300,52",
    title: "128,180,1250,220",
    body: "128,458,780,190",
    asset: "1000,438,390,230",
    source: "128,766,1280,58",
    align: "left",
  };
}

function compileHtml(input: DesignDirectorInput, pack: DesignPack): { html: string; sceneIds: string[]; elementIds: string[]; usedSourceIds: string[] } {
  const sourceIds = input.sources.map((source) => source.sourceId);
  const sceneIds: string[] = [];
  const elementIds: string[] = [];
  const usedSourceIds = new Set<string>();
  const scenes: string[] = [];
  for (let index = 0; index < input.deliverable.pageCount; index += 1) {
    const order = index + 1;
    const arc = pack.narrativeArc[index % pack.narrativeArc.length]!;
    const pagePoints = input.content.keyPoints.filter((_point, pointIndex) => pointIndex % input.deliverable.pageCount === index);
    const assignedPoints = pagePoints.length ? pagePoints : [input.content.keyPoints[index % input.content.keyPoints.length]!];
    const point = assignedPoints[0]!;
    const sceneId = `${input.taskId}_s${String(order).padStart(2, "0")}`;
    const elementPrefix = `${input.taskId}_p${String(order).padStart(2, "0")}`;
    const ids = {
      shape: `${elementPrefix}_shape`,
      eyebrow: `${elementPrefix}_eye`,
      title: `${elementPrefix}_title`,
      body: `${elementPrefix}_body`,
      source: `${elementPrefix}_source`,
      asset: `${elementPrefix}_asset`,
    };
    sceneIds.push(sceneId);
    elementIds.push(ids.shape, ids.eyebrow, ids.title, ids.body, ids.asset, ids.source);
    const pointSources = [...new Set(assignedPoints.flatMap((candidate) => candidate.sourceIds))].sort();
    pointSources.forEach((sourceId) => usedSourceIds.add(sourceId));
    const title = order === 1 ? input.title : sentence(point.text, 72);
    const pointSummary = assignedPoints.map((candidate) => candidate.text).join(" · ");
    const body = order === 1 ? input.brief.objective : order === input.deliverable.pageCount && input.content.callToAction ? input.content.callToAction : `${pointSummary}。${input.content.summary}`;
    const label = `${String(order).padStart(2, "0")} / ${arc.role}`;
    const sourceNote = pointSources.map((sourceId) => input.sources.find((source) => source.sourceId === sourceId)!.title).join(" · ");
    const layout = layoutProfile(pack.id, order);
    const elements = [
      elementMarkup({ tag: "div", id: ids.shape, role: "shape", frame: layout.shape, capabilities: ["frame", "order"], sourceIds: pointSources, fill: input.brand.primaryColor ?? pack.tokens.accent, zIndex: 0 }),
      elementMarkup({ tag: "p", id: ids.eyebrow, role: "eyebrow", frame: layout.eyebrow, capabilities: ["text", "typography", "frame", "order"], sourceIds: pointSources, content: label, fontSize: 22, fontWeight: 600, fontFamily: pack.tokens.fontFamily, color: pack.tokens.accent, align: layout.align, zIndex: 1 }),
      elementMarkup({ tag: "h1", id: ids.title, role: "title", frame: layout.title, capabilities: ["text", "typography", "frame", "order"], sourceIds: pointSources, content: sentence(title, 100), fontSize: order === 1 ? 72 : 56, fontWeight: 700, fontFamily: pack.tokens.headingFamily, color: pack.tokens.text, align: layout.align, zIndex: 2 }),
      elementMarkup({ tag: "p", id: ids.body, role: "body", frame: layout.body, capabilities: ["text", "typography", "frame", "order"], sourceIds: pointSources, content: sentence(body, pack.id === "editorial-story-graphics-cn" ? 100 : 360), fontSize: 28, fontWeight: 400, fontFamily: pack.tokens.fontFamily, color: pack.tokens.text, align: layout.align, zIndex: 3 }),
      elementMarkup({ tag: "img", id: ids.asset, role: "image", frame: layout.asset, capabilities: ["asset", "frame", "order"], sourceIds: pointSources, assetSrc: `asset://opendesign/placeholders/${pack.id}`, alt: `可替换视觉占位：${arc.purpose}`, zIndex: 4 }),
      elementMarkup({ tag: "p", id: ids.source, role: "caption", frame: layout.source, capabilities: ["text", "typography", "frame", "order"], sourceIds: pointSources, content: sentence(`来源：${sourceNote}`, 180), fontSize: 16, fontWeight: 400, fontFamily: pack.tokens.fontFamily, color: pack.tokens.muted, align: layout.align, zIndex: 5 }),
    ];
    scenes.push([
      `  <section ${attr(A.sceneId, sceneId)} ${attr(A.sceneOrder, order)} ${attr(A.pageRole, arc.role)} ${attr(A.layout, pack.designDna.composition.grid)} ${attr(A.documentTitle, sentence(title, 100))} ${attr(A.scenePurpose, arc.purpose)}>` ,
      ...elements,
      "  </section>",
    ].join("\n"));
  }

  const documentId = `doc_${input.taskId}`;
  const html = [
    "<!doctype html>",
    `<html lang="${input.deliverable.language}">`,
    "<head><meta charset=\"utf-8\"><title>" + escapeText(input.title) + "</title></head>",
    "<body>",
    `<main ${attr(A.contractVersion, STRUCTURED_HTML_CONTRACT_VERSION)} ${attr(A.documentId, documentId)} ${attr(A.documentTitle, input.title)} ${attr(A.designPackId, pack.id)} ${attr(A.designPackVersion, pack.version)}>`,
    ...scenes,
    "</main>",
    "</body>",
    "</html>",
  ].join("\n");
  return { html, sceneIds, elementIds, usedSourceIds: [...usedSourceIds].sort() };
}

function rejected(diagnostics: readonly DesignDirectorDiagnostic[]): DesignDirectorRejectedOutput {
  return { outputVersion: DESIGN_DIRECTOR_OUTPUT_VERSION, status: "rejected", diagnostics: [...diagnostics] };
}

export function compileDesignDirector(value: unknown): DesignDirectorOutput {
  const validation = validateDesignDirectorInput(value);
  if (!validation.ok) return rejected(validation.issues);
  const input = validation.value;
  const pack = getDesignPack(input.designPack.id, input.designPack.version);
  if (!pack) return rejected([{ code: "pack.unknown", severity: "error", path: "/designPack", message: "Design Pack is unavailable" }]);
  const compiled = compileHtml(input, pack);
  const declaredSourceIds = input.sources.map((source) => source.sourceId).sort();
  const used = new Set(compiled.usedSourceIds);
  const declared = new Set(declaredSourceIds);
  const sourceCoverage: DesignDirectorSourceCoverage = {
    declaredSourceIds,
    usedSourceIds: compiled.usedSourceIds,
    unusedSourceIds: declaredSourceIds.filter((sourceId) => !used.has(sourceId)),
    unresolvedSourceIds: compiled.usedSourceIds.filter((sourceId) => !declared.has(sourceId)),
  };
  if (sourceCoverage.unresolvedSourceIds.length || sourceCoverage.unusedSourceIds.length) {
    return rejected([{ code: "source.coverage_incomplete", severity: "error", path: "/sources", message: "Every declared source must be used and every used source must be declared" }]);
  }
  const importResult = importStructuredHtml({
    html: compiled.html,
    provenance: {
      sources: provenance(input),
      generatedBy: { kind: "skill", name: "opendesign-design-director", version: DESIGN_DIRECTOR_COMPILER_VERSION },
    },
  });
  if (importResult.status !== "accepted" || !importResult.document) {
    return rejected(importResult.diagnostics.map((diagnostic) => ({ code: `import.${diagnostic.code}`, severity: "error" as const, path: diagnostic.sourcePath, message: diagnostic.message })));
  }
  const risks = [
    "人工必须确认事实、措辞与来源边界后再发布",
    ...(input.brief.constraints?.length ? input.brief.constraints : ["未提供额外约束，发布前需补充审查"]),
  ];
  const output: DesignDirectorAcceptedOutput = {
    outputVersion: DESIGN_DIRECTOR_OUTPUT_VERSION,
    status: "accepted",
    html: compiled.html,
    manifest: {
      taskId: input.taskId,
      documentId: `doc_${input.taskId}`,
      compiler: { name: "opendesign-design-director", version: DESIGN_DIRECTOR_COMPILER_VERSION, deterministic: true },
      designPack: structuredClone(input.designPack),
      sceneIds: compiled.sceneIds,
      elementIds: compiled.elementIds,
      sourceCoverage,
      diagnosis: {
        objective: input.brief.objective,
        audience: input.brief.audience,
        designPrinciples: [...pack.designDna.principles],
        evidenceBoundary: `仅使用 ${declaredSourceIds.join(", ")}；不补造数据、引文或资产。`,
        risks,
      },
    },
    diagnostics: [],
    importResult: importResult as AcceptedHtmlImportResult,
  };
  const outputValidation = validateDesignDirectorOutput(output);
  return outputValidation.ok ? output : rejected(outputValidation.issues.map((issue) => ({ ...issue, code: `output.${issue.code}` })));
}
