import type {
  Revision,
  RevisionInput,
  RevisionResult,
  SceneDocument,
  SceneElement,
  ScenePatch,
} from "./index.js";
import {
  assertSceneDocument,
  validateRevision,
  type ContractIssue,
} from "./validation.js";

export class PatchApplicationError extends Error {
  readonly patch: ScenePatch;

  constructor(message: string, patch: ScenePatch) {
    super(message);
    this.name = "PatchApplicationError";
    this.patch = patch;
  }
}

export class RevisionContractError extends Error {
  readonly issues: readonly ContractIssue[];

  constructor(issues: readonly ContractIssue[]) {
    super(`Revision metadata is invalid: ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "RevisionContractError";
    this.issues = issues;
  }
}

function copyPatch(patch: ScenePatch): ScenePatch {
  if (patch.field === "frame") return { ...patch, value: { ...patch.value } };
  if (patch.field === "focalPoint") return { ...patch, value: { ...patch.value } };
  return { ...patch };
}

function patchElement(element: SceneElement, patch: ScenePatch): SceneElement {
  if (!element.editable) {
    throw new PatchApplicationError(`Element \"${element.id}\" is not editable`, patch);
  }

  const capabilityByField = {
    content: "text",
    fontFamily: "typography",
    fontWeight: "typography",
    fontSize: "typography",
    lineHeight: "typography",
    color: "typography",
    assetSrc: "asset",
    alt: "asset",
    imageFit: "asset",
    focalPoint: "asset",
    frame: "frame",
    zIndex: "order",
  } as const;
  if ("elementId" in patch && element.editableCapabilities !== undefined) {
    const requiredCapability = capabilityByField[patch.field];
    if (!element.editableCapabilities.includes(requiredCapability)) {
      throw new PatchApplicationError(`Field \"${patch.field}\" requires the \"${requiredCapability}\" capability`, patch);
    }
  }

  if (patch.field === "content" && !["text", "metric", "quote"].includes(element.type)) {
    throw new PatchApplicationError(`Field \"content\" cannot be patched on ${element.type} element \"${element.id}\"`, patch);
  }
  if (["assetSrc", "alt", "imageFit", "focalPoint"].includes(patch.field) && element.type !== "image") {
    throw new PatchApplicationError(`Field \"${patch.field}\" can only be patched on image elements`, patch);
  }
  if (["color", "fontSize", "fontFamily", "fontWeight", "lineHeight"].includes(patch.field) && !["text", "metric", "quote"].includes(element.type)) {
    throw new PatchApplicationError(`Field \"${patch.field}\" can only be patched on text-like elements`, patch);
  }
  if (patch.field === "fontSize" && (!Number.isFinite(patch.value) || patch.value < 8 || patch.value > 240)) {
    throw new PatchApplicationError("fontSize patches must stay between 8 and 240", patch);
  }

  if (patch.field === "fontWeight" && (!Number.isInteger(patch.value) || patch.value < 100 || patch.value > 900)) {
    throw new PatchApplicationError("fontWeight patches must be integers between 100 and 900", patch);
  }
  if (patch.field === "lineHeight" && (!Number.isFinite(patch.value) || patch.value < 0.5 || patch.value > 4)) {
    throw new PatchApplicationError("lineHeight patches must stay between 0.5 and 4", patch);
  }
  if (patch.field === "zIndex" && (!Number.isInteger(patch.value) || patch.value < 0)) {
    throw new PatchApplicationError("zIndex patches must be non-negative integers", patch);
  }
  if (patch.field === "fontFamily" && !patch.value.trim()) {
    throw new PatchApplicationError("fontFamily patches cannot be empty", patch);
  }
  if (patch.field === "focalPoint" && (![patch.value.x, patch.value.y].every((value) => Number.isFinite(value) && value >= 0 && value <= 1))) {
    throw new PatchApplicationError("focalPoint coordinates must stay between 0 and 1", patch);
  }
  if (patch.field === "frame") {
    const { x, y, width, height } = patch.value;
    if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) {
      throw new PatchApplicationError("frame patches require finite, non-negative coordinates and positive dimensions", patch);
    }
  }

  const value = patch.field === "frame" || patch.field === "focalPoint"
    ? { ...patch.value }
    : patch.value;
  return { ...element, [patch.field]: value };
}

export function applyPatch(document: SceneDocument, patch: ScenePatch): SceneDocument {
  if ("directionId" in patch) {
    const directionIndex = document.directions.findIndex((direction) => direction.id === patch.directionId);
    if (directionIndex < 0) throw new PatchApplicationError(`Direction "${patch.directionId}" was not found`, patch);
    if (!patch.value.trim()) throw new PatchApplicationError(`${patch.field} patches cannot be empty`, patch);
    const directions = document.directions.slice();
    const direction = directions[directionIndex]!;
    directions[directionIndex] = { ...direction, tokens: { ...direction.tokens, [patch.field]: patch.value } };
    return { ...document, directions };
  }
  let matchCount = 0;
  let changedSceneIndex = -1;
  let changedElementIndex = -1;

  document.scenes.forEach((scene, sceneIndex) => {
    scene.elements.forEach((element, elementIndex) => {
      if (element.id === patch.elementId) {
        matchCount += 1;
        changedSceneIndex = sceneIndex;
        changedElementIndex = elementIndex;
      }
    });
  });

  if (matchCount === 0) {
    throw new PatchApplicationError(`Element \"${patch.elementId}\" was not found`, patch);
  }
  if (matchCount > 1) {
    throw new PatchApplicationError(`Element ID \"${patch.elementId}\" is ambiguous`, patch);
  }

  const targetScene = document.scenes[changedSceneIndex];
  const targetElement = targetScene?.elements[changedElementIndex];
  if (targetScene === undefined || targetElement === undefined) {
    throw new PatchApplicationError(`Element \"${patch.elementId}\" could not be resolved`, patch);
  }

  const nextElements = targetScene.elements.slice();
  nextElements[changedElementIndex] = patchElement(targetElement, patch);
  const nextScenes = document.scenes.slice();
  nextScenes[changedSceneIndex] = { ...targetScene, elements: nextElements };

  return { ...document, scenes: nextScenes };
}

export function createRevision(document: SceneDocument, input: RevisionInput): RevisionResult {
  const revision: Revision = {
    revisionId: input.revisionId,
    parentRevisionId: input.parentRevisionId,
    createdAt: input.createdAt,
    reason: input.reason,
    patches: input.patches.map(copyPatch),
  };
  const revisionResult = validateRevision(revision);
  if (!revisionResult.ok) {
    throw new RevisionContractError(revisionResult.issues);
  }

  const revisedDocument = revision.patches.reduce(applyPatch, document);
  assertSceneDocument(revisedDocument);

  return { document: revisedDocument, revision };
}
