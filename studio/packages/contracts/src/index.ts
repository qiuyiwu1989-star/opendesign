export const STUDIO_SCHEMA_VERSION = "0.1.0" as const;
export const STRUCTURED_HTML_CONTRACT_VERSION = "0.1.0" as const;
export const DESIGN_PACK_SCHEMA_VERSION = "0.1.0" as const;
export const HTML_IMPORT_RESULT_VERSION = "0.1.0" as const;

export const STRUCTURED_HTML_ATTRIBUTES = {
  contractVersion: "data-od-contract-version",
  documentId: "data-od-document-id",
  documentTitle: "data-od-title",
  designPackId: "data-od-design-pack-id",
  designPackVersion: "data-od-design-pack-version",
  sceneId: "data-od-scene-id",
  sceneOrder: "data-od-scene-order",
  pageRole: "data-od-page-role",
  layout: "data-od-layout",
  scenePurpose: "data-od-purpose",
  elementId: "data-od-element-id",
  role: "data-od-role",
  frame: "data-od-frame",
  editableCapabilities: "data-od-editable",
  exportPptx: "data-od-export-pptx",
  sourceIds: "data-od-source-ids",
  fontSize: "data-od-font-size",
  fontWeight: "data-od-font-weight",
  fontFamily: "data-od-font-family",
  lineHeight: "data-od-line-height",
  color: "data-od-color",
  fill: "data-od-fill",
  align: "data-od-align",
  imageFit: "data-od-image-fit",
  focalPoint: "data-od-focal-point",
  zIndex: "data-od-z-index",
} as const;

export type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FocalPoint = { x: number; y: number };
export type DesignPackPin = { id: string; version: string };

export type SourceProvenance = {
  sourceId: string;
  type: "article" | "brief" | "document" | "url" | "manual" | "generated";
  title: string;
  sourceRef?: string;
  capturedAt?: string;
  contentHash?: string;
};

export type GenerationProvenance = {
  kind: "skill" | "human" | "import";
  name: string;
  version?: string;
};

export type DocumentProvenance = {
  sources: SourceProvenance[];
  generatedBy: GenerationProvenance;
  generatedAt?: string;
};

export type DesignTokens = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  line: string;
  fontFamily: string;
  headingFamily: string;
};

export type DesignDirection = {
  id: string;
  name: string;
  stance: "primary" | "alternate";
  rationale: string;
  referenceSlug: string;
  referenceVersion: string;
  tokens: DesignTokens;
};

export type ElementRole =
  | "eyebrow"
  | "title"
  | "body"
  | "caption"
  | "metric"
  | "quote"
  | "image"
  | "shape";

export type EditableCapability = "text" | "typography" | "asset" | "frame" | "order";
export type ElementExportMode = "native" | "raster" | "omitted";
export type ElementExportHint = { html: "native"; pptx: ElementExportMode; reason?: string };

export type SceneElement = {
  id: string;
  type: "text" | "image" | "shape" | "metric" | "quote";
  role: ElementRole;
  frame: Frame;
  content?: string;
  assetSrc?: string;
  alt?: string;
  fill?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  lineHeight?: number;
  align?: "left" | "center" | "right";
  imageFit?: "contain" | "cover" | "stretch";
  focalPoint?: FocalPoint;
  zIndex?: number;
  editable: boolean;
  editableCapabilities?: EditableCapability[];
  exportHint?: ElementExportHint;
  sourceIds?: string[];
};

export type Scene = {
  id: string;
  order: number;
  title: string;
  purpose: string;
  layout: string;
  elements: SceneElement[];
};

export type SceneDocument = {
  schemaVersion: typeof STUDIO_SCHEMA_VERSION;
  documentId: string;
  title: string;
  canvas: { width: 1600; height: 900; unit: "logical-px" };
  directions: DesignDirection[];
  selectedDirectionId: string;
  scenes: Scene[];
  designPack?: DesignPackPin;
  provenance?: DocumentProvenance;
};

export type ScenePatch =
  | { elementId: string; field: "content" | "assetSrc" | "alt" | "color"; value: string }
  | { elementId: string; field: "fontFamily"; value: string }
  | { elementId: string; field: "fontSize" | "fontWeight" | "lineHeight" | "zIndex"; value: number }
  | { elementId: string; field: "imageFit"; value: "contain" | "cover" | "stretch" }
  | { elementId: string; field: "frame"; value: Frame }
  | { elementId: string; field: "focalPoint"; value: FocalPoint }
  | { directionId: string; field: "fontFamily" | "headingFamily"; value: string };

export type Revision = {
  revisionId: string;
  parentRevisionId: string | null;
  createdAt: string;
  reason: "initial" | "edit" | "qa-fix" | "regenerate";
  patches: ScenePatch[];
};

export type RevisionInput = Omit<Revision, "patches"> & {
  patches: readonly ScenePatch[];
};

export type RevisionResult = {
  document: SceneDocument;
  revision: Revision;
};

export type IssueSeverity = "blocker" | "error" | "warning" | "note";
export type IssueStatus = "open" | "fixing" | "fixed" | "accepted" | "dismissed";

