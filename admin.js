/* OpenDesign 收录后台 · Triage 看板
 * 模型：用户推荐的 URL 进 submissions 队列；这里口令登录后看全部，标记状态。
 * 真正的收录 + 发布在本地跑（「接受」会复制 ingest 命令到剪贴板）。
 *
 * 安全：口令只存 sessionStorage；所有读写走 security definer RPC（口令校验，绕 RLS）。
 *       publishable anon key 是公开的，没口令调 RPC 会被服务端拒。 */

const PASS_KEY = "od-admin-pass";

const cfg = window.SUPABASE_CONFIG || {};
const sb = (window.supabase && cfg.url && cfg.anonKey)
  ? window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: false } })
  : null;

const $ = (sel) => document.querySelector(sel);
const gate = $("#gate");
const panel = $("#panel");
let currentFilter = "pending";
let allRows = [];

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1800);
}

// 提交内容（url / host / note）由匿名用户任意填，渲染前必须转义，否则后台开页即触发存储型 XSS
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function safeHref(u) {
  return /^https?:\/\//i.test(u || "") ? esc(u) : "#";
}

function getPass() {
  return sessionStorage.getItem(PASS_KEY) || "";
}

async function rpcList(pass) {
  if (!sb) throw new Error("Supabase 未初始化");
  const { data, error } = await sb.rpc("admin_list_submissions", { p_pass: pass });
  if (error) throw error;
  return data || [];
}

async function rpcSetStatus(id, status) {
  const { error } = await sb.rpc("admin_update_status", {
    p_pass: getPass(), p_id: id, p_status: status,
  });
  if (error) throw error;
}

async function rpcEnqueue(kind, slug, url) {
  const { error } = await sb.rpc("admin_enqueue_job", {
    p_pass: getPass(), p_kind: kind, p_slug: slug, p_url: url || "",
  });
  if (error) throw error;
}

async function rpcJobs() {
  try {
    const { data, error } = await sb.rpc("admin_list_jobs", { p_pass: getPass() });
    if (error) throw error;
    return data || [];
  } catch (_) { return null; }   // 0005 SQL 没应用时静默
}

async function rpcDiscoveries(status) {
  try {
    const { data, error } = await sb.rpc("admin_list_discoveries", { p_pass: getPass(), p_status: status });
    if (error) throw error;
    return data || [];
  } catch (_) { return null; }   // 0006 SQL 没应用时静默
}

async function rpcReviewDiscovery(id, action) {
  const { error } = await sb.rpc("admin_review_discovery", { p_pass: getPass(), p_id: id, p_action: action });
  if (error) throw error;
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch { return iso; }
}

const STATUS_LABEL = { pending: "待处理", accepted: "已接受", rejected: "已拒绝", published: "已发布" };

