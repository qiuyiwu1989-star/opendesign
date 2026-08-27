import type { Frame, SceneDocument, SceneElement } from "@opendesign/studio-contracts";

export type ImageFit = "cover" | "contain" | "stretch";
export type FocalPoint = { x: number; y: number };
export type EditorElement = SceneElement & {
  fontFamily?: string;
  lineHeight?: number;
  imageFit?: ImageFit;
  focalPoint?: FocalPoint;
};

export type DraftHistory<T> = { past: T[]; present: T; future: T[] };

export function createHistory<T>(present: T): DraftHistory<T> {
  return { past: [], present, future: [] };
}

export function pushHistory<T>(history: DraftHistory<T>, next: T): DraftHistory<T> {
  if (Object.is(history.present, next)) return history;
  return { past: [...history.past, history.present], present: next, future: [] };
}

export function undoHistory<T>(history: DraftHistory<T>): DraftHistory<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redoHistory<T>(history: DraftHistory<T>): DraftHistory<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future: history.future.slice(1) };
}

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

export function constrainFrame(frame: Frame, canvas: { width: number; height: number }, minimumSize = 24): Frame {
  const width = clamp(frame.width, minimumSize, canvas.width);
  const height = clamp(frame.height, minimumSize, canvas.height);
  return {
    x: clamp(frame.x, 0, canvas.width - width),
    y: clamp(frame.y, 0, canvas.height - height),
    width,
    height,
  };
}

export function updateElement(document: SceneDocument, elementId: string, update: (element: EditorElement) => EditorElement): SceneDocument {
  return {
    ...document,
    scenes: document.scenes.map((scene) => ({
      ...scene,
      elements: scene.elements.map((element) => element.id === elementId ? update(element as EditorElement) : element),
    })),
  };
}

export function duplicateScene(document: SceneDocument, sceneId: string, nonce = Date.now().toString(36)): SceneDocument {
  const index = document.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return document;
  const source = document.scenes[index]!;
  const duplicateId = `${source.id}_copy_${nonce}`;
  const duplicate = {
    ...source,
    id: duplicateId,
    title: `${source.title}副本`,
    elements: source.elements.map((element) => ({ ...element, id: `${element.id}_copy_${nonce}`, frame: { ...element.frame } })),
  };
  const scenes = [...document.scenes.slice(0, index + 1), duplicate, ...document.scenes.slice(index + 1)]
    .map((scene, order) => ({ ...scene, order: order + 1 }));
  return { ...document, scenes };
}

export function deleteScene(document: SceneDocument, sceneId: string): SceneDocument {
  if (document.scenes.length <= 1) return document;
  const scenes = document.scenes.filter((scene) => scene.id !== sceneId).map((scene, order) => ({ ...scene, order: order + 1 }));
  return scenes.length === document.scenes.length ? document : { ...document, scenes };
}

export function changeZIndex(document: SceneDocument, elementId: string, delta: -1 | 1): SceneDocument {
  const target = document.scenes.flatMap((scene) => scene.elements).find((element) => element.id === elementId);
  if (!target) return document;
  return updateElement(document, elementId, (element) => ({ ...element, zIndex: Math.max(0, (target.zIndex ?? 0) + delta) }));
}

export function regenerationConflicts(current: SceneDocument, incoming: SceneDocument) {
  const currentElements = new Map(current.scenes.flatMap((scene) => scene.elements.map((element) => [element.id, element])));
  const changed = incoming.scenes.flatMap((scene) => scene.elements).filter((element) => {
    const existing = currentElements.get(element.id);
    return existing && JSON.stringify(existing) !== JSON.stringify(element);
  });
  return { changedElementIds: changed.map((element) => element.id), incomingSceneCount: incoming.scenes.length };
}
