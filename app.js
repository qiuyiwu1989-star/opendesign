const STORAGE_KEY = "style-atlas-drafts";
const OWNER_MODE = new URLSearchParams(location.search).has("owner");
const curatedSites = Array.isArray(window.STYLE_ATLAS_SITES) ? window.STYLE_ATLAS_SITES : [];

// i18n 短别名（i18n.js 在 app.js 之前加载，window.i18n 已就绪）
const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

let sites = loadSites();
let activeSite = sites[0];
let activeTag = "All";
let searchQuery = "";
let sortMode = "curated"; // "curated"（curator 给的顺序）| "popular"（全站收藏 desc）
let currentView = "canvas";
let viewState = { x: -110, y: -70, scale: 1 };
let dragging = false;
let dragStart = { x: 0, y: 0 };
let panStart = { x: 0, y: 0 };

const canvasSurface = document.querySelector("#canvasSurface");
const canvasGrid = document.querySelector("#canvasGrid");
const tagFilters = document.querySelector("#tagFilters");
const searchInput = document.querySelector("#searchInput");
const libraryList = document.querySelector("#libraryList");
const detailDrawer = document.querySelector("#detailDrawer");
const collectModal = document.querySelector("#collectModal");
const collectForm = document.querySelector("#collectForm");
const collectUrlInput = document.querySelector("#collectUrlInput");
const urlDropZone = document.querySelector("#urlDropZone");
const previewShot = document.querySelector("#previewShot");
const previewTitle = document.querySelector("#previewTitle");
const previewMeta = document.querySelector("#previewMeta");
const previewTags = document.querySelector("#previewTags");
const autoCollectButton = document.querySelector("#autoCollectButton");
const toast = document.querySelector("#toast");

function loadSites() {
  if (!OWNER_MODE) return curatedSites;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return curatedSites;
  try {
    const drafts = JSON.parse(stored);
    if (!Array.isArray(drafts) || !drafts.length) return curatedSites;
    const curatedIds = new Set(curatedSites.map((site) => site.id));
    const newDrafts = drafts.filter((draft) => !curatedIds.has(draft.id));
    return [...newDrafts, ...curatedSites];
  } catch {
    return curatedSites;
  }
}

function saveSites() {
  if (!OWNER_MODE) return;
  const curatedIds = new Set(curatedSites.map((site) => site.id));
  const drafts = sites.filter((site) => !curatedIds.has(site.id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

function siteAsJsonSnippet(site) {
  const ordered = {
    id: site.id,
    title: site.title,
    url: site.url,
    image: site.image,
    tags: site.tags,
    palette: site.palette,
    layout: site.layout,
    interaction: site.interaction,
    motion: site.motion,
    notes: site.notes
  };
  return JSON.stringify(ordered, null, 2);
}

/* ====== DATA STORE ======
 * 双层架构：localStorage（即时缓存）+ Supabase（云端权威）。
 * - 无 supabase-config.js 或网络不通时：自动降级到纯 localStorage，UI 体感不变
 * - 有 Supabase 时：本地响应立即同步给 UI（乐观更新），网络后台异步推送
 * - store.init() 在 app 启动后跑一次，把云端状态拉下来合并 + 把本地遗留 push 上去
 */
const SAVED_KEY = "style-atlas-saved";
const LIKED_KEY = "style-atlas-liked";
const VISITOR_KEY = "style-atlas-visitor";
const LIKE_COUNTS_KEY = "style-atlas-like-counts";
const SAVE_COUNTS_KEY = "style-atlas-save-counts";

function readIdSet(key) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function writeIdSet(key, set) {
  localStorage.setItem(key, JSON.stringify([...set]));
}

function readLikeCounts() {
  try {
    const obj = JSON.parse(localStorage.getItem(LIKE_COUNTS_KEY) || "{}");
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function writeLikeCounts(map) {
  localStorage.setItem(LIKE_COUNTS_KEY, JSON.stringify(Object.fromEntries(map)));
}

function readSaveCounts() {
  try {
    const obj = JSON.parse(localStorage.getItem(SAVE_COUNTS_KEY) || "{}");
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function writeSaveCounts(map) {
  localStorage.setItem(SAVE_COUNTS_KEY, JSON.stringify(Object.fromEntries(map)));
}

function getVisitorId() {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

const visitorId = getVisitorId();

const supabaseClient = (() => {
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url || !cfg.anonKey) return null;
  if (!window.supabase || !window.supabase.createClient) {
    console.warn("[supabase] SDK not loaded; falling back to localStorage");
    return null;
  }
  try {
    return window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false }
    });
  } catch (err) {
    console.warn("[supabase] init failed; falling back to localStorage", err);
    return null;
  }
})();

const store = {
  saved: readIdSet(SAVED_KEY),
  liked: readIdSet(LIKED_KEY),
  likeCounts: readLikeCounts(),
  saveCounts: readSaveCounts(),
  backend: supabaseClient ? "supabase" : "local",

  isSaved(id) { return this.saved.has(id); },
  isLiked(id) { return this.liked.has(id); },

  /** Supabase 模式：返回全局聚合计数；本地模式：当前访客是否点过赞（0/1）。 */
  likeCount(id) {
    if (this.backend === "supabase") return this.likeCounts.get(id) || 0;
    return this.liked.has(id) ? 1 : 0;
  },

  /** 全站累计收藏数（含当前访客）。 */
  saveCount(id) {
    if (this.backend === "supabase") return this.saveCounts.get(id) || 0;
    return this.saved.has(id) ? 1 : 0;
  },

  toggleSaved(id) {
    const wasSaved = this.saved.has(id);
    if (wasSaved) {
      this.saved.delete(id);
      this.saveCounts.set(id, Math.max(0, (this.saveCounts.get(id) || 1) - 1));
    } else {
      this.saved.add(id);
      this.saveCounts.set(id, (this.saveCounts.get(id) || 0) + 1);
    }
    writeIdSet(SAVED_KEY, this.saved);
    writeSaveCounts(this.saveCounts);
    if (supabaseClient) this._push("saves", id, wasSaved);
    return !wasSaved;
  },

  toggleLiked(id) {
    const wasLiked = this.liked.has(id);
    if (wasLiked) {
      this.liked.delete(id);
      this.likeCounts.set(id, Math.max(0, (this.likeCounts.get(id) || 1) - 1));
    } else {
      this.liked.add(id);
      this.likeCounts.set(id, (this.likeCounts.get(id) || 0) + 1);
    }
    writeIdSet(LIKED_KEY, this.liked);
    writeLikeCounts(this.likeCounts);
    if (supabaseClient) this._push("likes", id, wasLiked);
    return !wasLiked;
  },

  savedSites(allSites) {
    return allSites.filter((s) => this.saved.has(s.id));
  },

  /** 后台异步推送，失败不阻塞 UI（本地已成功，下次 init 会重试同步）。 */
  async _push(table, siteId, wasOn) {
    try {
      if (wasOn) {
        await supabaseClient.from(table).delete()
          .match({ visitor_id: visitorId, site_id: siteId });
      } else {
        await supabaseClient.from(table)
          .upsert({ visitor_id: visitorId, site_id: siteId }, { onConflict: "visitor_id,site_id" });
      }
    } catch (err) {
      console.warn(`[supabase] ${table} sync failed`, err);
    }
  },

  /** 启动时跑一次：拉取云端 → 合并本地 → 把本地遗留补推上去 → 更新全局计数。 */
  async init() {
    if (!supabaseClient) return;
    try {
      const [savesRes, likesRes, likeCountsRes, saveCountsRes] = await Promise.all([
        supabaseClient.from("saves").select("site_id").eq("visitor_id", visitorId),
        supabaseClient.from("likes").select("site_id").eq("visitor_id", visitorId),
        supabaseClient.from("site_like_counts").select("*"),
        supabaseClient.from("site_save_counts").select("*")
      ]);

      const remoteSaved = new Set((savesRes.data || []).map((r) => r.site_id));
      const remoteLiked = new Set((likesRes.data || []).map((r) => r.site_id));

      await this._reconcile("saves", this.saved, remoteSaved);
      await this._reconcile("likes", this.liked, remoteLiked);

      this.saved = new Set([...this.saved, ...remoteSaved]);
      this.liked = new Set([...this.liked, ...remoteLiked]);
      writeIdSet(SAVED_KEY, this.saved);
      writeIdSet(LIKED_KEY, this.liked);

      this.likeCounts = new Map((likeCountsRes.data || []).map((r) => [r.site_id, r.like_count]));
      this.saveCounts = new Map((saveCountsRes.data || []).map((r) => [r.site_id, r.save_count]));
      writeLikeCounts(this.likeCounts);
      writeSaveCounts(this.saveCounts);
    } catch (err) {
      console.warn("[supabase] init read failed", err);
    }
  },

  async _reconcile(table, localSet, remoteSet) {
    const toPush = [...localSet].filter((id) => !remoteSet.has(id));
    if (!toPush.length) return;
    const rows = toPush.map((site_id) => ({ visitor_id: visitorId, site_id }));
    try {
      await supabaseClient.from(table).upsert(rows, { onConflict: "visitor_id,site_id" });
    } catch (err) {
      console.warn(`[supabase] ${table} migration failed`, err);
    }
  }
};

/* ====== SYNC CODE ======
 * 让用户把 anonymous visitor_id 跨设备携带 —— 不需要账号、邮箱、密码。
 *
 * 流程：
 *   Device A：generate → 拿到 code 如 "quiet-fern-42" → 写入 sync_codes 表
 *   Device B：bind(code) → 查表拿到 visitor_id_A → 替换 localStorage → reload
 *
 * 安全考量：拿到 code 的人都能看那个 visitor 的收藏，所以 UI 里要提醒
 *   「不要把 code 发给别人 / 不要贴公开页面」。
 */
const SYNC_ADJECTIVES = [
  "quiet","sharp","soft","bold","slow","warm","crisp","plush","rapt","keen",
  "swift","still","clear","vast","olive","rose","dove","steel","wool","milk",
  "glass","river","marble","clay","ash","dusk","dawn","mossy","linen","velvet",
  "amber","mauve","ivory","slate","pearl","azure","sable","cedar","frost","drift"
];
const SYNC_NOUNS = [
  "fern","cocoa","lemon","lake","ink","kite","fawn","vega","otto","iris",
  "jade","ember","glade","vellum","onyx","reef","dune","ferry","beam","tide",
  "rye","indigo","plume","quill","sage","silk","umber","cove","heron","fjord",
  "loom","brook","gable","atlas","wren","poppy","cairn","grove","cypress","lichen"
];

function generateSyncCode() {
  const a = SYNC_ADJECTIVES[Math.floor(Math.random() * SYNC_ADJECTIVES.length)];
  const n = SYNC_NOUNS[Math.floor(Math.random() * SYNC_NOUNS.length)];
  const d = String(Math.floor(Math.random() * 90) + 10);
  return `${a}-${n}-${d}`;
}

/** 在 Supabase 写入一个新 code 指向当前 visitor_id；冲突时重试。 */
async function createSyncCode(maxRetries = 5) {
  if (!supabaseClient) throw new Error("SUPABASE_REQUIRED");
  for (let i = 0; i < maxRetries; i++) {
    const code = generateSyncCode();
    const { error } = await supabaseClient
      .from("sync_codes")
      .insert({ code, visitor_id: visitorId });
    if (!error) return code;
    // 23505 = unique_violation
    if (error.code !== "23505") throw error;
  }
  throw new Error("CODE_GENERATION_FAILED");
}

/** 用 code 查回原 visitor_id；返回 { visitorId, createdAt } 或抛错 NOT_FOUND。 */
async function lookupSyncCode(rawCode) {
  if (!supabaseClient) throw new Error("SUPABASE_REQUIRED");
  const code = (rawCode || "").trim().toLowerCase();
  if (!code) throw new Error("EMPTY_CODE");
  const { data, error } = await supabaseClient
    .from("sync_codes")
    .select("code, visitor_id, created_at")
    .eq("code", code)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("NOT_FOUND");
  // best-effort 心跳，失败忽略
  supabaseClient.from("sync_codes").update({ last_used_at: new Date().toISOString() }).eq("code", code).then(() => {}, () => {});
  return { visitorId: data.visitor_id, createdAt: data.created_at };
}

/** 绑定后切换 localStorage 的 visitor_id 并清掉本地缓存。调用方应在成功后 reload。 */
function applySyncedVisitorId(newVisitorId) {
  localStorage.setItem(VISITOR_KEY, newVisitorId);
  // 清掉本地 saves/likes 缓存，让 reload 后从云端拉新的
  localStorage.removeItem(SAVED_KEY);
  localStorage.removeItem(LIKED_KEY);
  localStorage.removeItem(LIKE_COUNTS_KEY);
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withProtocol).toString();
}

function titleFromDomain(url) {
  const domain = domainFromUrl(url);
  const base = domain.split(".").filter(Boolean)[0] || domain;
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function screenshotForUrl(url) {
  // Legacy fallback only; pipeline now uses microlink real screenshots.
  return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=1440`;
}

/* ====== INGESTION PIPELINE ======
 * 真管道：URL → microlink 元信息 → 客户端调色板 → AI 视觉分析（占位）→ 富 spec
 * 替代旧的 inferDesignProfile + 模板拼接（那是"假装在分析"，不再用）。
 */

async function fetchMicrolinkMeta(url) {
  const endpoint = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=true`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`microlink HTTP ${res.status}`);
  const json = await res.json();
  if (json.status !== "success" || !json.data) throw new Error("microlink 返回失败");
  const d = json.data;
  return {
    title: d.title || "",
    description: d.description || "",
    screenshot: d.screenshot && d.screenshot.url,
    image: d.image && d.image.url,
    logo: d.logo && d.logo.url,
    lang: d.lang,
    author: d.author || ""
  };
}

/** 在 canvas 里采样截图主色（无需后端、无需付费 API）。
 *  返回去重后按出现频次排序的 hex 数组（最多 count 个）。*/
async function extractPaletteFromImage(imageUrl, count = 6) {
  return new Promise((resolve) => {
    if (!imageUrl) return resolve([]);
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => resolve([]), 8000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        const W = 96;
        const H = Math.max(1, Math.round((img.height || 1) * W / (img.width || 1)));
        const canvas = document.createElement("canvas");
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, W, H);
        const data = ctx.getImageData(0, 0, W, H).data;
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          // 16-bucket quantize per channel
          const r = data[i] & 0xF0;
          const g = data[i + 1] & 0xF0;
          const b = data[i + 2] & 0xF0;
          const key = (r << 16) | (g << 8) | b;
          buckets.set(key, (buckets.get(key) || 0) + 1);
        }
        const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, count * 4);
        // de-dupe by visual closeness
        const result = [];
        for (const [k] of sorted) {
          const hex = "#" + k.toString(16).padStart(6, "0").toUpperCase();
          if (!result.some((h) => colorDistance(h, hex) < 28)) result.push(hex);
          if (result.length >= count) break;
        }
        resolve(result);
      } catch (err) {
        // tainted canvas (CORS) or other failure
        console.warn("[palette] extract failed", err);
        resolve([]);
      }
    };
    img.onerror = () => { clearTimeout(timer); resolve([]); };
    img.src = imageUrl;
  });
}