function ingestCmd(row) {
  const title = (row.note || "").replace(/"/g, "'");
  if (row.kind === "pack") {
    // 完整包请求：Playwright 提取 → mimo from-extract → 打包带截图 ZIP
    const slug = (row.slug || "").replace(/[^a-z0-9-]/g, "");
    return [
      `# 完整设计系统包 · ${title || slug}`,
      `python3 extract/extract.py --url "${row.url}" --out extract/extracts/${slug}`,
      `python3 scripts/ingest.py --from-extract extract/extracts/${slug} --slug ${slug} --auto-publish`,
      `cp dist/packs/${slug}/DESIGN_SPEC.en.md extract/extracts/${slug}/DESIGN_SPEC.md && bash extract/pack.sh extract/extracts/${slug}`,
    ].join("\n");
  }
  const titleArg = title ? ` --title "${title}"` : "";
  return `python3 scripts/ingest.py "${row.url}" --auto-publish${titleArg}`;
}

const KIND_LABEL = { collect: "收录请求", pack: "完整包请求" };

function render() {
  const rows = currentFilter === "all"
    ? allRows
    : allRows.filter((r) => r.status === currentFilter);

  $("#count").textContent = `${rows.length} 条 · 全队列 ${allRows.length}`;
  $("#empty").hidden = rows.length > 0;

  $("#rows").innerHTML = rows.map((r) => {
    const host = esc(r.host);
    const note = esc(r.note);
    const label = note || host;
    const status = String(r.status || "").replace(/[^a-z]/g, "");
    const id = esc(r.id);
    const voters = Number(r.host_voters) || 0;
    const total = Number(r.host_total) || 0;
    const kind = r.kind === "pack" ? "pack" : "collect";
    const kindBadge = `<span class="badge kind-${kind}">${KIND_LABEL[kind]}</span>`;
    return `
      <tr>
        <td class="host">
          ${kindBadge}
          <a href="${safeHref(r.url)}" target="_blank" rel="noreferrer">${label}</a>
          ${note ? `<span class="note">${host}</span>` : ""}
        </td>
        <td class="demand">${voters} 人 · ${total} 次</td>
        <td>${esc(fmtDate(r.created_at))}</td>
        <td><span class="badge ${status}">${STATUS_LABEL[status] || status}</span></td>
        <td>
          <div class="row-actions">
            <button class="mini" data-act="accept" data-id="${id}" data-cmd="${encodeURIComponent(ingestCmd(r))}">接受 + 复制命令</button>
            <button class="ghost mini" data-act="published" data-id="${id}">标已发布</button>
            <button class="ghost mini" data-act="reject" data-id="${id}">拒绝</button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

/* ---- 站点状态缓存（packs-index：哪些是完整包） ---- */
let packsCache = {};
let smFilter = "all";
let smQuery = "";

async function ensurePacks() {
  if (Object.keys(packsCache).length) return;
  try { packsCache = await (await fetch("/packs-index.json?_=" + Date.now())).json(); } catch (_) { packsCache = {}; }
}

/* ---- 总览：统计卡 + 升级进度 ---- */
async function renderOverview(queuePending) {
  await ensurePacks();
  const sites = window.STYLE_ATLAS_SITES || [];
  const tier2 = sites.filter((s) => packsCache[s.id]).length;
  const pct = sites.length ? Math.round((tier2 / sites.length) * 100) : 0;
  $("#statTotal").textContent = sites.length;
  $("#statTier2").textContent = tier2;
  $("#statTier1").textContent = sites.length - tier2;
  $("#statPct").textContent = pct + "%";
  $("#statQueue").textContent = queuePending == null ? "–" : queuePending;
  $("#progressFill").style.width = pct + "%";
}

/* ---- 站点管理：缩略图 + Tier + 操作（下载真 ZIP / 复制升级命令 / folder / 详情页） ---- */
function siteCard(s) {
  const p = packsCache[s.id];
  const t2 = !!p;
  const folder = `https://opendesign.cc/packs/${esc(s.id)}/`;
  const detail = `https://opendesign.cc/en/sites/${esc(s.id)}`;
  const sl = esc(s.id), su = esc(s.url || "");
  let meta, actions;
  if (t2) {
    const zip = `${folder}${esc(p.zipFile || s.id + "-design-pack.zip")}`;
    const mb = ((p.zipSize || 0) / 1048576).toFixed(1);
    meta = `${p.fileCount || (p.files || []).length} 文件 · ${mb} MB`;
    actions = `<a class="mini" href="${zip}" download>↓ 下载完整 ZIP</a>
      <a class="ghost mini" href="${folder}" target="_blank" rel="noreferrer">folder</a>
      <a class="ghost mini" href="${detail}" target="_blank" rel="noreferrer">详情页</a>`;
  } else {
    meta = `Tier-1 · 文档版，待升级`;
    actions = `<button class="mini" data-job="upgrade" data-slug="${sl}" data-url="${su}">⬆ 升级为完整包</button>
      <a class="ghost mini" href="${folder}" target="_blank" rel="noreferrer">DESIGN.md</a>
      <a class="ghost mini" href="${detail}" target="_blank" rel="noreferrer">详情页</a>`;
  }
  return `<div class="sm-card">
    <a class="sm-thumb" href="${folder}" target="_blank" rel="noreferrer"><img loading="lazy" src="${esc(s.image || "")}" alt="" /></a>
    <div class="sm-body">
      <div class="sm-top"><span class="sm-title">${esc(s.title)}</span><span class="badge ${t2 ? "kind-pack" : "kind-collect"}">${t2 ? "完整包" : "文档"}</span></div>
      <div class="sm-meta">${meta}</div>
      <div class="sm-actions">${actions}</div>
    </div></div>`;
}

async function renderSiteMgr() {
  await ensurePacks();
  const sites = (window.STYLE_ATLAS_SITES || []).slice().sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  const q = smQuery.trim().toLowerCase();
  const list = sites.filter((s) => {
    const t2 = !!packsCache[s.id];
    if (smFilter === "tier2" && !t2) return false;
    if (smFilter === "tier1" && t2) return false;
    if (q && !`${s.title} ${s.id} ${s.url}`.toLowerCase().includes(q)) return false;
    return true;
  });
  $("#smCount").textContent = `${list.length} 站`;
  $("#smGrid").innerHTML = list.map(siteCard).join("");
}

/* ---- 任务队列（升级 / 刷新主图，服务器 cron 跑） ---- */
const JOB_STATUS = { pending: "排队中", running: "跑中…", done: "完成", failed: "失败" };
const JOB_KIND = { upgrade: "⬆ 升级", collect: "✓ 收录", refresh: "🖼 刷新主图" };
async function renderJobs() {
  const jobs = await rpcJobs();
  const wrap = $("#jobsList"), sum = $("#jobsSummary");
  if (jobs == null) { sum.innerHTML = ""; wrap.innerHTML = `<p class="jobs-empty">任务队列需先应用 <code>0005_jobs.sql</code> + 配好服务器 runner。</p>`; return; }
  // 状态计数条（一眼看全貌，不再是盲盒）
  const c = { pending: 0, running: 0, done: 0, failed: 0 };
  jobs.forEach((j) => { const s = String(j.status || "").replace(/[^a-z]/g, ""); if (s in c) c[s]++; });
  sum.innerHTML = [["running", "跑中"], ["pending", "排队"], ["done", "完成"], ["failed", "失败"]]
    .map(([k, label]) => `<span class="jc ${k}">${label} <b>${c[k]}</b></span>`).join("")
    + `<span class="jc">共 <b>${jobs.length}</b></span>`;
  if (!jobs.length) { wrap.innerHTML = `<p class="jobs-empty">暂无任务。点上方站点的「升级 / 刷新主图」即可入队。</p>`; return; }
  wrap.innerHTML = jobs.slice(0, 30).map((j) => {
    const st = String(j.status || "pending").replace(/[^a-z]/g, "");
    return `<div class="job-row">
      <span class="job-kind">${JOB_KIND[j.kind] || j.kind}</span>
      <span class="job-slug">${esc(j.slug)}</span>
      <span class="badge job-${st}">${JOB_STATUS[st] || st}</span>
      <span class="job-time">${esc(fmtDate(j.created_at))}</span>
      ${j.result ? `<span class="job-result" title="${esc(j.result)}">${esc(String(j.result).slice(0, 50))}</span>` : ""}
    </div>`;
  }).join("");
}

/* ---- 发现队列（爬虫全网发现 → 审阅 → 一键收录） ---- */
let dscFilter = "pending";
const DSC_STATUS = { pending: "待审阅", approved: "已收录", ignored: "已忽略" };

function dscCard(d) {
  const id = esc(d.id), host = esc(d.host), title = esc(d.title || d.host);
  const st = String(d.status || "pending").replace(/[^a-z]/g, "");
  const src = esc(d.source || "—");
  const score = Number(d.score) || 0;
  let actions;
  if (st === "pending") {
    actions = `<button class="mini" data-dsc="approve" data-id="${id}">✓ 收录</button>
      <button class="ghost mini" data-dsc="ignore" data-id="${id}">忽略</button>
      <a class="ghost mini" href="${safeHref(d.url)}" target="_blank" rel="noreferrer">访问</a>`;
  } else {
    actions = `<span class="badge ${st === "approved" ? "kind-pack" : "kind-collect"}">${DSC_STATUS[st] || st}</span>
      <a class="ghost mini" href="${safeHref(d.url)}" target="_blank" rel="noreferrer">访问</a>`;
  }
  return `<div class="sm-card">
    <a class="sm-thumb dsc" href="${safeHref(d.url)}" target="_blank" rel="noreferrer">
      <span class="src-tag">${src}</span>${score ? `<span class="score-tag">▲ ${score}</span>` : ""}
      <img loading="lazy" src="${esc(d.image || "")}" alt="" />
    </a>
    <div class="sm-body">
      <div class="sm-top"><span class="sm-title">${title}</span></div>
      <div class="sm-host">${host}</div>
      <div class="sm-actions">${actions}</div>
    </div></div>`;
}

async function renderDiscoveries() {
  const grid = $("#dscGrid"), empty = $("#dscEmpty"), count = $("#dscCount");
  const list = await rpcDiscoveries(dscFilter);
  if (list == null) {
    grid.innerHTML = "";
    empty.hidden = false;
    empty.innerHTML = `发现队列需先应用 <code>0006_discoveries.sql</code>，再本地跑 <code>python3 scripts/discover.py</code>。`;
    count.textContent = "";
    return;
  }
  count.textContent = `${list.length} 条`;
  empty.hidden = list.length > 0;
  if (!list.length) empty.innerHTML = `这个分类下暂无。本地跑 <code>python3 scripts/discover.py</code> 去全网找。`;
  grid.innerHTML = list.map(dscCard).join("");
}

/* ---- 实时刷新：完整包数 / 任务队列 / 发现队列 每 6 秒自动更新（页签可见时）---- */
let liveTimer = null;
function fmtNow() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
async function liveRefresh() {
  packsCache = {};   // 清缓存 → 拿最新 packs-index（完整包数实时涨）
  const pending = allRows.filter((r) => (r.status || "pending") === "pending").length;
  await renderOverview(pending);
  await renderJobs();
  await renderDiscoveries();
  const el = $("#liveStamp");
  if (el) el.innerHTML = `实时 · 上次更新 <b>${fmtNow()}</b>`;
}
function startLive() {
  if (liveTimer) return;
  liveTimer = setInterval(() => {
    if (document.visibilityState === "visible" && !panel.hidden) liveRefresh();
  }, 6000);
}

async function load() {
  try {
    allRows = await rpcList(getPass());
    panel.hidden = false;
    gate.hidden = true;
    render();
    const pending = allRows.filter((r) => (r.status || "pending") === "pending").length;
    renderOverview(pending);
    renderDiscoveries();
    renderSiteMgr();
    renderJobs();
    startLive();
    const ls = $("#liveStamp"); if (ls) ls.innerHTML = `实时 · 上次更新 <b>${fmtNow()}</b>`;
  } catch (err) {
    // 口令错或网络问题
    sessionStorage.removeItem(PASS_KEY);
    gate.hidden = false;
    panel.hidden = true;
    $("#gateErr").textContent = (err && /unauthorized/i.test(err.message || ""))
      ? "口令不对。"
      : `加载失败：${err.message || err}`;
  }
}

/* ---- 事件 ---- */

$("#gateForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pass = $("#passInput").value.trim();
  if (!pass) return;
  sessionStorage.setItem(PASS_KEY, pass);
  $("#gateErr").textContent = "";
  await load();
});

$("#logoutBtn").addEventListener("click", () => {
  sessionStorage.removeItem(PASS_KEY);
  location.reload();
});

$("#refreshBtn").addEventListener("click", load);

$("#filters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-f]");
  if (!btn) return;
  currentFilter = btn.dataset.f;
  document.querySelectorAll("#filters button").forEach((b) => b.classList.toggle("active", b === btn));
  render();
});

