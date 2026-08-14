import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyPatch, assertSceneDocument, validateRevision, type Revision, type SceneDocument, type ScenePatch } from "@opendesign/studio-contracts";
import type { SessionScope } from "./public-session.js";
import { LocalProjectStore, RevisionDriftError } from "./storage.js";

const SAFE_ID = /^[a-z][a-z0-9_-]{2,63}$/u;
const CANDIDATE_ID = /^change_[a-z0-9]{8,59}$/u;
const SCOPE = /^(?:scope_)?[a-f0-9]{64}$/u;

export type AgentChangeTarget =
  | { kind: "scene"; sceneId: string }
  | { kind: "element"; sceneId: string; elementId: string };

export type AgentChangeDiff = {
  elementId: string;
  field: "content";
  before: string;
  after: string;
};

export type AgentChangeCandidate = {
  candidateId: string;
  projectId: string;
  baseRevisionId: string;
  createdAt: string;
  status: "proposed" | "accepted" | "rejected" | "conflicted";
  target: AgentChangeTarget;
  instruction: string;
  rationale: string;
  patches: ScenePatch[];
  diffs: AgentChangeDiff[];
  proposedDocument: SceneDocument;
  decision?: { kind: "accepted" | "rejected" | "conflicted"; occurredAt: string; reason: string; revision?: Revision };
  notPublished: true;
};

type PersistedCandidate = AgentChangeCandidate & { persistenceVersion: 1; scopeHash: string };

export class AgentChangeNotFoundError extends Error {
  constructor() { super("Agent change candidate not found"); this.name = "AgentChangeNotFoundError"; }
}

export class AgentChangeConflictError extends Error {
  readonly code = "revision_drift";
  constructor(message: string) { super(message); this.name = "AgentChangeConflictError"; }
}

export class AgentChangeInstructionError extends Error {
  readonly code = "unsupported_instruction";
  constructor(message: string) { super(message); this.name = "AgentChangeInstructionError"; }
}

export class AgentChangeLimitError extends Error {
  readonly code = "agent_change_limit";
  constructor(readonly limit: number) { super(`This anonymous space can keep at most ${limit} Agent change candidates`); this.name = "AgentChangeLimitError"; }
}

export type AgentChangeManagerOptions = {
  rootDirectory: string;
  store: LocalProjectStore;
  now?: () => Date;
  id?: () => string;
  maxPerScope?: number;
};

function normalizeInstruction(value: unknown): { instruction: string; replacement: string } {
  if (typeof value !== "string") throw new AgentChangeInstructionError("Instruction is required");
  const instruction = value.replace(/\s+/gu, " ").trim();
  if ([...instruction].length < 4 || [...instruction].length > 800) throw new AgentChangeInstructionError("Instruction must contain between 4 and 800 characters");
  const match = instruction.match(/(?:改成|改为)\s*[：:]\s*(.+)$/iu) ?? instruction.match(/replace\s+with\s*:\s*(.+)$/iu);
  const replacement = match?.[1]?.trim();
  if (!replacement) throw new AgentChangeInstructionError("Use an explicit instruction such as “改成：新的文字”");
  if ([...replacement].length > 500) throw new AgentChangeInstructionError("Replacement text cannot exceed 500 characters");
  return { instruction, replacement };
}

function normalizeTarget(value: unknown): AgentChangeTarget {
  if (!value || typeof value !== "object") throw new AgentChangeInstructionError("A scene or element target is required");
  const target = value as Partial<AgentChangeTarget> & { sceneId?: unknown; elementId?: unknown };
  if ((target.kind !== "scene" && target.kind !== "element") || typeof target.sceneId !== "string" || !SAFE_ID.test(target.sceneId)) throw new AgentChangeInstructionError("Target scene is invalid");
  if (target.kind === "element") {
    if (typeof target.elementId !== "string" || !SAFE_ID.test(target.elementId)) throw new AgentChangeInstructionError("Target element is invalid");
    return { kind: "element", sceneId: target.sceneId, elementId: target.elementId };
  }
  return { kind: "scene", sceneId: target.sceneId };
}

function propose(document: SceneDocument, target: AgentChangeTarget, replacement: string): { patch: ScenePatch; diff: AgentChangeDiff; document: SceneDocument } {
  const scene = document.scenes.find((item) => item.id === target.sceneId);
  if (!scene) throw new AgentChangeInstructionError("Target scene does not exist");
  const element = target.kind === "element"
    ? scene.elements.find((item) => item.id === target.elementId)
    : scene.elements.find((item) => item.role === "title");
  if (!element || typeof element.content !== "string") throw new AgentChangeInstructionError("Target does not contain editable text");
  if (!element.editable || (element.editableCapabilities && !element.editableCapabilities.includes("text"))) throw new AgentChangeInstructionError("Target text is not editable");
  const patch: ScenePatch = { elementId: element.id, field: "content", value: replacement };
  const proposedDocument = applyPatch(document, patch);
  assertSceneDocument(proposedDocument);
  return { patch, diff: { elementId: element.id, field: "content", before: element.content, after: replacement }, document: proposedDocument };
}

