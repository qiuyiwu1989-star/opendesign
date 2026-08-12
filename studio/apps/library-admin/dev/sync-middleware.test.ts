import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createSyncApiMiddleware } from "./sync-middleware";
import type { ReadOnlyGitRunner } from "./sync-snapshot";

const runGit: ReadOnlyGitRunner = async (args) => {
  const values: Record<string, string> = {
    "symbolic-ref --quiet --short HEAD": "feature/test\n",
    "rev-parse --verify HEAD": "abc123\n",
    "status --porcelain=v1 --untracked-files=normal": "",
    "show-ref --verify refs/remotes/origin/feature/test": "abc123 refs/remotes/origin/feature/test\n",
  };
  const signature = args.join(" ");
  return { stdout: values[signature] ?? "", stderr: "", exitCode: signature in values ? 0 : 1 };
};

function request(method: string, url: string): IncomingMessage {
  return Object.assign(new EventEmitter(), { method, url }) as IncomingMessage;
}

function response() {
  const headers = new Map<string, string>();
  let body = "";
  const result = {
    statusCode: 200,
    setHeader(name: string, value: string) { headers.set(name, value); },
    end(value = "") { body += value; },
  };
  return {
    value: result as unknown as ServerResponse,
    headers,
    body: () => body,
    status: () => result.statusCode,
  };
}

describe("createSyncApiMiddleware", () => {
  it("passes unrelated routes through", () => {
    const middleware = createSyncApiMiddleware({ repoRoot: "/missing", runGit });
    const next = vi.fn();
    middleware(request("GET", "/elsewhere"), response().value, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects non-GET methods without building a snapshot", () => {
    const middleware = createSyncApiMiddleware({ repoRoot: "/missing", runGit });
    const output = response();
    middleware(request("POST", "/admin-api/v1/sync"), output.value, vi.fn());
    expect(output.status()).toBe(405);
    expect(output.headers.get("allow")).toBe("GET");
    expect(JSON.parse(output.body())).toMatchObject({ readOnly: true });
  });

  it("serves a no-store read-only JSON snapshot", async () => {
    const middleware = createSyncApiMiddleware({
      repoRoot: "/missing",
      observedAt: "2026-08-12T04:00:00.000Z",
      runGit,
    });
    const output = response();
    middleware(request("GET", "/admin-api/v1/sync?fresh=1"), output.value, vi.fn());
    await vi.waitFor(() => expect(output.body()).not.toBe(""));
    expect(output.headers.get("cache-control")).toBe("no-store");
    const body = JSON.parse(output.body()) as { sync: { readOnly: boolean; nodes: unknown[] } };
    expect(body.sync.readOnly).toBe(true);
    expect(body.sync.nodes).toHaveLength(5);
  });
});