export type StudioIssue = {
  issueId: string;
  sceneId: string;
  elementIds: string[];
  category:
    | "layout.overflow"
    | "layout.collision"
    | "layout.out_of_bounds"
    | "readability.font_size"
    | "readability.contrast"
    | "asset.missing"
    | "asset.alt_missing"
    | "export.font_missing"
    | "export.font_fallback"
    | "export.raster_fallback"
    | "export.omitted";
  severity: IssueSeverity;
  message: string;
  status: IssueStatus;
  safeAutoFix: boolean;
};

export type StructuredHtmlElementDeclaration = {
  id: string;
  tagName: "h1" | "h2" | "h3" | "p" | "span" | "img" | "div" | "figure" | "blockquote";
  role: ElementRole;
  editableCapabilities: EditableCapability[];
  exportHint: ElementExportHint;
  sourceIds: string[];
};

export type StructuredHtmlSceneDeclaration = {
  id: string;
  order: number;
  pageRole: string;
  layout: string;
  elements: StructuredHtmlElementDeclaration[];
};

/** Declarative data extracted from untrusted HTML. It cannot carry executable markup. */
export type StructuredHtmlContract = {
  contractVersion: typeof STRUCTURED_HTML_CONTRACT_VERSION;
  documentId: string;
  title: string;
  canvas: { width: 1600; height: 900; unit: "logical-px" };
  designPack: DesignPackPin;
  provenance: DocumentProvenance;
  scenes: StructuredHtmlSceneDeclaration[];
};

export type DesignPackContentSlot = {
  id: string;
  kind: "text" | "image" | "metric" | "chart" | "shape";
  required: boolean;
  maxChars?: number;
};

export type DesignPack = {
  packSchemaVersion: typeof DESIGN_PACK_SCHEMA_VERSION;
  id: string;
  version: string;
  name: string;
  summary: string;
  positioning: { scenarios: string[]; audiences: string[]; contentTypes: string[] };
  designDna: {
    principles: string[];
    mood: string[];
    composition: { grid: string; density: "airy" | "balanced" | "dense"; rhythm: string };
    typography: { headingFamily: string; bodyFamily: string; languageSupport: string[] };
  };
  tokens: DesignTokens;
  narrativeArc: Array<{ order: number; role: string; purpose: string; required: boolean }>;
  pageRoles: Array<{
    id: string;
    purpose: string;
    contentSlots: DesignPackContentSlot[];
    layoutGuidance: string[];
  }>;
  assetStrategy: {
    imagePolicy: "provided-first" | "library-first" | "generated-allowed";
    requiredAltText: true;
    allowedSchemes: Array<"https" | "asset">;
  };
  agentGuidance: string[];
  editability: {
    text: "native";
    image: "replaceable" | "locked";
    frame: boolean;
    order: boolean;
    decoration: "native" | "raster" | "locked";
  };
  export: {
    html: "high-fidelity";
    pptx: "native-first" | "hybrid";
    png: "supported";
    rasterFallback: "component-only" | "forbidden";
  };
  qaRules: Array<{
    id: string;
    severity: "blocker" | "error" | "warning" | "note";
    scope: "pack" | "scene" | "element";
    rule: string;
  }>;
  agentAnnotation: {
    copyText: string;
    requiredCapabilities: EditableCapability[];
    contractVersion: typeof STRUCTURED_HTML_CONTRACT_VERSION;
  };
};

export type HtmlImportDiagnosticCode =
  | "security.script_blocked"
  | "security.event_handler_blocked"
  | "security.url_blocked"
  | "node.unsupported"
  | "id.missing"
  | "id.duplicate"
  | "role.missing"
  | "role.unsupported"
  | "capability.invalid"
  | "design_pack.pin_missing"
  | "provenance.missing"
  | "scene_ir.invalid"
  | "import.empty";

export type HtmlImportDiagnostic = {
  diagnosticId: string;
  code: HtmlImportDiagnosticCode;
  severity: "error" | "warning" | "note";
  disposition: "blocked" | "unsupported" | "normalized";
  message: string;
  sourcePath: string;
  sceneId?: string;
  elementId?: string;
  nodeName?: string;
};

export type HtmlImportResult = {
  importVersion: typeof HTML_IMPORT_RESULT_VERSION;
  status: "accepted" | "partial" | "rejected";
  document?: SceneDocument;
  diagnostics: HtmlImportDiagnostic[];
  security: {
    untrustedInput: true;
    executableContent: "blocked";
    blockedNodeCount: number;
  };
};

export {
  SceneContractError,
  assertSceneDocument,
  validateDesignPack,
  validateHtmlImportResult,
  validateSceneDocument,
  validateStructuredHtmlContract,
  validateStudioIssue,
  validateRevision,
  type ContractIssue,
  type ValidationFailure,
  type ValidationResult,
  type ValidationSuccess,
} from "./validation.js";

export {
  PatchApplicationError,
  RevisionContractError,
  applyPatch,
  createRevision,
} from "./revision.js";
