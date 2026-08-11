import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertSceneDocument, type SceneDocument } from "@opendesign/studio-contracts";

const SAFE_ID = /^[a-z][a-z0-9_-]{2,63}$/;

export class LocalProjectStore {
  constructor(readonly rootDirectory: string) {}

  private projectPath(projectId: string): string {
    if (!SAFE_ID.test(projectId)) throw new Error("Invalid project ID");
    return join(this.rootDirectory, "projects", `${projectId}.json`);
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
}
