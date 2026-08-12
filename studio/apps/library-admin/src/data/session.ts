export type AdminSessionState =
  | { kind: "loading" }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" }
  | { kind: "authenticated"; actor: { actorId: string; login: string }; expiresAt: string };

export const ADMIN_SESSION_ENDPOINT = "/admin-api/v1/session";
export const ADMIN_LOGIN_ENDPOINT = "/admin-api/v1/login";

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
    if (typeof actor.actorId !== "string" || typeof actor.login !== "string") return { kind: "unavailable" };
    return {
      kind: "authenticated",
      actor: {
        actorId: actor.actorId,
        login: actor.login,
      },
      expiresAt: value.expiresAt,
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export type AdminLoginResult =
  | { ok: true; session: Extract<AdminSessionState, { kind: "authenticated" }> }
  | { ok: false; reason: "invalid" | "rate_limited" | "unavailable" };

export async function loginAdminSession(username: string, password: string, fetcher: typeof fetch = fetch): Promise<AdminLoginResult> {
  try {
    const response = await fetcher(ADMIN_LOGIN_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (response.status === 401) return { ok: false, reason: "invalid" };
    if (response.status === 429) return { ok: false, reason: "rate_limited" };
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return { ok: false, reason: "unavailable" };
    const value = payload as Record<string, unknown>;
    const actor = value.actor as Record<string, unknown> | undefined;
    if (value.authenticated !== true || !actor || typeof actor.actorId !== "string" || typeof actor.login !== "string" || typeof value.expiresAt !== "string") {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, session: { kind: "authenticated", actor: { actorId: actor.actorId, login: actor.login }, expiresAt: value.expiresAt } };
  } catch {
    return { ok: false, reason: "unavailable" };
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
