import type { DesignDirection, SceneDocument, SceneElement } from "@opendesign/studio-contracts";
import { contrastRatio } from "./color.js";
import { isOutOfBounds, overlapRatio } from "./geometry.js";
import type { QaIssue, QaOptions, QaReport } from "./types.js";

const DEFAULT_MINIMUMS = {
  eyebrow: 16,
  title: 35,
  body: 16,
  caption: 14,
  metric: 24,
  quote: 24,
} as const;

function selectedDirection(document: SceneDocument): DesignDirection {
  const direction = document.directions.find((candidate) => candidate.id === document.selectedDirectionId);
  if (!direction) throw new Error(`Unknown design direction: ${document.selectedDirectionId}`);
  return direction;
}

function tokenColor(value: string | undefined, direction: DesignDirection, fallback: string): string {
  if (!value) return fallback;
  const token = direction.tokens[value as keyof typeof direction.tokens];
  return typeof token === "string" ? token : value;
}

function primaryFont(stack: string): string {
  return stack.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? stack;
}

function issue(category: QaIssue["category"], severity: QaIssue["severity"], sceneId: string, elementIds: string[], message: string): QaIssue {
  const target = elementIds.length > 0 ? elementIds.slice().sort().join("+") : "document";
  return {
    issueId: `${sceneId}:${category}:${target}`,
    sceneId,
    elementIds: elementIds.slice().sort(),
    category,
    severity,
    message,
    safeAutoFix: false,
  };
}

function isText(element: SceneElement): boolean {
  return element.type === "text" || element.type === "metric" || element.type === "quote";
}

function collisionRelevant(left: SceneElement, right: SceneElement): boolean {
  if (left.type === "shape" || right.type === "shape") return false;
  if (left.type === "image" && right.type === "image") return true;
  return isText(left) || isText(right);
}

function backgroundForElement(element: SceneElement, allElements: SceneElement[], direction: DesignDirection): string {
  const center = {
    x: element.frame.x + element.frame.width / 2,
    y: element.frame.y + element.frame.height / 2,
  };
  const elementZ = element.zIndex ?? 0;
  const containingShapes = allElements.filter((candidate) => {
    if (candidate.type !== "shape" || (candidate.zIndex ?? 0) > elementZ) return false;
    return center.x >= candidate.frame.x
      && center.x <= candidate.frame.x + candidate.frame.width
      && center.y >= candidate.frame.y
      && center.y <= candidate.frame.y + candidate.frame.height;
  });
  const nearestShape = containingShapes.at(-1);
  return nearestShape ? tokenColor(nearestShape.fill, direction, direction.tokens.surface) : direction.tokens.background;
}

export function runDeterministicQa(document: SceneDocument, options: QaOptions = {}): QaReport {
  const direction = selectedDirection(document);
  const minimums = { ...DEFAULT_MINIMUMS, ...options.minimumFontSizes };
  const minimumContrast = options.minimumContrastRatio ?? 4.5;
  const supportedFonts = new Set((options.supportedFonts ?? ["Arial", "Aptos", "Georgia", "Noto Sans CJK SC", "Noto Serif CJK SC"]).map((font) => font.toLowerCase()));
  const issues: QaIssue[] = [];

  for (const scene of document.scenes.slice().sort((left, right) => left.order - right.order)) {
    for (const element of scene.elements) {
      if (isOutOfBounds(element.frame, document.canvas)) {
        issues.push(issue("layout.out_of_bounds", "error", scene.id, [element.id], `Element ${element.id} exceeds the ${document.canvas.width}×${document.canvas.height} canvas.`));
      }

      if (isText(element)) {
        const minimum = minimums[element.role as keyof typeof minimums];
        if (minimum !== undefined && (element.fontSize ?? 0) < minimum) {
          issues.push(issue("readability.font_size", "warning", scene.id, [element.id], `Element ${element.id} uses ${element.fontSize ?? 0}px; ${element.role} requires at least ${minimum}px.`));
        }
        const foreground = tokenColor(element.color, direction, direction.tokens.text);
        const ratio = contrastRatio(foreground, backgroundForElement(element, scene.elements, direction));
        if (ratio !== null && ratio < minimumContrast) {
          issues.push(issue("readability.contrast", "warning", scene.id, [element.id], `Element ${element.id} contrast is ${ratio.toFixed(2)}:1; minimum is ${minimumContrast.toFixed(1)}:1.`));
        }
      }

      if (element.type === "image") {
        if (!element.assetSrc?.trim()) {
          issues.push(issue("asset.missing", "error", scene.id, [element.id], `Image ${element.id} has no assetSrc.`));
        }
        if (!element.alt?.trim()) {
          issues.push(issue("asset.alt_missing", "warning", scene.id, [element.id], `Image ${element.id} has no alternative text.`));
        }
      }
    }

    const ordered = scene.elements.slice().sort((left, right) => left.id.localeCompare(right.id));
    for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
      const left = ordered[leftIndex];
      if (!left) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
        const right = ordered[rightIndex];
        if (!right || !collisionRelevant(left, right)) continue;
        const ratio = overlapRatio(left.frame, right.frame);
        if (ratio >= 0.08) {
          issues.push(issue("layout.collision", "error", scene.id, [left.id, right.id], `Elements ${left.id} and ${right.id} overlap ${(ratio * 100).toFixed(1)}% of the smaller frame.`));
        }
      }
    }
  }

  const fontStacks = [direction.tokens.fontFamily, direction.tokens.headingFamily];
  for (const font of new Set(fontStacks.map(primaryFont))) {
    if (!supportedFonts.has(font.toLowerCase())) {
      issues.push(issue("export.font_fallback", "warning", "document", [], `Primary font ${font} is not in the configured export font set; PowerPoint may substitute it.`));
    }
  }

  for (const degradation of options.exportDegradations ?? []) {
    const category = degradation.outputMode === "raster" ? "export.raster_fallback" : "export.omitted";
    issues.push(issue(category, degradation.outputMode === "omitted" ? "error" : "warning", degradation.sceneId, [degradation.elementId], degradation.reason));
  }

  issues.sort((left, right) => left.issueId.localeCompare(right.issueId));
  return {
    documentId: document.documentId,
    schemaVersion: document.schemaVersion,
    deterministic: true,
    summary: {
      blocker: issues.filter((item) => item.severity === "blocker").length,
      error: issues.filter((item) => item.severity === "error").length,
      warning: issues.filter((item) => item.severity === "warning").length,
      note: issues.filter((item) => item.severity === "note").length,
      total: issues.length,
    },
    issues,
  };
}
