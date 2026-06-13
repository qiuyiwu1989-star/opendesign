/* OpenDesign 管理后台 · 侧边栏导航版
 * 安全：口令只存 sessionStorage；所有读写走 security definer RPC（口令校验，绕 RLS）
 * publishable anon key 是公开的，没口令调 RPC 会被服务端拒                          */

const PASS_KEY = "od-admin-pass";

const cfg = window.SUPABASE_CONFIG || {};
const sb = (window.supabase && cfg.url && cfg.anonKey)
  ? window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } })
  : null;

const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

/* ── 全局状态 ─────────────────────────────────────────────────── */
let currentSection = "overview";
let allRows = [];           // submissions
let smFilter = "all";
let smQuery  = "";
let dscFilter = "pending";
let logFilter = "all";
let subFilter = "pending";
let packsCache = {};
let liveTimer = null;

/* ── 工具函数 ──────────────────────────────────────────────────── */
function getPass() { return sessionStorage.getItem(PASS_KEY) || ""; }

// 渲染前转义，防止存储型 XSS（用户提交内容经此过滤后才入 innerHTML）
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function safeHref(u) { return /^https?:\/\//i.test(u || "") ? esc(u) : "#"; }

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  } catch { return iso; }
}
function fmtDateTime(iso) {
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2,"0");
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return iso || "—"; }
}
function fmtDuration(startIso, endIso) {
  try {
    const s = Math.round((new Date(endIso) - new Date(startIso)) / 1000);
    if (isNaN(s) || s < 0) return "—";
    if (s < 60) return `${s}s`;
    return `${Math.floor(s/60)}m${s%60 ? " "+s%60+"s" : ""}`;
  } catch { return "—"; }
}
function fmtAgo(iso) {
  try {
    const s = Math.round((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return `${s}s 前`;
    if (s < 3600) return `${Math.floor(s/60)}m 前`;
    if (s < 86400) return `${Math.floor(s/3600)}h 前`;
    return `${Math.floor(s/86400)}d 前`;
  } catch { return "—"; }
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function fmtNow() {
  const d = new Date();
  return [d.getHours(),d.getMinutes(),d.getSeconds()].map((n)=>String(n).padStart(2,"0")).join(":");
}

/* ── 侧边栏导航 ───────────────────────────────────────────────── */
function adminNav(section) {
  currentSection = section;
  // 切换 section 显示
  $$(".section").forEach((s) => s.classList.remove("active"));
  const target = $(`#sec-${section}`);
  if (target) target.classList.add("active");
  // 切换 nav-item 高亮
  $$(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.section === section);
  });
  // 进入该页面时按需刷新
  if (section === "logs")        renderLogs();
  if (section === "discoveries") renderDiscoveries();
  if (section === "jobs")        renderJobs();
  if (section === "sites")       renderSiteMgr();
  if (section === "submissions") renderSubmissions();
}

$$(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => adminNav(btn.dataset.section));
});

/* ── RPC 层 ─────────────────────────────────────────────────────── */
async function rpcList(pass) {
  if (!sb) throw new Error("Supabase 未初始化");
  const { data, error } = await sb.rpc("admin_list_submissions", { p_pass: pass });
  if (error) throw error;
  return data || [];
}
async function rpcSetStatus(id, status) {
  const { error } = await sb.rpc("admin_update_status", { p_pass: getPass(), p_id: id, p_status: status });
  if (error) throw error;
}
async function rpcEnqueue(kind, slug, url) {
  const { error } = await sb.rpc("admin_enqueue_job", { p_pass: getPass(), p_kind: kind, p_slug: slug, p_url: url||"" });
  if (error) throw error;
}
async function rpcJobs() {
  try {
    const { data, error } = await sb.rpc("admin_list_jobs", { p_pass: getPass() });
    if (error) throw error;
    return data || [];
  } catch (_) { return null; }
}
async function rpcDiscoveries(status) {
  try {
    const { data, error } = await sb.rpc("admin_list_discoveries", { p_pass: getPass(), p_status: status });
    if (error) throw error;
    return data || [];
  } catch (_) { return null; }
}
async function rpcReviewDiscovery(id, action) {
  const { error } = await sb.rpc("admin_review_discovery", { p_pass: getPass(), p_id: id, p_action: action });
  if (error) throw error;
}
async function rpcGetLogs(kind) {
  try {
    const { data, error } = await sb.rpc("admin_get_logs", {
      p_pass: getPass(), p_kind: kind === "all" ? null : kind, p_limit: 80,
    });
    if (error) throw error;
    return data || [];
  } catch (_) { return null; }
}

