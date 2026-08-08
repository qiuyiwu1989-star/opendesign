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
let _catalogAt = 0;
const CATALOG_TTL_MS = 10 * 60 * 1000; // stdio 进程短命无所谓；HTTP 常驻进程没 TTL 会永远用旧库（踩过：重启前一直 serve 着少 368 站的旧目录）

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
  const now = Date.now();
  if (!_catalog || now - _catalogAt > CATALOG_TTL_MS) {
    try {
      const d = await httpGet("/catalog.json", { json: true });
      // catalog.json shape: { count, designs: [...] }
      _catalog = Array.isArray(d) ? d : d.designs || d.sites || d.entries || [];
      _catalogAt = now;
    } catch (err) {
      if (!_catalog) throw err; // 有旧数据就先用着，刷新失败不至于把服务打挂
    }
  }
  return _catalog;
}

/* 轻量同义词层：把 query 词扩展到 catalog 实际用的词汇。
 * 不搞语义搜索（保持零依赖），只覆盖高频真实差距——
 * 例如用户搜 "japanese"，日本站的 tag/summary 里写的是 japan/tokyo/jp。 */
const SYNONYMS = {
  japanese: ["japan", "tokyo", "jp"],
  finance: ["fintech", "bank", "banking"],
  banking: ["fintech", "bank", "finance"],
  shop: ["e-commerce", "ecommerce", "store"],
  store: ["e-commerce", "ecommerce", "shop"],
  webgl: ["3d", "three.js", "immersive"],
  "3d": ["webgl", "immersive"],
  developer: ["dev", "developer tools", "devtools"],
  minimalist: ["minimal", "clean"],
  type: ["typography", "foundry"],
  motion: ["animation", "kinetic"],
  crypto: ["web3", "blockchain", "nft"],
  dashboard: ["app ui", "product", "saas"],
};

function slim(e) {
  return {
    slug: e.slug, title: e.title, url: e.url, tags: e.tags || [],
    summary: e.summary || "", has_pack: !!e.has_pack,
    // 完整度：让调用方在检索阶段就能判断"这条参照够不够拿来开工"，
    // 而不是 fetch 完才发现只有黑白两色（那时它只会回去凭记忆编）
    spec_completeness: typeof e.spec_completeness === "number" ? e.spec_completeness : null,
  };
}

/* ── Aesthetic families (skill.md §3 "route to real references") ─────────
 * skill.md's routing rule — 1 primary + 2 alternates from DIFFERENT families,
 * "never 3 from one family" — is easy to state and hard for a model to reliably
 * self-enforce from a prose instruction alone. This makes it deterministic:
 * classify every candidate by tag overlap, then pick across buckets in code.
 * Tag signals below are grounded in the catalog's actual current tag vocabulary
 * (checked against a live frequency count, not guessed) — heuristic, not exact;
 * same spirit as skill.md's own framing: "a starting point for what to search". */
const FAMILIES = [
  {
    key: "restraint",
    label: "Restraint / trust (Swiss, editorial)",
    tags: ["clean", "premium", "calm", "refined", "restraint", "minimal", "monochrome", "fintech", "refinement"],
  },
  {
    key: "dev-tool",
    label: "Dev-tool / dense",
    tags: ["dev", "saas", "developer tools", "devtools", "dark mode", "productivity", "tooling", "infra", "tool", "design tools", "developer"],
  },
  {
    key: "bold-brand",
    label: "Bold brand / high-energy",
    tags: ["bold typography", "playful", "expressive", "consumer", "warm", "friendly"],
  },
  {
    key: "motion",
    label: "Motion / experimental (WebGL, studio)",
    tags: ["experimental", "geometric", "ai", "hardware"],
  },
  {
    key: "type-craft",
    label: "Type-driven / quiet-craft",
    tags: ["editorial", "typography", "portfolio", "photographic", "studio", "gallery", "type", "foundry", "museum", "reference", "fashion", "beauty"],
  },
];

function classifyFamily(tags) {
  const t = new Set((tags || []).map((x) => String(x).toLowerCase()));
  let best = null, bestScore = 0;
  for (const fam of FAMILIES) {
    const score = fam.tags.reduce((n, tag) => n + (t.has(tag) ? 1 : 0), 0);
    if (score > bestScore) { best = fam; bestScore = score; }
  }
  return best || FAMILIES[0]; // no tag signal at all → arbitrary bucket rather than null (still usable for diversity)
}

