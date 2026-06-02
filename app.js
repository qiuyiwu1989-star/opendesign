const STORAGE_KEY = "style-atlas-drafts";
const OWNER_MODE = new URLSearchParams(location.search).has("owner");
const curatedSites = Array.isArray(window.STYLE_ATLAS_SITES) ? window.STYLE_ATLAS_SITES : [];

/* ========== 双发事件追踪：一次调用同时上报 GA4 + 百度统计 ========== */
window.track = function (eventName, params = {}) {
  if (typeof gtag === "function") {
    try { gtag("event", eventName, params); } catch (_) {}
  }
  if (typeof _hmt !== "undefined") {
    try {
      const category = params.category || eventName.split("_")[0] || "event";
      const label = params.label || params.slug || params.id || params.name || params.target_name || "";
      const value = Number(params.value) || 0;
      _hmt.push(["_trackEvent", category, eventName, String(label), value]);
    } catch (_) {}
  }
};
const track = window.track;
// 外链点击（跳原站等）统一上报 —— 转化漏斗核心
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="http"]');
  if (a && a.host && a.host !== location.host) {
    track("outbound_click", {
      category: "outbound",
      target_url: a.href,
      target_name: (a.getAttribute("aria-label") || a.textContent || "").trim().slice(0, 60),
    });
  }
}, true);
// 滚动深度 25/50/75/100 各一次
(function () {
  const seen = new Set();
  let scheduled = false;
  function check() {
    const h = document.documentElement;
    const pct = Math.round((h.scrollTop + window.innerHeight) / Math.max(h.scrollHeight, 1) * 100);
    for (const th2 of [25, 50, 75, 100]) {
      if (pct >= th2 && !seen.has(th2)) { seen.add(th2); track("scroll_depth", { category: "engagement", depth: th2, value: th2 }); }
    }
  }
  window.addEventListener("scroll", () => {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(() => { check(); scheduled = false; });
  }, { passive: true });
})();
// 内部高价值按钮：完整包下载 / Agent 复制 / 文档下载（按 id 委托，避免逐个改 handler）
document.addEventListener("click", (e) => {
  const id = e.target.closest("button, a")?.id;
  const EVT = {
    packDownloadZip: "pack_download", genDownloadSpec: "docs_download",
    agentCopyPrompt: "agent_copy_prompt", agentCopyUrl: "agent_copy_url",
    genCopyAgentUrl: "agent_copy_url", packCopyAgentUrl: "agent_copy_url",
    agentOpenSpec: "agent_open_spec",
  };
  if (id && EVT[id]) {
    const slug = (typeof activeSite !== "undefined" && activeSite) ? activeSite.id : "";
    track(EVT[id], { category: "agent", slug });
  }
}, true);

// i18n 短别名（i18n.js 在 app.js 之前加载，window.i18n 已就绪）
const t = (key, params) => (window.i18n ? window.i18n.t(key, params) : key);

let sites = loadSites();
let activeSite = sites[0];
let activeTag = "All";
let searchQuery = "";
let sortMode = "curated"; // "curated"（curator 给的顺序）| "popular"（全站收藏 desc）| "random"（随机探索）
let randomOrder = new Map(); // site.id → 随机序号（随机探索时用）
let sitesI18n = {};        // overlay：site_id → { lang → { palette, layout, interaction, motion, notes } }
let packsIndex = {};       // overlay：site_id → { file, size, agentUrl, ... }
let currentView = "canvas";
const HOME_VIEW = { x: -110, y: -70, scale: 1 };  // 画布默认原点
let viewState = { ...HOME_VIEW };
// 无限画布虚拟化：只渲染视口内（+ 余量）的节点，不一次性铺全部 DOM / 图片
let canvasNodes = [];                 // [{ site, x, y }] 全量定位（不进 DOM）
let canvasLayout = { nodeW: 540, nodeH: 420 };
const renderedNodes = new Map();      // site.id → 当前在 DOM 里的 .site-node
let windowRaf = 0;                    // rAF 节流句柄
let dragging = false;
let dragStart = { x: 0, y: 0 };
let panStart = { x: 0, y: 0 };
let dragMoved = false;            // 区分 tap（点开详情）vs drag（拖画布）
const DRAG_THRESHOLD = 6;         // 移动超过 6px 才算拖拽

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

/* ====== 我请求的收录（本地视图） ======
 * 用户推荐一个还没收录的 URL → 写进 Supabase submissions 队列（我们后台审）
 * + 本地存一份，让用户在「我的收藏」里立刻看得到自己提交了什么。 */
const REQUESTS_KEY = "od-requests";