/* ── packs-index 缓存 ─────────────────────────────────────────── */
async function ensurePacks() {
  if (Object.keys(packsCache).length) return;
  try { packsCache = await (await fetch("/packs-index.json?_="+Date.now())).json(); }
  catch (_) { packsCache = {}; }
}

/* ── 字典 ────────────────────────────────────────────────────────── */
const STATUS_LABEL   = { pending:"待处理", accepted:"已接受", rejected:"已拒绝", published:"已发布" };
const KIND_LABEL_SUB = { collect:"收录请求", pack:"完整包请求" };
const JOB_STATUS     = { pending:"排队中", running:"跑中…", done:"完成", failed:"失败" };
const JOB_KIND       = { upgrade:"升级", collect:"收录", refresh:"刷主图" };
const DSC_STATUS     = { pending:"待审阅", approved:"已收录", ignored:"已忽略" };
const LOG_KIND_LABEL = { "jobrunner":"任务执行","discover":"发现","auto-evaluate":"AI 评估","adaptive-rank":"排名","self-optimize":"自优化" };
const LOG_STATUS_ICON= { done:"✅", error:"❌", skipped:"⏭" };
const CRON_SCHEDULE  = { "jobrunner":"每 10 分钟","discover":"每日 09:30","auto-evaluate":"每日 10:00","adaptive-rank":"每日 03:00","self-optimize":"周日 04:00" };

/* ── 概览 ─────────────────────────────────────────────────────── */
async function renderOverview() {
  await ensurePacks();
  const sites  = window.STYLE_ATLAS_SITES || [];
  const tier2  = sites.filter((s) => packsCache[s.id]).length;
  const pct    = sites.length ? Math.round((tier2/sites.length)*100) : 0;
  const penSub = allRows.filter((r) => (r.status||"pending")==="pending").length;

  // stat cards
  const total = $( "#ovTotal"); if (total) total.textContent = sites.length;
  const t2    = $( "#ovTier2"); if (t2)   t2.textContent   = tier2;
  const t1    = $( "#ovTier1"); if (t1)   t1.textContent   = sites.length - tier2;
  const pctEl = $( "#ovPct");   if (pctEl) pctEl.textContent = pct+"%";
  const prog  = $( "#ovProgress"); if (prog) prog.style.width = pct+"%";
  const pSub  = $( "#ovPending"); if (pSub) pSub.textContent = penSub;
  // saves: try to get from stats if available, skip gracefully
  const savesEl = $( "#ovSaves"); if (savesEl) savesEl.textContent = "–";

  // nav badges
  const nb = $( "#navSubBadge"); if (nb) { nb.textContent = penSub||"–"; nb.className = "nav-badge"+(penSub?"":"muted"); }

  // activity feed + health from logs
  const logs = await rpcGetLogs("all");
  renderActivityFeed(logs);
  renderHealthPanel(logs);
  renderSidebarHealth(logs);

  // log badge (error count in last 24h)
  if (logs) {
    const errs = logs.filter((l) => l.status === "error").length;
    const nb2 = $( "#navLogsBadge");
    if (nb2) { nb2.textContent = errs||logs.length; nb2.className = "nav-badge"+(errs?"":"muted"); }
  }
}

