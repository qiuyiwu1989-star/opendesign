import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { replayReviewLedger, type ReviewLedger } from "@opendesign/studio-publishing";
import { parseSessionScope, type SessionScope } from "./public-session.js";

const SAFE_ID = /^[a-z][a-z0-9_-]{2,63}$/u;

export class LocalReviewStore {
  constructor(readonly rootDirectory: string) {}

  private path(scope: SessionScope, reviewId: string): string {
    if (!SAFE_ID.test(reviewId)) throw new Error("Invalid review ID");
    return join(this.rootDirectory, "sessions", parseSessionScope(scope), "reviews", `${reviewId}.json`);
  }

  async read(scope: SessionScope, reviewId: string): Promise<ReviewLedger | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path(scope, reviewId), "utf8")) as ReviewLedger;
      replayReviewLedger(parsed);
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write(scope: SessionScope, ledger: ReviewLedger): Promise<ReviewLedger> {
    replayReviewLedger(ledger);
    const destination = this.path(scope, ledger.reviewId);
    await mkdir(join(this.rootDirectory, "sessions", parseSessionScope(scope), "reviews"), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
    return structuredClone(ledger);
  }
}