function hexToRgb(hex) {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function colorDistance(a, b) {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chroma(hex) {
  const [r, g, b] = hexToRgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function paletteToTokens(palette) {
  if (!palette || palette.length === 0) return {};
  const sorted = [...palette].sort((a, b) => relativeLuminance(b) - relativeLuminance(a));
  const lightest = sorted[0];
  const darkest = sorted[sorted.length - 1];
  const mid = sorted[Math.floor(sorted.length / 2)];
  const second = sorted[1] || lightest;
  // pick most chromatic as accent if it's not too near-grey
  let accent = null, maxChroma = 28;
  for (const hex of palette) {
    const c = chroma(hex);
    if (c > maxChroma) { maxChroma = c; accent = hex; }
  }
  return {
    bg: lightest,
    bgSoft: second,
    bgQuiet: darkest,
    ink: darkest,
    inkSoft: mid,
    muted: mid,
    mutedSoft: null,
    accent,
    line: null,
    principle: accent
      ? `主色 ${accent} 用作克制强调；底色 ${lightest}，正文 ${darkest}`
      : `单色谱：底 ${lightest}，正文 ${darkest}（无强调色）`
  };
}

/** AI 视觉解读 —— 当前是 stub，留有真实 Edge Function 调用入口。
 *  接通 Anthropic API 后，整段函数只换里面的 try 分支，不动调用方。*/
async function analyzeWithAI({ url, screenshotUrl, palette, meta }) {
  const cfg = window.SUPABASE_CONFIG;
  // 真实路径：调用 Supabase Edge Function `analyze-site`
  if (cfg && cfg.url && cfg.anonKey) {
    try {
      const res = await fetch(`${cfg.url}/functions/v1/analyze-site`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: cfg.anonKey,
          Authorization: `Bearer ${cfg.anonKey}`
        },
        body: JSON.stringify({ url, screenshotUrl, palette, meta })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.spec) return { spec: data.spec, source: "ai" };
      }
    } catch (err) {
      console.info("[ai] edge function unavailable, falling back to stub", err.message);
    }
  }
  // 占位：未接通 AI 时返回结构化骨架，靠调色板填颜色层
  return { spec: makeStubSpec({ url, palette, meta }), source: "stub" };
}

function makeStubSpec({ url, palette, meta }) {
  const colors = paletteToTokens(palette || []);
  const ideas = (meta && meta.description) ? meta.description.slice(0, 120) : "";
  return {
    identity: {
      keywords: [],
      analogy: "",
      oneLiner: ideas
    },
    colors: Object.keys(colors).length ? colors : null,
    typography: null,
    spacing: null,
    surfaces: null,
    layout: null,
    components: null,
    motion: null,
    interaction: null,
    voice: null,
    donts: [],
    systemPrompt: "",
    _ai: {
      status: "pending",
      hint: "AI 视觉分析层尚未接通 —— 当前 spec 只填了颜色层（来自调色板自动提取）。接 Anthropic API 后，typography / layout / motion / voice / donts / systemPrompt 全部自动填充。"
    }
  };
}

function inferTagsFromMeta(url, meta) {
  const text = `${url} ${(meta && meta.title) || ""} ${(meta && meta.description) || ""}`.toLowerCase();
  const rules = [
    ["AI", ["ai", "gpt", "claude", "agent", "copilot", "llm"]],
    ["SaaS", ["app", "dashboard", "tool", "workspace", "platform"]],
    ["Productivity", ["task", "project", "calendar", "notes", "workspace"]],
    ["App UI", ["app", "dashboard", "workspace"]],
    ["Fintech", ["bank", "pay", "card", "cash", "fund", "wallet", "money"]],
    ["Studio", ["studio", "agency", "atelier"]],
    ["Portfolio", ["portfolio", "works", "case", "selected"]],
    ["Editorial", ["magazine", "journal", "stories", "essay", "blog"]],
    ["Ecommerce", ["shop", "store", "commerce", "buy", "market"]],
    ["Docs", ["docs", "guide", "developer", "api", "manual"]],
    ["Product", ["camera", "phone", "hardware", "device", "watch"]],
    ["Consumer", ["care", "life", "home", "family", "wellness"]],
    ["3D", ["3d", "webgl", "shader", "render"]]
  ];
  const tags = rules.filter(([, words]) => words.some((w) => text.includes(w))).map(([t]) => t);
  if (tags.length < 2) tags.push("Reference");
  return [...new Set(tags)].slice(0, 5);
}

/** 主管道：编排 4 步异步流程，通过 onStep 回调反馈进度。
 *  onStep(stepKey, "running"|"done"|"error", payload?)
 */
async function runIngestionPipeline(rawUrl, onStep = () => {}) {
  // Step 1: clean URL
  onStep("url", "running");
  let url;
  try {
    url = normalizeUrl(rawUrl);
    if (!url) throw new Error("URL 为空");
  } catch (err) {
    onStep("url", "error", { error: err.message });
    throw err;
  }
  onStep("url", "done", { url });

  // Step 2: microlink meta + real screenshot
  onStep("meta", "running");
  let meta;
  try {
    meta = await fetchMicrolinkMeta(url);
  } catch (err) {
    onStep("meta", "error", { error: err.message });
    throw err;
  }
  onStep("meta", "done", meta);

  // Step 3: client-side palette extraction
  onStep("palette", "running");
  const screenshotUrl = meta.screenshot || screenshotForUrl(url);
  const palette = meta.screenshot ? await extractPaletteFromImage(meta.screenshot, 6) : [];
  onStep("palette", "done", { palette, screenshot: screenshotUrl });

  // Step 4: AI vision analysis (stub or real Edge Function)
  onStep("ai", "running");
  const { spec, source } = await analyzeWithAI({ url, screenshotUrl, palette, meta });
  onStep("ai", "done", { spec, source });

  // Assemble final candidate site object
  const title = meta.title || titleFromDomain(url);
  const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site").slice(0, 40);
  const candidate = {
    id: `${slug}-${Date.now().toString(36).slice(-6)}`,
    title,
    url,
    image: screenshotUrl,
    tags: inferTagsFromMeta(url, meta),
    palette: palette.join(", "),
    layout: (spec.layout && spec.layout.skeleton) || "",
    interaction: (spec.interaction && spec.interaction.hover) || "",
    motion: (spec.motion && spec.motion.easing) || "",
    notes: meta.description ? meta.description.slice(0, 220) : "",
    spec
  };
  return { candidate, meta, palette, source };
}

function inferTags(url) {
  const domain = domainFromUrl(url).toLowerCase();
  const text = `${domain} ${url}`.toLowerCase();
  const rules = [
    ["AI", ["ai", "gpt", "agent", "copilot", "diagram", "perplexity", "cursor"]],
    ["SaaS", ["app", "dashboard", "tool", "workspace", "linear", "height", "notion"]],
    ["Productivity", ["task", "project", "calendar", "notes", "linear", "height", "notion", "workspace"]],
    ["App UI", ["app", "dashboard", "workspace", "linear", "height", "platform"]],
    ["Fintech", ["bank", "pay", "card", "cash", "fund", "crypto", "wallet"]],
    ["Web3", ["web3", "chain", "dao", "wallet", "nft", "crypto"]],
    ["Portfolio", ["studio", "design", "works", "agency", "portfolio"]],
    ["Ecommerce", ["shop", "store", "commerce", "buy", "market"]],
    ["Docs", ["docs", "learn", "guide", "developer", "api"]],
    ["Consumer", ["care", "life", "home", "family", "social"]],
    ["Product", ["camera", "phone", "hardware", "device"]],
    ["Editorial", ["mag", "journal", "news", "blog", "stories"]]
  ];
  const tags = rules.filter(([, words]) => words.some((word) => text.includes(word))).map(([tag]) => tag);
  if (tags.length < 2) tags.push("Reference");
  if (tags.length < 3) tags.push(text.includes("studio") || text.includes("design") ? "Experimental" : "Clean");
  return [...new Set(tags)].slice(0, 4);
}

function inferDesignProfile(url, tags) {
  const domain = domainFromUrl(url);
  const isDark = tags.some((tag) => ["AI", "Web3", "Fintech"].includes(tag));
  const isProduct = tags.some((tag) => ["SaaS", "Product", "Docs"].includes(tag));
  const isEditorial = tags.some((tag) => ["Portfolio", "Editorial", "Experimental"].includes(tag));
  return {
    palette: isDark
      ? "深色或高对比首屏，使用明确信号色建立科技感；内容区需要保留足够留白让截图可读。"
      : "浅色内容表面为主，搭配少量品牌强调色；整体应保持干净、可扫描、低噪音。",
    layout: isProduct
      ? "以真实产品界面或工作流截图作为核心证据，首屏之后按功能模块、用例和信任证明组织。"
      : "以大幅视觉资产建立第一印象，随后用分区叙事展示风格、案例、过程或关键转化入口。",
    interaction: isEditorial
      ? "浏览体验应强调探索感：悬停预览、媒体放大、平滑进入详情，同时保持导航克制。"
      : "交互应服务理解：按钮、卡片、筛选和状态反馈要清晰，悬停动作短促且不遮挡主体内容。",
    motion: isDark
      ? "适合使用短时长的发光、渐变、产品状态切换或媒体预览，避免无目的循环动效。"
      : "以轻量淡入、位移和缩放为主，动效时长控制在 120-260ms，强调稳定和响应速度。",
    notes: `${domain} 已通过链接自动入库。当前根据域名关键词生成初始标签和风格迁移文档，后续可替换为真实截图识别与 AI 标注。`
  };
}

function buildSiteFromUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const tags = inferTags(url);
  const profile = inferDesignProfile(url, tags);
  const title = titleFromDomain(url);
  return {
    id: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "site"}-${Date.now()}`,
    title,
    url,
    image: screenshotForUrl(url),
    tags,
    ...profile
  };
}

function filteredSites() {
  const query = searchQuery.trim().toLowerCase();
  const list = sites.filter((site) => {
    const tagMatch = activeTag === "All" || site.tags.includes(activeTag);
    const text = [site.title, site.url, site.notes, ...site.tags].join(" ").toLowerCase();
    return tagMatch && (!query || text.includes(query));
  });
  if (sortMode === "popular") {
    // 按全站累计收藏 DESC，相同时按 curator 原顺序作 stable tie-breaker
    const order = new Map(sites.map((s, i) => [s.id, i]));
    return [...list].sort((a, b) => {
      const diff = store.saveCount(b.id) - store.saveCount(a.id);
      return diff !== 0 ? diff : order.get(a.id) - order.get(b.id);
    });
  }
  return list;
}

function renderAll() {
  renderFilters();
  renderCanvas();
  renderLibrary();
  renderSpecExample();
  renderLibraryCount();
  renderSaved();
}

function renderLibraryCount() {
  const count = sites.length;
  // Library eyebrow (full localized string with embedded count)
  const libEyebrow = document.querySelector("#libraryEyebrow");
  if (libEyebrow) libEyebrow.textContent = t("library.eyebrow", { count });
  // Canvas footnote (full localized string)
  const footnote = document.querySelector("#canvasFootnote");
  if (footnote) footnote.innerHTML = t("canvas.footnote", { count })
    .replace(/⌘/g, '<span class="mono">⌘</span>');
}

function renderFilters() {
  const tags = ["All", ...new Set(sites.flatMap((site) => site.tags))];
  tagFilters.innerHTML = tags
    .map((tag) => {
      const label = tag === "All" ? t("chip.all") : tag;
      return `<button class="chip ${tag === activeTag ? "active" : ""}" type="button" data-tag="${tag}">${label}</button>`;
    })
    .join("");
}

function renderCanvas() {
  const visibleSites = filteredSites();
  const isMobile = window.innerWidth <= 760;
  const columns = Math.ceil(Math.sqrt(Math.max(visibleSites.length, 1)));
  const spacingX = isMobile ? 332 : 540;
  const spacingY = isMobile ? 286 : 420;
  const offsetX = -Math.floor(columns / 2) * spacingX;
  const offsetY = -Math.ceil(visibleSites.length / columns / 2) * spacingY;

  canvasGrid.innerHTML = visibleSites
    .map((site, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = offsetX + col * spacingX;
      const y = offsetY + row * spacingY;
      const tagText = site.tags.slice(0, 3).join(" · ");
      const saved = store.isSaved(site.id);
      return `
        <div class="site-node" style="transform: translate3d(${x}px, ${y}px, 0);">
          <article class="site-card" data-id="${site.id}"${saved ? ' data-saved="true"' : ""}>
            <div class="card-thumb">
              <img src="${site.image}" alt="${t("img.alt.screenshot", { title: site.title })}" draggable="false" loading="lazy" />
              <button class="card-hit" type="button" aria-label="${t("card.open.aria", { title: site.title })}"></button>
              <a class="card-visit" href="${site.url}" target="_blank" rel="noreferrer" aria-label="${t("card.visit.aria", { title: site.title })}">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
              </a>
            </div>
            <div class="card-meta">
              <span class="card-title">${site.title}</span>
              <span class="card-meta-right">
                <span class="card-tags">${tagText}</span>
                ${saveCountChip(site.id)}
                <button class="card-save" type="button" data-save="${site.id}" aria-label="${t(saved ? "drawer.save.done" : "drawer.save")}" aria-pressed="${saved}">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.5-9.3-9A5.4 5.4 0 0 1 12 6a5.4 5.4 0 0 1 9.3 6c-2.3 4.5-9.3 9-9.3 9Z" /></svg>
                </button>
              </span>
            </div>
          </article>
        </div>
      `;
    })
    .join("");
  applyTransform();
}

function renderLibrary() {
  const visibleSites = filteredSites();
  libraryList.innerHTML = visibleSites.map((site, index) => libraryCardHTML(site, index)).join("");
}

function libraryCardHTML(site, index) {
  const saved = store.isSaved(site.id);
  const count = store.saveCount(site.id);
  return `
    <article class="library-card" data-id="${site.id}"${saved ? ' data-saved="true"' : ""}>
      <div class="library-thumb">
        <img src="${site.image}" alt="${t("img.alt.screenshot", { title: site.title })}" loading="lazy" />
        <button class="card-save library-save" type="button" data-save="${site.id}" aria-label="${t(saved ? "drawer.save.done" : "drawer.save")}" aria-pressed="${saved}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.5-9.3-9A5.4 5.4 0 0 1 12 6a5.4 5.4 0 0 1 9.3 6c-2.3 4.5-9.3 9-9.3 9Z" /></svg>
        </button>
      </div>
      <div class="library-meta">
        <h3 class="library-title">${site.title}</h3>
        <span class="library-num">${t("library.num", { n: String(index + 1).padStart(2, "0") })}</span>
        <p class="library-domain">${domainFromUrl(site.url)}</p>
        <p class="library-tags">${site.tags.join(" · ")}</p>
        ${count > 0 ? `<p class="library-save-count" aria-label="${t("count.saves.aria", { n: count })}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 21s-7-4.5-9.3-9A5.4 5.4 0 0 1 12 6a5.4 5.4 0 0 1 9.3 6c-2.3 4.5-9.3 9-9.3 9Z"/></svg> ${t("count.saves", { n: count })}</p>` : ""}
      </div>
    </article>
  `;
}

/** 小标：全站累计收藏数。0 时不显示（编辑型留白）。 */
function saveCountChip(siteId) {
  const n = store.saveCount(siteId);
  if (n <= 0) return "";
  return `<span class="save-count-chip" title="${t("count.saves.aria", { n })}" aria-label="${t("count.saves.aria", { n })}">${n}</span>`;
}

function renderSaved() {
  const savedList = document.querySelector("#savedList");
  const savedEmpty = document.querySelector("#savedEmpty");
  const savedEyebrow = document.querySelector("#savedEyebrow");
  const items = store.savedSites(sites);
  if (savedEyebrow) savedEyebrow.textContent = t("saved.eyebrow", { count: items.length });
  if (!savedList) return;
  if (items.length === 0) {
    savedList.innerHTML = "";
    if (savedEmpty) savedEmpty.hidden = false;
  } else {
    if (savedEmpty) savedEmpty.hidden = true;
    savedList.innerHTML = items.map((site, index) => libraryCardHTML(site, index)).join("");
  }
  const badge = document.querySelector("#savedBadge");
  if (badge) {
    badge.textContent = items.length;
    badge.hidden = items.length === 0;
  }
}

function renderSpecExample() {
  const sample = activeSite || sites[0];
  if (!sample) return;
  document.querySelector("#specExample").textContent = createMarkdown(sample);
  const sampleTitle = document.querySelector("#aboutSampleTitle");
  if (sampleTitle) sampleTitle.textContent = `${sample.title} 风格规范`;
}

function applyTransform() {
  canvasGrid.style.transform = `translate3d(${viewState.x}px, ${viewState.y}px, 0) scale(${viewState.scale})`;
}

function openDetail(siteId) {
  activeSite = sites.find((site) => site.id === siteId) || sites[0];
  document.querySelector("#drawerMedia").innerHTML = `
    <a href="${activeSite.url}" target="_blank" rel="noreferrer" aria-label="打开 ${activeSite.title} 原始网页">
      <img src="${activeSite.image}" alt="${activeSite.title} website screenshot" />
      <span class="media-visit-badge">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
        打开原站
      </span>
    </a>
  `;
  document.querySelector("#drawerDomain").textContent = domainFromUrl(activeSite.url);
  document.querySelector("#drawerTitle").textContent = activeSite.title;
  document.querySelector("#drawerUrl").href = activeSite.url;
  document.querySelector("#drawerTags").innerHTML = activeSite.tags.map((tag) => `<span>${tag}</span>`).join("");
  document.querySelector("#insightGrid").innerHTML = [
    [t("drawer.insight.color"), activeSite.palette],
    [t("drawer.insight.layout"), activeSite.layout],
    [t("drawer.insight.interaction"), activeSite.interaction],
    [t("drawer.insight.motion"), activeSite.motion]
  ]
    .map(([title, body]) => `<section class="insight-card"><h3>${title}</h3><p>${body}</p></section>`)
    .join("");
  document.querySelector("#markdownOutput").textContent = createMarkdown(activeSite);
  refreshDrawerActions();
  detailDrawer.classList.add("open");
  detailDrawer.setAttribute("aria-hidden", "false");
  setHash(`#/sites/${activeSite.id}`, { silent: true });
}