function publicCandidate(record: PersistedCandidate): AgentChangeCandidate {
  const { persistenceVersion: _version, scopeHash: _scope, ...candidate } = record;
  return structuredClone(candidate);
}

function isPersistedCandidate(value: unknown, scopeHash: string, projectId: string): value is PersistedCandidate {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PersistedCandidate>;
  if (record.persistenceVersion !== 1 || record.scopeHash !== scopeHash || record.projectId !== projectId
    || typeof record.candidateId !== "string" || !CANDIDATE_ID.test(record.candidateId)
    || typeof record.baseRevisionId !== "string" || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))
    || !["proposed", "accepted", "rejected", "conflicted"].includes(String(record.status))
    || typeof record.instruction !== "string" || typeof record.rationale !== "string" || record.notPublished !== true
    || !Array.isArray(record.patches) || record.patches.length !== 1 || !Array.isArray(record.diffs) || record.diffs.length !== 1
    || !record.proposedDocument || !record.target) return false;
  try {
    assertSceneDocument(record.proposedDocument);
    const diff = record.diffs[0];
    const patch = record.patches[0];
    if (!diff || !patch || diff.field !== "content" || patch.field !== "content" || diff.elementId !== patch.elementId || diff.after !== patch.value) return false;
    if (record.status === "proposed") return record.decision === undefined;
    if (!record.decision || record.decision.kind !== record.status || typeof record.decision.reason !== "string" || !Number.isFinite(Date.parse(record.decision.occurredAt))) return false;
    if (record.status === "accepted") return Boolean(record.decision.revision && validateRevision(record.decision.revision).ok && record.decision.revision.reason === "regenerate");
    return record.decision.revision === undefined;
  } catch {
    return false;
  }
}

