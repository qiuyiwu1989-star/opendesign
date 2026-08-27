import type { ServerResponse } from "node:http";

export function applySecurityHeaders(response: ServerResponse, requestId: string): void {
  response.setHeader("cache-control", "no-store, max-age=0");
  response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("x-request-id", requestId);
}

export function json(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

export function errorJson(response: ServerResponse, status: number, code: string, requestId: string): void {
  json(response, status, { error: { code, requestId } });
}

export function redirect(response: ServerResponse, location: string): void {
  response.writeHead(302, { location, "content-length": "0" });
  response.end();
}
