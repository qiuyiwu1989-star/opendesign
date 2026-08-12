export type AdminSessionState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" }
  | { kind: "authenticated"; actor: { githubUserId: number; login: string; avatarUrl?: string }; expiresAt: string };

export const ADMIN_SESSION_ENDPOINT = "/admin-api/v1/session";
export const ADMIN_LOGIN_ENDPOINT = "/admin-api/v1/auth/github/start?return=%2Fadmin%2F";

export async function loadAdminSession(fetcher: typeof fetch = fetch): Promise<AdminSessionState> {
  try {
    const response = await fetcher(ADMIN_SESSION_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return { kind: "unavailable" };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return { kind: "unavailable" };
    const value = payload as Record<string, unknown>;
    if (value.authenticated === false) return { kind: "unauthenticated" };
    if (value.authenticated !== true || !value.actor || typeof value.actor !== "object" || typeof value.expiresAt !== "string") {
      return { kind: "unavailable" };
    }
    const actor = value.actor as Record<string, unknown>;
    if (!Number.isSafeInteger(actor.githubUserId) || typeof actor.login !== "string") return { kind: "unavailable" };
    return {
      kind: "authenticated",
      actor: {
        githubUserId: actor.githubUserId as number,
        login: actor.login,
        ...(typeof actor.avatarUrl === "string" ? { avatarUrl: actor.avatarUrl } : {}),
      },
      expiresAt: value.expiresAt,
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function logoutAdminSession(fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher("/admin-api/v1/logout", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  }
}