function readRequests() {
  try {
    const arr = JSON.parse(localStorage.getItem(REQUESTS_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeRequests(arr) {
  localStorage.setItem(REQUESTS_KEY, JSON.stringify(arr.slice(0, 100)));
}

function addRequestLocal(rec) {
  const list = readRequests();
  // 同 host 已请求过就不重复加（更新时间）
  const i = list.findIndex((r) => r.host === rec.host);
  if (i >= 0) {
    list[i] = { ...list[i], ...rec, at: rec.at };
  } else {
    list.unshift(rec);
  }
  writeRequests(list);
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
 * 设计：每个 visitor 在 sync_codes 表里有且仅有一行（visitor_id 是 PK）。
 *   - 第一次点「我的同步码」：lazy INSERT (visitor_id, 随机 code) → 拿到 code
 *   - 之后任何时候点：SELECT 已有的 → 返回同一个 code
 *   - localStorage 也 cache 一份，无网情况下也能秒显
 *
 * 流程：
 *   Device A: getMySyncCode() → "quiet-fern-42"（固定，不变）
 *   Device B: bindSyncCode("quiet-fern-42") → SELECT visitor_id WHERE code=?
 *             → 替换 Device B 的 localStorage visitor_id → reload
 *
 * 安全：拿到 code 的人都能看到那个 visitor 的收藏，UI 里要提醒不要外发。
 */
const MY_SYNC_CODE_KEY = "style-atlas-my-sync-code";

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

function generateSyncCodeString() {
  const a = SYNC_ADJECTIVES[Math.floor(Math.random() * SYNC_ADJECTIVES.length)];
  const n = SYNC_NOUNS[Math.floor(Math.random() * SYNC_NOUNS.length)];
  const d = String(Math.floor(Math.random() * 90) + 10);
  return `${a}-${n}-${d}`;
}

/**
 * 拿到当前 visitor 的固定 sync code（幂等）。
 * 1. 先看 localStorage 缓存
 * 2. 没有 → 查 DB（SELECT WHERE visitor_id=?）
 * 3. DB 也没有 → INSERT 一个新的（冲突重试到 maxRetries）
 * 4. 成功后写回 localStorage 缓存
 */
async function getMySyncCode(maxRetries = 5) {
  if (!supabaseClient) throw new Error("SUPABASE_REQUIRED");

  // 1) localStorage 缓存
  const cached = localStorage.getItem(MY_SYNC_CODE_KEY);
  if (cached) return cached;

  // 2) 查 DB
  const { data: existing, error: selErr } = await supabaseClient
    .from("sync_codes")
    .select("code")
    .eq("visitor_id", visitorId)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing && existing.code) {
    localStorage.setItem(MY_SYNC_CODE_KEY, existing.code);
    return existing.code;
  }

  // 3) DB 也没有 → 生成 + INSERT，code 冲突时重试
  for (let i = 0; i < maxRetries; i++) {
    const code = generateSyncCodeString();
    const { error } = await supabaseClient
      .from("sync_codes")
      .insert({ visitor_id: visitorId, code });
    if (!error) {
      localStorage.setItem(MY_SYNC_CODE_KEY, code);
      return code;
    }
    // 23505 = unique_violation。可能 visitor_id 撞 PK（并发竞态）或 code 撞 unique。
    if (error.code !== "23505") throw error;
    // 如果 PK 冲突（visitor_id 已存在），说明并发场景下别的 tab 已经写入了，重新 SELECT
    const { data: again } = await supabaseClient
      .from("sync_codes")
      .select("code")
      .eq("visitor_id", visitorId)
      .maybeSingle();
    if (again && again.code) {
      localStorage.setItem(MY_SYNC_CODE_KEY, again.code);
      return again.code;
    }
    // 否则是 code 撞了 unique，下一轮换个 code 重试
  }
  throw new Error("CODE_GENERATION_FAILED");
}

/** 用 code 查回原 visitor_id。返回 { visitorId } 或抛 NOT_FOUND。 */
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
  // 清掉本地 saves/likes/sync-code 缓存，让 reload 后从云端拉新的
  localStorage.removeItem(SAVED_KEY);
  localStorage.removeItem(LIKED_KEY);
  localStorage.removeItem(LIKE_COUNTS_KEY);
  localStorage.removeItem(SAVE_COUNTS_KEY);
  localStorage.removeItem(MY_SYNC_CODE_KEY);
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/* ====== 截图加载容错 ======
 * thum.io 偶尔返回占位 / 限速 / 还在生成。给每张 site 图建一条 fallback 链：
 *   原图 → thum.io?重试 → wsrv.nl 代理 → microlink
 * 用 data-fallback-idx 记录已重试到第几级，onerror 时前进一级。
 */
function imageFallbackChain(site) {
  const target = site.url;
  const enc = encodeURIComponent(target);
  const chain = [];
  // 1) 原始 image（多半是 thum.io 1440）
  if (site.image) chain.push(site.image);
  // 2) thum.io 带 noanimate + 更小宽度（更快返回真图）
  chain.push(`https://image.thum.io/get/width/1200/noanimate/${target}`);
  // 3) wsrv.nl 代理（缓存 + 重新取）
  chain.push(`https://wsrv.nl/?url=${enc}&w=1200&output=jpg`);
  // 4) microlink 实时截图
  chain.push(`https://api.microlink.io/?url=${enc}&screenshot=true&embed=screenshot.url`);
  // 去重
  return [...new Set(chain)];
}

/** 生成 <img> 标签的 src + onerror fallback 属性串 */
function imgAttrs(site, { lazy = true } = {}) {
  const chain = imageFallbackChain(site);
  const chainAttr = encodeURIComponent(JSON.stringify(chain));
  const loading = lazy ? ' loading="lazy"' : "";
  return `src="${chain[0]}" data-fallback="${chainAttr}" data-fallback-idx="0" onerror="window.__imgFallback&&window.__imgFallback(this)"${loading}`;
}

// 全局 onerror handler：沿 fallback 链前进
window.__imgFallback = function (img) {
  try {
    const chain = JSON.parse(decodeURIComponent(img.dataset.fallback || "[]"));
    let idx = parseInt(img.dataset.fallbackIdx || "0", 10) + 1;
    if (idx < chain.length) {
      img.dataset.fallbackIdx = String(idx);
      img.src = chain[idx];
    } else {
      // 全失败 → 标记 + 移除 onerror 防死循环
      img.onerror = null;
      img.closest(".card-thumb, .library-thumb")?.classList.add("img-failed");
    }
  } catch {
    img.onerror = null;
  }
};

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
  // 1) 优先 microlink（含截图 + meta）
  try {
    const endpoint = `https://api.microlink.io/?url=${encodeURIComponent(url)}&screenshot=true&meta=true`;
    const res = await fetch(endpoint);
    if (res.ok) {
      const json = await res.json();
      if (json.status === "success" && json.data) {
        const d = json.data;
        return {
          title: d.title || "",
          description: d.description || "",
          screenshot: (d.screenshot && d.screenshot.url) || `https://image.thum.io/get/width/1440/${url}`,
          image: d.image && d.image.url,
          logo: d.logo && d.logo.url,
          lang: d.lang,
          author: d.author || "",
          _source: "microlink"
        };
      }
    }
    console.warn("[microlink] returned non-success, falling back to thum.io");
  } catch (err) {
    console.warn("[microlink] threw, falling back to thum.io:", err.message);
  }

  // 2) Fallback：thum.io 截图，无 meta（title/desc 从 URL 推断）
  const host = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return url; }
  })();
  const titleGuess = host.split(".")[0]
    .split(/[-_]/).filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
  return {
    title: titleGuess,
    description: "",
    screenshot: `https://image.thum.io/get/width/1440/${url}`,
    image: null,
    logo: null,
    lang: null,
    author: "",
    _source: "thum.io-fallback"
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
    // 搜索覆盖多语言 notes + 多语言 tags —— 日语用户搜「ブラウザ」/「フィンテック」也能命中
    const overlay = sitesI18n[site.id] || {};
    const allNotes = Object.values(overlay).map((o) => o && o.notes).filter(Boolean);
    const localizedTags = site.tags.map((tg) => window.i18n.tag(tg));
    const text = [site.title, site.url, site.notes, ...allNotes, ...site.tags, ...localizedTags].join(" ").toLowerCase();
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
  if (sortMode === "random" && randomOrder.size) {
    return [...list].sort((a, b) =>
      (randomOrder.get(a.id) ?? 0) - (randomOrder.get(b.id) ?? 0));
  }
  return list;
}

/** 随机探索：洗一副新顺序，切到 random 排序，重排画布并回到原点。 */
function shuffleExplore() {
  const ids = sites.map((s) => s.id);
  for (let i = ids.length - 1; i > 0; i -= 1) {        // Fisher–Yates 洗牌
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  randomOrder = new Map(ids.map((id, i) => [id, i]));
  sortMode = "random";
  document.querySelectorAll(".sort-option").forEach((b) => b.classList.remove("active"));
  track("shuffle", { category: "explore" });
  viewState = { ...HOME_VIEW };
  renderAll();
  reflectHomeState();
}

function renderAll() {
  renderFilters();
  renderCanvas();
  renderLibrary();
  renderSpecExample();
  renderLibraryCount();
  renderSaved();
}

/**
 * 筛选 / 搜索 / 排序改变了结果集时调用：先把画布拉回原点再重渲染。
 * 否则（虚拟化后）若用户此前拖远了，过滤出的小结果集会落在视口外，画布看起来一片空白。
 */
function applyFilterChange() {
  viewState = { ...HOME_VIEW };
  renderAll();
  reflectHomeState();
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

/** 统计每个 tag 的出现频次（在当前 sites 数据集里） */
function tagFrequency() {
  const freq = new Map();
  for (const s of sites) {
    for (const t of s.tags || []) freq.set(t, (freq.get(t) || 0) + 1);
  }
  return freq;
}

/** 与某个 tag "常同现" 的其它 tag —— 用于点选 tag 后展示「也试试」 */
function relatedTags(activeTag, limit = 5) {
  if (activeTag === "All" || !activeTag) return [];
  const cooccur = new Map();
  for (const s of sites) {
    if (!(s.tags || []).includes(activeTag)) continue;
    for (const t of s.tags) {
      if (t === activeTag) continue;
      cooccur.set(t, (cooccur.get(t) || 0) + 1);
    }
  }
  return [...cooccur.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, n]) => ({ tag, count: n }));
}

function renderFilters() {
  const freq = tagFrequency();
  // 按频次 desc 排序；同频次走 alpha
  const sorted = [...freq.keys()].sort((a, b) => {
    const d = (freq.get(b) || 0) - (freq.get(a) || 0);
    return d !== 0 ? d : a.localeCompare(b);
  });
  const tags = ["All", ...sorted];

  tagFilters.innerHTML = tags
    .map((tag) => {
      const isAll = tag === "All";
      const label = isAll ? t("chip.all") : window.i18n.tag(tag);
      const count = isAll ? sites.length : (freq.get(tag) || 0);
      const countBadge = count > 0 ? `<span class="chip-count">${count}</span>` : "";
      return `<button class="chip ${tag === activeTag ? "active" : ""}" type="button" data-tag="${tag}">${label}${countBadge}</button>`;
    })
    .join("");

  // 渲染 related-tags 提示（当前 active 不是 All 时）
  renderRelatedTags();
}

function renderRelatedTags() {
  const host = document.querySelector("#relatedTags");
  if (!host) return;
  if (activeTag === "All") { host.innerHTML = ""; host.hidden = true; return; }
  const rel = relatedTags(activeTag, 5);
  if (!rel.length) { host.innerHTML = ""; host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML =
    `<span class="related-tags-eyebrow">${t("filter.related")}</span> ` +
    rel.map(({ tag, count }) =>
      `<button class="related-tag-chip" type="button" data-tag="${tag}">${window.i18n.tag(tag)} <span class="related-tag-count">${count}</span></button>`
    ).join("");
}

/** 单个画布节点的 HTML（虚拟化时按需创建）。 */
function siteNodeHTML(site, x, y) {
  const tagText = site.tags.slice(0, 3).map((tg) => window.i18n.tag(tg)).join(" · ");
  const saved = store.isSaved(site.id);
  return `
    <div class="site-node" data-node="${site.id}" style="transform: translate3d(${x}px, ${y}px, 0);">
      <article class="site-card" data-id="${site.id}"${saved ? ' data-saved="true"' : ""}>
        <div class="card-thumb">
          <img ${imgAttrs(site)} alt="${t("img.alt.screenshot", { title: site.title })}" draggable="false" />
          <a class="card-hit" href="${siteDetailHref(site.id)}" aria-label="${t("card.open.aria", { title: site.title })}"></a>
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
    </div>`;
}

/** 计算全量节点定位（不进 DOM）。filter / resize 时调用。 */
function layoutCanvas() {
  const visibleSites = filteredSites();
  const isMobile = window.innerWidth <= 760;
  const columns = Math.ceil(Math.sqrt(Math.max(visibleSites.length, 1)));
  const spacingX = isMobile ? 332 : 540;
  const spacingY = isMobile ? 286 : 420;
  const offsetX = -Math.floor(columns / 2) * spacingX;
  const offsetY = -Math.ceil(visibleSites.length / columns / 2) * spacingY;
  canvasLayout = { nodeW: spacingX, nodeH: spacingY };
  canvasNodes = visibleSites.map((site, index) => ({
    site,
    x: offsetX + (index % columns) * spacingX,
    y: offsetY + Math.floor(index / columns) * spacingY,
  }));
}

/**
 * 虚拟化窗口：只把视口内（+ 余量）的节点渲染进 DOM；离开视口的回收。
 * 这样 1000 个站点也只挂几十个 DOM / 加载几十张图，而不是一次性全部。
 */
function updateCanvasWindow() {
  windowRaf = 0;
  const surfaceW = canvasSurface.clientWidth || window.innerWidth;
  const surfaceH = canvasSurface.clientHeight || window.innerHeight;
  const s = viewState.scale;
  const originX = surfaceW / 2 + viewState.x;   // 网格 (0,0) 在 surface 内的屏幕坐标
  const originY = surfaceH / 2 + viewState.y;
  const margin = Math.max(canvasLayout.nodeW, canvasLayout.nodeH) * 1.2; // 预渲染余量（屏幕 px）
  const nodeW = canvasLayout.nodeW * s;
  const nodeH = canvasLayout.nodeH * s;

  const wanted = new Set();
  for (const n of canvasNodes) {
    const sx = originX + n.x * s;
    const sy = originY + n.y * s;
    const visible =
      sx < surfaceW + margin && sx + nodeW > -margin &&
      sy < surfaceH + margin && sy + nodeH > -margin;
    if (!visible) continue;
    wanted.add(n.site.id);
    if (!renderedNodes.has(n.site.id)) {
      const tpl = document.createElement("template");
      tpl.innerHTML = siteNodeHTML(n.site, n.x, n.y).trim();
      const el = tpl.content.firstElementChild;
      canvasGrid.appendChild(el);
      renderedNodes.set(n.site.id, el);
    }
  }
  // 回收离开视口的节点
  for (const [id, el] of renderedNodes) {
    if (!wanted.has(id)) {
      el.remove();
      renderedNodes.delete(id);
    }
  }
}

/** rAF 节流的窗口更新（拖拽 / 缩放时高频调用）。 */
function scheduleWindowUpdate() {
  if (windowRaf) return;
  windowRaf = requestAnimationFrame(updateCanvasWindow);
}

function renderCanvas() {
  layoutCanvas();
  canvasGrid.innerHTML = "";
  renderedNodes.clear();
  updateCanvasWindow();
  applyTransform();
}

function renderLibrary() {
  const visibleSites = filteredSites();
  if (!visibleSites.length) {
    // 搜索/筛选无结果 —— 别留白让用户懵；给方向 + 指向顶部「＋ 收录」
    libraryList.innerHTML = `<div class="library-empty" style="grid-column:1/-1;text-align:center;color:var(--ink-soft);padding:64px 16px;font-size:15px;line-height:1.6;">${t("search.empty")}</div>`;
    return;
  }
  libraryList.innerHTML = visibleSites.map((site, index) => libraryCardHTML(site, index)).join("");
}

function libraryCardHTML(site, index) {
  const saved = store.isSaved(site.id);
  const count = store.saveCount(site.id);
  return `
    <article class="library-card" data-id="${site.id}"${saved ? ' data-saved="true"' : ""}>
      <a class="library-hit" href="${siteDetailHref(site.id)}" aria-label="${t("card.open.aria", { title: site.title })}"></a>
      <div class="library-thumb">
        <img ${imgAttrs(site)} alt="${t("img.alt.screenshot", { title: site.title })}" />
        <button class="card-save library-save" type="button" data-save="${site.id}" aria-label="${t(saved ? "drawer.save.done" : "drawer.save")}" aria-pressed="${saved}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.5-9.3-9A5.4 5.4 0 0 1 12 6a5.4 5.4 0 0 1 9.3 6c-2.3 4.5-9.3 9-9.3 9Z" /></svg>
        </button>
      </div>
      <div class="library-meta">
        <h3 class="library-title">${site.title}</h3>
        <span class="library-num">${t("library.num", { n: String(index + 1).padStart(2, "0") })}</span>
        <p class="library-domain">${domainFromUrl(site.url)}</p>
        <p class="library-tags">${site.tags.map((tg) => window.i18n.tag(tg)).join(" · ")}</p>
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
  const hasRequests = readRequests().length > 0;
  if (items.length === 0) {
    savedList.innerHTML = "";
    // 有请求时不显示"空空如也"（页面其实不空）
    if (savedEmpty) savedEmpty.hidden = hasRequests;
  } else {
    if (savedEmpty) savedEmpty.hidden = true;
    savedList.innerHTML = items.map((site, index) => libraryCardHTML(site, index)).join("");
  }
  renderMyRequests();
  const badge = document.querySelector("#savedBadge");
  if (badge) {
    const total = items.length + readRequests().length;
    badge.textContent = total;
    badge.hidden = total === 0;
  }
}

/** 「我请求的收录」—— 用户推荐但还没上广场的，读本地 od-requests。 */
function renderMyRequests() {
  const wrap = document.querySelector("#myRequests");
  const list = document.querySelector("#myRequestsList");
  if (!wrap || !list) return;
  const reqs = readRequests();
  if (reqs.length === 0) {
    wrap.hidden = true;
    list.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  list.innerHTML = reqs.map((r) => {
    // r.note / r.host 源自外部页面（microlink 抓到的 title）—— 一律转义防存储型 XSS
    const host = escapeHtml(r.host);
    const note = r.note ? escapeHtml(r.note) : "";
    const label = note ? `${note} · ${host}` : host;
    const status = String(r.status || "pending").replace(/[^a-z]/g, "");
    const statusKey = `requests.status.${status}`;
    return `
      <li class="request-row request-${status}">
        <a class="request-host" href="${safeHref(r.url)}" target="_blank" rel="noreferrer">${label}</a>
        <span class="request-status" data-i18n="${statusKey}">${t(statusKey)}</span>
      </li>`;
  }).join("");
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
  track("card_view", { category: "card", slug: activeSite.id, name: activeSite.title });
  // 用户存过的「刷新版」截图（localStorage）优先，否则用 site.image
  const shotOverride = localStorage.getItem(`shot-override:${activeSite.id}`);
  const heroImg = shotOverride || activeSite.image;
  document.querySelector("#drawerMedia").innerHTML = `
    <a href="${activeSite.url}" target="_blank" rel="noreferrer" aria-label="${t("drawer.visit.aria")}">
      <img id="drawerHeroImg" ${imgAttrs({ ...activeSite, image: heroImg }, { lazy: false })} alt="${activeSite.title} screenshot" />
      <span class="media-visit-badge">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" /></svg>
        ${t("drawer.media.visit")}
      </span>
    </a>
    <button class="media-refresh" id="drawerRefreshShot" type="button" title="${t("drawer.refreshShot")}" aria-label="${t("drawer.refreshShot")}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  `;
  document.querySelector("#drawerDomain").textContent = domainFromUrl(activeSite.url);
  document.querySelector("#drawerTitle").textContent = activeSite.title;
  document.querySelector("#drawerUrl").href = activeSite.url;
  document.querySelector("#drawerTags").innerHTML = activeSite.tags.map((tag) => `<span>${window.i18n.tag(tag)}</span>`).join("");
  document.querySelector("#insightGrid").innerHTML = [
    [t("drawer.insight.color"),       localizedField(activeSite, "palette")],
    [t("drawer.insight.layout"),      localizedField(activeSite, "layout")],
    [t("drawer.insight.interaction"), localizedField(activeSite, "interaction")],
    [t("drawer.insight.motion"),      localizedField(activeSite, "motion")]
  ]
    .map(([title, body]) => `<section class="insight-card"><h3>${title}</h3><p>${body}</p></section>`)
    .join("");
  document.querySelector("#markdownOutput").textContent = createMarkdown(activeSite);
  renderAgentBlock(activeSite);
  renderRelatedSites(activeSite);
  refreshDrawerActions();
  detailDrawer.classList.add("open");
  detailDrawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("drawer-open");
  // URL 用真实独立页路径 /{lang}/sites/{slug}（与静态 SEO 页一致、可分享、可索引）
  // 不用 hash —— 让 URL 看起来就是详情页，刷新时 nginx 给静态 HTML
  const lang = (window.i18n && window.i18n.current) || "en";
  const detailPath = `/${lang}/sites/${activeSite.id}`;
  if (location.pathname !== detailPath) {
    history.pushState({ site: activeSite.id }, "", detailPath);
  }
}

/** 详情页 URL（供卡片 <a href> 用，爬虫可跟随）*/
function siteDetailHref(slug) {
  const lang = (window.i18n && window.i18n.current) || "en";
  return `/${lang}/sites/${slug}`;
}

/* ====== 给 AI Agent 的入口 ======
 * 每个作品页都有：一个 folder URL（serve DESIGN.md）+ 一段可直接粘的提示词。
 * Agent URL 协议：opendesign.cc/packs/<slug>/ → nginx 默认 serve DESIGN.md
 */
function agentSpecUrl(slug) {
  return `${location.origin}/packs/${slug}/`;
}

function agentPromptText(site) {
  const url = agentSpecUrl(site.id);
  const name = site.title;
  return t("agent.promptTemplate", { name, url });
}

function renderAgentBlock(site) {
  const block = document.querySelector("#agentBlock");
  if (!block || !site) return;
  const promptEl = document.querySelector("#agentPrompt");
  const openSpec = document.querySelector("#agentOpenSpec");
  if (promptEl) promptEl.textContent = agentPromptText(site);
  if (openSpec) openSpec.href = agentSpecUrl(site.id);
  block.dataset.slug = site.id;
}

/* ====== 相关推荐（详情抽屉底部）======
 * 相似度计算：tag Jaccard (0..1) × 1.0  +  accent 色相似度 (0..1) × 0.4
 * → 选 top 4，过滤已收藏 / 同 id
 */
function colorDistance(hexA, hexB) {
  if (!hexA || !hexB) return Infinity;
  const p = (h) => {
    const m = h.replace("#","").match(/(\w\w)(\w\w)(\w\w)/);
    return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : null;
  };
  const a = p(hexA), b = p(hexB);
  if (!a || !b) return Infinity;
  return Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
}

function relatedSitesFor(site, limit = 4) {
  const myTags = new Set(site.tags || []);
  if (myTags.size === 0) return [];
  const myBg = site.spec && site.spec.colors && site.spec.colors.bg;
  const myAccent = site.spec && site.spec.colors && site.spec.colors.accent;

  const scored = [];
  for (const other of sites) {
    if (other.id === site.id) continue;
    const otherTags = new Set(other.tags || []);
    // Jaccard
    const inter = [...myTags].filter((t) => otherTags.has(t)).length;
    const uni = new Set([...myTags, ...otherTags]).size;
    const jaccard = uni > 0 ? inter / uni : 0;
    if (jaccard < 0.1) continue;

    // bg / accent 色距（归一化到 0..1）
    let colorSim = 0;
    if (myBg && other.spec && other.spec.colors && other.spec.colors.bg) {
      const d = colorDistance(myBg, other.spec.colors.bg);
      if (isFinite(d)) colorSim += 1 - Math.min(d / 441, 1); // max RGB dist
    }
    if (myAccent && other.spec && other.spec.colors && other.spec.colors.accent) {
      const d = colorDistance(myAccent, other.spec.colors.accent);
      if (isFinite(d)) colorSim += (1 - Math.min(d / 441, 1)) * 0.5;
    }

    const score = jaccard * 1.0 + colorSim * 0.4;
    scored.push({ site: other, score, jaccard, sharedTags: inter });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function renderRelatedSites(site) {
  const section = document.querySelector("#relatedSites");
  const grid = document.querySelector("#relatedSitesGrid");
  if (!section || !grid) return;

  const rel = relatedSitesFor(site, 4);
  if (rel.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  grid.innerHTML = rel.map(({ site: s, sharedTags }) => `
    <a class="related-site-card" data-related="${s.id}" href="#/sites/${s.id}">
      <div class="related-site-thumb">
        <img src="${s.image}" alt="${s.title}" loading="lazy" />
      </div>
      <div class="related-site-meta">
        <span class="related-site-name">${s.title}</span>
        <span class="related-site-tags">${(s.tags || []).slice(0, 2).map((tg) => window.i18n.tag(tg)).join(" · ")}</span>
        <span class="related-site-shared">${t("drawer.related.shared", { n: sharedTags })}</span>
      </div>
    </a>
  `).join("");
}

// 点相关推荐 → 切到那个 site
document.querySelector("#relatedSitesGrid")?.addEventListener("click", (e) => {
  const card = e.target.closest("[data-related]");
  if (!card) return;
  e.preventDefault();
  openDetail(card.dataset.related);
});

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
  const gen = document.querySelector("#packGenerate");
  const pack = packsIndex[activeSite.id];
  if (!pack || !pack.files || !pack.files.length) {
    // 没有 ZIP 素材包 → 显示「生成设计系统」面板（客户端从 11 层 spec 实时组装）
    manifest.hidden = true;
    if (gen) { gen.hidden = false; setupGenerate(activeSite); }
    return;
  }
  manifest.hidden = false;
  if (gen) gen.hidden = true;

  // 头部数据
  document.querySelector("#packCount").textContent = pack.fileCount || pack.files.length;
  const zipSize = formatBytes(pack.zipSize || 0);
  document.querySelector("#packZipSize").textContent = zipSize;
  document.querySelector("#packCtaZipSize").textContent = zipSize;

  // 下载 ZIP 按钮
  const dlZip = document.querySelector("#packDownloadZip");
  dlZip.href = `/packs/${pack.zipFile}`;
  dlZip.setAttribute("download", `${activeSite.id}-design-pack.zip`);

  // 文件清单 —— 把 shot 类合并显示成"13 张滚动分段"
  const filesList = document.querySelector("#packFilesList");
  const grouped = groupPackFiles(pack.files);
  filesList.innerHTML = grouped.map((g) => packFileRowHTML(g, activeSite.id)).join("");
}

/** 「完整包」面板状态复位：已请求过的站显示「已加入队列」，否则显示「请求生成」按钮。 */
function setupGenerate(site) {
  const btn = document.querySelector("#genRequestButton");
  const requested = document.querySelector("#genRequested");
  const view = document.querySelector("#genViewDesign");
  if (!btn || !requested) return;
  if (view) view.href = `/packs/${site.id}/`;   // 文件夹 URL：nginx 以 DESIGN.md 为 index
  btn.disabled = false;
  const already = localStorage.getItem(`packreq:${site.id}`) === "1";
  btn.hidden = already;
  requested.hidden = !already;
}

/**
 * 点「请求生成完整设计系统」：写进生成队列（kind='pack'），curator 用 mimo from-extract 管线产出完整包。
 * 浏览器不直接调 mimo（钥匙/成本/防滥用）—— 这里只下单，真正生成在服务端/本地跑。
 */
async function requestPackGeneration(site) {
  let host = site.url;
  try { host = new URL(normalizeUrl(site.url)).hostname.replace(/^www\./, ""); } catch {}
  // 本地立刻标记 + 切到「已请求」
  localStorage.setItem(`packreq:${site.id}`, "1");
  const btn = document.querySelector("#genRequestButton");
  const requested = document.querySelector("#genRequested");
  if (btn) btn.hidden = true;
  if (requested) requested.hidden = false;
  track("pack_request", { category: "pack", slug: site.id, name: site.title });
  showToast(t("gen.req.toast"));
  // 异步写云端队列（失败不阻塞）
  if (supabaseClient) {
    supabaseClient.from("submissions").insert({
      url: site.url, host, note: site.title || host,
      visitor_id: visitorId, kind: "pack", slug: site.id,
    }).then(({ error }) => { if (error) console.warn("[pack-request] insert failed", error); },
            (err) => console.warn("[pack-request] insert failed", err));
  }
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
      _displayName: t("pack.dyn.scrollSegments.name", { n: sections.length }),
      size: totalSize,
      category: "shot",
      desc: t("pack.dyn.scrollSegments.desc", { n: sections.length }),
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
  const href = f._isGroup ? `/packs/${slug}/` : `/packs/${slug}/${f.name}`;
  const isImage = /\.png$|\.jpe?g$|\.webp$|\.svg$/i.test(f.name);
  const target = isImage || f._isGroup ? "_blank" : "_self";
  return `
    <li class="pack-file" data-category="${f.category}">
      <span class="pack-file-icon">${icon}</span>
      <a class="pack-file-name" href="${href}" target="${target}" rel="noreferrer">${displayName}</a>
      <span class="pack-file-desc">${window.i18n.packDesc(f.desc) || ""}</span>
      <span class="pack-file-size">${sizeText}</span>
    </li>
  `;
}

function closeDetail() {
  detailDrawer.classList.remove("open");
  detailDrawer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("drawer-open");
  // 如果当前 URL 是 /{lang}/sites/{slug} 详情页路径，退回到列表/画布根
  if (/^\/[a-zA-Z-]+\/sites\//.test(location.pathname)) {
    history.pushState({}, "", "/" + (location.hash || ""));
  }
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
    `# ${t("md.title", { title: site.title })}`,
    "",
    `> ${t("md.purpose", { domain })}`,
    `> ${t("md.scope")}`,
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
    t("md.h0"),
    `- **${t("md.s0.url")}**: ${site.url}`,
    `- **${t("md.s0.domain")}**: ${domain}`,
    `- **${t("md.s0.tags")}**: ${(site.tags || []).map((tg) => window.i18n.tag(tg)).join(" · ") || "—"}`,
    `- **${t("md.s0.shot")}**: ${site.image}`,
    `- **${t("md.s0.addedAt")}**: ${today}`,
    localizedField(site, "notes") ? `- **${t("md.s0.reason")}**: ${localizedField(site, "notes")}` : null,
    ""
  ].filter(Boolean).join("\n");
}

function section1Identity(site, spec) {
  const id = spec.identity;
  if (!id) {
    return [
      t("md.h1"),
      `- ${localizedField(site, "notes") || t("md.s1.fallback")}`,
      ""
    ].join("\n");
  }
  return [
    t("md.h1"),
    `- **${t("md.s1.oneliner")}**: ${id.oneLiner || "—"}`,
    `- **${t("md.s1.keywords")}**: ${(id.keywords || []).join(" · ") || "—"}`,
    `- **${t("md.s1.analogy")}**: ${id.analogy || "—"}`,
    ""
  ].join("\n");
}

function section2Colors(spec, site) {
  const c = spec.colors;
  if (!c) {
    return [
      t("md.h2"),
      `- ${t("md.s2.desc")}: ${localizedField(site, "palette") || "—"}`,
      `- ${t("md.s2.warnTokens")}`,
      ""
    ].join("\n");
  }
  const rows = [
    ["--bg",         c.bg,        t("md.s2.use.bg")],
    ["--bg-soft",    c.bgSoft,    t("md.s2.use.bgSoft")],
    ["--bg-quiet",   c.bgQuiet,   t("md.s2.use.bgQuiet")],
    ["--ink",        c.ink,       t("md.s2.use.ink")],
    ["--ink-soft",   c.inkSoft,   t("md.s2.use.inkSoft")],
    ["--muted",      c.muted,     t("md.s2.use.muted")],
    ["--muted-soft", c.mutedSoft, t("md.s2.use.mutedSoft")],
    ["--accent",     c.accent,    t("md.s2.use.accent")],
    ["--line",       c.line,      t("md.s2.use.line")]
  ].filter(([, v]) => v != null && v !== "");
  return [
    t("md.h2"),
    "",
    `| ${t("md.s2.col.token")} | ${t("md.s2.col.value")} | ${t("md.s2.col.use")} |`,
    "|---|---|---|",
    ...rows.map(([k, v, use]) => `| \`${k}\` | \`${v}\` | ${use} |`),
    "",
    c.principle ? `**${t("md.s2.principle")}**: ${c.principle}` : null,
    ""
  ].filter(Boolean).join("\n");
}

function section3Typography(spec) {
  const ty = spec.typography;
  if (!ty) {
    return [t("md.h3"), `- ${t("md.s3.warn")}`, ""].join("\n");
  }
  return [
    t("md.h3"),
    "",
    `### ${t("md.s3.family")}`,
    `- **Display**: ${ty.display || "—"}`,
    `- **Body**: ${ty.body || "—"}`,
    `- **Mono**: ${ty.mono || "—"}`,
    "",
    `### ${t("md.s3.scale")}`,
    "",
    `| ${t("md.s2.col.token")} | ${t("md.s3.col.size")} | ${t("md.s3.col.lh")} | ${t("md.s3.col.weight")} | ${t("md.s3.col.ls")} | ${t("md.s3.col.use")} |`,
    "|---|---|---|---|---|---|",
    ...((ty.scale || []).map(s =>
      `| ${s.token} | ${s.size}px | ${s.lh} | ${s.weight} | ${s.ls} | ${s.use} |`
    )),
    "",
    (ty.rules && ty.rules.length) ? `### ${t("md.s3.rules")}\n` + ty.rules.map(r => `- ${r}`).join("\n") : null,
    ""
  ].filter(Boolean).join("\n");
}

function section4Spacing(spec) {
  const s = spec.spacing;
  if (!s) return [t("md.h4"), `- ${t("md.s4.warn")}`, ""].join("\n");
  return [
    t("md.h4"),
    `- **${t("md.s4.base")}**: ${s.base}px`,
    `- **${t("md.s4.scale")}**: ${(s.scale || []).join(" / ")} px`,
    s.rhythm ? `- **${t("md.s4.rhythm")}**: ${s.rhythm}` : null,
    ""
  ].filter(Boolean).join("\n");
}

function section5Surfaces(spec) {
  const s = spec.surfaces;
  if (!s) return [t("md.h5"), `- ${t("md.s4.warn")}`, ""].join("\n");
  const r = s.radius || {};
  return [
    t("md.h5"),
    "",
    `### ${t("md.s5.radius")}`,
    `- ${t("md.s5.r.sm")}: ${r.sm ?? "—"}${r.sm != null ? "px" : ""}`,
    `- ${t("md.s5.r.md")}: ${r.md ?? "—"}${r.md != null ? "px" : ""}`,
    `- ${t("md.s5.r.lg")}: ${r.lg ?? "—"}${r.lg != null ? "px" : ""}`,
    `- ${t("md.s5.r.pill")}: ${r.pill ?? 999}px`,
    "",
    `### ${t("md.s5.shadows")}`,
    ...((s.shadows || ["—"]).map(x => `- ${x}`)),
    "",
    `### ${t("md.s5.borders")}`,
    `- ${s.borders || "—"}`,
    ""
  ].join("\n");
}

function section6Layout(spec, site) {
  const l = spec.layout;
  if (!l) {
    return [
      t("md.h6"),
      `- ${t("md.s6.skeletonLabel")}: ${localizedField(site, "layout") || "—"}`,
      ""
    ].join("\n");
  }
  return [
    t("md.h6"),
    `- **${t("md.s6.container")}**: ${l.container || "—"}px`,
    `- **${t("md.s6.paragraph")}**: ${l.paragraph || "—"}px`,
    `- **${t("md.s6.columns")}**: ${t("md.s6.colsFmt", { n: l.columns || "—", g: l.gutter || "—" })}`,
    `- **${t("md.s6.breakpoints")}**: ${(l.breakpoints || []).join(" / ") || "—"} px`,
    "",
    `### ${t("md.s6.skeletonLabel")}`,
    l.skeleton || localizedField(site, "layout") || "—",
    ""
  ].join("\n");
}

function section7Components(spec) {
  const c = spec.components;
  if (!c) return [t("md.h7"), `- ${t("md.s4.warn")}`, ""].join("\n");
  const rows = [
    ["Button", c.button],
    ["Card",   c.card],
    ["Chip",   c.chip],
    ["Input",  c.input],
    ["Hero",   c.hero]
  ].filter(([, v]) => v);
  return [
    t("md.h7"),
    "",
    ...rows.map(([name, recipe]) => `### ${name}\n${recipe}\n`)
  ].join("\n");
}

function section8Motion(spec, site) {
  const m = spec.motion;
  if (!m) {
    return [
      t("md.h8"),
      `- ${t("md.s8.desc")}: ${localizedField(site, "motion") || "—"}`,
      ""
    ].join("\n");
  }
  const d = m.durations || {};
  return [
    t("md.h8"),
    "",
    `| ${t("md.s8.col.name")} | ${t("md.s8.col.duration")} | ${t("md.s8.col.use")} |`,
    "|---|---|---|",
    `| micro | ${d.micro || "—"}ms | ${t("md.s8.use.micro")} |`,
    `| small | ${d.small || "—"}ms | ${t("md.s8.use.small")} |`,
    `| medium | ${d.medium || "—"}ms | ${t("md.s8.use.medium")} |`,
    "",
    `- **${t("md.s8.easing")}**: \`${m.easing || "—"}\``,
    "",
    (m.patterns && m.patterns.length) ? `### ${t("md.s8.patterns")}\n` + m.patterns.map(p => `- ${p}`).join("\n") : null,
    ""
  ].filter(Boolean).join("\n");
}

function section9Interaction(spec, site) {
  const i = spec.interaction;
  if (!i) {
    return [
      t("md.h9"),
      `- ${t("md.s9.core")}: ${localizedField(site, "interaction") || "—"}`,
      ""
    ].join("\n");
  }
  return [
    t("md.h9"),
    `- **Hover**: ${i.hover || "—"}`,
    `- **Click**: ${i.click || "—"}`,
    `- **Transition**: ${i.transition || "—"}`,
    `- **Keyboard**: ${i.keyboard || "—"}`,
    ""
  ].join("\n");
}

function section10Voice(spec) {
  const v = spec.voice;
  if (!v) return [t("md.h10"), `- ${t("md.s4.warn")}`, ""].join("\n");
  return [
    t("md.h10"),
    `- **${t("md.s10.tone")}**: ${v.tone || "—"}`,
    `- **${t("md.s10.headline")}**: ${v.headlineStyle || "—"}`,
    `- **${t("md.s10.cta")}**: ${v.ctaStyle || "—"}`,
    (v.avoid && v.avoid.length) ? `- **${t("md.s10.avoid")}**: ${v.avoid.join(" / ")}` : null,
    ""
  ].filter(Boolean).join("\n");
}

function section11Donts(spec) {
  const d = spec.donts;
  if (!d || !d.length) {
    return [
      t("md.h11"),
      `- ${t("md.s11.f1")}`,
      `- ${t("md.s11.f2")}`,
      `- ${t("md.s11.f3")}`,
      ""
    ].join("\n");
  }
  return [
    t("md.h11"),
    ...d.map(item => `- ❌ ${item}`),
    ""
  ].join("\n");
}

function section12SystemPrompt(site, spec, domain) {
  const prompt = spec.systemPrompt || defaultSystemPrompt(site, spec, domain);
  return [
    t("md.h12"),
    "",
    t("md.s12.intro"),
    "",
    "```",
    prompt,
    "```",
    ""
  ].join("\n");
}

function defaultSystemPrompt(site, spec, domain) {
  const parts = [t("md.dp.head", { domain })];
  if (spec.identity && spec.identity.oneLiner) parts.push(t("md.dp.identity", { oneLiner: spec.identity.oneLiner }));
  if (spec.colors && spec.colors.principle) parts.push(t("md.dp.colors", { principle: spec.colors.principle }));
  if (spec.typography && spec.typography.display) parts.push(t("md.dp.typo", { display: spec.typography.display, body: spec.typography.body || t("md.dp.typoFallback") }));
  if (spec.layout && spec.layout.skeleton) parts.push(t("md.dp.layout", { skeleton: spec.layout.skeleton }));
  if (spec.donts && spec.donts.length) parts.push(t("md.dp.donts", { list: spec.donts.join(t("md.s11.donts.sep")) }));
  if (!spec.identity) parts.push(t("md.dp.keywords", { kw: localizedField(site, "palette") || t("md.s1.fallback") }));
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
  downloadBlob(new Blob([text], { type: "text/markdown;charset=utf-8" }), filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ===== 极简 ZIP (STORE 法 · 无压缩) 打包器 —— 零依赖，浏览器端生成设计系统 ZIP ===== */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** entries: [{ name, data: Uint8Array }] → ZIP Blob（STORE，无压缩，兼容所有解压工具） */
function zipStore(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = e.data;
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true);     // UTF-8 文件名
    dv.setUint16(8, 0, true);          // STORE
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0x21, true);      // 1980-01-01
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    chunks.push(lh, data);
    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, eocd], { type: "application/zip" });
}

async function fetchTextSafe(url) {
  try {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

function genReadme(site) {
  return [
    `${site.title} — Design System Pack`,
    `Generated by OpenDesign · https://opendesign.cc`,
    "",
    `Source:    ${site.url}`,
    `Agent URL: ${agentSpecUrl(site.id)}`,
    "",
    "Contents",
    "  DESIGN.md               Google design.md–compatible format (YAML + 8 sections)",
    "  DESIGN_SPEC.<lang>.md   OpenDesign 11-layer spec · up to 5 languages (en/zh-CN/zh-TW/ja/ko)",
    "  spec.json               11-layer design tokens, machine-readable",
    "",
    "How to use with AI",
    "  Paste a DESIGN_SPEC.*.md into Claude / Cursor / v0 / Lovable, or point your agent",
    "  at the Agent URL above — it will read this site's full design system and reproduce",
    "  the same visual language in your own pages.",
    "",
  ].join("\n");
}

/** 从该站已部署的同源文档 + 客户端 spec 组装一个设计系统 ZIP。 */
async function buildDesignSystemZip(site) {
  const enc = new TextEncoder();
  const slug = site.id;
  const entries = [{ name: "README.txt", data: enc.encode(genReadme(site)) }];
  if (site.spec) entries.push({ name: "spec.json", data: enc.encode(JSON.stringify(site.spec, null, 2)) });

  const designMd = await fetchTextSafe(`/packs/${slug}/DESIGN.md`);
  if (designMd) entries.push({ name: "DESIGN.md", data: enc.encode(designMd) });

  for (const lang of ["en", "zh-CN", "zh-TW", "ja", "ko"]) {
    const md = await fetchTextSafe(`/packs/${slug}/DESIGN_SPEC.${lang}.md`);
    if (md) entries.push({ name: `DESIGN_SPEC.${lang}.md`, data: enc.encode(md) });
  }
  // 兜底：该站没在 /packs 部署文档（无 narrative）时，至少放当前语言客户端生成的规范
  if (!entries.some((e) => e.name.startsWith("DESIGN_SPEC"))) {
    entries.push({ name: "DESIGN_SPEC.md", data: enc.encode(createMarkdown(site)) });
  }
  return zipStore(entries);
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
    // screenshotUrl / meta.title 来自第三方（microlink）—— 转义后再进 img 属性，防属性逃逸 XSS
    previewShot.innerHTML = `<img src="${escapeHtml(screenshotUrl)}" alt="${escapeHtml(meta.title || "screenshot")}" />`;
  }
  if (meta.title) previewTitle.textContent = meta.title;       // textContent 本身安全
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
  previewTags.innerHTML = tags.map((tag) => `<span>${escapeHtml(String(tag))}</span>`).join("");
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
    return submitRequest(pendingCandidate);
  }

  const rawUrl = collectUrlInput.value.trim();
  if (!rawUrl) {
    showToast(t("toast.url.empty"));
    return;
  }

  // 同时填充 curator CLI 命令（让 owner 一键复制走正式收录）
  updateCuratorCliCommand(rawUrl);

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
    // 预览管线挂了（microlink 限流等）不影响请求收录：用原始 URL 兜底，仍可提交。
    collectState = "done";
    let host = rawUrl;
    try { host = new URL(normalizeUrl(rawUrl)).hostname.replace(/^www\./, ""); } catch {}
    pendingCandidate = { url: rawUrl, title: host, tags: [], spec: {} };
    autoCollectButton.disabled = false;
    autoCollectButton.textContent = t("modal.button.commit");
    previewMeta.textContent = t("modal.preview.failsafe");
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

/**
 * 用户「请求收录」一个网站。
 * 模型：不再公开发布，而是写进 submissions 队列（我们后台 /admin 审 → 跑 ingest → 上广场）。
 * 用户侧立即生效：进本地 od-requests，在「我的收藏 → 我请求的」里看得到。
 */
async function submitRequest(candidate) {
  let url, host;
  try {
    url = normalizeUrl(candidate.url || collectUrlInput.value);
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    showToast(t("toast.url.empty"));
    return;
  }

  const note = (candidate.title && candidate.title !== host) ? candidate.title : "";
  const at = new Date().toISOString();

  // 1) 本地立刻可见
  addRequestLocal({ host, url, note, status: "pending", at });

  // 2) 异步写云端队列（失败不阻塞；本地已留痕）
  if (supabaseClient) {
    supabaseClient
      .from("submissions")
      .insert({ url, host, note: note || null, visitor_id: visitorId })
      .then(({ error }) => {
        if (error) console.warn("[submissions] insert failed", error);
      }, (err) => console.warn("[submissions] insert failed", err));
  }

  closeModal();
  showToast(t("toast.request.success"));
  // 跳到「我的收藏」让用户看到自己请求的
  switchView("saved");
  renderSaved();
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
  // 进入画布时 surface 才有真实尺寸 —— 补一次虚拟化窗口渲染 + 复位提示
  if (view === "canvas") { updateCanvasWindow(); reflectHomeState(); }
  if (!fromHash) setHash(viewToHash(view), { silent: true });
}

/* ====== HASH ROUTER ====== */
function viewToHash(view) {
  return view === "canvas" ? "#/" : `#/${view}`;
}

/** 手机上无限画布拖拽体验差 —— 默认进 Library 列表视图。
 *  桌面默认 canvas。只在「无显式 hash」时生效，用户手动切了不覆盖。 */
function defaultView() {
  return window.innerWidth <= 760 ? "library" : "canvas";
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  if (!raw) return { route: "view", view: defaultView() };
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "sites" && parts[1]) return { route: "site", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "tags" && parts[1]) return { route: "tag", tag: decodeURIComponent(parts[1]) };
  if (["canvas", "library", "saved", "about"].includes(parts[0])) return { route: "view", view: parts[0] };
  return { route: "view", view: defaultView() };
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
  // 只在真正的控件（收藏按钮 / 打开原站外链 / 输入框）上让出事件让原生行为生效；
  // 卡片主链接 a.card-hit 本身也是 <a>，绝不能用裸 "a" 跳过——否则手机上按在卡片上滑不动。
  // 在卡片上开始拖拽 → 平移画布；没移动的轻点 → click 处理里 openDetail（dragMoved 守卫）。
  if (event.target.closest(".card-save, .card-visit, input")) return;
  dragging = true;
  dragMoved = false;
  dragStart = { x: event.clientX, y: event.clientY };
  panStart = { x: viewState.x, y: viewState.y };
  // 关键：不在 pointerdown 就 setPointerCapture —— 它会"吞掉"卡片上的 click，
  // 导致点卡片既不开抽屉也不跳转。等真正拖动(过阈值)再 capture，见 pointermove。
});

