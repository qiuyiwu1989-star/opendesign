import { applyPatch, assertSceneDocument, type SceneDocument, type SceneElement, type ScenePatch } from "@opendesign/studio-contracts";

export const CHANGE_ADAPTER_CONTRACT_VERSION = "0.1.0" as const;
export const CHANGE_CANDIDATE_VERSION = "0.1.0" as const;

export type ChangeTarget = { kind: "scene"; sceneId: string } | { kind: "element"; sceneId: string; elementId: string };

export type ChangeRequest = {
  contractVersion: typeof CHANGE_ADAPTER_CONTRACT_VERSION;
  requestId: string;
  projectId: string;
  baseRevisionId: string;
  document: SceneDocument;
  instruction: string;
  target: ChangeTarget;
  signal?: AbortSignal;
};

export type ChangeProviderRequest = Omit<ChangeRequest, "signal"> & { signal: AbortSignal };
export type ChangeProvider = {
  providerId: string;
  model: string;
  propose(request: ChangeProviderRequest): Promise<{ candidate: unknown; providerRequestId?: string }>;
};

export type ChangeDiff = { elementId: string; field: ScenePatch["field"]; before: unknown; after: unknown };
export type ChangeAccepted = {
  contractVersion: typeof CHANGE_ADAPTER_CONTRACT_VERSION;
  requestId: string;
  status: "accepted";
  provider: { id: string; model: string; requestId?: string };
  baseRevisionId: string;
  target: ChangeTarget;
  rationale: string;
  patches: ScenePatch[];
  diffs: ChangeDiff[];
  proposedDocument: SceneDocument;
  notPublished: true;
};
export type ChangeErrorCode = "request.invalid" | "request.aborted" | "provider.timeout" | "provider.failure" | "candidate.too_large" | "candidate.invalid" | "candidate.out_of_scope" | "candidate.rejected";
export type ChangeRejected = {
  contractVersion: typeof CHANGE_ADAPTER_CONTRACT_VERSION;
  requestId: string;
  status: "rejected";
  provider: { id: string; model: string };
  error: { code: ChangeErrorCode; stage: "request" | "provider" | "candidate" | "scene-ir"; retryable: boolean; message: string };
};
export type ChangeResult = ChangeAccepted | ChangeRejected;
export type ChangeAdapterOptions = { timeoutMs?: number; maxCandidateBytes?: number; maxPatches?: number };

const SAFE_ID = /^[a-z][a-z0-9_-]{2,63}$/u;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const SAFE_COLOR = /^#[0-9a-f]{6}$/iu;
const SAFE_ASSET = /^(?:asset:\/\/[A-Za-z0-9._/-]{1,240}|\/api\/assets\/[A-Za-z0-9._/-]{1,240})$/u;
const PATCH_FIELDS = new Set(["content", "assetSrc", "alt", "color", "fontFamily", "fontSize", "fontWeight", "lineHeight", "zIndex", "imageFit", "frame", "focalPoint"]);