function refreshDrawerActions() {
  if (!activeSite) return;
  const saveBtn = document.querySelector("#drawerSaveButton");
  const likeBtn = document.querySelector("#drawerLikeButton");
  const likeCount = document.querySelector("#drawerLikeCount");
  const saveCount = document.querySelector("#drawerSaveCount");
  if (saveBtn) {
    const saved = store.isSaved(activeSite.id);
    saveBtn.setAttribute("aria-pressed", saved);
    saveBtn.querySelector(".action-label").textContent = t(saved ? "drawer.save.done" : "drawer.save");
  }
  if (likeBtn) {
    const liked = store.isLiked(activeSite.id);
    likeBtn.setAttribute("aria-pressed", liked);
    likeBtn.querySelector(".action-label").textContent = t(liked ? "drawer.like.done" : "drawer.like");
  }
  if (likeCount) likeCount.textContent = store.likeCount(activeSite.id);
  if (saveCount) {
    const n = store.saveCount(activeSite.id);
    saveCount.textContent = n > 0 ? n : "";
    saveCount.hidden = n <= 0;
  }

  renderPackManifest();
}

/** 渲染详情抽屉里的「设计素材包」区 —— 文件清单 + 下载 ZIP + 复制 Agent URL */
function renderPackManifest() {
  const manifest = document.querySelector("#packManifest");
  if (!manifest || !activeSite) return;
  const pack = packsIndex[activeSite.id];
  if (!pack || !pack.files || !pack.files.length) {
    manifest.hidden = true;
    return;
  }
  manifest.hidden = false;

  // 头部数据
  document.querySelector("#packCount").textContent = pack.fileCount || pack.files.length;
  const zipSize = formatBytes(pack.zipSize || 0);
  document.querySelector("#packZipSize").textContent = zipSize;
  document.querySelector("#packCtaZipSize").textContent = zipSize;

  // 下载 ZIP 按钮
  const dlZip = document.querySelector("#packDownloadZip");
  dlZip.href = `./packs/${pack.zipFile}`;
  dlZip.setAttribute("download", `${activeSite.id}-design-pack.zip`);

  // 文件清单 —— 把 shot 类合并显示成"13 张滚动分段"
  const filesList = document.querySelector("#packFilesList");
  const grouped = groupPackFiles(pack.files);
  filesList.innerHTML = grouped.map((g) => packFileRowHTML(g, activeSite.id)).join("");
}