canvasSurface.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  if (!dragMoved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
    dragMoved = true;
    canvasSurface.classList.add("is-dragging");
    // 真拖动了才捕获指针(此时不再需要 click)；轻点从不 capture → 卡片 click 正常触发
    try { canvasSurface.setPointerCapture(event.pointerId); } catch (_) {}
  }
  if (dragMoved) {
    viewState.x = panStart.x + dx;
    viewState.y = panStart.y + dy;
    applyTransform();
    scheduleWindowUpdate();
    reflectHomeState();
  }
});

function endCanvasDrag() {
  dragging = false;
  canvasSurface.classList.remove("is-dragging");
}
canvasSurface.addEventListener("pointerup", endCanvasDrag);
canvasSurface.addEventListener("pointercancel", endCanvasDrag);

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
    scheduleWindowUpdate();
    reflectHomeState();
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
  // 刚拖完不触发打开（避免拖拽松手误点开）
  if (dragMoved) { dragMoved = false; return; }
  // 让出"打开原站"外链
  if (event.target.closest(".card-visit")) return;
  const card = event.target.closest(".site-card");
  if (!card) return;
  // 普通点击 → 拦截 <a> 跳转，走 SPA 抽屉。
  // 但 ⌘/Ctrl/中键 点击 → 放行（用户想新标签打开独立页）
  if (event.metaKey || event.ctrlKey || event.button === 1) return;
  event.preventDefault();
  openDetail(card.dataset.id);
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
    // library-hit 是真 <a href="/{lang}/sites/{slug}">（爬虫可跟随）
    // ⌘/Ctrl/中键 放行新标签；普通点击拦截走 SPA 抽屉
    const hit = event.target.closest(".library-hit, a.card-hit");
    if (hit) {
      if (event.metaKey || event.ctrlKey || event.button === 1) return;
      event.preventDefault();
      const card = event.target.closest(".library-card, .site-card");
      if (card) openDetail(card.dataset.id);
      return;
    }
    // 其它外链（card-visit / library-domain 等）放行
    if (event.target.closest("a")) return;
    const card = event.target.closest(".library-card");
    if (card) openDetail(card.dataset.id);
  });
}