function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"); }
function size(value: unknown): number { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Number.POSITIVE_INFINITY; } }
function safeMessage(value: unknown, fallback: string): string {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : fallback;
  return message.replace(/((?:api[_-]?key|authorization|bearer|token|secret|password)\s*[:=]\s*)[^\s,;]+/giu, "$1[redacted]").replace(/\b(?:sk|AKIA|AKID)[-_A-Za-z0-9]{12,}\b/gu, "[redacted]").replace(/[\r\n\t]+/gu, " ").slice(0, 240) || fallback;
}
function reject(requestId: string, provider: ChangeProvider, code: ChangeErrorCode, stage: ChangeRejected["error"]["stage"], message: string, retryable = false): ChangeRejected {
  return { contractVersion: CHANGE_ADAPTER_CONTRACT_VERSION, requestId, status: "rejected", provider: { id: provider.providerId, model: provider.model }, error: { code, stage, retryable, message } };
}
function targetElements(document: SceneDocument, target: ChangeTarget): SceneElement[] {
  const scene = document.scenes.find((item) => item.id === target.sceneId);
  if (!scene) return [];
  return target.kind === "scene" ? scene.elements : scene.elements.filter((item) => item.id === target.elementId);
}
function parseTarget(value: unknown, document: SceneDocument): ChangeTarget | null {
  if (!isObject(value) || (value.kind !== "scene" && value.kind !== "element") || typeof value.sceneId !== "string" || !SAFE_ID.test(value.sceneId)) return null;
  if (value.kind === "scene" && exactKeys(value, ["kind", "sceneId"]) && document.scenes.some((scene) => scene.id === value.sceneId)) return { kind: "scene", sceneId: value.sceneId };
  if (value.kind === "element" && exactKeys(value, ["kind", "sceneId", "elementId"]) && typeof value.elementId === "string" && SAFE_ID.test(value.elementId)
    && document.scenes.some((scene) => scene.id === value.sceneId && scene.elements.some((element) => element.id === value.elementId))) return { kind: "element", sceneId: value.sceneId, elementId: value.elementId };
  return null;
}
function parsePatch(value: unknown): ScenePatch | null {
  if (!isObject(value) || !exactKeys(value, ["elementId", "field", "value"]) || typeof value.elementId !== "string" || !SAFE_ID.test(value.elementId) || typeof value.field !== "string" || !PATCH_FIELDS.has(value.field)) return null;
  const base = { elementId: value.elementId };
  if (["content", "alt"].includes(value.field) && typeof value.value === "string" && [...value.value].length <= 5_000) return { ...base, field: value.field as "content" | "alt", value: value.value };
  if (value.field === "assetSrc" && typeof value.value === "string" && SAFE_ASSET.test(value.value)) return { ...base, field: "assetSrc", value: value.value };
  if (value.field === "color" && typeof value.value === "string" && SAFE_COLOR.test(value.value)) return { ...base, field: "color", value: value.value };
  if (value.field === "fontFamily" && typeof value.value === "string" && value.value.trim().length > 0 && [...value.value].length <= 160) return { ...base, field: "fontFamily", value: value.value };
  if (value.field === "imageFit" && ["contain", "cover", "stretch"].includes(String(value.value))) return { ...base, field: "imageFit", value: value.value as "contain" | "cover" | "stretch" };
  if (["fontSize", "fontWeight", "lineHeight", "zIndex"].includes(value.field) && typeof value.value === "number" && Number.isFinite(value.value)) return { ...base, field: value.field as "fontSize" | "fontWeight" | "lineHeight" | "zIndex", value: value.value };
  if (value.field === "frame" && isObject(value.value) && exactKeys(value.value, ["x", "y", "width", "height"]) && [value.value.x, value.value.y, value.value.width, value.value.height].every((item) => typeof item === "number" && Number.isFinite(item))) return { ...base, field: "frame", value: { x: Number(value.value.x), y: Number(value.value.y), width: Number(value.value.width), height: Number(value.value.height) } };
  if (value.field === "focalPoint" && isObject(value.value) && exactKeys(value.value, ["x", "y"]) && [value.value.x, value.value.y].every((item) => typeof item === "number" && Number.isFinite(item))) return { ...base, field: "focalPoint", value: { x: Number(value.value.x), y: Number(value.value.y) } };
  return null;
}

