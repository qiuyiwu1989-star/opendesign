import { describe, expect, it } from "vitest";
import { OperationsRepository } from "./repository.js";
import { readSyncEvidence } from "./sync-evidence.js";
import type { DatabaseClient } from "./types.js";

describe("readSyncEvidence", () => {
  it("keeps unconfigured locations explicitly unknown", async () => {
    const client: DatabaseClient = {
      query: async <T>() => ({
        rows: [{ revision: "db-revision", observed_at: "2026-08-12T00:00:00.000Z", detail: "read view" }] as T[],
        rowCount: 1,
      }),
    };
    const envelope = await readSyncEvidence(
      new OperationsRepository(client),
      undefined,
      () => new Date("2026-08-12T00:00:00.000Z"),
    );
    expect(envelope.sync.nodes.map((node) => node.location)).toEqual(["database", "local", "git", "github", "public"]);
    expect(envelope.sync.nodes.slice(1).every((node) => node.state === "unknown" && node.readOnly)).toBe(true);
    expect(envelope.sync.state).toBe("attention");
  });
});
