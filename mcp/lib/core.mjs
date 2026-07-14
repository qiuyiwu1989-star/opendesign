/**
 * OpenDesign MCP core — transport-agnostic tool logic shared by the stdio
 * server (opendesign-mcp.mjs, local/npx) and the Streamable HTTP server
 * (server-http.mjs, remote — no install needed).
 *
 * Zero dependencies. Needs Node ≥ 18 (built-in global fetch).
 */

export const BASE = "https://opendesign.cc";
export const NAME = "opendesign";
export const VERSION = "1.0.0";
export const PROTOCOL = "2024-11-05";

let _catalog = null; // cache

async function httpGet(path, { json = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "opendesign-mcp/1.0", Accept: json ? "application/json" : "text/markdown,text/plain,*/*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return json ? res.json() : res.text();
  } finally {
    clearTimeout(t);
  }
}

async function catalog() {
  if (!_catalog) {
    const d = await httpGet("/catalog.json", { json: true });
    // catalog.json shape: { count, designs: [...] }
    _catalog = Array.isArray(d) ? d : d.designs || d.sites || d.entries || [];
  }
  return _catalog;
}

function slim(e) {
  return { slug: e.slug, title: e.title, url: e.url, tags: e.tags || [], summary: e.summary || "", has_pack: !!e.has_pack };
}

/* ── Tools ─────────────────────────────────────────────────────────────── */
export const TOOLS = [
  {
    name: "search_designs",
    description:
      "Search the OpenDesign library (900+ real design systems) by need. `query` matches title/slug/tags/summary (case-insensitive, all words must hit); `tags` requires any tag to match. Returns slim matches — then call get_design_system for the real tokens. e.g. search_designs('fintech trust restrained') or search_designs('', ['ai','minimal']).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "free-text need, e.g. 'dark dev-tool dense'" },
        tags: { type: "array", items: { type: "string" }, description: "optional tag filter (any-match)" },
        limit: { type: "number", description: "max results (default 20)" },
      },
    },
  },
  {
    name: "list_designs",
    description: "Browse the catalog (slim: slug/title/tags/summary). Paginated; use to get an overview of what's available. Prefer search_designs when you have a need.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "default 40" }, offset: { type: "number", description: "default 0" } },
    },
  },
  {
    name: "get_design_system",
    description:
      "THE core tool. Get a site's grounded design tokens (real colors, typography scale, spacing, surfaces, layout, motion — extracted from the live site, verified against computed styles), plus resource URLs (full 11-layer spec, screenshots ZIP). Build with THESE actual values, not from memory. `slug` is from search_designs/list_designs (e.g. 'linear', 'stripe', 'mercury').",
    inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
  },
  {
    name: "fetch_design_spec_markdown",
    description:
      "Get a site's full DESIGN_SPEC as Markdown (the readable 11-layer spec incl. voice + anti-patterns/donts) — ideal to drop straight into a prompt. `lang` optional: en (default) / zh-CN / ja / ko / zh-TW.",
    inputSchema: { type: "object", properties: { slug: { type: "string" }, lang: { type: "string" } }, required: ["slug"] },
  },
  {
    name: "get_director_protocol",
    description: "Read the OpenDesign design-director protocol (skill.md) — how to diagnose the need, give a professional point of view, route to the right references, and decompose them into a grounded build. Read this first to act as a design director.",
    inputSchema: { type: "object", properties: {} },
  },
];