export async function proposeChangeWithModel(provider: ChangeProvider, request: ChangeRequest, options: ChangeAdapterOptions = {}): Promise<ChangeResult> {
  const requestId = typeof request?.requestId === "string" ? request.requestId : "invalid_request";
  if (request?.contractVersion !== CHANGE_ADAPTER_CONTRACT_VERSION || !SAFE_ID.test(requestId) || !SAFE_ID.test(provider.providerId) || !SAFE_MODEL.test(provider.model)) return reject(requestId, provider, "request.invalid", "request", "Change request or provider identity is invalid");
  try { assertSceneDocument(request.document); } catch { return reject(requestId, provider, "request.invalid", "request", "Base Scene IR is invalid"); }
  const target = parseTarget(request.target, request.document);
  if (request.projectId !== request.document.documentId || !SAFE_ID.test(request.baseRevisionId) || typeof request.instruction !== "string" || [...request.instruction.trim()].length < 4 || [...request.instruction].length > 800 || !target) return reject(requestId, provider, "request.invalid", "request", "Project, revision, instruction, or target is invalid");
  if (request.signal?.aborted) return reject(requestId, provider, "request.aborted", "request", "Change request was aborted");
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxCandidateBytes ?? 64 * 1024;
  const maxPatches = options.maxPatches ?? 12;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 || !Number.isSafeInteger(maxPatches) || maxPatches < 1 || maxPatches > 24) return reject(requestId, provider, "request.invalid", "request", "Adapter limits are invalid");
  const controller = new AbortController();
  const onAbort = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("change provider timeout")), timeoutMs);
  let response: { candidate: unknown; providerRequestId?: string };
  try {
    const { signal: _signal, ...requestWithoutSignal } = request;
    response = await Promise.race([
      provider.propose({ ...structuredClone(requestWithoutSignal), signal: controller.signal }),
      new Promise<never>((_resolve, rejectPromise) => controller.signal.addEventListener("abort", () => rejectPromise(controller.signal.reason), { once: true })),
    ]);
  } catch (error) {
    const timedOut = !request.signal?.aborted && controller.signal.aborted;
    const aborted = request.signal?.aborted === true;
    return reject(requestId, provider, timedOut ? "provider.timeout" : aborted ? "request.aborted" : "provider.failure", "provider", timedOut ? "Change provider timed out" : aborted ? "Change request was aborted" : "Change provider failed", timedOut);
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onAbort);
  }
  if (size(response.candidate) > maxBytes) return reject(requestId, provider, "candidate.too_large", "candidate", "Change candidate exceeds the configured byte limit");
  if (!isObject(response.candidate) || !exactKeys(response.candidate, ["candidateVersion", "rationale", "patches"]) || response.candidate.candidateVersion !== CHANGE_CANDIDATE_VERSION || typeof response.candidate.rationale !== "string" || [...response.candidate.rationale.trim()].length < 4 || [...response.candidate.rationale].length > 500 || !Array.isArray(response.candidate.patches) || response.candidate.patches.length < 1 || response.candidate.patches.length > maxPatches) return reject(requestId, provider, "candidate.invalid", "candidate", "Change candidate schema is invalid");
  const patches = response.candidate.patches.map(parsePatch);
  if (patches.some((patch) => patch === null)) return reject(requestId, provider, "candidate.invalid", "candidate", "Change candidate contains an invalid patch");
  const validPatches = patches as ScenePatch[];
  const allowedIds = new Set(targetElements(request.document, target).map((element) => element.id));
  if (validPatches.some((patch) => !("elementId" in patch) || !allowedIds.has(patch.elementId))) return reject(requestId, provider, "candidate.out_of_scope", "candidate", "Change candidate attempted to edit outside its target");
  const patchKeys = validPatches.map((patch) => `${"elementId" in patch ? patch.elementId : "direction"}:${patch.field}`);
  if (new Set(patchKeys).size !== patchKeys.length) return reject(requestId, provider, "candidate.invalid", "candidate", "Change candidate contains duplicate field patches");
  let proposedDocument = structuredClone(request.document);
  const diffs: ChangeDiff[] = [];
  try {
    for (const patch of validPatches) {
      if (!("elementId" in patch)) throw new Error("Direction patches are outside the local target contract");
      const before = proposedDocument.scenes.flatMap((scene) => scene.elements).find((element) => element.id === patch.elementId)?.[patch.field as keyof SceneElement];
      proposedDocument = applyPatch(proposedDocument, patch);
      diffs.push({ elementId: patch.elementId, field: patch.field, before: structuredClone(before), after: structuredClone(patch.value) });
    }
    assertSceneDocument(proposedDocument);
  } catch (error) {
    return reject(requestId, provider, "candidate.rejected", "scene-ir", safeMessage(error, "Change candidate failed Scene IR validation"));
  }
  const providerRequestId = typeof response.providerRequestId === "string" ? response.providerRequestId.replace(/[^A-Za-z0-9_.:-]/gu, "").slice(0, 128) : "";
  return { contractVersion: CHANGE_ADAPTER_CONTRACT_VERSION, requestId, status: "accepted", provider: { id: provider.providerId, model: provider.model, ...(providerRequestId ? { requestId: providerRequestId } : {}) }, baseRevisionId: request.baseRevisionId, target, rationale: response.candidate.rationale.trim(), patches: structuredClone(validPatches), diffs, proposedDocument, notPublished: true };
}

export function createFixtureChangeProvider(candidate: unknown): ChangeProvider {
  return { providerId: "fixture", model: "change-fixture-v1", propose: async () => ({ candidate: structuredClone(candidate), providerRequestId: "fixture-request" }) };
}
