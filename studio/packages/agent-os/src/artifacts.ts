import type { ArtifactEnvelope, ArtifactType, ExecutionPlan } from "./types.js";
import { AgentContractError, validateArtifactEnvelope, validateExecutionPlan } from "./validation.js";

export type ArtifactRegistry = {
  workOrderId: string;
  plan: ExecutionPlan;
  artifacts: readonly ArtifactEnvelope[];
};

export type ArtifactRegistryErrorCode =
  | "artifact.conflict"
  | "artifact.cross_work_order"
  | "artifact.plan_mismatch"
  | "artifact.stage_mismatch"
  | "artifact.revision_conflict"
  | "artifact.pack_mismatch";

export class ArtifactRegistryError extends Error {
  constructor(readonly code: ArtifactRegistryErrorCode, message: string) {
    super(message);
    this.name = "ArtifactRegistryError";
  }
}

function jsonSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSnapshot);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, jsonSnapshot((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(jsonSnapshot(left)) === JSON.stringify(jsonSnapshot(right));
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function snapshot<T>(value: T): T {
  return freezeDeep(structuredClone(value));
}

export function createArtifactRegistry(workOrderId: string, plan: ExecutionPlan): ArtifactRegistry {
  const validation = validateExecutionPlan(plan);
  if (!validation.ok) throw new AgentContractError("Execution Plan", validation.issues);
  if (plan.workOrderId !== workOrderId) throw new ArtifactRegistryError("artifact.cross_work_order", "Execution Plan belongs to another Work Order");
  return snapshot({ workOrderId, plan, artifacts: [] });
}

export function appendArtifact(registry: ArtifactRegistry, artifact: ArtifactEnvelope): ArtifactRegistry {
  const validation = validateArtifactEnvelope(artifact);
  if (!validation.ok) throw new AgentContractError("Artifact Envelope", validation.issues);
  if (artifact.workOrderId !== registry.workOrderId) throw new ArtifactRegistryError("artifact.cross_work_order", "Artifact belongs to another Work Order");
  if (artifact.planId !== registry.plan.planId) throw new ArtifactRegistryError("artifact.plan_mismatch", "Artifact belongs to another Execution Plan");
  const stage = registry.plan.stages.find((candidate) => candidate.stageId === artifact.stageId);
  if (!stage || !stage.expectedArtifactTypes.includes(artifact.artifactType)) throw new ArtifactRegistryError("artifact.stage_mismatch", "Artifact type is not declared by its stage");
  if (artifact.designPack.id !== registry.plan.designPack.id || artifact.designPack.version !== registry.plan.designPack.version) throw new ArtifactRegistryError("artifact.pack_mismatch", "Artifact Design Pack differs from the pinned plan");
  const sameId = registry.artifacts.find((candidate) => candidate.artifactId === artifact.artifactId);
  if (sameId) {
    if (sameJson(sameId, artifact)) return registry;
    throw new ArtifactRegistryError("artifact.conflict", `Artifact ID ${artifact.artifactId} already has different content`);
  }
  const sameRevision = registry.artifacts.find((candidate) => candidate.artifactType === artifact.artifactType && candidate.revisionId === artifact.revisionId);
  if (sameRevision) throw new ArtifactRegistryError("artifact.revision_conflict", `Revision ${artifact.revisionId} already exists for ${artifact.artifactType}`);
  return snapshot({ ...registry, artifacts: [...registry.artifacts, artifact] });
}

export function latestArtifactByType(registry: Pick<ArtifactRegistry, "artifacts">, artifactType: ArtifactType): ArtifactEnvelope | null {
  return registry.artifacts.filter((artifact) => artifact.artifactType === artifactType).at(-1) ?? null;
}

export function findArtifact(registry: Pick<ArtifactRegistry, "artifacts">, artifactId: string): ArtifactEnvelope | null {
  return registry.artifacts.find((artifact) => artifact.artifactId === artifactId) ?? null;
}