/** 把"03_desktop_section_*.png"合并成一行（13 张滚动分段），其他文件保持独立。*/
function groupPackFiles(files) {
  const sections = files.filter((f) => /^03_desktop_section_\d+\.png$/.test(f.name));
  const rest = files.filter((f) => !/^03_desktop_section_\d+\.png$/.test(f.name));
  // sort: spec → data → shot
  const order = { spec: 0, data: 1, shot: 2, other: 3 };
  rest.sort((a, b) => (order[a.category] - order[b.category]) || a.name.localeCompare(b.name));
  if (sections.length) {
    const totalSize = sections.reduce((acc, f) => acc + f.size, 0);
    // 插入到 shot 段开头
    const shotStart = rest.findIndex((f) => f.category === "shot");
    const sectionRow = {
      name: `03_desktop_section_*.png`,
      _displayName: `桌面滚动分段 × ${sections.length}`,
      size: totalSize,
      category: "shot",
      desc: `${sections.length} 张滚动截图（90% viewport 步进，作为视觉证据）`,
      _isGroup: true,
      _items: sections
    };
    if (shotStart >= 0) rest.splice(shotStart, 0, sectionRow);
    else rest.push(sectionRow);
  }
  return rest;
}

function packFileRowHTML(f, slug) {
  const icon = f.category === "spec" ? "📄"
             : f.category === "data" ? "🔢"
             : f.category === "shot" ? "🖼"
             : "📦";
  const sizeText = formatBytes(f.size);
  const displayName = f._displayName || f.name;
  // 单文件直接链接；group 链接到 folder（让用户去 nginx 目录列表看，或我们以后做画廊预览）
  const href = f._isGroup ? `./packs/${slug}/` : `./packs/${slug}/${f.name}`;
  const isImage = /\.png$|\.jpe?g$|\.webp$|\.svg$/i.test(f.name);
  const target = isImage || f._isGroup ? "_blank" : "_self";
  return `
    <li class="pack-file" data-category="${f.category}">
      <span class="pack-file-icon">${icon}</span>
      <a class="pack-file-name" href="${href}" target="${target}" rel="noreferrer">${displayName}</a>
      <span class="pack-file-desc">${f.desc || ""}</span>
      <span class="pack-file-size">${sizeText}</span>
    </li>
  `;
}

