#!/usr/bin/env node
/**
 * OpenDesign MCP server — turn https://opendesign.cc (1,400+ real, grounded design
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

// 在途请求计数：stdin 关闭时若还有 handleMessage 没跑完，不能直接 exit——
// 否则管道式调用（echo '...' | opendesign-mcp）会在 fetch 返回前被杀掉，
// 只有不需要网络的 tools/list 侥幸有输出。真实 MCP 客户端 stdin 常开不易触发，
// 但这让任何脚本化调用/冒烟测试都不可用。
let inFlight = 0;
let stdinClosed = false;
const maybeExit = () => { if (stdinClosed && inFlight === 0) process.exit(0); };

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  const s = line.trim();
  if (!s) return;
  let req;
  try { req = JSON.parse(s); } catch { return; }
  inFlight++;
  try {
    const res = await handleMessage(req);
    if (res) send(res);
  } catch (err) {
    // 单条消息失败不该让整个 server 静默死掉
    const id = req && req.id !== undefined ? req.id : null;
    if (id !== null) send({ jsonrpc: "2.0", id, error: { code: -32603, message: String(err && err.message || err) } });
  } finally {
    inFlight--;
    maybeExit();
  }
});
process.stdin.on("end", () => { stdinClosed = true; maybeExit(); });