export async function callTool(name, args = {}) {
  if (name === "search_designs") {
    const items = await catalog();
    const q = String(args.query || "").toLowerCase().trim();
    const want = new Set((args.tags || []).map((t) => String(t).toLowerCase()));
    const limit = args.limit || 20;
    const words = q ? q.split(/\s+/) : [];
    // score-ranked (not strict AND): exact tag hit = strong, substring = weak; sort by relevance.
    const scored = [];
    for (const e of items) {
      const s = slim(e);
      const tagset = new Set(s.tags.map((t) => String(t).toLowerCase()));
      if (want.size && ![...want].some((w) => tagset.has(w))) continue; // hard tag filter
      let score = want.size ? 2 : 0;
      const hay = `${s.slug} ${s.title} ${s.tags.join(" ")} ${s.summary}`.toLowerCase();
      for (const w of words) {
        if (tagset.has(w)) score += 3;
        else if (hay.includes(w)) score += 1;
      }
      if (words.length && score === (want.size ? 2 : 0)) continue; // query had zero hits
      scored.push({ s, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const out = scored.slice(0, limit).map((x) => x.s);
    return { query: args.query || "", tags: args.tags || [], count: out.length, designs: out };
  }

  if (name === "list_designs") {
    const items = await catalog();
    const limit = args.limit || 40, offset = args.offset || 0;
    const rows = items.map(slim);
    return { total: rows.length, offset, limit, designs: rows.slice(offset, offset + limit) };
  }

  if (name === "get_design_system") {
    const slug = args.slug;
    if (!slug) throw new Error("slug required");
    const items = await catalog();
    const e = items.find((x) => x.slug === slug);
    if (!e) {
      const sample = items.slice(0, 25).map((x) => x.slug).join(", ");
      throw new Error(`No slug '${slug}'. Use search_designs/list_designs. Sample slugs: ${sample} …`);
    }
    const folder = `${BASE}/packs/${slug}/`;
    let spec = null;
    if (e.has_pack) {
      try { spec = await httpGet(`/packs/${slug}/spec.json`, { json: true }); } catch { /* tier-1, no pack */ }
    }
    return {
      slug, title: e.title, url: e.url, tags: e.tags || [], summary: e.summary || "",
      tokens: spec, // colors, typography, spacing, surfaces, layout, motion (null for tier-1 without a pack)
      resources: {
        design_spec_md: `${folder}DESIGN_SPEC.en.md`,
        design_md: `${folder}DESIGN.md`,
        spec_json: `${folder}spec.json`,
        pack_zip: `${folder}${slug}-design-pack.zip`,
        screenshots_folder: folder,
        detail_page: `${BASE}/en/sites/${slug}`,
      },
      note: spec ? "tokens are real, grounded against the live site's computed styles." : "tier-1 entry: no full pack yet — use the detail_page / original url as reference.",
    };
  }

  if (name === "fetch_design_spec_markdown") {
    const slug = args.slug;
    if (!slug) throw new Error("slug required");
    const lang = (args.lang || "en").replace(/^zh$/, "zh-CN");
    try {
      return await httpGet(`/packs/${slug}/DESIGN_SPEC.${lang}.md`);
    } catch {
      return await httpGet(`/packs/${slug}/DESIGN_SPEC.en.md`); // fallback to en
    }
  }

  if (name === "get_director_protocol") {
    return await httpGet("/skill.md");
  }

  throw new Error(`unknown tool: ${name}`);
}

/** 处理单条 JSON-RPC 消息，两种传输（stdio / http）共用。
 *  通知（无 id）返回 null——两边都不回。 */
export async function handleMessage(req, { protocolVersion } = {}) {
  const { id, method, params } = req;
  if (id === undefined || id === null) return null;

  try {
    if (method === "initialize") {
      // 尽量回声客户端请求的协议版本，兼容面更广；没带就用我们的默认值。
      const negotiated = params?.protocolVersion || protocolVersion || PROTOCOL;
      return { jsonrpc: "2.0", id, result: { protocolVersion: negotiated, capabilities: { tools: {} }, serverInfo: { name: NAME, version: VERSION } } };
    }
    if (method === "notifications/initialized") return null;
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    if (method === "tools/call") {
      const result = await callTool(params?.name, params?.arguments || {});
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: false } };
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } };
  } catch (err) {
    if (method === "tools/call") {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true } };
    }
    return { jsonrpc: "2.0", id, error: { code: -32603, message: err.message } };
  }
}