function closeDetail() {
  detailDrawer.classList.remove("open");
  detailDrawer.setAttribute("aria-hidden", "true");
  const current = parseHash();
  if (current.route === "site") setHash(viewToHash(currentView), { silent: true });
}

/* ====== Rich Markdown Generator ======
 * 优先用 site.spec 的 11 层富数据；缺失字段降级到旧 flat 字段。
 * 输出可直接喂给 Claude / Cursor / v0 的设计系统迁移规范。
 */
function createMarkdown(site) {
  const spec = site.spec || {};
  const domain = domainFromUrl(site.url);
  const today = new Date().toISOString().slice(0, 10);
  return [
    `# ${site.title} · 设计系统迁移规范`,
    "",
    `> 用途：把 ${domain} 的视觉、结构、交互、动效、文案规则抽离成可被 AI 直接复用的设计 DNA。`,
    `> 只迁移气质、节奏和组织方式 —— 不复制品牌资产、不抄文案。`,
    "",
    section0Source(site, domain, today),
    section1Identity(site, spec),
    section2Colors(spec, site),
    section3Typography(spec),
    section4Spacing(spec),
    section5Surfaces(spec),
    section6Layout(spec, site),
    section7Components(spec),
    section8Motion(spec, site),
    section9Interaction(spec, site),
    section10Voice(spec),
    section11Donts(spec),
    section12SystemPrompt(site, spec, domain)
  ].filter(Boolean).join("\n");
}

function section0Source(site, domain, today) {
  return [
    "## 0. 来源 Source",
    `- **URL**: ${site.url}`,
    `- **域名**: ${domain}`,
    `- **标签**: ${(site.tags || []).join(" · ") || "—"}`,
    `- **截图**: ${site.image}`,
    `- **收录时间**: ${today}`,
    site.notes ? `- **收录原因**: ${site.notes}` : null,
    ""
  ].filter(Boolean).join("\n");
}

function section1Identity(site, spec) {
  const id = spec.identity;
  if (!id) {
    return [
      "## 1. 设计气质 DNA",
      `- ${site.notes || "克制、清晰、真实内容优先"}`,
      ""
    ].join("\n");
  }
  return [
    "## 1. 设计气质 DNA",
    `- **一句话**: ${id.oneLiner || "—"}`,
    `- **关键词**: ${(id.keywords || []).join(" · ") || "—"}`,
    `- **类比**: ${id.analogy || "—"}`,
    ""
  ].join("\n");
}

function section2Colors(spec, site) {
  const c = spec.colors;
  if (!c) {
    return [
      "## 2. 颜色 Tokens",
      `- 描述: ${site.palette || "—"}`,
      "- ⚠️ 缺精确 hex tokens（待 AI 分析或人工补齐）",
      ""
    ].join("\n");
  }
  const rows = [
    ["--bg",        c.bg,        "主页面底色"],
    ["--bg-soft",   c.bgSoft,    "内容卡片底"],
    ["--bg-quiet",  c.bgQuiet,   "深色 / 安静区域"],
    ["--ink",       c.ink,       "正文、按钮文字"],
    ["--ink-soft",  c.inkSoft,   "次级文字"],
    ["--muted",     c.muted,     "metadata / placeholder"],
    ["--muted-soft", c.mutedSoft, "更弱的提示"],
    ["--accent",    c.accent,    "唯一强调色（如有）"],
    ["--line",      c.line,      "分隔线"]
  ].filter(([, v]) => v != null && v !== "");
  return [
    "## 2. 颜色 Tokens",
    "",
    "| Token | 值 | 用法 |",
    "|---|---|---|",
    ...rows.map(([k, v, use]) => `| \`${k}\` | \`${v}\` | ${use} |`),
    "",
    c.principle ? `**用色原则**：${c.principle}` : null,
    ""
  ].filter(Boolean).join("\n");
}

function section3Typography(spec) {
  const t = spec.typography;
  if (!t) {
    return ["## 3. 字体 Typography", "- ⚠️ 待 AI 分析或人工补齐", ""].join("\n");
  }
  return [
    "## 3. 字体 Typography",
    "",
    "### 字体族",
    `- **Display**: ${t.display || "—"}`,
    `- **Body**: ${t.body || "—"}`,
    `- **Mono**: ${t.mono || "—"}`,
    "",
    "### 字号阶",
    "",
    "| Token | Size | Line-height | Weight | Letter-spacing | 用法 |",
    "|---|---|---|---|---|---|",
    ...((t.scale || []).map(s =>
      `| ${s.token} | ${s.size}px | ${s.lh} | ${s.weight} | ${s.ls} | ${s.use} |`
    )),
    "",
    (t.rules && t.rules.length) ? "### 字体规则\n" + t.rules.map(r => `- ${r}`).join("\n") : null,
    ""
  ].filter(Boolean).join("\n");
}

function section4Spacing(spec) {
  const s = spec.spacing;
  if (!s) return ["## 4. 间距 Spacing", "- ⚠️ 待补齐", ""].join("\n");
  return [
    "## 4. 间距 Spacing",
    `- **基础单位**: ${s.base}px`,
    `- **间距阶**: ${(s.scale || []).join(" / ")} px`,
    s.rhythm ? `- **节奏**: ${s.rhythm}` : null,
    ""
  ].filter(Boolean).join("\n");
}

function section5Surfaces(spec) {
  const s = spec.surfaces;
  if (!s) return ["## 5. 圆角 / 阴影 / 边线", "- ⚠️ 待补齐", ""].join("\n");
  const r = s.radius || {};
  return [
    "## 5. 圆角 / 阴影 / 边线",
    "",
    "### 圆角",
    `- 小元件: ${r.sm ?? "—"}${r.sm != null ? "px" : ""}`,
    `- 中元件: ${r.md ?? "—"}${r.md != null ? "px" : ""}`,
    `- 大卡片 / 模态: ${r.lg ?? "—"}${r.lg != null ? "px" : ""}`,
    `- Pill (chip/button): ${r.pill ?? 999}px`,
    "",
    "### 阴影",
    ...((s.shadows || ["—"]).map(x => `- ${x}`)),
    "",
    "### 边线",
    `- ${s.borders || "—"}`,
    ""
  ].join("\n");
}

function section6Layout(spec, site) {
  const l = spec.layout;
  if (!l) {
    return [
      "## 6. 布局 Layout",
      `- 页面骨架: ${site.layout || "—"}`,
      ""
    ].join("\n");
  }
  return [
    "## 6. 布局 Layout",
    `- **容器最大宽度**: ${l.container || "—"}px`,
    `- **段落最大宽度**: ${l.paragraph || "—"}px`,
    `- **栅格**: ${l.columns || "—"} 列, gutter ${l.gutter || "—"}px`,
    `- **响应式断点**: ${(l.breakpoints || []).join(" / ") || "—"} px`,
    "",
    "### 页面骨架",
    l.skeleton || site.layout || "—",
    ""
  ].join("\n");
}

function section7Components(spec) {
  const c = spec.components;
  if (!c) return ["## 7. 组件 Components", "- ⚠️ 待补齐", ""].join("\n");
  const rows = [
    ["Button", c.button],
    ["Card",   c.card],
    ["Chip",   c.chip],
    ["Input",  c.input],
    ["Hero",   c.hero]
  ].filter(([, v]) => v);
  return [
    "## 7. 组件 Components",
    "",
    ...rows.map(([name, recipe]) => `### ${name}\n${recipe}\n`)
  ].join("\n");
}

