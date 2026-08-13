import { describe, expect, it } from "vitest";
import fixture from "@opendesign/studio-contracts/fixtures/proposal-v0";
import type { SceneDocument } from "@opendesign/studio-contracts";
import { changeZIndex, constrainFrame, createHistory, deleteScene, duplicateScene, pushHistory, redoHistory, regenerationConflicts, undoHistory } from "./editor-model";

const document = fixture as unknown as SceneDocument;

describe("Studio Foundation v0.2 editor model", () => {
  it("constrains movement and resize to the 1600x900 canvas", () => {
    expect(constrainFrame({ x: -20, y: 880, width: 1800, height: 10 }, document.canvas)).toEqual({ x: 0, y: 876, width: 1600, height: 24 });
  });

  it("supports stable undo and redo snapshots", () => {
    const next = { ...document, title: "changed" };
    const history = pushHistory(createHistory(document), next);
    expect(undoHistory(history).present).toBe(document);
    expect(redoHistory(undoHistory(history)).present).toBe(next);
  });

  it("duplicates and deletes scenes with unique element IDs and normalized order", () => {
    const duplicated = duplicateScene(document, "scene_cover", "test");
    expect(duplicated.scenes).toHaveLength(document.scenes.length + 1);
    expect(duplicated.scenes[1]?.id).toBe("scene_cover_copy_test");
    expect(duplicated.scenes[1]?.elements[0]?.id).toBe("cover_eyebrow_copy_test");
    expect(deleteScene(duplicated, "scene_cover").scenes.map((scene) => scene.order)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("changes layer order without allowing a negative z-index", () => {
    const lowered = changeZIndex(document, "cover_title", -1);
    expect(lowered.scenes[0]?.elements.find((element) => element.id === "cover_title")?.zIndex).toBe(0);
  });

  it("reports incoming AI changes without mutating the current draft", () => {
    const incoming = { ...document, scenes: document.scenes.map((scene, index) => index ? scene : { ...scene, elements: scene.elements.map((element, elementIndex) => elementIndex ? element : { ...element, content: "AI changed" }) }) };
    expect(regenerationConflicts(document, incoming).changedElementIds).toContain("cover_eyebrow");
    expect(document.scenes[0]?.elements[0]?.content).toBe("OPENDESIGN STUDIO · V0");
  });
});