bindListClicks(libraryList);
bindListClicks(document.querySelector("#savedList"));

function handleSaveToggle(siteId) {
  const nowSaved = store.toggleSaved(siteId);
  track(nowSaved ? "save_add" : "save_remove", { category: "save", slug: siteId });
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
  track(nowLiked ? "like_add" : "like_remove", { category: "like", slug: siteId });
  showToast(t(nowLiked ? "toast.like.added" : "toast.like.removed"));
  if (activeSite && activeSite.id === siteId) refreshDrawerActions();
}

tagFilters.addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  const tag = chip.dataset.tag;
  activeTag = tag;
  applyFilterChange();
  if (tag === "All") setHash(viewToHash(currentView), { silent: true });
  else setHash(`#/tags/${encodeURIComponent(tag)}`, { silent: true });
});

// 「相关 tag」点击也切 filter
document.querySelector("#relatedTags")?.addEventListener("click", (event) => {
  const chip = event.target.closest(".related-tag-chip");
  if (!chip) return;
  activeTag = chip.dataset.tag;
  applyFilterChange();
  setHash(`#/tags/${encodeURIComponent(activeTag)}`, { silent: true });
});

searchInput.addEventListener("input", (event) => {
  searchQuery = event.target.value;
  applyFilterChange();
});