function section8Motion(spec, site) {
  const m = spec.motion;
  if (!m) {
    return [
      "## 8. 动效 Motion",
      `- 描述: ${site.motion || "—"}`,
      ""
    ].join("\n");
  }
  const d = m.durations || {};
  return [
    "## 8. 动效 Motion",
    "",
    "| 名称 | duration | 用途 |",
    "|---|---|---|",
    `| micro | ${d.micro || "—"}ms | hover / 状态切换 / focus |`,
    `| small | ${d.small || "—"}ms | 卡片提升 / 浮层 |`,
    `| medium | ${d.medium || "—"}ms | 图片缩放 / drawer open |`,
    "",
    `- **Easing**: \`${m.easing || "—"}\``,
    "",
    (m.patterns && m.patterns.length) ? "### 动效模式\n" + m.patterns.map(p => `- ${p}`).join("\n") : null,
    ""
  ].filter(Boolean).join("\n");
}

function section9Interaction(spec, site) {
  const i = spec.interaction;
  if (!i) {
    return [
      "## 9. 交互 Interaction",
      `- 核心交互: ${site.interaction || "—"}`,
      ""
    ].join("\n");
  }
  return [
    "## 9. 交互 Interaction",
    `- **Hover**: ${i.hover || "—"}`,
    `- **Click**: ${i.click || "—"}`,
    `- **Transition**: ${i.transition || "—"}`,
    `- **Keyboard**: ${i.keyboard || "—"}`,
    ""
  ].join("\n");
}

function section10Voice(spec) {
  const v = spec.voice;
  if (!v) return ["## 10. 文案语气 Voice", "- ⚠️ 待补齐", ""].join("\n");
  return [
    "## 10. 文案语气 Voice",
    `- **语气**: ${v.tone || "—"}`,
    `- **标题写法**: ${v.headlineStyle || "—"}`,
    `- **CTA**: ${v.ctaStyle || "—"}`,
    (v.avoid && v.avoid.length) ? `- **避免**: ${v.avoid.join("、")}` : null,
    ""
  ].filter(Boolean).join("\n");
}

function section11Donts(spec) {
  const d = spec.donts;
  if (!d || !d.length) {
    return [
      "## 11. 禁用清单 Don't",
      "- 不要做纯渐变背景或无内容的抽象 hero",
      "- 不要让卡片、按钮、标签发生文字溢出",
      "- 不要为了视觉丰富而增加无意义装饰元素",
      ""
    ].join("\n");
  }
  return [
    "## 11. 禁用清单 Don't",
    ...d.map(item => `- ❌ ${item}`),
    ""
  ].join("\n");
}

function section12SystemPrompt(site, spec, domain) {
  const prompt = spec.systemPrompt || defaultSystemPrompt(site, spec, domain);
  return [
    "## 12. 迁移提示词 System Prompt",
    "",
    "把下面这段整段复制到 Claude / Cursor / v0 / Lovable 等 AI 助手的 system prompt，让它按这份规范生成新页面：",
    "",
    "```",
    prompt,
    "```",
    ""
  ].join("\n");
}

function defaultSystemPrompt(site, spec, domain) {
  const parts = [`你是一位设计师。请按 ${domain} 的设计语言生成新页面，但不要复制品牌资产或文案，只迁移气质、节奏和组织方式。`];
  if (spec.identity && spec.identity.oneLiner) parts.push(`定位：${spec.identity.oneLiner}`);
  if (spec.colors && spec.colors.principle) parts.push(`配色：${spec.colors.principle}`);
  if (spec.typography && spec.typography.display) parts.push(`字体：标题 ${spec.typography.display}，正文 ${spec.typography.body || "无衬线"}。`);
  if (spec.layout && spec.layout.skeleton) parts.push(`页面骨架：${spec.layout.skeleton}`);
  if (spec.donts && spec.donts.length) parts.push(`禁用清单：${spec.donts.join("；")}。`);
  if (!spec.identity) parts.push(`视觉关键词：${site.palette || "克制、清晰、真实内容优先"}`);
  return parts.join(" ");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function copyMarkdown() {
  const text = document.querySelector("#markdownOutput").textContent;
  navigator.clipboard.writeText(text).then(() => showToast(t("toast.md.copied")));
}

function copyJsonSnippet() {
  if (!activeSite) return;
  const snippet = siteAsJsonSnippet(activeSite);
  navigator.clipboard.writeText(snippet).then(() => showToast(t("toast.json.copied")));
}

function downloadMarkdown() {
  const text = document.querySelector("#markdownOutput").textContent;
  downloadTextFile(text, markdownFilename(activeSite));
}

function markdownFilename(site) {
  const slug = site.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "design-spec"}-style-spec.md`;
}

function downloadTextFile(text, filename) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/* ====== Collect Modal Controller ====== */
let collectState = "idle"; // idle | running | done | error
let pendingCandidate = null; // 分析完成但尚未入库的候选

function openModal() {
  resetCollectModal();
  collectModal.classList.add("open");
  collectModal.setAttribute("aria-hidden", "false");
  collectUrlInput.focus();
}

function closeModal() {
  collectModal.classList.remove("open");
  collectModal.setAttribute("aria-hidden", "true");
}

function resetCollectModal() {
  collectState = "idle";
  pendingCandidate = null;
  collectUrlInput.disabled = false;
  collectUrlInput.value = "";
  setPipeline(null);
  previewShot.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>`;
  previewTitle.textContent = t("modal.preview.waiting.title");
  previewMeta.textContent = t("modal.preview.waiting.meta");
  previewTags.innerHTML = "";
  document.querySelector("#previewPalette")?.replaceChildren();
  document.querySelector("#previewSpecHint")?.classList.add("hidden");
  autoCollectButton.disabled = false;
  autoCollectButton.textContent = t("modal.button.start");
}

function setPipeline(stepStates) {
  // stepStates: null 全部清空；或 { url: "running|done|error", meta: ..., palette: ..., ai: ... }
  document.querySelectorAll("[data-pipeline]").forEach((item) => {
    item.classList.remove("running", "done", "error", "active");
    if (stepStates) {
      const s = stepStates[item.dataset.pipeline];
      if (s) item.classList.add(s);
    }
  });
}

function setPreviewFromMeta(meta, screenshotUrl) {
  if (screenshotUrl) {
    previewShot.innerHTML = `<img src="${screenshotUrl}" alt="${meta.title || "screenshot"}" />`;
  }
  if (meta.title) previewTitle.textContent = meta.title;
  if (meta.description) previewMeta.textContent = meta.description.slice(0, 140);
}

function setPreviewPalette(palette) {
  const el = document.querySelector("#previewPalette");
  if (!el) return;
  el.innerHTML = palette.map((hex) =>
    `<span class="palette-swatch" style="background:${hex}" title="${hex}"></span>`
  ).join("");
}

function setPreviewTags(tags) {
  previewTags.innerHTML = tags.map((tag) => `<span>${tag}</span>`).join("");
}

function showSpecHint(spec, source) {
  const el = document.querySelector("#previewSpecHint");
  if (!el) return;
  el.classList.remove("hidden");
  if (source === "ai") {
    el.textContent = t("spec.hint.ai");
  } else if (spec.colors) {
    el.textContent = t("spec.hint.colorsOnly");
  } else {
    el.textContent = t("spec.hint.stub");
  }
}

async function startCollect() {
  if (collectState === "running") return;
  if (collectState === "done" && pendingCandidate) {
    return commitCandidate(pendingCandidate);
  }

  const rawUrl = collectUrlInput.value.trim();
  if (!rawUrl) {
    showToast(t("toast.url.empty"));
    return;
  }

  collectState = "running";
  collectUrlInput.disabled = true;
  autoCollectButton.disabled = true;
  autoCollectButton.textContent = t("modal.button.running");

  let result;
  try {
    result = await runIngestionPipeline(rawUrl, (step, state, payload) => {
      setPipeline({
        url:     step === "url"     ? state : currentStateFor(step, "url"),
        meta:    step === "meta"    ? state : currentStateFor(step, "meta"),
        palette: step === "palette" ? state : currentStateFor(step, "palette"),
        ai:      step === "ai"      ? state : currentStateFor(step, "ai")
      });
      if (step === "meta" && state === "done") {
        setPreviewFromMeta(payload, payload.screenshot);
      }
      if (step === "palette" && state === "done") {
        setPreviewPalette(payload.palette || []);
      }
    });
  } catch (err) {
    collectState = "error";
    autoCollectButton.disabled = false;
    autoCollectButton.textContent = t("modal.button.retry");
    previewMeta.textContent = `${err.message || err}`;
    return;
  }

  setPreviewTags(result.candidate.tags);
  showSpecHint(result.candidate.spec || {}, result.source);
  pendingCandidate = result.candidate;
  collectState = "done";
  autoCollectButton.disabled = false;
  autoCollectButton.textContent = t("modal.button.commit");
}

function currentStateFor(currentStep, key) {
  // 把"还没轮到的"标 idle，已经过的标 done（管道是顺序的）
  const order = ["url", "meta", "palette", "ai"];
  const i = order.indexOf(currentStep);
  const j = order.indexOf(key);
  if (j < i) return "done";
  if (j === i) return "running";
  return "";
}

