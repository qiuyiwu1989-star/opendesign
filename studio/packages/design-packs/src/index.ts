import { validateDesignPack, type ContractIssue, type DesignPack } from "@opendesign/studio-contracts";

import editorialStoryGraphics from "../packs/editorial-story-graphics-cn.json" with { type: "json" };
import executiveProposal from "../packs/executive-proposal-cn.json" with { type: "json" };
import researchKeynote from "../packs/research-keynote-cn.json" with { type: "json" };

export type DesignPackValidation =
  | { ok: true; value: DesignPack; issues: readonly [] }
  | { ok: false; issues: readonly ContractIssue[] };

function semanticIssues(pack: DesignPack): ContractIssue[] {
  const issues: ContractIssue[] = [];
  const pageRoleIds = new Set(pack.pageRoles.map((role) => role.id));
  const narrativeOrders = new Set<number>();
  const ruleIds = new Set<string>();
  const slotIds = new Set<string>();

  pack.narrativeArc.forEach((step, index) => {
    if (narrativeOrders.has(step.order)) {
      issues.push({ source: "semantic", code: "narrative.order_duplicate", path: `/narrativeArc/${index}/order`, message: `Narrative order ${step.order} is duplicated.` });
    }
    narrativeOrders.add(step.order);
    if (!pageRoleIds.has(step.role)) {
      issues.push({ source: "semantic", code: "narrative.role_missing", path: `/narrativeArc/${index}/role`, message: `Narrative role ${step.role} has no pageRoles entry.` });
    }
  });

  for (let expected = 1; expected <= pack.narrativeArc.length; expected += 1) {
    if (!narrativeOrders.has(expected)) {
      issues.push({ source: "semantic", code: "narrative.order_gap", path: "/narrativeArc", message: `Narrative orders must be continuous; missing ${expected}.` });
    }
  }

  pack.pageRoles.forEach((role, roleIndex) => {
    role.contentSlots.forEach((slot, slotIndex) => {
      const scopedId = `${role.id}:${slot.id}`;
      if (slotIds.has(scopedId)) {
        issues.push({ source: "semantic", code: "page_role.slot_duplicate", path: `/pageRoles/${roleIndex}/contentSlots/${slotIndex}/id`, message: `Slot ${slot.id} is duplicated within ${role.id}.` });
      }
      slotIds.add(scopedId);
    });
  });

  pack.qaRules.forEach((rule, index) => {
    if (ruleIds.has(rule.id)) {
      issues.push({ source: "semantic", code: "qa_rule.id_duplicate", path: `/qaRules/${index}/id`, message: `QA rule ${rule.id} is duplicated.` });
    }
    ruleIds.add(rule.id);
  });

  if (!pack.agentAnnotation.copyText.includes(`${pack.id}@${pack.version}`)) {
    issues.push({ source: "semantic", code: "agent_annotation.pin_missing", path: "/agentAnnotation/copyText", message: "Agent annotation must include the exact pack id and version pin." });
  }

  if (pack.agentAnnotation.requiredCapabilities.length === 0) {
    issues.push({ source: "semantic", code: "agent_annotation.capabilities_empty", path: "/agentAnnotation/requiredCapabilities", message: "Agent annotation must declare at least one editor capability." });
  }

  return issues;
}

export function validatePack(value: unknown): DesignPackValidation {
  const contractResult = validateDesignPack(value);
  if (!contractResult.ok) return contractResult;
  const issues = semanticIssues(contractResult.value);
  return issues.length === 0 ? { ok: true, value: contractResult.value, issues: [] } : { ok: false, issues };
}

export function assertPack(value: unknown): asserts value is DesignPack {
  const result = validatePack(value);
  if (!result.ok) {
    throw new Error(`Design Pack is invalid:\n${result.issues.map((issue) => `${issue.path} ${issue.code}: ${issue.message}`).join("\n")}`);
  }
}

const rawPacks: unknown[] = [executiveProposal, researchKeynote, editorialStoryGraphics];

export const designPacks: readonly DesignPack[] = rawPacks.map((pack) => {
  assertPack(pack);
  return pack;
});

export function getDesignPack(id: string, version?: string): DesignPack | undefined {
  return designPacks.find((pack) => pack.id === id && (version === undefined || pack.version === version));
}

export function copyAgentAnnotation(id: string, version?: string): string | undefined {
  return getDesignPack(id, version)?.agentAnnotation.copyText;
}
