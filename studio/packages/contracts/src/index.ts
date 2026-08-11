export const STUDIO_SCHEMA_VERSION = "0.1.0" as const;

export type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
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
  align?: "left" | "center" | "right";
  zIndex?: number;
  editable: boolean;
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
};

export type ScenePatch =
  | { elementId: string; field: "content" | "assetSrc" | "alt" | "color"; value: string }
  | { elementId: string; field: "fontSize"; value: number };

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
    | "export.font_missing"
    | "export.raster_fallback";
  severity: IssueSeverity;
  message: string;
  status: IssueStatus;
  safeAutoFix: boolean;
};

export {
  SceneContractError,
  assertSceneDocument,
  validateSceneDocument,
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