function commitCandidate(candidate) {
  sites = [candidate, ...sites];
  activeSite = candidate;
  saveSites();
  const markdown = createMarkdown(candidate);
  renderAll();
  closeModal();
  downloadTextFile(markdown, markdownFilename(candidate));
  showToast(t("toast.collect.success"));
  openDetail(candidate.id);
}

function switchView(view, { fromHash = false } = {}) {
  if (!document.querySelector(`#${view}View`)) view = "canvas";
  currentView = view;
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".canvas-view, .panel-view").forEach((section) => {
    section.classList.remove("active");
  });
  document.querySelector(`#${view}View`).classList.add("active");
  // 让 body 知道当前是不是 canvas（决定是否锁页面滚动）
  document.body.classList.toggle("canvas-active", view === "canvas");
  // 切到面板视图时，把页面滚到顶部（避免上一个视图的滚动位置错乱）
  if (view !== "canvas") window.scrollTo(0, 0);
  if (view === "saved") renderSaved();
  if (!fromHash) setHash(viewToHash(view), { silent: true });
}

/* ====== HASH ROUTER ====== */
function viewToHash(view) {
  return view === "canvas" ? "#/" : `#/${view}`;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw) return { route: "view", view: "canvas" };
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "sites" && parts[1]) return { route: "site", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "tags" && parts[1]) return { route: "tag", tag: decodeURIComponent(parts[1]) };
  if (["canvas", "library", "saved", "about"].includes(parts[0])) return { route: "view", view: parts[0] };
  return { route: "view", view: "canvas" };
}

let suppressHashApply = false;
function setHash(hash, { silent = false } = {}) {
  const target = hash || "#/";
  if (location.hash === target) return;
  if (silent) {
    suppressHashApply = true;
    history.replaceState(null, "", target);
    queueMicrotask(() => { suppressHashApply = false; });
  } else {
    location.hash = target.startsWith("#") ? target.slice(1) : target;
  }
}

function applyHash() {
  if (suppressHashApply) return;
  const state = parseHash();
  if (state.route === "site") {
    const target = sites.find((s) => s.id === state.id);
    if (target) {
      openDetail(target.id);
      return;
    }
    setHash(viewToHash("canvas"), { silent: true });
    switchView("canvas", { fromHash: true });
    return;
  }
  if (state.route === "tag") {
    activeTag = state.tag;
    if (currentView !== "canvas" && currentView !== "library") {
      switchView("canvas", { fromHash: true });
    }
    renderAll();
    return;
  }
  if (detailDrawer.classList.contains("open")) {
    detailDrawer.classList.remove("open");
    detailDrawer.setAttribute("aria-hidden", "true");
  }
  switchView(state.view, { fromHash: true });
}

canvasSurface.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button, a, input")) return;
  dragging = true;
  dragStart = { x: event.clientX, y: event.clientY };
  panStart = { x: viewState.x, y: viewState.y };
  canvasSurface.setPointerCapture(event.pointerId);
});

canvasSurface.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  viewState.x = panStart.x + event.clientX - dragStart.x;
  viewState.y = panStart.y + event.clientY - dragStart.y;
  applyTransform();
});

canvasSurface.addEventListener("pointerup", () => {
  dragging = false;
});

canvasSurface.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      const nextScale = Math.min(1.4, Math.max(0.72, viewState.scale - event.deltaY * 0.001));
      viewState.scale = nextScale;
    } else {
      viewState.x -= event.deltaX;
      viewState.y -= event.deltaY;
    }
    applyTransform();
  },
  { passive: false }
);

canvasGrid.addEventListener("click", (event) => {
  const saveBtn = event.target.closest("[data-save]");
  if (saveBtn) {
    event.stopPropagation();
    event.preventDefault();
    handleSaveToggle(saveBtn.dataset.save);
    return;
  }
  const card = event.target.closest(".site-card");
  const hit = event.target.closest(".card-hit");
  if (card && hit) openDetail(card.dataset.id);
});

function bindListClicks(listEl) {
  if (!listEl) return;
  listEl.addEventListener("click", (event) => {
    const saveBtn = event.target.closest("[data-save]");
    if (saveBtn) {
      event.stopPropagation();
      event.preventDefault();
      handleSaveToggle(saveBtn.dataset.save);
      return;
    }
    if (event.target.closest("a")) return;
    const card = event.target.closest(".library-card");
    if (card) openDetail(card.dataset.id);
  });
}

bindListClicks(libraryList);
bindListClicks(document.querySelector("#savedList"));

function handleSaveToggle(siteId) {
  const nowSaved = store.toggleSaved(siteId);
  showToast(t(nowSaved ? "toast.save.added" : "toast.save.removed"));
  document.querySelectorAll(`[data-save="${siteId}"]`).forEach((btn) => {
    btn.setAttribute("aria-pressed", nowSaved);
    btn.setAttribute("aria-label", t(nowSaved ? "drawer.save.done" : "drawer.save"));
    const card = btn.closest("[data-id]");
    if (card) {
      if (nowSaved) card.dataset.saved = "true";
      else delete card.dataset.saved;
    }
  });
  if (activeSite && activeSite.id === siteId) refreshDrawerActions();
  renderSaved();
}

function handleLikeToggle(siteId) {
  const nowLiked = store.toggleLiked(siteId);
  showToast(t(nowLiked ? "toast.like.added" : "toast.like.removed"));
  if (activeSite && activeSite.id === siteId) refreshDrawerActions();
}

tagFilters.addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  const tag = chip.dataset.tag;
  activeTag = tag;
  renderAll();
  if (tag === "All") setHash(viewToHash(currentView), { silent: true });
  else setHash(`#/tags/${encodeURIComponent(tag)}`, { silent: true });
});

searchInput.addEventListener("input", (event) => {
  searchQuery = event.target.value;
  renderAll();
});

/* 排序切换 —— 精选顺序 vs 热门（按全站累计收藏数 desc） */
document.querySelectorAll(".sort-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = btn.dataset.sort;
    if (next === sortMode) return;
    sortMode = next;
    document.querySelectorAll(".sort-option").forEach((b) => b.classList.toggle("active", b.dataset.sort === sortMode));
    renderAll();
  });
});

document.querySelectorAll("[data-close]").forEach((element) => {
  element.addEventListener("click", closeDetail);
});

document.querySelectorAll("[data-close-modal]").forEach((element) => {
  element.addEventListener("click", closeModal);
});

/* ====== Sync code modals 行为 ====== */
const syncCreateModal = document.querySelector("#syncCreateModal");
const syncBindModal = document.querySelector("#syncBindModal");
const syncCodeDisplay = document.querySelector("#syncCodeDisplay");
const syncCodeCopyBtn = document.querySelector("#syncCodeCopyBtn");
const syncBindForm = document.querySelector("#syncBindForm");
const syncBindInput = document.querySelector("#syncBindInput");
const syncBindWarn = document.querySelector("#syncBindWarn");
const syncBindSubmit = document.querySelector("#syncBindSubmit");
let lastCreatedSyncCode = null;

function closeSyncModals() {
  syncCreateModal.classList.remove("open");
  syncCreateModal.setAttribute("aria-hidden", "true");
  syncBindModal.classList.remove("open");
  syncBindModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  syncBindWarn.hidden = true;
}

document.querySelectorAll("[data-close-sync]").forEach((el) => {
  el.addEventListener("click", (e) => {
    if (e.currentTarget === e.target || e.target.matches("[data-close-sync]") || e.target.closest("[data-close-sync]") === e.currentTarget) {
      closeSyncModals();
    }
  });
});

async function openCreateSyncModal() {
  if (!supabaseClient) {
    showToast(t("sync.error.offline"));
    return;
  }
  syncCodeDisplay.textContent = "···";
  syncCreateModal.classList.add("open");
  syncCreateModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  try {
    const code = await createSyncCode();
    lastCreatedSyncCode = code;
    syncCodeDisplay.textContent = code;
  } catch (err) {
    console.warn("[sync] create failed", err);
    syncCodeDisplay.textContent = "—";
    showToast(t("sync.error.create"));
  }
}

function openBindSyncModal() {
  if (!supabaseClient) {
    showToast(t("sync.error.offline"));
    return;
  }
  syncBindInput.value = "";
  syncBindWarn.hidden = true;
  syncBindModal.classList.add("open");
  syncBindModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  setTimeout(() => syncBindInput.focus(), 80);
}

document.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "open-create-sync") openCreateSyncModal();
  if (action === "open-bind-sync") openBindSyncModal();
});

syncCodeCopyBtn.addEventListener("click", () => {
  if (!lastCreatedSyncCode) return;
  navigator.clipboard.writeText(lastCreatedSyncCode).then(
    () => showToast(t("sync.create.copied")),
    () => showToast(lastCreatedSyncCode)
  );
});

syncBindForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = syncBindInput.value.trim().toLowerCase();
  if (!code) return;
  syncBindWarn.hidden = true;
  syncBindSubmit.disabled = true;
  syncBindSubmit.textContent = t("sync.bind.submitting");
  try {
    const { visitorId: newId } = await lookupSyncCode(code);
    applySyncedVisitorId(newId);
    showToast(t("sync.bind.success"));
    // 等 toast 出来一下，再 reload 让新 visitor_id 生效
    setTimeout(() => { location.reload(); }, 600);
  } catch (err) {
    console.warn("[sync] bind failed", err);
    syncBindWarn.textContent = err.message === "NOT_FOUND"
      ? t("sync.bind.error.notfound")
      : t("sync.bind.error.generic");
    syncBindWarn.hidden = false;
    syncBindSubmit.disabled = false;
    syncBindSubmit.textContent = t("sync.bind.submit");
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (syncCreateModal.classList.contains("open") || syncBindModal.classList.contains("open")) {
      closeSyncModals();
    }
  }
});

