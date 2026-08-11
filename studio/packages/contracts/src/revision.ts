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

function patchElement(element: SceneElement, patch: ScenePatch): SceneElement {
  if (!element.editable) {
    throw new PatchApplicationError(`Element \"${element.id}\" is not editable`, patch);
  }

  if (patch.field === "content" && !["text", "metric", "quote"].includes(element.type)) {
    throw new PatchApplicationError(`Field \"content\" cannot be patched on ${element.type} element \"${element.id}\"`, patch);
  }
  if ((patch.field === "assetSrc" || patch.field === "alt") && element.type !== "image") {
    throw new PatchApplicationError(`Field \"${patch.field}\" can only be patched on image elements`, patch);
  }
  if ((patch.field === "color" || patch.field === "fontSize") && !["text", "metric", "quote"].includes(element.type)) {
    throw new PatchApplicationError(`Field \"${patch.field}\" can only be patched on text-like elements`, patch);
  }
  if (patch.field === "fontSize" && (!Number.isFinite(patch.value) || patch.value < 8 || patch.value > 240)) {
    throw new PatchApplicationError("fontSize patches must stay between 8 and 240", patch);
  }

  return { ...element, [patch.field]: patch.value };
}

export function applyPatch(document: SceneDocument, patch: ScenePatch): SceneDocument {
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
    patches: input.patches.map((patch) => ({ ...patch })),
  };
  const revisionResult = validateRevision(revision);
  if (!revisionResult.ok) {
    throw new RevisionContractError(revisionResult.issues);
  }

  const revisedDocument = revision.patches.reduce(applyPatch, document);
  assertSceneDocument(revisedDocument);

  return { document: revisedDocument, revision };
}
