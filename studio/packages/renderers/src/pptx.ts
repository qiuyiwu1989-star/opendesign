import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import PptxGenJS from "pptxgenjs";
import type { DesignDirection, SceneDocument, SceneElement } from "@opendesign/studio-contracts";
import { resolveColor } from "./colors.js";
import type { EditabilityReport, ElementEditability, PptxExportOptions, PptxExportResult } from "./types.js";

const PX_PER_INCH = 120;
const PX_TO_POINT = 0.75;

function selectedDirection(document: SceneDocument): DesignDirection {
  const direction = document.directions.find((candidate) => candidate.id === document.selectedDirectionId);
  if (!direction) throw new Error(`Unknown design direction: ${document.selectedDirectionId}`);
  return direction;
}

function firstFont(stack: string): string {
  return stack.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") || "Arial";
}

function inches(value: number): number {
  return value / PX_PER_INCH;
}

function imagePlaceholder(pptx: PptxGenJS, slide: PptxGenJS.Slide, element: SceneElement, direction: DesignDirection): void {
  slide.addShape(pptx.ShapeType.rect, {
    x: inches(element.frame.x),
    y: inches(element.frame.y),
    w: inches(element.frame.width),
    h: inches(element.frame.height),
    fill: { color: resolveColor("surface", direction.tokens, direction.tokens.surface) },
    line: { color: resolveColor("line", direction.tokens, direction.tokens.line) },
  });
  slide.addText("Missing image", {
    x: inches(element.frame.x),
    y: inches(element.frame.y),
    w: inches(element.frame.width),
    h: inches(element.frame.height),
    fontFace: firstFont(direction.tokens.fontFamily),
    fontSize: 14,
    color: resolveColor("muted", direction.tokens, direction.tokens.muted),
    align: "center",
    valign: "middle",
    margin: 0,
  });
}

export async function exportDocumentToPptx(document: SceneDocument, options: PptxExportOptions): Promise<PptxExportResult> {
  const direction = selectedDirection(document);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "OPENDESIGN_16_9", width: inches(document.canvas.width), height: inches(document.canvas.height) });
  pptx.layout = "OPENDESIGN_16_9";
  pptx.author = options.author ?? "OpenDesign Studio";
  pptx.subject = options.subject ?? document.title;
  pptx.title = document.title;
  pptx.company = "OpenDesign";
  pptx.theme = {
    headFontFace: firstFont(direction.tokens.headingFamily),
    bodyFontFace: firstFont(direction.tokens.fontFamily),
  };

  const elements: ElementEditability[] = [];
  for (const scene of document.scenes.slice().sort((left, right) => left.order - right.order)) {
    const slide = pptx.addSlide();
    slide.background = { color: resolveColor("background", direction.tokens, direction.tokens.background) };

    for (const element of scene.elements.slice().sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))) {
      const position = {
        x: inches(element.frame.x),
        y: inches(element.frame.y),
        w: inches(element.frame.width),
        h: inches(element.frame.height),
      };
      if (element.type === "shape") {
        slide.addShape(pptx.ShapeType.rect, {
          ...position,
          fill: { color: resolveColor(element.fill, direction.tokens, direction.tokens.surface) },
          line: { color: resolveColor(element.fill, direction.tokens, direction.tokens.surface), transparency: 100 },
        });
        elements.push({ sceneId: scene.id, elementId: element.id, declaredEditable: element.editable, outputMode: "native", nativeObjectKind: "shape" });
        continue;
      }

      if (element.type === "image") {
        const asset = element.assetSrc && options.assetResolver
          ? await options.assetResolver(element.assetSrc, { document, sceneId: scene.id, element })
          : null;
        if (asset) {
          slide.addImage({ ...position, ...asset });
          elements.push({ sceneId: scene.id, elementId: element.id, declaredEditable: element.editable, outputMode: "native", nativeObjectKind: "image" });
        } else {
          imagePlaceholder(pptx, slide, element, direction);
          elements.push({
            sceneId: scene.id,
            elementId: element.id,
            declaredEditable: element.editable,
            outputMode: "omitted",
            fallbackReason: element.assetSrc ? "Asset resolver returned no embeddable image; emitted native placeholder." : "Image assetSrc is missing; emitted native placeholder.",
          });
        }
        continue;
      }

      const fontStack = element.role === "title" || element.role === "quote" ? direction.tokens.headingFamily : direction.tokens.fontFamily;
      slide.addText(element.content ?? "", {
        ...position,
        fontFace: firstFont(fontStack),
        fontSize: (element.fontSize ?? 24) * PX_TO_POINT,
        bold: (element.fontWeight ?? 400) >= 600,
        color: resolveColor(element.color, direction.tokens, direction.tokens.text),
        align: element.align ?? "left",
        valign: "middle",
        margin: 0,
        breakLine: false,
        fit: "shrink",
        paraSpaceAfter: 0,
      });
      elements.push({ sceneId: scene.id, elementId: element.id, declaredEditable: element.editable, outputMode: "native", nativeObjectKind: "text" });
    }
  }

  await mkdir(dirname(options.outputPath), { recursive: true });
  await pptx.writeFile({ fileName: options.outputPath });

  const report: EditabilityReport = {
    documentId: document.documentId,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    renderer: "pptxgenjs",
    defaultMode: "editable",
    summary: {
      totalElements: elements.length,
      nativeElements: elements.filter((element) => element.outputMode === "native").length,
      rasterFallbacks: elements.filter((element) => element.outputMode === "raster").length,
      omittedElements: elements.filter((element) => element.outputMode === "omitted").length,
    },
    elements,
  };
  return { outputPath: options.outputPath, report };
}