/* 排序切换 —— 精选顺序 vs 热门（按全站累计收藏数 desc） */
document.querySelectorAll(".sort-option").forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = btn.dataset.sort;
    if (next === sortMode) return;
    sortMode = next;
    document.querySelectorAll(".sort-option").forEach((b) => b.classList.toggle("active", b.dataset.sort === sortMode));
    applyFilterChange();
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
    const code = await getMySyncCode();
    lastCreatedSyncCode = code;
    syncCodeDisplay.textContent = code;
  } catch (err) {
    console.warn("[sync] get-my-code failed", err);
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

// 「给你的 Agent」卡片：复制 skill.md 链接
const agentCopyBtn = document.querySelector("#agentCopyBtn");
if (agentCopyBtn) {
  agentCopyBtn.addEventListener("click", () => {
    const url = agentCopyBtn.dataset.copy || "https://opendesign.cc/skill.md";
    navigator.clipboard.writeText(url).then(
      () => showToast(t("toast.agent.copied")),
      () => showToast(url)
    );
  });
}

// 顶部「给你的 Agent」入口 —— 切到 About 视图并定位到 agent 区（带短暂高亮）。
// 把产品核心差异放在首屏最显眼处，让访客一眼知道「这库能喂给我的 AI」。
const agentTopBtn = document.querySelector("#agentTopBtn");
if (agentTopBtn) {
  agentTopBtn.addEventListener("click", () => {
    switchView("about");
    setTimeout(() => {
      const sec = document.querySelector("#agentSection");
      if (!sec) return;
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
      sec.classList.remove("is-flash");
      void sec.offsetWidth; // 强制 reflow，让高亮动画可重复触发
      sec.classList.add("is-flash");
      setTimeout(() => sec.classList.remove("is-flash"), 1700);
    }, 60);
  });
}

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

/* 「完整包」面板（无 mimo 完整包的作品）按钮，引用 activeSite */
document.querySelector("#genRequestButton")?.addEventListener("click", () => {
  if (activeSite) requestPackGeneration(activeSite);
});
document.querySelector("#genDownloadSpec")?.addEventListener("click", async () => {
  if (!activeSite) return;
  try {
    const blob = await buildDesignSystemZip(activeSite);
    downloadBlob(blob, `${activeSite.id}-design-system.zip`);
  } catch { showToast(t("gen.toast.fail")); }
});
document.querySelector("#genCopyAgentUrl")?.addEventListener("click", () => {
  if (!activeSite) return;
  const url = agentSpecUrl(activeSite.id);
  navigator.clipboard.writeText(url).then(
    () => showToast(t("agent.urlCopied")),
    () => showToast(url)
  );
});
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

/* 刷新截图：cache-bust thum.io 重新生成最新一帧，存 localStorage 覆盖 */
document.querySelector("#drawerMedia")?.addEventListener("click", (e) => {
  const btn = e.target.closest("#drawerRefreshShot");
  if (!btn || !activeSite) return;
  e.preventDefault();
  e.stopPropagation();
  const stamp = Date.now();
  // thum.io noanimate + cache-bust，强制重抓
  const fresh = `https://image.thum.io/get/width/1440/noanimate/?_cb=${stamp}/${activeSite.url}`;
  const img = document.querySelector("#drawerHeroImg");
  if (img) {
    btn.classList.add("spinning");
    img.onerror = null;
    img.onload = () => { btn.classList.remove("spinning"); };
    img.src = fresh;
    // 持久化覆盖：下次打开仍是这张新图
    localStorage.setItem(`shot-override:${activeSite.id}`, fresh);
    showToast(t("drawer.refreshShot.done"));
  }
});

/* Agent block 的复制按钮 */
document.querySelector("#agentCopyPrompt")?.addEventListener("click", () => {
  if (!activeSite) return;
  const text = agentPromptText(activeSite);
  navigator.clipboard.writeText(text).then(
    () => showToast(t("agent.promptCopied")),
    () => showToast(text)
  );
});
document.querySelector("#agentCopyUrl")?.addEventListener("click", () => {
  if (!activeSite) return;
  const url = agentSpecUrl(activeSite.id);
  navigator.clipboard.writeText(url).then(
    () => showToast(t("agent.urlCopied")),
    () => showToast(url)
  );
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
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
/** href 白名单：只放行 http(s)，其它（javascript: / data: 等）一律降级为 #，防点击型 XSS。 */
function safeHref(u) {
  return /^https?:\/\//i.test(u || "") ? escapeHtml(u) : "#";
}
document.querySelector("#importButton").addEventListener("click", openModal);

/** 当前视图是否偏离原点（决定是否提示「回到原点」）。 */
function isAtHome() {
  return Math.abs(viewState.x - HOME_VIEW.x) < 24 &&
         Math.abs(viewState.y - HOME_VIEW.y) < 24 &&
         Math.abs(viewState.scale - HOME_VIEW.scale) < 0.02;
}

/** 偏离原点时让「回到原点」按钮显形/高亮，回到原点后淡出。 */
function reflectHomeState() {
  const btn = document.querySelector("#canvasRecenter");
  if (btn) btn.classList.toggle("is-active", !isAtHome());
}

/** 平滑飞回原点（带过渡，明确告诉用户「这是归位，不是出错」）。 */
function recenterCanvas() {
  canvasGrid.classList.add("recentering");
  viewState = { ...HOME_VIEW };
  applyTransform();
  reflectHomeState();
  // 过渡结束后补一次窗口渲染 + 去掉过渡类
  const done = (ev) => {
    // 只认 canvasGrid 自身的 transform 过渡；忽略子元素冒泡上来的 transitionend（否则会提前中断动画）
    if (ev && (ev.target !== canvasGrid || ev.propertyName !== "transform")) return;
    canvasGrid.classList.remove("recentering");
    updateCanvasWindow();
    canvasGrid.removeEventListener("transitionend", done);
  };
  canvasGrid.addEventListener("transitionend", done);
  setTimeout(done, 560); // 兜底（transitionend 偶尔不触发）
}

document.querySelector("#resetViewButton").addEventListener("click", recenterCanvas);
const canvasRecenterBtn = document.querySelector("#canvasRecenter");
if (canvasRecenterBtn) canvasRecenterBtn.addEventListener("click", recenterCanvas);
document.querySelector("#canvasShuffle")?.addEventListener("click", shuffleExplore);

// 「＋ 收录」对所有人可见 —— 它是用户「请求收录」的入口（openModal → submitRequest）。
// 之前只在 owner 模式显示，导致普通用户根本无法请求收录（功能建了却没入口）。
document.querySelector("#importButton").hidden = false;
if (OWNER_MODE) {
  document.querySelector("#copyJsonButton").hidden = false;  // JSON 导出仍仅 owner
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

/* Curator CLI command box: 用户一粘 URL 就显示一键 ingest 命令 */
function updateCuratorCliCommand(url) {
  const box = document.querySelector("#curatorCliBox");
  const cmd = document.querySelector("#curatorCliCmd");
  if (!box || !cmd) return;
  try {
    const cleanUrl = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).toString();
    cmd.textContent = `python3 scripts/ingest.py --url ${cleanUrl} --auto-publish`;
    box.hidden = false;
  } catch {
    box.hidden = true;
  }
}

// 用户输入 URL 时也同步更新（不用等点提交）
collectUrlInput.addEventListener("input", () => updateCuratorCliCommand(collectUrlInput.value.trim()));

const curatorCliCopyBtn = document.querySelector("#curatorCliCopyBtn");
if (curatorCliCopyBtn) {
  curatorCliCopyBtn.addEventListener("click", () => {
    const text = document.querySelector("#curatorCliCmd")?.textContent || "";
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => showToast(t("toast.cli.copied")),
      () => showToast(text)
    );
  });
}

/* ====== Language dropdown wiring ====== */
const langTrigger = document.querySelector("#langTrigger");
const langTriggerCode = document.querySelector("#langTriggerCode");
const langDropdown = document.querySelector("#langDropdown");

/** 渲染下拉菜单的选项（按 i18n.supported 顺序，标记当前 active） */
function renderLangDropdown() {
  if (!langDropdown) return;
  const cur = window.i18n.current;
  langDropdown.innerHTML = window.i18n.supported.map((code) => {
    const m = window.i18n.meta[code];
    const active = code === cur;
    return `<li role="option" aria-selected="${active}" class="lang-item${active ? " active" : ""}" data-lang="${code}">
      <span class="lang-item-code">${m.code}</span>
      <span class="lang-item-native">${m.native}</span>
    </li>`;
  }).join("");
}

/** 刷新顶栏触发器上的简码（中 / 繁 / EN / 日 / 한）+ 重渲下拉 */
function syncLangToggle() {
  if (!langTrigger) return;
  const cur = window.i18n.current;
  const m = window.i18n.meta[cur];
  if (m && langTriggerCode) langTriggerCode.textContent = m.code;
  renderLangDropdown();
}

function closeLangDropdown() {
  if (!langDropdown) return;
  langDropdown.hidden = true;
  langTrigger.setAttribute("aria-expanded", "false");
}

function openLangDropdown() {
  if (!langDropdown) return;
  renderLangDropdown();
  langDropdown.hidden = false;
  langTrigger.setAttribute("aria-expanded", "true");
}

if (langTrigger && langDropdown) {
  langTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (langDropdown.hidden) openLangDropdown();
    else closeLangDropdown();
  });

  langDropdown.addEventListener("click", (e) => {
    const item = e.target.closest(".lang-item");
    if (!item) return;
    track("lang_switch", { category: "i18n", label: item.dataset.lang, name: item.dataset.lang });
    window.i18n.set(item.dataset.lang);
    closeLangDropdown();
  });

  // 点其他地方关菜单
  document.addEventListener("click", (e) => {
    if (!langDropdown.hidden && !e.target.closest(".lang-menu")) closeLangDropdown();
  });

  // ESC 关
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !langDropdown.hidden) closeLangDropdown();
  });
}
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