export class AgentChangeManager {
  readonly #now: () => Date;
  readonly #id: () => string;
  readonly #limit: number;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(readonly options: AgentChangeManagerOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? (() => `change_${randomUUID().replaceAll("-", "")}`);
    this.#limit = options.maxPerScope ?? 50;
    if (!Number.isSafeInteger(this.#limit) || this.#limit < 1 || this.#limit > 200) throw new TypeError("maxPerScope must be between 1 and 200");
  }

  async create(scope: SessionScope, projectId: string, input: { instruction: unknown; target: unknown }): Promise<AgentChangeCandidate> {
    this.assertPath(scope, projectId);
    return this.withLock(`${scope}:${projectId}`, async () => {
      if (await this.countForScope(scope) >= this.#limit) throw new AgentChangeLimitError(this.#limit);
      const current = await this.options.store.currentRevisionForOwner(scope, projectId);
      if (!current) throw new AgentChangeNotFoundError();
      const { instruction, replacement } = normalizeInstruction(input.instruction);
      const target = normalizeTarget(input.target);
      const proposal = propose(current.document, target, replacement);
      const candidateId = this.#id();
      if (!CANDIDATE_ID.test(candidateId)) throw new TypeError("Injected candidate ID is invalid");
      const record: PersistedCandidate = {
        persistenceVersion: 1,
        scopeHash: scope,
        candidateId,
        projectId,
        baseRevisionId: current.revision.revisionId,
        createdAt: this.#now().toISOString(),
        status: "proposed",
        target,
        instruction,
        rationale: target.kind === "scene" ? "按页面目标定位标题元素，并生成一个可撤销的文字 patch。" : "只修改用户明确选中的文字元素，其余 Scene IR 保持不变。",
        patches: [proposal.patch],
        diffs: [proposal.diff],
        proposedDocument: proposal.document,
        notPublished: true,
      };
      await this.persist(record);
      return publicCandidate(record);
    });
  }

  async list(scope: SessionScope, projectId: string): Promise<AgentChangeCandidate[]> {
    this.assertPath(scope, projectId);
    const directory = this.directory(scope, projectId);
    const records: PersistedCandidate[] = [];
    for (const name of await readdir(directory).catch(() => [])) {
      if (!/^change_[a-z0-9]{8,59}\.json$/u.test(name)) continue;
      try {
        const parsed = JSON.parse(await readFile(join(directory, name), "utf8")) as unknown;
        if (isPersistedCandidate(parsed, scope, projectId) && `${parsed.candidateId}.json` === name) records.push(parsed);
      } catch {
        // A malformed or partial candidate never enters the public projection.
      }
    }
    return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(publicCandidate);
  }

  async accept(scope: SessionScope, projectId: string, candidateId: string, reason: unknown): Promise<{ candidate: AgentChangeCandidate; document: SceneDocument; revision: Revision }> {
    return this.decide(scope, projectId, candidateId, "accepted", reason) as Promise<{ candidate: AgentChangeCandidate; document: SceneDocument; revision: Revision }>;
  }

  async reject(scope: SessionScope, projectId: string, candidateId: string, reason: unknown): Promise<{ candidate: AgentChangeCandidate }> {
    return this.decide(scope, projectId, candidateId, "rejected", reason) as Promise<{ candidate: AgentChangeCandidate }>;
  }

  private async decide(scope: SessionScope, projectId: string, candidateId: string, decision: "accepted" | "rejected", rawReason: unknown): Promise<{ candidate: AgentChangeCandidate; document?: SceneDocument; revision?: Revision }> {
    this.assertPath(scope, projectId, candidateId);
    const reason = typeof rawReason === "string" ? rawReason.replace(/\s+/gu, " ").trim() : "";
    if ([...reason].length < 4 || [...reason].length > 500) throw new AgentChangeInstructionError("Decision reason must contain between 4 and 500 characters");
    return this.withLock(`${scope}:${projectId}:${candidateId}`, async () => {
      const record = await this.read(scope, projectId, candidateId);
      if (!record) throw new AgentChangeNotFoundError();
      if (record.status === decision) {
        const candidate = publicCandidate(record);
        if (decision === "accepted") return { candidate, document: candidate.proposedDocument, revision: structuredClone(record.decision!.revision!) };
        return { candidate };
      }
      if (record.status !== "proposed") throw new AgentChangeConflictError(`Candidate is already ${record.status}`);
      const occurredAt = this.#now().toISOString();
      if (decision === "rejected") {
        record.status = "rejected";
        record.decision = { kind: "rejected", occurredAt, reason };
        await this.persist(record);
        return { candidate: publicCandidate(record) };
      }
      const base = await this.options.store.currentRevisionForOwner(scope, projectId);
      if (base?.revision.revisionId === record.baseRevisionId) {
        let reconstructed = base.document;
        for (const patch of record.patches) reconstructed = applyPatch(reconstructed, patch);
        const before = base.document.scenes.flatMap((scene) => scene.elements).find((element) => element.id === record.diffs[0]!.elementId)?.content;
        if (before !== record.diffs[0]!.before || JSON.stringify(reconstructed) !== JSON.stringify(record.proposedDocument)) {
          throw new AgentChangeInstructionError("Candidate snapshot does not match its base revision and patches");
        }
      }
      try {
        const stored = await this.options.store.appendRevisionForOwnerIfCurrent(scope, projectId, record.baseRevisionId, record.proposedDocument, { reason: "regenerate", patches: record.patches });
        record.status = "accepted";
        record.decision = { kind: "accepted", occurredAt, reason, revision: structuredClone(stored.revision) };
        await this.persist(record);
        return { candidate: publicCandidate(record), document: stored.document, revision: stored.revision };
      } catch (error) {
        if (!(error instanceof RevisionDriftError)) throw error;
        const current = await this.options.store.currentRevisionForOwner(scope, projectId);
        if (current && current.revision.parentRevisionId === record.baseRevisionId
          && JSON.stringify(current.document) === JSON.stringify(record.proposedDocument)
          && JSON.stringify(current.revision.patches) === JSON.stringify(record.patches)) {
          record.status = "accepted";
          record.decision = { kind: "accepted", occurredAt, reason, revision: structuredClone(current.revision) };
          await this.persist(record);
          return { candidate: publicCandidate(record), document: current.document, revision: current.revision };
        }
        record.status = "conflicted";
        record.decision = { kind: "conflicted", occurredAt, reason: "Current project revision changed after this candidate was created." };
        await this.persist(record);
        throw new AgentChangeConflictError(error.message);
      }
    });
  }

  private async read(scope: SessionScope, projectId: string, candidateId: string): Promise<PersistedCandidate | null> {
    try {
      const parsed = JSON.parse(await readFile(join(this.directory(scope, projectId), `${candidateId}.json`), "utf8")) as unknown;
      return isPersistedCandidate(parsed, scope, projectId) ? parsed : null;
    } catch {
      return null;
    }
  }

  private directory(scope: SessionScope, projectId: string): string {
    return join(this.options.rootDirectory, "sessions", scope, "agent-changes", projectId);
  }

  private assertPath(scope: SessionScope, projectId: string, candidateId?: string): void {
    if (!SCOPE.test(scope) || !SAFE_ID.test(projectId) || (candidateId !== undefined && !CANDIDATE_ID.test(candidateId))) throw new TypeError("Agent change path is invalid");
  }

  private async countForScope(scope: SessionScope): Promise<number> {
    const root = join(this.options.rootDirectory, "sessions", scope, "agent-changes");
    let count = 0;
    for (const projectId of await readdir(root).catch(() => [])) {
      if (!SAFE_ID.test(projectId)) continue;
      count += (await readdir(join(root, projectId)).catch(() => [])).filter((name) => CANDIDATE_ID.test(name.replace(/\.json$/u, ""))).length;
    }
    return count;
  }

  private async persist(record: PersistedCandidate): Promise<void> {
    const directory = this.directory(record.scopeHash as SessionScope, record.projectId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, `${record.candidateId}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.#locks.set(key, queued);
    await previous;
    try { return await operation(); } finally { release(); if (this.#locks.get(key) === queued) this.#locks.delete(key); }
  }
}
