import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertSceneDocument, validateRevision, type Revision, type SceneDocument } from "@opendesign/studio-contracts";
import {
  assertPublicSessionQuota,
  DEFAULT_PUBLIC_SESSION_QUOTA,
  isPublicSessionExpired,
  parseSessionScope,
  type PublicSessionClock,
  type PublicSessionQuota,
  type PublicSessionQuotaDelta,
  type PublicSessionQuotaUsage,
  type PublicSessionRecord,
  type SessionScope,
} from "./public-session.js";

const SAFE_ID = /^[a-z][a-z0-9_-]{2,63}$/;

export type ProjectSummary = { projectId: string; title: string; sceneCount: number; updatedAt: string };
export type StoredRevision = { revision: Revision; document: SceneDocument };

export class RevisionDriftError extends Error {
  readonly code = "revision_drift";
  constructor(readonly expectedRevisionId: string, readonly currentRevisionId: string | null) {
    super(`Revision drift: expected ${expectedRevisionId}, current ${currentRevisionId ?? "missing"}`);
    this.name = "RevisionDriftError";
  }
}

export type SessionCleanupSummary = {
  scope: SessionScope;
  expiredAt: string;
  projectCount: number;
  revisionCount: number;
  assetBytes: number;
  exportCount: number;
  action: "delete" | "dry-run";
  removed: boolean;
};

export type SessionCleanupResult = {
  scanned: number;
  expired: number;
  removed: number;
  skippedUnsafe: number;
  summaries: SessionCleanupSummary[];
};

export type SessionCleanupOptions = {
  clock?: PublicSessionClock;
  dryRun?: boolean;
  onSummary?: (summary: SessionCleanupSummary) => void | Promise<void>;
};

export type LocalStoreRandom = { uuid(): string };

const defaultStoreRandom: LocalStoreRandom = { uuid: () => randomUUID() };

