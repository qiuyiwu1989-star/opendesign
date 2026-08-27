import type { IncomingMessage, ServerResponse } from "node:http";
import { buildSyncSnapshot, type BuildSyncSnapshotOptions } from "./sync-snapshot";

export type SyncMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

export function createSyncApiMiddleware(
  options: BuildSyncSnapshotOptions,
): SyncMiddleware {
  return (request, response, next) => {
    const path = request.url?.split("?", 1)[0];
    if (path !== "/admin-api/v1/sync") return next();
    if (request.method !== "GET") {
      response.statusCode = 405;
      response.setHeader("allow", "GET");
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ error: "method_not_allowed", readOnly: true }));
      return;
    }
    void buildSyncSnapshot(options).then((snapshot) => {
      response.statusCode = 200;
      response.setHeader("cache-control", "no-store");
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(JSON.stringify(snapshot));
    }).catch(next);
  };
}