// resize 防抖：连续拖拽缩放窗口时只在停下后重建一次画布，且仅当画布视图可见
let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentView === "canvas") renderCanvas();
  }, 160);
});
window.addEventListener("hashchange", applyHash);

/* ====== 路径路由 ======
 * SPA 现在用 pushState 切到 /{lang}/sites/{slug}。
 * 处理：(a) 首次直接命中该路径（SPA 接管 index.html fallback 时）
 *       (b) 浏览器前进/后退
 */
function applyPathRoute() {
  const m = location.pathname.match(/^\/[a-zA-Z-]+\/sites\/([a-z0-9][a-z0-9-]*)\/?$/);
  if (m) {
    const slug = m[1];
    const target = sites.find((s) => s.id === slug);
    if (target) { openDetail(target.id); return true; }
  }
  // 不是详情路径 → 若抽屉开着则关
  if (detailDrawer.classList.contains("open")) {
    detailDrawer.classList.remove("open");
    detailDrawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("drawer-open");
  }
  return false;
}

window.addEventListener("popstate", () => {
  // 优先路径路由（详情页），否则回退 hash 视图路由
  if (!applyPathRoute()) applyHash();
});

renderAll();
// 启动：先看 URL 是不是详情页路径，否则走 hash
if (!applyPathRoute()) applyHash();