function renderActivityFeed(logs) {
  const el = $( "#ovActivity"); if (!el) return;
  if (!logs || !logs.length) {
    el.innerHTML = `<div class="empty-state"><span class="empty-icon">📋</span>暂无日志（需应用 0008 SQL）</div>`;
    return;
  }
  el.innerHTML = logs.slice(0, 8).map((r) => {
    const icon = LOG_STATUS_ICON[r.status] || "•";
    const kl = LOG_KIND_LABEL[r.kind] || r.kind;
    const kindTag = `<span class="log-kind lk-${esc(r.kind)}">${kl}</span>`;
    const sum = esc(r.summary || "（无摘要）");
    return `<div class="activity-row">
      <span class="activity-status">${icon}</span>
      <span class="activity-kind">${kindTag}</span>
      <span class="activity-sum" title="${sum}">${sum}</span>
      <span class="activity-time">${fmtAgo(r.started_at)}</span>
    </div>`;
  }).join("");
}

function renderHealthPanel(logs) {
  const el = $( "#ovHealth"); if (!el) return;
  const kinds = ["jobrunner","discover","auto-evaluate","adaptive-rank","self-optimize"];
  if (!logs || !logs.length) {
    el.innerHTML = `<div class="empty-state"><span class="empty-icon">⏱️</span>暂无数据</div>`;
    return;
  }
  // 每种取最新一条
  const latest = {};
  kinds.forEach((k) => {
    const found = logs.find((l) => l.kind === k);
    if (found) latest[k] = found;
  });
  el.innerHTML = kinds.map((k) => {
    const r = latest[k];
    if (!r) {
      return `<div class="health-item">
        <span class="hi-dot unknown"></span>
        <span class="hi-name">${LOG_KIND_LABEL[k]||k}</span>
        <span class="hi-time">从未运行</span>
        <span class="hi-next">${CRON_SCHEDULE[k]||""}</span>
      </div>`;
    }
    const dotClass = r.status==="done" ? "ok" : r.status==="error" ? "err" : "warn";
    const icon = LOG_STATUS_ICON[r.status] || "•";
    return `<div class="health-item">
      <span class="hi-dot ${dotClass}"></span>
      <span class="hi-name">${LOG_KIND_LABEL[k]||k}</span>
      <span class="hi-time">${fmtAgo(r.finished_at||r.started_at)}</span>
      <span class="hi-status">${icon}</span>
      <span class="hi-next">${CRON_SCHEDULE[k]||""}</span>
    </div>`;
  }).join("");
}

function renderSidebarHealth(logs) {
  const el = $( "#sidebarHealth"); if (!el) return;
  if (!logs || !logs.length) { el.innerHTML = ""; return; }
  const kinds = ["jobrunner","discover","auto-evaluate","adaptive-rank"];
  const latest = {};
  kinds.forEach((k) => { const f = logs.find((l) => l.kind===k); if(f) latest[k]=f; });
  el.innerHTML = `<div class="health-title">定时任务</div>`
    + kinds.map((k) => {
      const r = latest[k];
      const dot = !r ? "unknown" : r.status==="done" ? "ok" : r.status==="error" ? "err" : "warn";
      const time = r ? fmtAgo(r.finished_at||r.started_at) : "无记录";
      return `<div class="health-row"><span class="health-dot ${dot}"></span><span class="health-name">${LOG_KIND_LABEL[k]||k}</span><span class="health-time">${time}</span></div>`;
    }).join("");
}

