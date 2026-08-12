import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import PptxGenJS from "pptxgenjs";
import type { DesignDirection, SceneDocument, SceneElement } from "@opendesign/studio-contracts";
import { resolveColor } from "./colors.js";
import type { AssetInput, EditabilityReport, ElementEditability, PptxExportOptions, PptxExportResult } from "./types.js";

const PX_PER_INCH = 120;
const PX_TO_POINT = 0.75;
const LOGICAL_PX_TO_POINT = 72 / PX_PER_INCH;

function selectedDirection(document: SceneDocument): DesignDirection {
  const direction = document.directions.find((candidate) => candidate.id === document.selectedDirectionId);
  if (!direction) throw new Error(`Unknown design direction: ${document.selectedDirectionId}`);
  return direction;
}

function firstFont(stack: string): string {
  return stack.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") || "Arial";
}

const CJK_TEXT = /[\u2e80-\u2fff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
const CJK_PPTX_FONT = "Hiragino Sans GB";

export function pptxFontFace(content: string, stack: string): string {
  if (!CJK_TEXT.test(content)) return firstFont(stack);
  const cjkFace = stack.split(",").map((face) => face.trim().replace(/^['"]|['"]$/g, "")).find((face) => /Songti|SimSun|Hiragino|YaHei|Noto (?:Sans|Serif) CJK|PingFang|Heiti/i.test(face));
  return cjkFace ?? CJK_PPTX_FONT;
}

export function pptxTextLanguage(content: string): string {
  return CJK_TEXT.test(content) ? "zh-CN" : "en-US";
}

function inches(value: number): number {
  return value / PX_PER_INCH;
}

function textUnits(value: string): number {
  return [...value].reduce((total, character) => {
    if (/\s/u.test(character)) return total + 0.35;
    if (/[\u0000-\u024f]/u.test(character)) return total + 0.58;
    return total + 1;
  }, 0);
}

export function fitTextFontSize(element: SceneElement): number {
  const content = element.content ?? "";
  const requested = (element.fontSize ?? 24) * PX_TO_POINT * (element.role === "body" && textUnits(content) > 18 ? 0.92 : 1);
  if (!content.trim()) return requested;
  const widthPoints = element.frame.width * LOGICAL_PX_TO_POINT;
  const roleLines: Partial<Record<SceneElement["role"], number>> = {
    eyebrow: 1,
    title: 2,
    caption: 2,
    metric: 3,
    quote: 4,
    body: 6,
  };
  const maximumLines = roleLines[element.role] ?? 4;
  const widthLimited = (widthPoints * maximumLines * 0.88) / Math.max(textUnits(content), 1);
  const minimum = element.role === "title" ? 35 : element.role === "eyebrow" ? 16 : 14;
  return Math.max(minimum, Math.min(requested, widthLimited));
}

export function preparePptxText(element: SceneElement, fontSize: number): string {
  const content = element.content ?? "";
  if (element.role !== "body" || !CJK_TEXT.test(content) || content.includes("\n")) return content;
  const maximumUnits = (element.frame.width * LOGICAL_PX_TO_POINT * 0.94) / Math.max(fontSize, 1);
  const segments = content.match(/[^，。！？；：、,.!?;:]+[，。！？；：、,.!?;:]?/gu) ?? [content];
  const lines: string[] = [];
  let line = "";
  for (const segment of segments) {
    if (line && textUnits(`${line}${segment}`) > maximumUnits) {
      lines.push(line);
      line = segment;
    } else {
      line += segment;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

const SAFE_IMAGE_PATH = /\.(?:png|jpe?g)$/i;
const SAFE_IMAGE_DATA = /^data:image\/(?:png|jpeg);base64,/i;

export function assertSafePptxAsset(asset: AssetInput): AssetInput {
  if ("path" in asset && !SAFE_IMAGE_PATH.test(asset.path)) {
    throw new Error("PPTX assets must be PNG or JPEG files");
  }
  if ("data" in asset && !SAFE_IMAGE_DATA.test(asset.data)) {
    throw new Error("PPTX data assets must be PNG or JPEG base64 data URLs");
  }
  return asset;
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
          const safeAsset = assertSafePptxAsset(asset);
          const { mimeType: _mimeType, ...pptxAsset } = safeAsset;
          slide.addImage({ ...position, ...pptxAsset });
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
      const fontSize = fitTextFontSize(element);
      const content = preparePptxText(element, fontSize);
      slide.addText(content, {
        ...position,
        fontFace: pptxFontFace(content, fontStack),
        lang: pptxTextLanguage(content),
        fontSize,
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
