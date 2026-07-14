#!/usr/bin/env node
/**
 * OpenDesign MCP — remote Streamable HTTP transport.
 *
 * Same tools as opendesign-mcp.mjs (stdio), but reachable without installing
 * anything: point an MCP client at https://opendesign.cc/mcp/http and go.
 *
 * Implements the MCP "Streamable HTTP" transport (spec 2025-03-26+), the
 * minimal-viable slice this server actually needs:
 *   - single POST endpoint, JSON-RPC request(s) in, JSON-RPC response(s) out
 *   - no server-initiated push (we never need to send unsolicited messages),
 *     so GET (the SSE-stream-for-server-push half of the spec) replies 405 —
 *     that's spec-legal for a server that doesn't use server-initiated streams
 *   - stateless: no Mcp-Session-Id. Every tool call is a fresh read against
 *     the public catalog, nothing here is per-session, so there's nothing a
 *     session would buy us — skipping it is simpler and still spec-legal
 *     (session management is OPTIONAL in Streamable HTTP)
 *
 * Zero dependencies — Node's built-in http module only. Binds 127.0.0.1;
 * nginx reverse-proxies /mcp/http/ from the public domain (TLS terminates
 * at nginx, this process never sees the internet directly).
 *
 * Run: node server-http.mjs   (PORT env var, default 8787)
 * Deployed as systemd service opendesign-mcp-http.service (always-on, like nginx —
 * NOT part of the paused content pipeline; this just serves already-public data).
 */
import http from "node:http";
import { handleMessage } from "./lib/core.mjs";

const PORT = Number(process.env.PORT) || 8787;
const MAX_BODY = 2_000_000; // 2MB — generous for JSON-RPC tool calls, stops abuse

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname !== "/" && url.pathname !== "/mcp/http" && url.pathname !== "/mcp/http/") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jsonRpcError(null, -32601, "not found — POST JSON-RPC to this path")));
    return;
  }

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET") {
    // We never send server-initiated messages, so there's no SSE stream to open here.
    // Spec-legal: a server that doesn't support server push MAY reply 405 to GET.
    res.writeHead(405, { "Content-Type": "text/plain", "Allow": "POST" });
    res.end("This server has no server-initiated stream — POST your JSON-RPC request instead.");
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain", "Allow": "POST" });
    res.end("Method Not Allowed");
    return;
  }

  let raw;
  try {
    raw = await readBody(req);
  } catch (err) {
    res.writeHead(413, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jsonRpcError(null, -32600, err.message)));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify(jsonRpcError(null, -32700, "Parse error: invalid JSON")));
    return;
  }

  const batch = Array.isArray(payload) ? payload : [payload];
  const results = [];
  for (const msg of batch) {
    const r = await handleMessage(msg);
    if (r) results.push(r);
  }

  if (results.length === 0) {
    // all requests were notifications — nothing to return, per JSON-RPC convention
    res.writeHead(202);
    res.end();
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(Array.isArray(payload) ? results : results[0]));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`OpenDesign MCP (Streamable HTTP) listening on http://127.0.0.1:${PORT}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