/* ── 运行日志 ─────────────────────────────────────────────────── */
async function renderLogs() {
  const tbody = $( "#logsBody"), empty = $( "#logsEmpty"), count = $( "#logsCount");
  if (!tbody) return;
  const logs = await rpcGetLogs(logFilter);
  if (logs === null) {
    tbody.innerHTML = "";
    if (count) count.textContent = "";
    if (empty) empty.hidden = false;
    return;
  }
  if (count) count.textContent = `${logs.length} 条`;
  if (empty) empty.hidden = logs.length > 0;
  if (!logs.length) { tbody.innerHTML = ""; return; }

  tbody.innerHTML = logs.map((r) => {
    const kl   = esc(LOG_KIND_LABEL[r.kind] || r.kind);
    const icon = LOG_STATUS_ICON[r.status] || "•";
    const dur  = fmtDuration(r.started_at, r.finished_at);
    const sum  = esc(r.summary || "—");
    const det  = esc(r.details || "（无详细输出）");
    const rid  = esc(r.id);
    return `<tr class="log-main-row" data-lid="${rid}" style="cursor:pointer">
        <td style="white-space:nowrap;color:var(--muted)">${esc(fmtDateTime(r.started_at))}</td>
        <td><span class="log-kind lk-${esc(r.kind)}">${kl}</span></td>
        <td>${icon}</td>
        <td style="white-space:nowrap;color:var(--faint)">${dur}</td>
        <td style="color:var(--muted)">${sum}</td>
      </tr>
      <tr class="log-detail-row" id="ldr-${rid}">
        <td colspan="5" style="padding:0 12px 12px">
          <div class="log-output">${det}</div>
        </td>
      </tr>`;
  }).join("");
}

/* ── 发现队列 ─────────────────────────────────────────────────── */
function dscCard(d) {
  const id    = esc(d.id), title = esc(d.title || d.host);
  const host  = esc(d.host), src  = esc(d.source || "—");
  const score = Number(d.score) || 0;
  const st    = String(d.status || "pending").replace(/[^a-z]/g,"");
  let actions;
  if (st === "pending") {
    actions = `<button class="btn-sm" data-dsc="approve" data-id="${id}">✓ 收录</button>
      <button class="btn-sm ghost" data-dsc="ignore" data-id="${id}">忽略</button>
      <a class="btn-sm ghost" href="${safeHref(d.url)}" target="_blank" rel="noreferrer">访问 ↗</a>`;
  } else {
    const stLabel = DSC_STATUS[st] || st;
    const stClass = st==="approved" ? "done" : "ignored";
    actions = `<span class="badge ${stClass}">${stLabel}</span>
      <a class="btn-sm ghost" href="${safeHref(d.url)}" target="_blank" rel="noreferrer">访问 ↗</a>`;
  }
  return `<div class="card">
    <a class="card-thumb dsc" href="${safeHref(d.url)}" target="_blank" rel="noreferrer">
      <span class="src-tag">${src}</span>
      ${score ? `<span class="score-tag">▲ ${score}</span>` : ""}
      <img loading="lazy" src="${esc(d.image || "")}" alt="" />
    </a>
    <div class="card-body">
      <div class="card-top"><span class="card-title">${title}</span></div>
      <div class="card-meta">${host}</div>
      <div class="card-actions">${actions}</div>
    </div>
  </div>`;
}

async function renderDiscoveries() {
  const grid = $( "#dscGrid"), empty = $( "#dscEmpty"), count = $( "#dscCount");
  if (!grid) return;
  const list = await rpcDiscoveries(dscFilter);
  if (list == null) {
    grid.innerHTML = "";
    if (count) count.textContent = "";
    if (empty) { empty.hidden = false; empty.innerHTML = `发现队列需先应用 <code>0006_discoveries.sql</code>，再服务器跑 discover cron。`; }
    // nav badge
    const nb = $( "#navDscBadge"); if (nb) { nb.textContent = "–"; nb.className = "nav-badge muted"; }
    return;
  }
  const pendingCount = await (async()=>{
    if (dscFilter !== "pending") {
      const all = await rpcDiscoveries("pending");
      return all ? all.length : 0;
    }
    return list.length;
  })();
  const nb = $( "#navDscBadge");
  if (nb) { nb.textContent = pendingCount||"–"; nb.className = "nav-badge"+(pendingCount?"":"muted"); }
  if (count) count.textContent = `${list.length} 条`;
  if (empty) empty.hidden = list.length > 0;
  grid.innerHTML = list.map(dscCard).join("");
}