document.querySelector("#copyMarkdownButton").addEventListener("click", copyMarkdown);
document.querySelector("#downloadMarkdownButton").addEventListener("click", downloadMarkdown);
document.querySelector("#copyJsonButton").addEventListener("click", copyJsonSnippet);
document.querySelector("#drawerSaveButton").addEventListener("click", () => {
  if (activeSite) handleSaveToggle(activeSite.id);
});
document.querySelector("#drawerLikeButton").addEventListener("click", () => {
  if (activeSite) handleLikeToggle(activeSite.id);
});
document.querySelector("#packCopyAgentUrl").addEventListener("click", () => {
  if (!activeSite) return;
  const pack = packsIndex[activeSite.id];
  if (!pack || !pack.agentUrl) return;
  const fullUrl = new URL(pack.agentUrl, location.origin).toString();
  navigator.clipboard.writeText(fullUrl).then(() => {
    showToast(t("pack.copied"));
  }).catch(() => {
    showToast(fullUrl);
  });
});

/* ====== 资产预览模态：点 pack 文件不直接跳走，改成在站内渲染 ====== */
const assetPreview = document.querySelector("#assetPreview");
const previewBody = document.querySelector("#previewBody");

document.querySelector("#packFilesList").addEventListener("click", (e) => {
  const link = e.target.closest(".pack-file-name");
  if (!link) return;
  const href = link.getAttribute("href");
  // 目录类（group 合并行）让它正常跳转去看 nginx 目录列表
  if (href.endsWith("/")) return;
  e.preventDefault();
  openAssetPreview(href, link.textContent.trim());
});

document.querySelectorAll("[data-close-preview]").forEach((el) => {
  el.addEventListener("click", closeAssetPreview);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && assetPreview.classList.contains("open")) {
    closeAssetPreview();
  }
});

function closeAssetPreview() {
  assetPreview.classList.remove("open");
  assetPreview.setAttribute("aria-hidden", "true");
  previewBody.innerHTML = "";
}

async function openAssetPreview(url, name) {
  const ext = (url.split(".").pop() || "").toLowerCase();
  const isImage = ["png", "jpg", "jpeg", "webp", "svg", "gif"].includes(ext);
  const isMarkdown = ext === "md";
  const isJson = ext === "json";

  // 头部信息
  const iconEl = document.querySelector("#previewIcon");
  const nameEl = document.querySelector("#previewName");
  const sizeEl = document.querySelector("#previewSize");
  const dlEl = document.querySelector("#previewDownload");
  iconEl.textContent = isImage ? "🖼" : isMarkdown ? "📄" : isJson ? "🔢" : "📦";
  nameEl.textContent = name;
  sizeEl.textContent = "";
  dlEl.href = url;
  dlEl.setAttribute("download", name.split("/").pop() || name);

  previewBody.innerHTML = `<p class="preview-status">${t("preview.loading")}</p>`;
  assetPreview.classList.add("open");
  assetPreview.setAttribute("aria-hidden", "false");

  try {
    if (isImage) {
      // lightbox 模式
      previewBody.innerHTML = `<div class="preview-image-wrap"><img src="${url}" alt="${name}" /></div>`;
      // 等图加载完再设大小
      const img = previewBody.querySelector("img");
      img.onload = () => {
        sizeEl.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
      };
      return;
    }
    if (isMarkdown) {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      sizeEl.textContent = formatBytes(new Blob([text]).size);
      // 渲染 markdown
      let html;
      if (window.marked && typeof window.marked.parse === "function") {
        window.marked.setOptions({ gfm: true, breaks: false, headerIds: false, mangle: false });
        html = window.marked.parse(text);
      } else {
        // 兜底：把代码块和段落简单转一下
        html = `<pre>${escapeHtml(text)}</pre>`;
      }
      previewBody.innerHTML = `<div class="preview-md">${html}</div>`;
      return;
    }
    if (isJson) {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      sizeEl.textContent = formatBytes(new Blob([text]).size);
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch {}
      previewBody.innerHTML = `<pre class="preview-code"><code>${escapeHtml(pretty)}</code></pre>`;
      return;
    }
    // 其他类型：放个链接让用户新窗口打开
    previewBody.innerHTML = `<p class="preview-status"><a href="${url}" target="_blank" rel="noreferrer">${t("preview.openRaw")} ↗</a></p>`;
  } catch (err) {
    previewBody.innerHTML = `<p class="preview-status">${t("preview.error")}：${err.message}</p>`;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
document.querySelector("#importButton").addEventListener("click", openModal);
document.querySelector("#resetViewButton").addEventListener("click", () => {
  viewState = { x: -110, y: -70, scale: 1 };
  applyTransform();
});

if (OWNER_MODE) {
  document.querySelector("#importButton").hidden = false;
  document.querySelector("#copyJsonButton").hidden = false;
  document.body.dataset.ownerMode = "true";
}

function updateLastUpdatedDate() {
  const el = document.querySelector("#lastUpdated");
  if (!el) return;
  const locale = (window.i18n && window.i18n.current === "en") ? "en-US" : "zh-CN";
  el.textContent = new Date().toLocaleDateString(locale, { year: "numeric", month: "long" });
}
updateLastUpdatedDate();


document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

collectUrlInput.addEventListener("input", () => {
  // 不在打字时拉远端；只是把"分析中"残留状态清掉，回到 idle。
  if (collectState !== "running") {
    autoCollectButton.textContent = "开始分析";
    autoCollectButton.disabled = false;
  }
});

urlDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  urlDropZone.classList.add("dragging");
});

urlDropZone.addEventListener("dragleave", () => {
  urlDropZone.classList.remove("dragging");
});

urlDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  urlDropZone.classList.remove("dragging");
  const droppedUrl = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
  collectUrlInput.value = droppedUrl.trim();
});

collectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  startCollect();
});

/* ====== Language toggle wiring ====== */
function syncLangToggle() {
  document.querySelectorAll(".lang-option").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === window.i18n.current);
  });
}

document.querySelectorAll(".lang-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    window.i18n.set(btn.dataset.lang);
  });
});
syncLangToggle();

window.addEventListener("i18n:change", () => {
  syncLangToggle();
  // 重渲染所有 JS 动态生成的内容（卡片、抽屉、模态、计数、日期等）
  renderAll();
  if (activeSite && detailDrawer.classList.contains("open")) {
    // 重新打开详情以刷新 insight grid + 状态
    openDetail(activeSite.id);
  }
  // 重渲染"最近更新"日期，按当前语言地区格式
  updateLastUpdatedDate();
  // 重新弹出 collect 模态时也会用新语言（resetCollectModal 用 t()）
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeDetail();
    closeModal();
  }
});

window.addEventListener("resize", renderCanvas);
window.addEventListener("hashchange", applyHash);

renderAll();
applyHash();

/* 启动后异步:
 * 1) merge 外部 sites-specs.json 进 curatedSites（AI 批跑产物，独立维护避免污染 sites.js）
 * 2) Supabase 拉取访客 saves/likes
 * 完成后刷新一次 UI。 */
(async () => {
  await Promise.all([
    mergeExternalSpecs(),
    loadPacksIndex()
  ]);
  await store.init();
  // spec / packs / supabase 任一有变化都要重渲
  renderAll();
  if (detailDrawer.classList.contains("open") && activeSite) {
    openDetail(activeSite.id);   // 重新渲染抽屉用新 spec / 显示下载按钮
  }
})();

/** 加载 sites-specs.json（AI 批跑结果），合并 spec 到对应 curated site。
 *  原则：sites.js 里手写的 spec 优先（用户精校过的不要被覆盖）；
 *  只有 site.spec 缺失时才用外部 spec 填。*/
async function mergeExternalSpecs() {
  try {
    const res = await fetch("./sites-specs.json", { cache: "no-cache" });
    if (!res.ok) return;
    const data = await res.json();
    let merged = 0;
    for (const s of curatedSites) {
      const ext = data[s.id];
      if (ext && ext.spec && !s.spec) {
        s.spec = ext.spec;
        merged++;
      }
    }
    if (merged > 0) console.info(`[specs] merged ${merged} AI spec(s) from sites-specs.json`);
  } catch (err) {
    // 文件不存在 / 解析失败都没事，正常运行
  }
}

/** 设计素材包索引（site.id → {file, size}）—— 决定详情抽屉是否显示「下载」按钮 */
let packsIndex = {};
async function loadPacksIndex() {
  try {
    const res = await fetch("./packs-index.json", { cache: "no-cache" });
    if (!res.ok) return;
    packsIndex = await res.json();
    console.info(`[packs] ${Object.keys(packsIndex).length} design packs available`);
  } catch (err) {
    // 没索引也没关系，按钮就藏着
  }
}

function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
