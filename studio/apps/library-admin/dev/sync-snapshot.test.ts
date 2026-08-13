import { describe, expect, it } from "vitest";
import { buildSyncSnapshot, readGitEvidence, type ReadOnlyGitRunner } from "./sync-snapshot";

const observedAt = "2026-08-12T04:00:00.000Z";

function runner(responses: Record<string, string>): ReadOnlyGitRunner {
  return async (args) => ({
    stdout: responses[args.join(" ")] ?? "",
    stderr: "",
    exitCode: Object.hasOwn(responses, args.join(" ")) ? 0 : 1,
  });
}

describe("readGitEvidence", () => {
  it("reads only branch, HEAD, status, and cached origin ref", async () => {
    const calls: string[] = [];
    const run: ReadOnlyGitRunner = async (args) => {
      const signature = args.join(" ");
      calls.push(signature);
      const output: Record<string, string> = {
        "symbolic-ref --quiet --short HEAD": "feature/test\n",
        "rev-parse --verify HEAD": "abc123\n",
        "status --porcelain=v1 --untracked-files=normal": "",
        "show-ref --verify refs/remotes/origin/feature/test": "abc123 refs/remotes/origin/feature/test\n",
      };
      return { stdout: output[signature] ?? "", stderr: "", exitCode: signature in output ? 0 : 1 };
    };
    const result = await readGitEvidence({ repoRoot: "/repo", observedAt, runGit: run });
    expect(result).toMatchObject({
      branch: "feature/test",
      head: "abc123",
      originRevision: "abc123",
      dirty: false,
    });
    expect(calls).toEqual([
      "symbolic-ref --quiet --short HEAD",
      "rev-parse --verify HEAD",
      "status --porcelain=v1 --untracked-files=normal",
      "show-ref --verify refs/remotes/origin/feature/test",
    ]);
    expect(calls.some((call) => /fetch|pull|push/u.test(call))).toBe(false);
  });
});

describe("buildSyncSnapshot", () => {
  it("keeps missing external revisions explicit and read-only", async () => {
    const run = runner({
      "symbolic-ref --quiet --short HEAD": "feature/test\n",
      "rev-parse --verify HEAD": "abc123\n",
      "status --porcelain=v1 --untracked-files=normal": "",
      "show-ref --verify refs/remotes/origin/feature/test": "abc123 refs/remotes/origin/feature/test\n",
    });
    const result = await buildSyncSnapshot({
      repoRoot: "/definitely/missing",
      observedAt,
      runGit: run,
    });
    expect(result.sync.nodes.map((node) => [node.location, node.drift])).toEqual([
      ["database", "unknown"],
      ["local", "in-sync"],
      ["git", "in-sync"],
      ["github", "unknown"],
      ["public", "unknown"],
    ]);
    expect(result.sync.nodes.every((node) => node.observedAt === observedAt && node.readOnly)).toBe(true);
  });

  it("compares injected GitHub and Public revisions without network access", async () => {
    const run = runner({
      "symbolic-ref --quiet --short HEAD": "feature/test\n",
      "rev-parse --verify HEAD": "abc123\n",
      "status --porcelain=v1 --untracked-files=normal": " M local.txt\n",
      "show-ref --verify refs/remotes/origin/feature/test": "abc123 refs/remotes/origin/feature/test\n",
    });
    const result = await buildSyncSnapshot({
      repoRoot: "/definitely/missing",
      observedAt,
      runGit: run,
      github: { revision: "abc123", observedAt },
      public: { revision: "old456", observedAt },
    });
    expect(result.sync.state).toBe("attention");
    expect(result.sync.nodes.find((node) => node.location === "local")?.drift).toBe("ahead");
    expect(result.sync.nodes.find((node) => node.location === "github")?.drift).toBe("in-sync");
    expect(result.sync.nodes.find((node) => node.location === "public")?.drift).toBe("diverged");
  });
});
