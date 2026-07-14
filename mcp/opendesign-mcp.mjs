#!/usr/bin/env node
/**
 * OpenDesign MCP server — turn https://opendesign.cc (900+ real, grounded design
 * systems) into a connected tool for any MCP client (Cursor / Claude / Windsurf / …).
 *
 * Why an MCP server instead of "just fetch the URL": many agent runtimes block or
 * sandbox raw web fetches (URL allowlists, browser CORS). An MCP tool is explicitly
 * connected by the user, so it works where a bare fetch is refused. The fetches here
 * happen from THIS local process — normal network, no CORS, no agent URL policy.
 *
 * Zero dependencies. Needs Node ≥ 18 (built-in global fetch). stdio transport.
 *
 * Install (Claude Desktop / Cursor → mcpServers config):
 *   { "opendesign": { "command": "node", "args": ["/abs/path/mcp/opendesign-mcp.mjs"] } }
 * After npm publish it can also run via: { "command": "npx", "args": ["-y", "opendesign-mcp"] }
 *
 * Prefer not to install anything? There's also a remote Streamable HTTP endpoint —
 * see https://opendesign.cc/mcp/ for the URL, no local process needed.
 */
import readline from "node:readline";
import { handleMessage } from "./lib/core.mjs";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  const s = line.trim();
  if (!s) return;
  let req;
  try { req = JSON.parse(s); } catch { return; }
  const res = await handleMessage(req);
  if (res) send(res);
});
process.stdin.on("end", () => process.exit(0));
