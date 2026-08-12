import { existsSync } from "node:fs";
import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import type { DesignDirection, Scene, SceneDocument, SceneElement } from "@opendesign/studio-contracts";
import { resolveColor } from "./colors.js";

const CJK_TEXT = /[\u2e80-\u2fff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
const NO_LINE_START = /^[，。！？；：、）》】」』,.!?;:]$/u;
const CJK_SANS_FAMILY = "OpenDesign CJK Sans";
const CJK_SERIF_FAMILY = "OpenDesign CJK Serif";
const CJK_SANS_CANDIDATES = [
  process.env.OPENDESIGN_CJK_FONT_PATH,
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "/System/Library/Fonts/STHeiti Medium.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
].filter((path): path is string => Boolean(path));
const CJK_SERIF_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Songti.ttc",
  "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSerifCJK-Regular.ttc",
].filter((path): path is string => Boolean(path));

let fontReady = false;

function ensureCjkFont(): void {
  if (fontReady) return;
  const fontPath = CJK_SANS_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!fontPath) throw new Error("PNG rendering requires OPENDESIGN_CJK_FONT_PATH or a supported local CJK font");
  GlobalFonts.registerFromPath(fontPath, CJK_SANS_FAMILY);
  const serifPath = CJK_SERIF_CANDIDATES.find((candidate) => existsSync(candidate));
  if (serifPath) GlobalFonts.registerFromPath(serifPath, CJK_SERIF_FAMILY);
  fontReady = true;
}

function selectedDirection(document: SceneDocument): DesignDirection {
  const direction = document.directions.find((candidate) => candidate.id === document.selectedDirectionId);
  if (!direction) throw new Error(`Unknown design direction: ${document.selectedDirectionId}`);
  return direction;
}

function primaryFont(stack: string): string {
  const requested = stack.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") || "Arial";
  return requested.toLowerCase() === "inter" ? "Arial" : requested;
}

function canvasFontFamily(content: string, stack: string): string {
  if (!CJK_TEXT.test(content)) return primaryFont(stack);
  return /Songti|SimSun|Noto Serif/i.test(stack) && GlobalFonts.has(CJK_SERIF_FAMILY) ? CJK_SERIF_FAMILY : CJK_SANS_FAMILY;
}

function canvasColor(value: string | undefined, direction: DesignDirection, fallback: string): string {
  return `#${resolveColor(value, direction.tokens, fallback)}`;
}

function fitLines(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  content: string,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of content.split("\n")) {
    if (paragraph.length === 0) { lines.push(""); continue; }
    let line = "";
    for (const character of [...paragraph]) {
      const candidate = `${line}${character}`;
      if (line && context.measureText(candidate).width > width && !NO_LINE_START.test(character)) {
        lines.push(line.trimEnd());
        line = character.trimStart();
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function textLayout(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  element: SceneElement,
  family: string,
): { fontSize: number; lineHeight: number; lines: string[] } {
  const requested = element.fontSize ?? 24;
  const minimum = element.role === "title" ? 35 : element.role === "eyebrow" ? 16 : 12;
  for (let fontSize = requested; fontSize >= minimum; fontSize -= 1) {
    context.font = `${(element.fontWeight ?? 400) >= 600 ? "bold " : ""}${fontSize}px "${family}"`;
    const lineHeight = fontSize * 1.18;
    const lines = fitLines(context, element.content ?? "", element.frame.width);
    if (lines.length * lineHeight <= element.frame.height) return { fontSize, lineHeight, lines };
  }
  context.font = `${(element.fontWeight ?? 400) >= 600 ? "bold " : ""}${minimum}px "${family}"`;
  return { fontSize: minimum, lineHeight: minimum * 1.18, lines: fitLines(context, element.content ?? "", element.frame.width) };
}

function drawText(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  element: SceneElement,
  direction: DesignDirection,
): void {
  const content = element.content ?? "";
  const stack = element.role === "title" || element.role === "quote" ? direction.tokens.headingFamily : direction.tokens.fontFamily;
  const family = canvasFontFamily(content, stack);
  const { fontSize, lineHeight, lines } = textLayout(context, element, family);
  const totalHeight = lines.length * lineHeight;
  const align = element.align ?? "left";
  const x = align === "center"
    ? element.frame.x + element.frame.width / 2
    : align === "right"
      ? element.frame.x + element.frame.width
      : element.frame.x;
  const firstBaseline = element.frame.y + (element.frame.height - totalHeight) / 2 + fontSize;

  context.save();
  context.beginPath();
  context.rect(element.frame.x, element.frame.y, element.frame.width, element.frame.height);
  context.clip();
  context.font = `${(element.fontWeight ?? 400) >= 600 ? "bold " : ""}${fontSize}px "${family}"`;
  context.fillStyle = canvasColor(element.color, direction, direction.tokens.text);
  context.textAlign = align;
  context.textBaseline = "alphabetic";
  for (const [index, line] of lines.entries()) context.fillText(line, x, firstBaseline + index * lineHeight);
  context.restore();
}

function drawElement(
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  element: SceneElement,
  direction: DesignDirection,
): void {
  if (element.type === "shape") {
    context.fillStyle = canvasColor(element.fill, direction, direction.tokens.surface);
    context.fillRect(element.frame.x, element.frame.y, element.frame.width, element.frame.height);
    return;
  }
  if (element.type === "image") {
    context.fillStyle = direction.tokens.surface;
    context.fillRect(element.frame.x, element.frame.y, element.frame.width, element.frame.height);
    context.strokeStyle = direction.tokens.line;
    context.strokeRect(element.frame.x, element.frame.y, element.frame.width, element.frame.height);
    return;
  }
  drawText(context, element, direction);
}

export type CanvasAssetResolver = (source: string) => Promise<Buffer | null>;

export async function renderSceneToPngBuffer(document: SceneDocument, scene: Scene, assetResolver?: CanvasAssetResolver): Promise<Buffer> {
  ensureCjkFont();
  const direction = selectedDirection(document);
  const canvas = createCanvas(document.canvas.width, document.canvas.height);
  const context = canvas.getContext("2d");
  context.fillStyle = direction.tokens.background;
  context.fillRect(0, 0, document.canvas.width, document.canvas.height);
  for (const element of scene.elements.slice().sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))) {
    if (element.type === "image" && element.assetSrc && assetResolver) {
      const asset = await assetResolver(element.assetSrc);
      if (asset) {
        const image = await loadImage(asset);
        const scale = Math.max(element.frame.width / image.width, element.frame.height / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        context.save();
        context.beginPath();
        context.rect(element.frame.x, element.frame.y, element.frame.width, element.frame.height);
        context.clip();
        context.drawImage(image, element.frame.x + (element.frame.width - width) / 2, element.frame.y + (element.frame.height - height) / 2, width, height);
        context.restore();
        continue;
      }
    }
    drawElement(context, element, direction);
  }
  return canvas.toBuffer("image/png");
}
