export interface GitHubActor {
  githubUserId: number;
  login: string;
  avatarUrl?: string;
}

export interface GitHubOAuthAdapter {
  createAuthorizationUrl(input: { state: string; redirectUri: string }): string;
  authenticate(input: { code: string; redirectUri: string; signal: AbortSignal }): Promise<GitHubActor>;
}

export type OAuthFetch = (input: string | URL, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  fetcher?: OAuthFetch;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GitHub returned an invalid response");
  return value as Record<string, unknown>;
}

export function createGitHubOAuthAdapter(config: GitHubOAuthConfig): GitHubOAuthAdapter {
  if (!config.clientId || !config.clientSecret) throw new Error("GitHub OAuth credentials are required");
  const fetcher = config.fetcher ?? globalThis.fetch;
  if (!fetcher) throw new Error("fetch is unavailable");

  return {
    createAuthorizationUrl({ state, redirectUri }) {
      const url = new URL("https://github.com/login/oauth/authorize");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      return url.toString();
    },
    async authenticate({ code, redirectUri, signal }) {
      const tokenResponse = await fetcher("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "user-agent": "OpenDesign-Admin-API" },
        body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri }),
        signal,
      });
      if (!tokenResponse.ok) throw new Error(`GitHub token exchange failed with status ${tokenResponse.status}`);
      const tokenPayload = object(await tokenResponse.json());
      const token = tokenPayload.access_token;
      if (typeof token !== "string" || token.length < 8) throw new Error("GitHub token exchange did not return a token");

      const userResponse = await fetcher("https://api.github.com/user", {
        method: "GET",
        headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "OpenDesign-Admin-API", "x-github-api-version": "2022-11-28" },
        signal,
      });
      if (!userResponse.ok) throw new Error(`GitHub identity request failed with status ${userResponse.status}`);
      const user = object(await userResponse.json());
      if (!Number.isSafeInteger(user.id) || (user.id as number) <= 0 || typeof user.login !== "string" || !user.login) {
        throw new Error("GitHub returned an invalid identity");
      }
      return {
        githubUserId: user.id as number,
        login: user.login,
        ...(typeof user.avatar_url === "string" ? { avatarUrl: user.avatar_url } : {}),
      };
    },
  };
}
