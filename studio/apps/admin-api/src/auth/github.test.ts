import assert from "node:assert/strict";
import test from "node:test";
import { createGitHubOAuthAdapter } from "./github.js";

test("GitHub adapter builds a scoped authorization URL and validates immutable identity", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), ...(init ? { init } : {}) });
    if (calls.length === 1) return { ok: true, status: 200, json: async () => ({ access_token: "test-access-token" }) };
    return { ok: true, status: 200, json: async () => ({ id: 123, login: "curator", avatar_url: "https://avatars.example/123" }) };
  };
  const adapter = createGitHubOAuthAdapter({ clientId: "client", clientSecret: "secret", fetcher });
  const authorization = new URL(adapter.createAuthorizationUrl({ state: "signed-state", redirectUri: "https://admin.example/admin-api/v1/auth/github/callback" }));
  assert.equal(authorization.origin, "https://github.com");
  assert.equal(authorization.searchParams.get("state"), "signed-state");
  assert.equal(authorization.searchParams.has("scope"), false);

  const actor = await adapter.authenticate({ code: "code", redirectUri: "https://admin.example/admin-api/v1/auth/github/callback", signal: new AbortController().signal });
  assert.deepEqual(actor, { githubUserId: 123, login: "curator", avatarUrl: "https://avatars.example/123" });
  assert.equal(calls[1]?.init?.headers && (calls[1].init.headers as Record<string, string>).authorization, "Bearer test-access-token");
});

test("GitHub adapter rejects non-numeric identity", async () => {
  let call = 0;
  const adapter = createGitHubOAuthAdapter({
    clientId: "client",
    clientSecret: "secret",
    fetcher: async () => ++call === 1
      ? { ok: true, status: 200, json: async () => ({ access_token: "test-access-token" }) }
      : { ok: true, status: 200, json: async () => ({ id: "123", login: "curator" }) },
  });
  await assert.rejects(() => adapter.authenticate({ code: "code", redirectUri: "https://admin.example/callback", signal: new AbortController().signal }), /invalid identity/);
});