/* ── Tools ─────────────────────────────────────────────────────────────── */
export const TOOLS = [
  {
    name: "search_designs",
    description:
      "Search the OpenDesign library by need. `query` words are score-ranked (tag hit strongest; any word may match — NOT strict AND; check `unmatched_terms` in the result for query words that hit nothing); `tags` is the only hard filter. Returns slim matches — then call get_design_system for the real tokens. e.g. search_designs('fintech trust restrained') or search_designs('', ['ai','minimal']).",
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
  {
    name: "recommend_references",
    description:
      "Task-oriented routing (skill.md step 3): given a brief, return 1 primary + 2 alternates picked from DIFFERENT aesthetic families on purpose — the classic safe/bold/unexpected spread — instead of 3 near-duplicates. Family diversity is enforced in code, not left to chance. Use this instead of search_designs when you want a director-style recommendation set, not a raw result list. Then call get_design_system on the one the user picks.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "the need in free text, e.g. 'crypto trading dashboard, trustworthy not flashy'" },
        tags: { type: "array", items: { type: "string" }, description: "optional hard tag filter (any-match), same semantics as search_designs" },
      },
    },
  },
  {
    name: "get_critique_rubric",
    description:
      "The OpenDesign 5-dimension critique rubric (skill.md 'when asked to review a design'): reference fidelity, visual hierarchy, craft, function, originality — each scored 0-10, plus the Keep/Fix/Quick-wins output shape. Fetch this and apply it yourself when the user asks to review/score a design — this tool hands you the rubric structure, it doesn't look at anything (no vision call happens server-side).",
    inputSchema: { type: "object", properties: {} },
  },
];

