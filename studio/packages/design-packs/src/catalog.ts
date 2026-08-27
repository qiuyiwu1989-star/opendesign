import type { DesignDirection, DesignPack } from "@opendesign/studio-contracts";

import editorialStoryGraphics from "../packs/editorial-story-graphics-cn.json" with { type: "json" };
import executiveProposal from "../packs/executive-proposal-cn.json" with { type: "json" };
import researchKeynote from "../packs/research-keynote-cn.json" with { type: "json" };

// These files are validated by the package test/build gate. This browser entry
// intentionally avoids shipping Ajv and the contract schemas with the editor.
export const designPacks = [executiveProposal, researchKeynote, editorialStoryGraphics] as unknown as readonly DesignPack[];

export function getDesignPack(id: string, version?: string): DesignPack | undefined {
  return designPacks.find((pack) => pack.id === id && (version === undefined || pack.version === version));
}

export function copyAgentAnnotation(id: string, version?: string): string | undefined {
  return getDesignPack(id, version)?.agentAnnotation.copyText;
}

export function designDirections(selectedPackId: string): DesignDirection[] {
  return designPacks.map((pack) => ({
    id: `direction_${pack.id}`,
    name: pack.name,
    stance: pack.id === selectedPackId ? "primary" : "alternate",
    rationale: pack.summary,
    referenceSlug: pack.id,
    referenceVersion: pack.version,
    tokens: structuredClone(pack.tokens),
  }));
}