async function atomicJsonWrite(destination: string, value: unknown, random: LocalStoreRandom = defaultStoreRandom): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${random.uuid()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function directoryNames(directory: string): Promise<string[]> {
  try { return await readdir(directory); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function recursiveFileBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += await recursiveFileBytes(path);
    else if (entry.isFile()) total += (await stat(path)).size;
  }
  return total;
}

export class LocalProjectStore {
  private readonly scopeLocks = new Map<SessionScope, Promise<void>>();

  constructor(
    readonly rootDirectory: string,
    readonly quota: PublicSessionQuota = DEFAULT_PUBLIC_SESSION_QUOTA,
    readonly clock: PublicSessionClock = { now: () => new Date() },
    readonly random: LocalStoreRandom = defaultStoreRandom,
  ) {}

  private scopeRoot(scope: SessionScope): string {
    return join(this.rootDirectory, "sessions", parseSessionScope(scope));
  }

  private async withScopeLock<T>(scope: SessionScope, operation: () => Promise<T>): Promise<T> {
    const previous = this.scopeLocks.get(scope) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.scopeLocks.set(scope, queued);
    await previous;
    try { return await operation(); } finally {
      release();
      if (this.scopeLocks.get(scope) === queued) this.scopeLocks.delete(scope);
    }
  }

  private projectPath(projectId: string): string {
    if (!SAFE_ID.test(projectId)) throw new Error("Invalid project ID");
    return join(this.rootDirectory, "projects", `${projectId}.json`);
  }

  private revisionDirectory(projectId: string): string {
    if (!SAFE_ID.test(projectId)) throw new Error("Invalid project ID");
    return join(this.rootDirectory, "revisions", projectId);
  }

  private ownerProjectPath(scope: SessionScope, projectId: string): string {
    if (!SAFE_ID.test(projectId)) throw new Error("Invalid project ID");
    return join(this.scopeRoot(scope), "projects", `${projectId}.json`);
  }

  private ownerRevisionDirectory(scope: SessionScope, projectId: string): string {
    if (!SAFE_ID.test(projectId)) throw new Error("Invalid project ID");
    return join(this.scopeRoot(scope), "revisions", projectId);
  }

  /** Demo-fixture compatibility only. Never use for anonymous requests. */
  async list(): Promise<ProjectSummary[]> {
    const directory = join(this.rootDirectory, "projects");
    let names: string[];
    try { names = await readdir(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const projects = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      const projectId = name.slice(0, -5);
      const document = await this.read(projectId);
      if (!document) return null;
      const metadata = await stat(this.projectPath(projectId));
      return { projectId, title: document.title, sceneCount: document.scenes.length, updatedAt: metadata.mtime.toISOString() };
    }));
    return projects.filter((item): item is ProjectSummary => item !== null).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  /** Demo-fixture compatibility only. Never use for anonymous requests. */
  async read(projectId: string): Promise<SceneDocument | null> {
    try {
      const parsed = JSON.parse(await readFile(this.projectPath(projectId), "utf8")) as unknown;
      assertSceneDocument(parsed);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /** Demo-fixture compatibility only. Never use for anonymous requests. */
  async write(projectId: string, document: SceneDocument): Promise<SceneDocument> {
    if (document.documentId !== projectId) throw new Error("Project ID does not match documentId");
    assertSceneDocument(document);
    const destination = this.projectPath(projectId);
    await atomicJsonWrite(destination, document, this.random);
    return structuredClone(document);
  }

  /** Demo-fixture compatibility only. Never use for anonymous requests. */
  async create(document: SceneDocument): Promise<SceneDocument> {
    if (await this.read(document.documentId)) throw new Error("Project already exists");
    await this.appendRevision(document.documentId, document, { reason: "initial", patches: [] });
    return structuredClone(document);
  }

  /** Demo-fixture compatibility only. Never use for anonymous requests. */
  async appendRevision(
    projectId: string,
    document: SceneDocument,
    input: { reason: Revision["reason"]; patches: Revision["patches"] },
  ): Promise<StoredRevision> {
    if (document.documentId !== projectId) throw new Error("Project ID does not match documentId");
    assertSceneDocument(document);
    const previous = (await this.listRevisions(projectId)).at(0);
    const now = this.clock.now();
    const revision: Revision = {
      revisionId: `revision_${now.getTime().toString(36)}_${this.random.uuid().slice(0, 8)}`,
      parentRevisionId: previous?.revision.revisionId ?? null,
      createdAt: now.toISOString(),
      reason: input.reason,
      patches: input.patches.map((patch) => ({ ...patch })),
    };
    const validation = validateRevision(revision);
    if (!validation.ok) throw new Error(`Invalid revision: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    const stored: StoredRevision = { revision, document: structuredClone(document) };
    const directory = this.revisionDirectory(projectId);
    await atomicJsonWrite(join(directory, `${revision.revisionId}.json`), stored, this.random);
    await this.write(projectId, document);
    return stored;
  }

  /** Demo-fixture compatibility only. Never use for anonymous requests. */
  async listRevisions(projectId: string): Promise<StoredRevision[]> {
    const directory = this.revisionDirectory(projectId);
    let names: string[];
    try { names = await readdir(directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const revisions = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      const parsed = JSON.parse(await readFile(join(directory, name), "utf8")) as StoredRevision;
      assertSceneDocument(parsed.document);
      return parsed;
    }));
    return revisions.sort((left, right) => {
      const byDate = right.revision.createdAt.localeCompare(left.revision.createdAt);
      return byDate === 0 ? right.revision.revisionId.localeCompare(left.revision.revisionId) : byDate;
    });
  }

  async writeSessionRecord(record: PublicSessionRecord): Promise<void> {
    const scope = parseSessionScope(record.scope);
    if (isPublicSessionExpired(record, this.clock.now())) throw new Error("Cannot persist an expired public session");
    await this.withScopeLock(scope, () => atomicJsonWrite(join(this.scopeRoot(scope), "session.json"), record, this.random));
  }

  async readSessionRecord(scope: SessionScope): Promise<PublicSessionRecord | null> {
    try {
      const parsed = JSON.parse(await readFile(join(this.scopeRoot(scope), "session.json"), "utf8")) as PublicSessionRecord;
      if (parsed.version !== 1 || parseSessionScope(parsed.scope) !== scope) throw new Error("Invalid session metadata");
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async listForOwner(scope: SessionScope): Promise<ProjectSummary[]> {
    const directory = join(this.scopeRoot(scope), "projects");
    const projects = await Promise.all((await directoryNames(directory)).filter((name) => name.endsWith(".json")).map(async (name) => {
      const projectId = name.slice(0, -5);
      if (!SAFE_ID.test(projectId)) return null;
      const document = await this.readForOwner(scope, projectId);
      if (!document) return null;
      const metadata = await stat(this.ownerProjectPath(scope, projectId));
      return { projectId, title: document.title, sceneCount: document.scenes.length, updatedAt: metadata.mtime.toISOString() };
    }));
    return projects.filter((item): item is ProjectSummary => item !== null).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async readForOwner(scope: SessionScope, projectId: string): Promise<SceneDocument | null> {
    try {
      const parsed = JSON.parse(await readFile(this.ownerProjectPath(scope, projectId), "utf8")) as unknown;
      assertSceneDocument(parsed);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async writeForOwner(scope: SessionScope, projectId: string, document: SceneDocument): Promise<SceneDocument> {
    if (document.documentId !== projectId) throw new Error("Project ID does not match documentId");
    assertSceneDocument(document);
    await this.withScopeLock(scope, async () => {
      const existing = await this.readForOwner(scope, projectId);
      if (!existing) await this.assertOwnerQuota(scope, { projects: 1 });
      await atomicJsonWrite(this.ownerProjectPath(scope, projectId), document, this.random);
    });
    return structuredClone(document);
  }

  async createForOwner(scope: SessionScope, document: SceneDocument): Promise<SceneDocument> {
    assertSceneDocument(document);
    return this.withScopeLock(scope, async () => {
      if (await this.readForOwner(scope, document.documentId)) throw new Error("Project already exists");
      await this.assertOwnerQuota(scope, { projects: 1, revisions: 1 });
      await this.appendRevisionForOwnerUnlocked(scope, document.documentId, document, { reason: "initial", patches: [] });
      return structuredClone(document);
    });
  }

  async appendRevisionForOwner(
    scope: SessionScope,
    projectId: string,
    document: SceneDocument,
    input: { reason: Revision["reason"]; patches: Revision["patches"] },
  ): Promise<StoredRevision> {
    return this.withScopeLock(scope, async () => {
      await this.assertOwnerQuota(scope, { revisions: 1, projects: (await this.readForOwner(scope, projectId)) ? 0 : 1 });
      return this.appendRevisionForOwnerUnlocked(scope, projectId, document, input);
    });
  }

  async currentRevisionForOwner(scope: SessionScope, projectId: string): Promise<StoredRevision | null> {
    return this.withScopeLock(scope, async () => (await this.listRevisionsForOwner(scope, projectId))[0] ?? null);
  }

  async appendRevisionForOwnerIfCurrent(
    scope: SessionScope,
    projectId: string,
    expectedRevisionId: string,
    document: SceneDocument,
    input: { reason: Revision["reason"]; patches: Revision["patches"] },
  ): Promise<StoredRevision> {
    return this.withScopeLock(scope, async () => {
      const current = (await this.listRevisionsForOwner(scope, projectId))[0];
      if (!current || current.revision.revisionId !== expectedRevisionId) throw new RevisionDriftError(expectedRevisionId, current?.revision.revisionId ?? null);
      await this.assertOwnerQuota(scope, { revisions: 1 });
      return this.appendRevisionForOwnerUnlocked(scope, projectId, document, input);
    });
  }

  private async appendRevisionForOwnerUnlocked(
    scope: SessionScope,
    projectId: string,
    document: SceneDocument,
    input: { reason: Revision["reason"]; patches: Revision["patches"] },
  ): Promise<StoredRevision> {
    if (document.documentId !== projectId) throw new Error("Project ID does not match documentId");
    assertSceneDocument(document);
    const previous = (await this.listRevisionsForOwner(scope, projectId)).at(0);
    const now = this.clock.now();
    const revision: Revision = {
      revisionId: `revision_${now.getTime().toString(36)}_${this.random.uuid().slice(0, 8)}`,
      parentRevisionId: previous?.revision.revisionId ?? null,
      createdAt: now.toISOString(),
      reason: input.reason,
      patches: input.patches.map((patch) => ({ ...patch })),
    };
    const validation = validateRevision(revision);
    if (!validation.ok) throw new Error(`Invalid revision: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    const stored: StoredRevision = { revision, document: structuredClone(document) };
    await atomicJsonWrite(join(this.ownerRevisionDirectory(scope, projectId), `${revision.revisionId}.json`), stored, this.random);
    await atomicJsonWrite(this.ownerProjectPath(scope, projectId), document, this.random);
    return stored;
  }

  async listRevisionsForOwner(scope: SessionScope, projectId: string): Promise<StoredRevision[]> {
    const directory = this.ownerRevisionDirectory(scope, projectId);
    const revisions = await Promise.all((await directoryNames(directory)).filter((name) => name.endsWith(".json")).map(async (name) => {
      const parsed = JSON.parse(await readFile(join(directory, name), "utf8")) as StoredRevision;
      assertSceneDocument(parsed.document);
      return parsed;
    }));
    return revisions.sort((left, right) => {
      const byDate = right.revision.createdAt.localeCompare(left.revision.createdAt);
      return byDate === 0 ? right.revision.revisionId.localeCompare(left.revision.revisionId) : byDate;
    });
  }

  async usageForOwner(scope: SessionScope, additional: Partial<Pick<PublicSessionQuotaUsage, "runningJobs">> = {}): Promise<PublicSessionQuotaUsage> {
    const scopeDirectory = this.scopeRoot(scope);
    const projects = (await directoryNames(join(scopeDirectory, "projects"))).filter((name) => name.endsWith(".json")).length;
    let revisions = 0;
    for (const projectId of await directoryNames(join(scopeDirectory, "revisions"))) {
      if (!SAFE_ID.test(projectId)) continue;
      revisions += (await directoryNames(join(scopeDirectory, "revisions", projectId))).filter((name) => name.endsWith(".json")).length;
    }
    const exports = (await readdir(join(scopeDirectory, "exports"), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })).filter((entry) => entry.isDirectory() && /^export_[a-z0-9_]+$/.test(entry.name)).length;
    return {
      projects,
      revisions,
      assetBytes: await recursiveFileBytes(join(scopeDirectory, "assets")),
      exports,
      runningJobs: additional.runningJobs ?? 0,
    };
  }

  async assertOwnerQuota(
    scope: SessionScope,
    delta: PublicSessionQuotaDelta,
    additional: Partial<Pick<PublicSessionQuotaUsage, "runningJobs">> = {},
  ): Promise<void> {
    assertPublicSessionQuota(await this.usageForOwner(scope, additional), delta, this.quota);
  }

  async withOwnerQuota<T>(
    scope: SessionScope,
    delta: PublicSessionQuotaDelta,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.withScopeLock(scope, async () => {
      await this.assertOwnerQuota(scope, delta);
      return operation();
    });
  }
}

export async function cleanupExpiredSessionScopes(
  rootDirectory: string,
  options: SessionCleanupOptions = {},
): Promise<SessionCleanupResult> {
  const clock = options.clock ?? { now: () => new Date() };
  const sessionsDirectory = join(rootDirectory, "sessions");
  const result: SessionCleanupResult = { scanned: 0, expired: 0, removed: 0, skippedUnsafe: 0, summaries: [] };
  const entries = await readdir(sessionsDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    let scope: SessionScope;
    try { scope = parseSessionScope(entry.name); } catch { result.skippedUnsafe += 1; continue; }
    if (!entry.isDirectory() || entry.isSymbolicLink()) { result.skippedUnsafe += 1; continue; }
    const scopeDirectory = join(sessionsDirectory, scope);
    result.scanned += 1;
    let record: PublicSessionRecord;
    try {
      const metadata = await lstat(scopeDirectory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("Unsafe session scope type");
      record = JSON.parse(await readFile(join(scopeDirectory, "session.json"), "utf8")) as PublicSessionRecord;
      if (record.version !== 1 || parseSessionScope(record.scope) !== scope) throw new Error("Session metadata scope mismatch");
    } catch {
      result.skippedUnsafe += 1;
      continue;
    }
    if (!isPublicSessionExpired(record, clock.now())) continue;
    result.expired += 1;
    const store = new LocalProjectStore(rootDirectory, DEFAULT_PUBLIC_SESSION_QUOTA, clock);
    const usage = await store.usageForOwner(scope);
    const summary: SessionCleanupSummary = {
      scope,
      expiredAt: new Date(Math.min(Date.parse(record.expiresAt), Date.parse(record.maximumExpiresAt))).toISOString(),
      projectCount: usage.projects,
      revisionCount: usage.revisions,
      assetBytes: usage.assetBytes,
      exportCount: usage.exports,
      action: options.dryRun ? "dry-run" : "delete",
      removed: false,
    };
    // Persist/emit the intended action before deletion so an interrupted cleanup remains auditable.
    await options.onSummary?.(structuredClone(summary));
    result.summaries.push(summary);
    if (!options.dryRun) {
      await rm(scopeDirectory, { recursive: true, force: false });
      summary.removed = true;
      result.removed += 1;
    }
  }
  return result;
}