/* 启动后异步:
 * 1) merge 外部 sites-specs.json 进 curatedSites（AI 批跑产物，独立维护避免污染 sites.js）
 * 2) Supabase 拉取访客 saves/likes
 * 完成后刷新一次 UI。 */
(async () => {
  await Promise.all([
    mergeExternalSpecs(),
    loadPacksIndex(),
    loadSitesI18n()
  ]);
  await store.init();
  // spec / packs / i18n / supabase 任一有变化都要重渲
  renderAll();
  if (detailDrawer.classList.contains("open") && activeSite) {
    openDetail(activeSite.id);   // 重新渲染抽屉用新 spec / 显示下载按钮 / 用新语言
  }
})();

/** 加载 sites-specs.json（AI 批跑结果），合并 spec 到对应 curated site。
 *  原则：sites.js 里手写的 spec 优先（用户精校过的不要被覆盖）；
 *  只有 site.spec 缺失时才用外部 spec 填。*/
async function mergeExternalSpecs() {
  try {
    const res = await fetch("/sites-specs.json", { cache: "no-cache" });
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

/* ====== Sites i18n overlay ======
 * 把 site 的 palette/layout/interaction/motion/notes 5 个字段按当前语言取出来。
 * 数据存在 sites-i18n.json（侧旁文件，独立维护）。
 * Fallback 链：requested-lang → en → site.<field>（sites.js 里的老字段，bw-compat）
 * 注：sitesI18n 变量声明在文件顶部状态区，避免 TDZ。
 */
async function loadSitesI18n() {
  try {
    const res = await fetch("/sites-i18n.json", { cache: "no-cache" });
    if (!res.ok) return;
    const data = await res.json();
    // 剥掉 _meta，剩下都是 site_id → { lang → fields }
    Object.keys(data).forEach((k) => {
      if (!k.startsWith("_")) sitesI18n[k] = data[k];
    });
    console.info(`[i18n] loaded sites-i18n for ${Object.keys(sitesI18n).length} sites`);
  } catch (err) {
    // 静默 fallback 到 sites.js 自带字段
  }
}

/** 取当前语言下的字段值，多层回退保证不报错 */
function localizedField(site, field) {
  const lang = (window.i18n && window.i18n.current) || "en";
  const overlay = sitesI18n[site.id];
  if (overlay) {
    if (overlay[lang] && overlay[lang][field]) return overlay[lang][field];
    if (overlay.en   && overlay.en[field])   return overlay.en[field];
    if (overlay["zh-CN"] && overlay["zh-CN"][field]) return overlay["zh-CN"][field];
  }
  return site[field] || "";
}

/** 设计素材包索引（site.id → {file, size}）—— 决定详情抽屉是否显示「下载」按钮
 *  注：packsIndex 变量声明在文件顶部状态区，避免 TDZ。 */
async function loadPacksIndex() {
  try {
    const res = await fetch("/packs-index.json", { cache: "no-cache" });
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