/* ── 任务队列 ─────────────────────────────────────────────────── */
async function renderJobs() {
  const tbody = $( "#jobsBody"), empty = $( "#jobsEmpty"), sumBar = $( "#jobsSummary");
  if (!tbody) return;
  const jobs = await rpcJobs();

  if (jobs == null) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:24px 16px;color:var(--muted);text-align:center">任务队列需先应用 <code>0005_jobs.sql</code>。</td></tr>`;
    if (sumBar) sumBar.innerHTML = "";
    if (empty) empty.hidden = true;
    const nb = $( "#navJobsBadge"); if (nb) { nb.textContent = "–"; nb.className = "nav-badge muted"; }
    return;
  }

  const c = { pending:0, running:0, done:0, failed:0 };
  jobs.forEach((j) => { const s = String(j.status||"").replace(/[^a-z]/g,""); if (s in c) c[s]++; });
  if (sumBar) {
    sumBar.innerHTML = [["running","跑中"],["pending","排队"],["done","完成"],["failed","失败"]]
      .map(([k,l]) => `<div class="jsc ${k}"><b>${c[k]}</b> ${l}</div>`).join("")
      + `<div class="jsc"><b>${jobs.length}</b> 总计</div>`;
  }
  const nb = $( "#navJobsBadge");
  const active = c.running + c.pending;
  if (nb) { nb.textContent = active||jobs.length||"–"; nb.className = "nav-badge"+(c.failed?"":"muted"); }

  if (empty) empty.hidden = jobs.length > 0;
  if (!jobs.length) { tbody.innerHTML = ""; return; }

  tbody.innerHTML = jobs.slice(0,60).map((j) => {
    const st = String(j.status||"pending").replace(/[^a-z]/g,"");
    const kl = JOB_KIND[j.kind] || j.kind;
    const res = j.result ? esc(String(j.result).slice(0,80)) : "—";
    return `<tr>
      <td><span class="badge ${j.kind==="upgrade"?"pack":j.kind==="collect"?"collect":"pack"}">${kl}</span></td>
      <td><code>${esc(j.slug)}</code></td>
      <td><span class="badge ${st}">${JOB_STATUS[st]||st}</span></td>
      <td style="color:var(--muted);white-space:nowrap">${esc(fmtDate(j.created_at))}</td>
      <td style="color:var(--muted);font-size:12px" title="${esc(j.result||"")}">${res}</td>
    </tr>`;
  }).join("");
}

/* ── 站点管理 ─────────────────────────────────────────────────── */
function siteCard(s) {
  const p    = packsCache[s.id];
  const t2   = !!p;
  const folder = `https://opendesign.cc/packs/${esc(s.id)}/`;
  const detail = `https://opendesign.cc/en/sites/${esc(s.id)}`;
  const sl = esc(s.id), su = esc(s.url||"");
  let meta, actions;
  if (t2) {
    const zip = `${folder}${esc(p.zipFile || s.id+"-design-pack.zip")}`;
    const mb  = ((p.zipSize||0)/1048576).toFixed(1);
    meta    = `${p.fileCount||(p.files||[]).length} 文件 · ${mb} MB`;
    actions = `<a class="btn-sm" href="${zip}" download>↓ 下载 ZIP</a>
      <a class="btn-sm ghost" href="${folder}" target="_blank" rel="noreferrer">目录</a>
      <a class="btn-sm ghost" href="${detail}" target="_blank" rel="noreferrer">详情页</a>`;
  } else {
    meta    = `Tier-1 · 文档版`;
    actions = `<button class="btn-sm" data-job="upgrade" data-slug="${sl}" data-url="${su}">⬆ 升级完整包</button>
      <a class="btn-sm ghost" href="${folder}" target="_blank" rel="noreferrer">DESIGN.md</a>
      <a class="btn-sm ghost" href="${detail}" target="_blank" rel="noreferrer">详情页</a>`;
  }
  return `<div class="card">
    <a class="card-thumb" href="${folder}" target="_blank" rel="noreferrer">
      <img loading="lazy" src="${esc(s.image||"")}" alt="" />
    </a>
    <div class="card-body">
      <div class="card-top">
        <span class="card-title">${esc(s.title)}</span>
        <span class="badge ${t2?"tier2":"tier1"}">${t2?"完整包":"文档版"}</span>
      </div>
      <div class="card-meta">${meta}</div>
      <div class="card-actions">${actions}</div>
    </div>
  </div>`;
}