export async function callTool(name, args = {}) {
  if (name === "search_designs") {
    const items = await catalog();
    const q = String(args.query || "").toLowerCase().trim();
    const want = new Set((args.tags || []).map((t) => String(t).toLowerCase()));
    const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
    const words = q ? q.split(/\s+/) : [];
    const matchedTerms = new Set(); // 记录每个 query 词有没有真的命中过任何站
    const scored = [];
    for (const e of items) {
      const s = slim(e);
      const tagset = new Set(s.tags.map((t) => String(t).toLowerCase()));
      if (want.size && ![...want].some((w) => tagset.has(w))) continue; // hard tag filter
      let score = want.size ? 2 : 0;
      const hay = `${s.slug} ${s.title} ${s.tags.join(" ")} ${s.summary}`.toLowerCase();
      for (const w of words) {
        if (tagset.has(w)) { score += 3; matchedTerms.add(w); }
        else if (hay.includes(w)) { score += 1; matchedTerms.add(w); }
        else {
          // 同义词降级匹配（权重低于直接命中，避免同义词喧宾夺主）
          for (const syn of SYNONYMS[w] || []) {
            if (tagset.has(syn) || hay.includes(syn)) { score += 2; matchedTerms.add(w); break; }
          }
        }
      }
      if (words.length && score === (want.size ? 2 : 0)) continue; // query had zero hits
      // 相关度相同时，tokens 更完整的排前面——同样相关的两条，能直接开工的那条更有用
      score += (typeof e.spec_completeness === "number" ? e.spec_completeness : 0.5) * 0.5;
      scored.push({ s, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const out = scored.slice(0, limit).map((x) => x.s);
    // 关键的诚实信号：哪些词一个站都没命中。没有这个，调用方会把
    // "japanese minimal" 返回一堆法国极简站当成正确答案（真踩过）。
    const unmatched = words.filter((w) => !matchedTerms.has(w));
    const res = { query: args.query || "", tags: args.tags || [], count: out.length, designs: out };
    if (unmatched.length) {
      res.unmatched_terms = unmatched;
      res.warning = `These query terms matched nothing in the catalog: ${unmatched.join(", ")}. Results only reflect the remaining terms — do not present them as covering the full query. Consider different terms, or browse tags via list_designs.`;
    }
    return res;
  }

  if (name === "list_designs") {
    const items = await catalog();
    const limit = Math.min(Math.max(Number(args.limit) || 40, 1), 100);   // 钳制:曾实测 99999 一次吐 640KB
    const offset = Math.max(0, Number(args.offset) || 0);
    const rows = items.slice(offset, offset + limit).map(slim);
    return { total: items.length, offset, limit, has_more: offset + limit < items.length, designs: rows };
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
    // 无条件试取:has_pack 只代表「有完整截图包」,而 spec.json 对任何有 spec 的站都存在。
    // 之前用 has_pack 当门禁,33% 的站被谎称"没有 tokens"→ Agent 回去凭记忆编颜色。
    try { spec = await httpGet(`/packs/${slug}/spec.json`, { json: true }); } catch { /* 真没有才 null */ }
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
    const slug = String(args.slug || "");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("invalid slug (expected kebab-case, e.g. 'linear')");
    const LANGS = ["en", "zh-CN", "zh-TW", "ja", "ko"];
    const lang = (args.lang || "en").replace(/^zh$/, "zh-CN");
    if (!LANGS.includes(lang)) throw new Error(`invalid lang '${args.lang}' — use one of ${LANGS.join("/")}`);
    try {
      return await httpGet(`/packs/${slug}/DESIGN_SPEC.${lang}.md`);
    } catch {
      const md = await httpGet(`/packs/${slug}/DESIGN_SPEC.en.md`);
      return lang === "en" ? md : `> (requested ${lang}, served en — no ${lang} spec for this pack)\n\n${md}`;
    }
  }

  if (name === "get_director_protocol") {
    return await httpGet("/skill.md");
  }

  if (name === "recommend_references") {
    const items = await catalog();
    const q = String(args.query || "").toLowerCase().trim();
    const want = new Set((args.tags || []).map((t) => String(t).toLowerCase()));
    const words = q ? q.split(/\s+/) : [];

    // same relevance scoring as search_designs (incl. synonym fallback), plus a family tag per candidate
    const matchedTerms = new Set();
    const scored = [];
    for (const e of items) {
      const s = slim(e);
      const tagset = new Set(s.tags.map((t) => String(t).toLowerCase()));
      if (want.size && ![...want].some((w) => tagset.has(w))) continue;
      let score = want.size ? 2 : 0;
      const hay = `${s.slug} ${s.title} ${s.tags.join(" ")} ${s.summary}`.toLowerCase();
      for (const w of words) {
        if (tagset.has(w)) { score += 3; matchedTerms.add(w); }
        else if (hay.includes(w)) { score += 1; matchedTerms.add(w); }
        else {
          for (const syn of SYNONYMS[w] || []) {
            if (tagset.has(syn) || hay.includes(syn)) { score += 2; matchedTerms.add(w); break; }
          }
        }
      }
      if (words.length && score === (want.size ? 2 : 0)) continue;
      score += (typeof e.spec_completeness === "number" ? e.spec_completeness : 0.5) * 0.5;
      scored.push({ s, score, family: classifyFamily(s.tags) });
    }
    scored.sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return { query: args.query || "", tags: args.tags || [], picks: [], note: "No matches — try broader terms or fewer tag filters (this mirrors search_designs' matching, so the same query works there too)." };
    }
    const unmatchedRec = words.filter((w) => !matchedTerms.has(w));

    const why = (c) =>
      `${c.s.title} reads ${c.family.label.toLowerCase()} — tagged ${c.s.tags.slice(0, 3).join(", ") || "n/a"}. ${c.s.summary || ""}`.trim();

    const primary = scored[0];
    const usedFamilies = new Set([primary.family.key]);
    const alternates = [];
    for (const c of scored.slice(1)) {
      if (alternates.length >= 2) break;
      if (usedFamilies.has(c.family.key)) continue; // enforce: never 2 picks from the same family
      alternates.push(c);
      usedFamilies.add(c.family.key);
    }
    // not enough family spread in the result set (small/narrow query) — fill remaining slots
    // with next-best regardless of family, rather than returning fewer than 3 picks.
    if (alternates.length < 2) {
      for (const c of scored.slice(1)) {
        if (alternates.length >= 2) break;
        if (alternates.includes(c) || c === primary) continue;
        alternates.push(c);
      }
    }

    const label = (c, role) => ({ role, slug: c.s.slug, title: c.s.title, url: c.s.url, tags: c.s.tags, summary: c.s.summary, family: c.family.label, why: why(c) });
    const recRes = {
      query: args.query || "",
      tags: args.tags || [],
      picks: [label(primary, "primary"), ...alternates.map((c) => label(c, "alternate"))],
      next_step: "Call get_design_system(slug) on whichever the user picks to get its actual grounded tokens — never build from these summaries alone.",
    };
    if (unmatchedRec.length) {
      recRes.unmatched_terms = unmatchedRec;
      recRes.warning = `These query terms matched nothing: ${unmatchedRec.join(", ")}. The picks reflect only the remaining terms — tell the user which part of their brief the library couldn't cover.`;
    }
    return recRes;
  }

  if (name === "get_critique_rubric") {
    return {
      instructions: "Apply this yourself against the design in front of you — this tool returns the rubric, it does not see or judge anything server-side. Score each dimension 0-10, then output Keep / Fix / Quick-wins.",
      dimensions: [
        { key: "reference_fidelity", question: "Does it honor a real system, or is it generic?", check: "squint test — blur your eyes, is the hierarchy still legible?" },
        { key: "visual_hierarchy", question: "Does the eye flow where intended?", check: "title:body contrast ≥ 2.5×" },
        { key: "craft", question: "Alignment, spacing rhythm, restraint.", check: "one grid, ≤3-4 colors, ≤2 type families" },
        { key: "function", question: "Would removing any element make it worse?", check: "if not, it's filler — cut it" },
        { key: "originality", question: "A signature move, or template clichés?", check: "e.g. a gradient orb defaulting to \"AI\" is a cliché, not a choice" },
      ],
      output_shape: {
        total: "sum of the 5 scores, out of 50",
        keep: "what's actually working — be specific, not generic praise",
        fix: "tag each issue ⚠️ fatal / ⚡ important / 💡 polish",
        quick_wins: "top 3 five-minute fixes, ordered by impact",
      },
      note: "Critique the design, not the designer.",
    };
  }

  throw new Error(`unknown tool: ${name}`);
}

/** 处理单条 JSON-RPC 消息，两种传输（stdio / http）共用。
 *  通知（无 id）返回 null——两边都不回。 */
export async function handleMessage(req, { protocolVersion } = {}) {
  if (!req || typeof req !== "object") return null;  // null/畸形消息直接忽略——曾被 4 字节 'null' 打挂常驻进程
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
