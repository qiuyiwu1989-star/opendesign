import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertSceneDocument, validateRevision, type Revision, type SceneDocument } from "@opendesign/studio-contracts";

const SAFE_ID = /^[a-z][a-z0-9_-]{2,63}$/;

export type ProjectSummary = { projectId: string; title: string; sceneCount: number; updatedAt: string };
export type StoredRevision = { revision: Revision; document: SceneDocument };

export class LocalProjectStore {
  constructor(readonly rootDirectory: string) {}

  private projectPath(projectId: string): string {
    if (!SAFE_ID.test(projectId)) throw new Error("Invalid project ID");
    return join(this.rootDirectory, "projects", `${projectId}.json`);
  }

  private revisionDirectory(projectId: string): string {
    if (!SAFE_ID.test(projectId)) throw new Error("Invalid project ID");
    return join(this.rootDirectory, "revisions", projectId);
  }

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

  async write(projectId: string, document: SceneDocument): Promise<SceneDocument> {
    if (document.documentId !== projectId) throw new Error("Project ID does not match documentId");
    assertSceneDocument(document);
    const destination = this.projectPath(projectId);
    await mkdir(join(this.rootDirectory, "projects"), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
    return structuredClone(document);
  }

  async create(document: SceneDocument): Promise<SceneDocument> {
    if (await this.read(document.documentId)) throw new Error("Project already exists");
    await this.appendRevision(document.documentId, document, { reason: "initial", patches: [] });
    return structuredClone(document);
  }

  async appendRevision(
    projectId: string,
    document: SceneDocument,
    input: { reason: Revision["reason"]; patches: Revision["patches"] },
  ): Promise<StoredRevision> {
    if (document.documentId !== projectId) throw new Error("Project ID does not match documentId");
    assertSceneDocument(document);
    const previous = (await this.listRevisions(projectId)).at(0);
    const revision: Revision = {
      revisionId: `revision_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
      parentRevisionId: previous?.revision.revisionId ?? null,
      createdAt: new Date().toISOString(),
      reason: input.reason,
      patches: input.patches.map((patch) => ({ ...patch })),
    };
    const validation = validateRevision(revision);
    if (!validation.ok) throw new Error(`Invalid revision: ${validation.issues.map((issue) => issue.message).join("; ")}`);
    const stored: StoredRevision = { revision, document: structuredClone(document) };
    const directory = this.revisionDirectory(projectId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${revision.revisionId}.json`), `${JSON.stringify(stored, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await this.write(projectId, document);
    return stored;
  }

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
}
