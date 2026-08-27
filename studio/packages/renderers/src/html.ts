import type { DesignDirection, Scene, SceneDocument, SceneElement } from "@opendesign/studio-contracts";
import type { HtmlRenderOptions } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function selectedDirection(document: SceneDocument): DesignDirection {
  const direction = document.directions.find((candidate) => candidate.id === document.selectedDirectionId);
  if (!direction) throw new Error(`Unknown design direction: ${document.selectedDirectionId}`);
  return direction;
}

function cssColor(value: string | undefined, direction: DesignDirection, fallback: string): string {
  if (!value) return fallback;
  const tokenValue = direction.tokens[value as keyof typeof direction.tokens];
  return typeof tokenValue === "string" ? tokenValue : value;
}

function elementHtml(element: SceneElement, direction: DesignDirection): string {
  const { frame } = element;
  const position = `left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;z-index:${element.zIndex ?? 0}`;
  const shared = `position:absolute;box-sizing:border-box;${position}`;
  const id = escapeHtml(element.id);

  if (element.type === "shape") {
    const fill = cssColor(element.fill, direction, direction.tokens.surface);
    return `<div data-element-id="${id}" data-element-type="shape" style="${shared};background:${escapeHtml(fill)}"></div>`;
  }

  if (element.type === "image") {
    if (!element.assetSrc) {
      return `<div data-element-id="${id}" data-element-type="image" data-missing-asset="true" style="${shared};background:${escapeHtml(direction.tokens.surface)}"></div>`;
    }
    return `<img data-element-id="${id}" data-element-type="image" src="${escapeHtml(element.assetSrc)}" alt="${escapeHtml(element.alt ?? "")}" style="${shared};object-fit:cover" />`;
  }

  const color = cssColor(element.color, direction, direction.tokens.text);
  const family = element.role === "title" || element.role === "quote" ? direction.tokens.headingFamily : direction.tokens.fontFamily;
  const textStyle = [
    shared,
    `color:${escapeHtml(color)}`,
    `font-family:${escapeHtml(family)}`,
    `font-size:${element.fontSize ?? 24}px`,
    `font-weight:${element.fontWeight ?? 400}`,
    `text-align:${element.align ?? "left"}`,
    "white-space:pre-wrap",
    "overflow:hidden",
    "display:flex",
    "align-items:center",
  ].join(";");
  return `<div data-element-id="${id}" data-element-type="text" style="${textStyle}">${escapeHtml(element.content ?? "")}</div>`;
}

export function renderSceneToHtml(document: SceneDocument, scene: Scene, options: HtmlRenderOptions = {}): string {
  const direction = selectedDirection(document);
  const className = options.sceneClassName ?? "studio-scene";
  const content = scene.elements
    .slice()
    .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))
    .map((element) => elementHtml(element, direction))
    .join("");
  return `<section class="${escapeHtml(className)}" data-scene-id="${escapeHtml(scene.id)}" style="position:relative;width:${document.canvas.width}px;height:${document.canvas.height}px;overflow:hidden;background:${escapeHtml(direction.tokens.background)}">${content}</section>`;
}

export function renderDocumentToHtml(document: SceneDocument, options: HtmlRenderOptions = {}): string {
  const scenes = document.scenes
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((scene) => renderSceneToHtml(document, scene, options))
    .join("\n");
  if (options.includeDocumentShell === false) return scenes;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.title)}</title><style>html,body{margin:0;padding:0;background:#111}.studio-scene{page-break-after:always}</style></head><body>${scenes}</body></html>`;
}
