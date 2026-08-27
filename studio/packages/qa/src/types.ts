import type { SceneDocument } from "@opendesign/studio-contracts";

export type QaCategory =
  | "layout.out_of_bounds"
  | "layout.collision"
  | "readability.font_size"
  | "readability.contrast"
  | "asset.missing"
  | "asset.alt_missing"
  | "export.font_fallback"
  | "export.raster_fallback"
  | "export.omitted";

export type QaSeverity = "blocker" | "error" | "warning" | "note";

export type QaIssue = {
  issueId: string;
  sceneId: string;
  elementIds: string[];
  category: QaCategory;
  severity: QaSeverity;
  message: string;
  safeAutoFix: boolean;
};

export type ExportDegradation = {
  sceneId: string;
  elementId: string;
  outputMode: "raster" | "omitted";
  reason: string;
};

export type QaOptions = {
  minimumFontSizes?: Partial<Record<"eyebrow" | "title" | "body" | "caption" | "metric" | "quote", number>>;
  minimumContrastRatio?: number;
  supportedFonts?: string[];
  exportDegradations?: ExportDegradation[];
};

export type QaReport = {
  documentId: string;
  schemaVersion: SceneDocument["schemaVersion"];
  deterministic: true;
  summary: {
    blocker: number;
    error: number;
    warning: number;
    note: number;
    total: number;
  };
  issues: QaIssue[];
};