async function renderSiteMgr() {
  const grid = $( "#smGrid"), empty = $( "#smEmpty"), count = $( "#smCount");
  if (!grid) return;
  await ensurePacks();
  const sites = (window.STYLE_ATLAS_SITES||[]).slice().sort((a,b)=>(a.title||"").localeCompare(b.title||""));
  const q = smQuery.trim().toLowerCase();
  const list = sites.filter((s) => {
    const t2 = !!packsCache[s.id];
    if (smFilter==="tier2" && !t2) return false;
    if (smFilter==="tier1" &&  t2) return false;
    if (q && !`${s.title} ${s.id} ${s.url}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (count) count.textContent = `${list.length} 站`;
  if (empty) empty.hidden = list.length > 0;
  grid.innerHTML = list.map(siteCard).join("");
}

/* ── 收录请求 ─────────────────────────────────────────────────── */
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./,""); } catch { return ""; } }
function ingestCmd(row) {
  const title = (row.note||"").replace(/"/g,"'");
  if (row.kind==="pack") {
    const slug = (row.slug||"").replace(/[^a-z0-9-]/g,"");
    return [`# 完整设计系统包 · ${title||slug}`,
      `python3 extract/extract.py --url "${row.url}" --out extract/extracts/${slug}`,
      `python3 scripts/ingest.py --from-extract extract/extracts/${slug} --slug ${slug} --auto-publish`,
      `cp dist/packs/${slug}/DESIGN_SPEC.en.md extract/extracts/${slug}/DESIGN_SPEC.md && bash extract/pack.sh extract/extracts/${slug}`,
    ].join("\n");
  }
  return `python3 scripts/ingest.py "${row.url}" --auto-publish${title ? ` --title "${title}"` : ""}`;
}

function renderSubmissions() {
  const tbody = $( "#subBody"), empty = $( "#subEmpty"), count = $( "#subCount");
  if (!tbody) return;
  const rows = subFilter==="all" ? allRows : allRows.filter((r)=>r.status===subFilter);
  const liveHosts = new Set((window.STYLE_ATLAS_SITES||[]).map((s)=>hostOf(s.url)).filter(Boolean));

  if (count) count.textContent = `${rows.length} 条 · 全部 ${allRows.length}`;
  if (empty) empty.hidden = rows.length > 0;

  // nav badge
  const penCount = allRows.filter((r)=>(r.status||"pending")==="pending").length;
  const nb = $( "#navSubBadge");
  if (nb) { nb.textContent = penCount||"–"; nb.className = "nav-badge"+(penCount?"":"muted"); }

  tbody.innerHTML = rows.map((r) => {
    const host   = esc(r.host), note = esc(r.note);
    const label  = note || host;
    const status = String(r.status||"").replace(/[^a-z]/g,"");
    const kind   = r.kind==="pack" ? "pack" : "collect";
    const voters = Number(r.host_voters)||0, total = Number(r.host_total)||0;
    const inLib  = liveHosts.has(hostOf(r.url)||r.host);
    const truth  = inLib
      ? `<span class="badge done" title="库中确有此站" style="margin-left:4px">✓ 在库</span>`
      : (status==="published" ? `<span class="badge failed" style="margin-left:4px" title="库中无此站">⚠ 不在库</span>` : "");
    return `<tr>
      <td><span class="badge ${kind}">${KIND_LABEL_SUB[kind]}</span></td>
      <td>
        <a href="${safeHref(r.url)}" target="_blank" rel="noreferrer" style="font-weight:600">${label}</a>
        ${note ? `<div style="font-size:11px;color:var(--muted)">${host}</div>` : ""}
      </td>
      <td style="white-space:nowrap;color:var(--muted)">${voters} 人 · ${total} 次</td>
      <td style="white-space:nowrap;color:var(--muted)">${esc(fmtDate(r.created_at))}</td>
      <td><span class="badge ${status}">${STATUS_LABEL[status]||status}</span>${truth}</td>
      <td>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn-sm" data-act="accept" data-id="${esc(r.id)}" data-cmd="${encodeURIComponent(ingestCmd(r))}">接受&复制</button>
          <button class="btn-sm ghost" data-act="published" data-id="${esc(r.id)}">标发布</button>
          <button class="btn-sm danger" data-act="reject" data-id="${esc(r.id)}">拒绝</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

/* ── 实时刷新 ─────────────────────────────────────────────────── */
async function liveRefresh() {
  packsCache = {};  // 清 packs 缓存，确保完整包数是最新的
  try {
    allRows = await rpcList(getPass());
  } catch (_) {}
  await renderOverview();
  // 只刷当前可见的 section
  if (currentSection === "logs")        await renderLogs();
  if (currentSection === "jobs")        await renderJobs();
  if (currentSection === "discoveries") await renderDiscoveries();
  if (currentSection === "sites")       await renderSiteMgr();
  if (currentSection === "submissions") renderSubmissions();
  const el = $( "#liveLabel"); if (el) el.textContent = `${fmtNow()} 同步`;
}

function startLive() {
  if (liveTimer) return;
  liveTimer = setInterval(() => {
    if (document.visibilityState === "visible") liveRefresh();
  }, 6000);
}

/* ── 登录/加载 ────────────────────────────────────────────────── */
async function load() {
  try {
    allRows = await rpcList(getPass());
    $( "#gate").hidden = true;
    $( "#app").hidden  = false;
    // 初始化所有已在视图内的内容
    await renderOverview();
    renderSubmissions();
    startLive();
  } catch (err) {
    sessionStorage.removeItem(PASS_KEY);
    $( "#gate").hidden = false;
    $( "#app").hidden  = true;
    $( "#gateErr").textContent = /unauthorized/i.test(err.message||"")
      ? "口令不对，请重试。"
      : `加载失败：${err.message||err}`;
  }
}

/* ── 事件绑定 ──────────────────────────────────────────────────── */

// 登录表单
$( "#gateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = $( "#passInput").value.trim();
  if (!pass) return;
  sessionStorage.setItem(PASS_KEY, pass);
  $( "#gateErr").textContent = "";
  await load();
});

// 退出
$( "#logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem(PASS_KEY);
  location.reload();
});

// 日志：展开/收起
document.addEventListener("click", (e) => {
  const row = e.target.closest("tr.log-main-row");
  if (!row) return;
  const id  = row.dataset.lid;
  const det = document.getElementById(`ldr-${id}`);
  if (!det) return;
  const open = det.style.display === "table-row";
  det.style.display = open ? "none" : "table-row";
});

// 日志：类型筛选
$( "#logFilters") && $( "#logFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-lf]");
  if (!btn) return;
  logFilter = btn.dataset.lf;
  $$( "#logFilters button").forEach((b) => b.classList.toggle("active", b===btn));
  renderLogs();
});
$( "#logsRefresh") && $( "#logsRefresh").addEventListener("click", renderLogs);

// 发现队列：筛选
$( "#dscFilters") && $( "#dscFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-df]");
  if (!btn) return;
  dscFilter = btn.dataset.df;
  $$( "#dscFilters button").forEach((b) => b.classList.toggle("active", b===btn));
  renderDiscoveries();
});
$( "#dscRefresh") && $( "#dscRefresh").addEventListener("click", renderDiscoveries);

// 发现队列：收录/忽略
$( "#dscGrid") && $( "#dscGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-dsc]");
  if (!btn) return;
  const action = btn.dataset.dsc, id = btn.dataset.id;
  btn.disabled = true;
  try {
    await rpcReviewDiscovery(id, action);
    toast(action==="approve" ? "已入队收录 → 等 cron 处理" : "已忽略");
    renderDiscoveries();
    if (action==="approve") renderJobs();
  } catch (err) {
    toast(/unauthorized/i.test(err.message||"") ? "口令失效，重新登录" : `操作失败：${err.message||err}`);
    btn.disabled = false;
  }
});

// 任务队列：刷新
$( "#jobsRefresh") && $( "#jobsRefresh").addEventListener("click", renderJobs);

// 站点管理：筛选 / 搜索 / 入队升级
$( "#smFilters") && $( "#smFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sf]");
  if (!btn) return;
  smFilter = btn.dataset.sf;
  $$( "#smFilters button").forEach((b) => b.classList.toggle("active", b===btn));
  renderSiteMgr();
});
$( "#smSearch") && $( "#smSearch").addEventListener("input", (e) => { smQuery = e.target.value; renderSiteMgr(); });
$( "#smGrid") && $( "#smGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-job]");
  if (!btn) return;
  const kind = btn.dataset.job, slug = btn.dataset.slug, url = btn.dataset.url;
  btn.disabled = true;
  try {
    await rpcEnqueue(kind, slug, url);
    toast(`「${slug}」已入队 → 等 cron 处理`);
    renderJobs();
  } catch (err) {
    toast(/unauthorized/i.test(err.message||"") ? "口令失效，重新登录" : `入队失败：${err.message||err}`);
    btn.disabled = false;
  }
});

// 收录请求：筛选 / 操作
$( "#subFilters") && $( "#subFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sf2]");
  if (!btn) return;
  subFilter = btn.dataset.sf2;
  $$( "#subFilters button").forEach((b) => b.classList.toggle("active", b===btn));
  renderSubmissions();
});
$( "#subRefresh") && $( "#subRefresh").addEventListener("click", async () => {
  try { allRows = await rpcList(getPass()); renderSubmissions(); }
  catch (err) { toast(`刷新失败：${err.message||err}`); }
});
$( "#subBody") && $( "#subBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  try {
    if (act==="accept") {
      const cmd = decodeURIComponent(btn.dataset.cmd||"");
      try { await navigator.clipboard.writeText(cmd); toast("已接受 · 命令已复制，去终端跑"); }
      catch { toast("已接受（剪贴板不可用，命令见 console）"); console.log(cmd); }
      await rpcSetStatus(id,"accepted");
    } else if (act==="published") {
      const row  = allRows.find((r)=>String(r.id)===String(id));
      const livH = new Set((window.STYLE_ATLAS_SITES||[]).map((s)=>hostOf(s.url)).filter(Boolean));
      const inL  = row && livH.has(hostOf(row.url)||row.host);
      if (!inL && !confirm("库中查不到这个站，确定标为「已发布」？")) return;
      await rpcSetStatus(id,"published");
      toast(inL ? "已标记为已发布" : "已标记（注意：库中暂无此站）");
    } else if (act==="reject") {
      await rpcSetStatus(id,"rejected");
      toast("已拒绝");
    }
    allRows = await rpcList(getPass());
    renderSubmissions();
    renderOverview();
  } catch (err) {
    toast(`操作失败：${err.message||err}`);
  }
});

// 概览「查看全部日志」快捷链接
window.adminNav = adminNav;

/* ── 启动 ──────────────────────────────────────────────────────── */
if (getPass()) load();
