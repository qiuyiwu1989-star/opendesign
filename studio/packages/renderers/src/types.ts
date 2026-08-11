import type { SceneDocument, SceneElement } from "@opendesign/studio-contracts";

export type NativeObjectKind = "text" | "image" | "shape";
export type ExportMode = "native" | "raster" | "omitted";

export type ElementEditability = {
  sceneId: string;
  elementId: string;
  declaredEditable: boolean;
  outputMode: ExportMode;
  nativeObjectKind?: NativeObjectKind;
  fallbackReason?: string;
};

export type EditabilityReport = {
  documentId: string;
  generatedAt: string;
  renderer: "pptxgenjs";
  defaultMode: "editable";
  summary: {
    totalElements: number;
    nativeElements: number;
    rasterFallbacks: number;
    omittedElements: number;
  };
  elements: ElementEditability[];
};

export type AssetInput = { path: string } | { data: string };
export type AssetResolver = (
  source: string,
  context: { document: SceneDocument; sceneId: string; element: SceneElement },
) => Promise<AssetInput | null>;

export type PptxExportOptions = {
  outputPath: string;
  assetResolver?: AssetResolver;
  generatedAt?: string;
  author?: string;
  subject?: string;
};

export type PptxExportResult = {
  outputPath: string;
  report: EditabilityReport;
};

export type HtmlRenderOptions = {
  sceneClassName?: string;
  includeDocumentShell?: boolean;
};

export type ScreenshotRequest = {
  html: string;
  outputPath: string;
  width: number;
  height: number;
  deviceScaleFactor?: number;
};

export interface PageScreenshotAdapter {
  readonly name: string;
  capture(request: ScreenshotRequest): Promise<void>;
}

export type PngExportOptions = {
  outputDirectory: string;
  adapter: PageScreenshotAdapter;
  deviceScaleFactor?: number;
};

export type PngExportResult = {
  adapter: string;
  pages: Array<{ sceneId: string; outputPath: string }>;
};
