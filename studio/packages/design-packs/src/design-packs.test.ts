import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateDesignPack } from "@opendesign/studio-contracts";

import { copyAgentAnnotation, designPacks, getDesignPack, validatePack } from "./index.js";

test("all bundled Design Packs satisfy the central contract and semantic rules", () => {
  assert.equal(designPacks.length, 3);
  for (const pack of designPacks) {
    assert.equal(validateDesignPack(pack).ok, true, pack.id);
    assert.equal(validatePack(pack).ok, true, pack.id);
  }
});

test("the initial catalog covers three distinct production jobs", () => {
  assert.deepEqual(designPacks.map((pack) => pack.id).sort(), [
    "editorial-story-graphics-cn",
    "executive-proposal-cn",
    "research-keynote-cn",
  ]);
  assert.equal(new Set(designPacks.map((pack) => pack.tokens.accent)).size, 3);
});

test("agent annotations are pinned and machine-readable", () => {
  for (const pack of designPacks) {
    assert.equal(pack.agentAnnotation.contractVersion, "0.1.0");
    assert.match(pack.agentAnnotation.copyText, new RegExp(`${pack.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}@${pack.version.replaceAll(".", "\\.")}`));
    assert.ok(pack.agentAnnotation.requiredCapabilities.includes("text"));
    assert.ok(pack.agentAnnotation.requiredCapabilities.includes("frame"));
    assert.equal(copyAgentAnnotation(pack.id, pack.version), pack.agentAnnotation.copyText);
  }
});

test("semantic validation catches missing role references", () => {
  const broken = structuredClone(designPacks[0]!);
  broken.narrativeArc[0]!.role = "missing-role";
  const result = validatePack(broken);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === "narrative.role_missing"));
});

test("Golden Task is local-only and pins every direction to a bundled pack", async () => {
  const raw = await readFile(new URL("../../../fixtures/golden-task/design-studio-brief-v01.json", import.meta.url), "utf8");
  const task = JSON.parse(raw) as {
    sources: Array<{ status: string; sourceRef: string }>;
    directions: Array<{ pack: { id: string; version: string }; selectionRationale: string }>;
    selectedDirectionId: string;
  };

  assert.ok(task.sources.every((source) => source.status === "snapshot" && source.sourceRef.startsWith("fixture://")));
  assert.equal(task.directions.length, 3);
  assert.equal(new Set(task.directions.map((direction) => direction.pack.id)).size, 3);
  for (const direction of task.directions) {
    assert.ok(getDesignPack(direction.pack.id, direction.pack.version));
    assert.ok(direction.selectionRationale.length >= 20);
  }
  assert.equal(task.selectedDirectionId, "direction-proposal");
});
