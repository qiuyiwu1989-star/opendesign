import type { IncomingMessage } from "node:http";

export function hasRequestBody(request: IncomingMessage): boolean {
  const transferEncoding = request.headers["transfer-encoding"];
  if (transferEncoding !== undefined) return true;
  const contentLength = request.headers["content-length"];
  if (contentLength === undefined) return false;
  return contentLength.trim() !== "0";
}

export function assertExactQuery(url: URL, allowed: ReadonlySet<string>): boolean {
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) return false;
  for (const key of allowed) if (url.searchParams.getAll(key).length > 1) return false;
  return true;
}

export function safeReturnPath(value: string | null): string | undefined {
  if (value === null || value === "") return "/admin/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\r\n\0]/.test(value)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value, "https://return.invalid");
  } catch {
    return undefined;
  }
  if (parsed.origin !== "https://return.invalid" || !parsed.pathname.startsWith("/admin")) return undefined;
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function originMatches(request: IncomingMessage, expectedOrigin: string): boolean {
  const origin = request.headers.origin;
  return typeof origin === "string" && origin === expectedOrigin;
}
