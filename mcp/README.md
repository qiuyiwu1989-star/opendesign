# OpenDesign MCP

Turn [opendesign.cc](https://opendesign.cc) — **545+ real, grounded design systems** —
into a connected tool for **Cursor / Claude / Windsurf / any MCP client**.

> Say to your agent *"build a Linear-style landing page"* and it can call
> `get_design_system("linear")` to pull Linear's **real** color / type scale / spacing /
> radii / motion tokens — extracted from the live site with a browser and grounded against
> its actual computed styles — and build from those, not from memory.

## Why an MCP server (not "just fetch the URL")

Many agent runtimes **block or sandbox raw web fetches** (URL allowlists, browser CORS).
An MCP tool is explicitly connected by you, so it works where a bare fetch is refused —
the network calls happen from the local MCP process, with no CORS and no agent URL policy.
This is the reliable way to give *any* agent the OpenDesign library.

## Tools

| Tool | What it does |
|------|------|
| `search_designs(query, tags?, limit?)` | Search by need — score-ranked. e.g. `"fintech trust"`, `tags:["ai"]` |
| `list_designs(limit?, offset?)` | Browse the catalog (slug / title / tags / summary) |
| `get_design_system(slug)` | **Core** — real grounded tokens (colors, typography, spacing, surfaces, layout, motion) + resource URLs |
| `fetch_design_spec_markdown(slug, lang?)` | The full 11-layer DESIGN_SPEC as Markdown (drop straight into a prompt) |
| `get_director_protocol()` | The OpenDesign "design director" protocol (skill.md) — read first to act as a director |

## Install — Node (recommended, zero dependencies)

Needs **Node ≥ 18**. No `npm install`, no Python.

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json`:

```jsonc
{
  "mcpServers": {
    "opendesign": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/opendesign/mcp/opendesign-mcp.mjs"]
    }
  }
}
```

**Cursor** — `~/.cursor/mcp.json` (or project `.cursor/mcp.json`) — same `opendesign` block.
**Windsurf / Cline / other** — same shape, in that client's MCP config.

Restart the client; `opendesign` appears in the tool list.

> Once published to npm, this also runs install-free via
> `{ "command": "npx", "args": ["-y", "opendesign-mcp"] }`.

## Install — Python (alternative)

`opendesign_mcp.py` is a [FastMCP](https://github.com/jlowin/fastmcp) version. Needs
[uv](https://docs.astral.sh/uv/) or `pip install mcp httpx`:

```jsonc
{ "mcpServers": { "opendesign": { "command": "uv", "args": ["run", "/ABS/PATH/mcp/opendesign_mcp.py"] } } }
```

## Try it (no client needed)

```bash
# pipe MCP JSON-RPC straight in:
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_designs","arguments":{"query":"fintech trust"}}}' \
 | node mcp/opendesign-mcp.mjs
# or the official inspector:
npx @modelcontextprotocol/inspector node mcp/opendesign-mcp.mjs
```

## Usage (say to your agent)

- *"What AI-product design systems are in OpenDesign?"* → `search_designs("", tags:["ai"])`
- *"Make a pricing page in Stripe's system"* → `get_design_system("stripe")` → build on its tokens
- *"Give me teenage-engineering's full spec"* → `fetch_design_spec_markdown("teenage-engineering")`
- *"Act as my design director for this"* → `get_director_protocol()` then diagnose → recommend → decompose

All data is read-only, public, no keys. The library grows continuously, so `search_designs`
reflects the current catalog.