/* ---- 站点管理：筛选 / 搜索 / 复制升级命令 ---- */
$("#smFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sf]");
  if (!btn) return;
  smFilter = btn.dataset.sf;
  document.querySelectorAll("#smFilters button").forEach((b) => b.classList.toggle("active", b === btn));
  renderSiteMgr();
});
$("#smSearch").addEventListener("input", (e) => { smQuery = e.target.value; renderSiteMgr(); });
$("#smGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-job]");
  if (!btn) return;
  const kind = btn.dataset.job, slug = btn.dataset.slug, url = btn.dataset.url;
  btn.disabled = true;
  try {
    await rpcEnqueue(kind, slug, url);
    toast(`${kind === "upgrade" ? "升级" : "刷新主图"}已入队 · ${slug} —— 本地跑 drain.sh 上线`);
    renderJobs();
  } catch (err) {
    toast(/unauthorized/i.test(err.message || "") ? "口令失效，重新登录" : `入队失败：${err.message || err}（先应用 0005 SQL？）`);
  } finally {
    btn.disabled = false;
  }
});

/* ---- 发现队列：筛选 / 刷新 / 收录·忽略 ---- */
$("#dscFilters").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-df]");
  if (!btn) return;
  dscFilter = btn.dataset.df;
  document.querySelectorAll("#dscFilters button").forEach((b) => b.classList.toggle("active", b === btn));
  renderDiscoveries();
});
$("#dscRefresh").addEventListener("click", renderDiscoveries);
$("#dscGrid").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-dsc]");
  if (!btn) return;
  const action = btn.dataset.dsc, id = btn.dataset.id;
  btn.disabled = true;
  try {
    await rpcReviewDiscovery(id, action);
    toast(action === "approve" ? "已收录 → 入队，本地 drain 跑完整包上线" : "已忽略");
    renderDiscoveries();
    if (action === "approve") renderJobs();   // 收录会新建一条 collect 任务
  } catch (err) {
    toast(/unauthorized/i.test(err.message || "") ? "口令失效，重新登录" : `操作失败：${err.message || err}`);
    btn.disabled = false;
  }
});

$("#rows").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === "accept") {
      const cmd = decodeURIComponent(btn.dataset.cmd || "");
      try { await navigator.clipboard.writeText(cmd); toast("已接受 · 命令已复制，去终端跑"); }
      catch { toast("已接受（剪贴板不可用，命令见 console）"); console.log(cmd); }
      await rpcSetStatus(id, "accepted");
    } else if (act === "published") {
      await rpcSetStatus(id, "published");
      toast("标记为已发布");
    } else if (act === "reject") {
      await rpcSetStatus(id, "rejected");
      toast("已拒绝");
    }
    await load();
  } catch (err) {
    toast(`操作失败：${err.message || err}`);
  }
});

/* ---- 启动：有缓存口令就直接进 ---- */
if (getPass()) {
  load();
}
