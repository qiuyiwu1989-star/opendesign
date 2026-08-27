export const ADMIN_API_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "sandbox",
].join("; ");

export const ADMIN_API_SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store, max-age=0",
  "content-security-policy": ADMIN_API_CSP,
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
});

export function adminJsonHeaders(requestId: string): Readonly<Record<string, string>> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) throw new Error("Invalid request id");
  return {
    ...ADMIN_API_SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
  };
}
