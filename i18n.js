/* OpenDesign · i18n 模块
 * 支持 N 种语言；要加新语言（日韩法德等）只需在 TRANSLATIONS 里加一个 key 即可。
 * 使用：
 *   - 静态 HTML：在元素上加 data-i18n="key"，本模块自动 applyI18n() 时填文本
 *   - 属性：data-i18n-placeholder="key" / data-i18n-aria-label="key" 等
 *   - JS 动态串：调用 i18n.t("key", { count: 5 }) 取译文
 *   - 切换：i18n.set("en") / i18n.set("zh")
 *   - 持久化：localStorage `opendesign-lang`，URL ?lang=en 临时覆盖
 */

(function () {
  const LANG_KEY = "opendesign-lang";
  const FALLBACK = "zh";
  const SUPPORTED = ["zh", "en"];

  const TRANSLATIONS = {
    zh: {
      // brand
      "brand.aria": "OpenDesign 首页",
      "brand.sub": "策展网页美学",

      // nav
      "nav.aria": "导航",
      "nav.atlas": "图集",
      "nav.library": "列表",
      "nav.saved": "收藏",
      "nav.about": "关于",

      // top actions
      "actions.collect": "＋ 收录",
      "actions.reset": "重置",
      "actions.reset.aria": "重置画布",
      "actions.lang.aria": "切换语言",

      // filter rail
      "filter.aria": "筛选",
      "filter.search.placeholder": "搜索 · 风格 / 标签 / URL",
      "chip.all": "全部",

      // canvas
      "canvas.aria": "灵感图集",
      "canvas.surface.aria": "拖拽浏览灵感图集",
      "canvas.footnote": "共 {count} 个网站 · 拖拽 · ⌘ + 滚轮缩放 · 点击查看",

      // library
      "library.aria": "列表视图",
      "library.eyebrow": "列表 · 共 {count} 个网站",
      "library.heading": "把好网站沉淀成可复用的设计语料。",
      "library.lead": "列表视图便于快速扫描和搜索。点击任意一条进入详情，可复制或下载它的 Markdown 风格迁移规范。",
      "library.num": "第 {n} 号",
      "library.footer.brand": "OpenDesign",
      "library.footer.url": "opendesign.cc",

      // saved
      "saved.aria": "我的收藏",
      "saved.eyebrow": "收藏 · 共 {count} 个网站",
      "saved.heading": "你保存下来的网页美学。",
      "saved.lead": "收藏存在这个浏览器，云端有备份。换设备？用「同步码」把收藏带过去 —— 不需要账号。",
      "saved.empty.title": "还没收藏任何网站",
      "saved.empty.sub": "在图集或列表里点心形 ♥ 收藏喜欢的条目，会出现在这里。",
      "saved.empty.bind": "在另一台设备已经收藏过？<button class=\"text-link\" data-action=\"open-bind-sync\">绑定一个同步码</button>",
      "saved.footer.note": "本浏览器存储",
      "footer.tagline": "精选 · 开放 · 免费",

      // sync code
      "sync.eyebrow": "跨设备携带",
      "sync.lead": "想把这台设备的收藏带到手机 / 另一台电脑？生成一个同步码即可。不需要邮箱密码。",
      "sync.action.create": "生成同步码",
      "sync.action.bind": "绑定一个同步码",
      "sync.create.eyebrow": "同步码 · 已生成",
      "sync.create.title": "把它记好",
      "sync.create.copy": "复制",
      "sync.create.copied": "已复制到剪贴板",
      "sync.create.note": "在另一台设备打开 opendesign.cc → 「我的收藏」→ 「绑定同步码」→ 输入这串码。收藏会跟过来。",
      "sync.create.warn": "⚠️ 任何拿到这个码的人都能看到这个浏览器的收藏。不要发给别人，不要贴到公开页面。",
      "sync.bind.eyebrow": "同步码 · 绑定",
      "sync.bind.title": "输入在另一台设备生成的码",
      "sync.bind.submit": "绑定",
      "sync.bind.submitting": "绑定中…",
      "sync.bind.cancel": "取消",
      "sync.bind.success": "已绑定，正在加载收藏…",
      "sync.bind.note": "绑定后，这个浏览器会切换到那台设备的收藏夹。当前浏览器原本的收藏（如果有）会被替换为新的（旧数据未删，但不再显示）。",
      "sync.bind.error.notfound": "没找到这个同步码。请检查拼写。",
      "sync.bind.error.generic": "绑定失败。请稍后重试。",
      "sync.close.aria": "关闭",
      "sync.error.offline": "网络未就绪，暂时不能同步。",
      "sync.error.create": "生成失败，请稍后重试。",

      // about
      "about.aria": "关于 OpenDesign",
      "about.eyebrow": "关于 · OpenDesign",
      "about.heading": "把那些「看一眼就知道很贵」的网站，拆成 AI 也能学的语料。",
      "about.lead": "OpenDesign 是一个开放的网页美学资源库。每一个收录都附带一份 Markdown 设计系统规范 —— 不是文案，不是版式 PSD，而是把视觉、布局、交互、动效抽象成 AI 可直接复用的迁移指令。",
      "about.card.01.label": "标准",
      "about.card.01.title": "统一的 11 层 Tokens 结构",
      "about.card.01.body": "每个条目按相同结构整理：身份 / 颜色 / 字体 / 间距 / 圆角阴影 / 布局 / 组件 / 动效 / 交互 / 文案 / 禁用清单 + 可直接喂 AI 的 System Prompt。结构稳定，AI 学起来才稳。",
      "about.card.02.label": "用法",
      "about.card.02.title": "喂给 AI 生成同气质网页",
      "about.card.02.body": "在图集或列表里挑一个，进入详情，复制或下载 Markdown，丢进 Claude、Cursor、v0、Lovable 这类工具，让它按这份规范生成你的新页面 —— 不复制品牌资产、只迁移气质。",
      "about.card.03.label": "立场",
      "about.card.03.title": "克制，是这里的唯一标准",
      "about.card.03.body": "不收录炫技但没有内容的页面。值得反复回看的是那些「少做了几件事」的网站 —— 它们对留白、信息密度、动效目的都有判断。",
      "about.card.04.label": "开放",
      "about.card.04.title": "所有规范开放复用",
      "about.card.04.body": "所有 Markdown 规范开放给任何人复制、下载、二次使用。不向 AI 工具收授权费，不向访客收 newsletter，不接广告 —— 这是这个站作为「公共资源」的承诺。",
      "about.card.05.label": "开源",
      "about.card.05.title": "代码 + 规范 + 工具，全在 GitHub",
      "about.card.05.body": "OpenDesign 的前端、抽取 CLI、Edge Function、所有 spec 都在 GitHub 上：代码 MIT，curated specs 走 CC BY 4.0。欢迎 fork、改进、提名新站。",
      "about.card.05.cta": "在 GitHub 上查看",
      "github.viewOnGitHub": "在 GitHub 上查看",
      "github.aria": "在 GitHub 上查看 OpenDesign 的源代码和文档",
      "about.sample.eyebrow": "示例 · 一份规范长什么样",
      "about.sample.lead": "下面是当前精选中的一份完整 Markdown 设计系统规范 —— 你可以直接复制走，喂给任何 AI 编码工具。",
      "about.contact.eyebrow": "投稿",
      "about.contact.heading": "发现了值得收录的网站？",
      "about.contact.lead": "把链接发给我们，符合收录标准的会被加入资源库。",
      "about.footer.updated": "最近更新",

      // drawer
      "drawer.close.aria": "关闭详情",
      "drawer.visit.aria": "打开原始网页",
      "drawer.visit.text": "打开原站",
      "drawer.media.visit": "打开原站",
      "drawer.download.text": "下载素材包",
      "drawer.download.aria": "下载设计素材 ZIP（含 11 层 MD 规范 + 真 Token 数据 + 全套截图）",
      "pack.eyebrow": "设计素材包 / DESIGN PACK",
      "pack.files": "个文件",
      "pack.pitch": "不只是一个 MD —— 含真 computed styles + 真字体清单 + 滚动分段证据截图 + AI 就绪 markdown，可直接喂任意编码 agent。",
      "pack.download.zip": "下载 ZIP",
      "pack.copy.agentUrl": "复制 AI Agent URL",
      "pack.copy.agentUrl.aria": "复制 DESIGN_SPEC.md 的永久链接给 Claude / Cursor / v0 等 AI 工具",
      "pack.copied": "已复制目录链接 —— 粘给 Claude / Cursor，AI 会自动读到规范 + 截图 + 字体清单全套",
      "pack.cat.spec": "规范",
      "pack.cat.data": "数据",
      "pack.cat.shot": "截图",
      "preview.download": "下载",
      "preview.close": "关闭预览",
      "preview.loading": "加载中…",
      "preview.error": "加载失败",
      "preview.openRaw": "新窗口看原始文件",
      "drawer.save": "收藏",
      "drawer.save.done": "已收藏",
      "drawer.save.aria": "收藏",
      "drawer.like": "点赞",
      "drawer.like.done": "已赞",
      "drawer.like.aria": "点赞",
      "drawer.md.title": "MD 设计规范",
      "drawer.md.copy": "复制",
      "drawer.md.download": "下载",
      "drawer.md.copyJson": "复制 JSON",
      "drawer.insight.color": "视觉语言",
      "drawer.insight.layout": "布局结构",
      "drawer.insight.interaction": "交互形态",
      "drawer.insight.motion": "动效规则",

      // collect modal
      "modal.close.aria": "关闭",
      "modal.eyebrow": "自动收录",
      "modal.heading": "丢进一个链接，自动生成灵感条目",
      "modal.url.label": "粘贴或拖入网址",
      "modal.preview.waiting.title": "等待链接",
      "modal.preview.waiting.meta": "粘 URL 后点「开始分析」—— 系统会真实抓页面、截图、抽颜色、生成 11 层设计系统规范。",
      "modal.palette.aria": "抽取到的主色",
      "modal.pipeline.aria": "自动收录流水线",
      "modal.pipeline.url": "① 清洗 URL",
      "modal.pipeline.meta": "② microlink 抓取",
      "modal.pipeline.palette": "③ 抽取调色板",
      "modal.pipeline.ai": "④ AI 解读",
      "modal.button.start": "开始分析",
      "modal.button.running": "分析中…",
      "modal.button.commit": "✓ 入库并下载 MD",
      "modal.button.retry": "重试",

      // spec hint
      "spec.hint.ai": "✓ 已生成完整 11 层设计系统 spec（含字体 / 间距 / 动效 / 文案 / 禁用清单）",
      "spec.hint.colorsOnly": "⚠ 颜色层从截图自动抽取；其他 10 层等 AI 接通（见下方提示）",
      "spec.hint.stub": "⚠ 当前只能生成结构骨架，AI 接通后会自动填充",

      // toasts
      "toast.md.copied": "已复制 Markdown",
      "toast.json.copied": "已复制 JSON · 粘到 sites.js 即可",
      "toast.save.added": "已加入收藏",
      "toast.save.removed": "已取消收藏",
      "toast.like.added": "已点赞",
      "toast.like.removed": "已取消点赞",
      "toast.url.invalid": "请输入有效网址",
      "toast.url.empty": "请先粘一个链接",
      "toast.collect.success": "已入库 · MD 已下载 · 别忘了复制 JSON 粘到 sites.js",

      // misc
      "card.open.aria": "查看 {title} 的详情",
      "card.visit.aria": "打开 {title} 原站",
      "img.alt.screenshot": "{title} 网站截图"
    },

    en: {
      "brand.aria": "OpenDesign home",
      "brand.sub": "curated web design",

      "nav.aria": "Navigation",
      "nav.atlas": "Atlas",
      "nav.library": "Library",
      "nav.saved": "Saved",
      "nav.about": "About",

      "actions.collect": "+ Collect",
      "actions.reset": "Reset",
      "actions.reset.aria": "Reset canvas",
      "actions.lang.aria": "Switch language",

      "filter.aria": "Filters",
      "filter.search.placeholder": "Search style, tag, or URL",
      "chip.all": "All",

      "canvas.aria": "Inspiration canvas",
      "canvas.surface.aria": "Drag to pan the canvas",
      "canvas.footnote": "{count} references · drag · ⌘ + scroll · click",

      "library.aria": "List view",
      "library.eyebrow": "Library · {count} references",
      "library.heading": "Distill great websites into reusable design tokens.",
      "library.lead": "Scan and search in list form. Click any entry to open its detail, copy or download its Markdown style spec.",
      "library.num": "№ {n}",
      "library.footer.brand": "OpenDesign",
      "library.footer.url": "opendesign.cc",

      "saved.aria": "My saves",
      "saved.eyebrow": "Saved · {count} sites",
      "saved.heading": "Your collected web aesthetics.",
      "saved.lead": "Saves live in this browser, with a cloud backup. Switching devices? Use a sync code to bring them along — no account needed.",
      "saved.empty.title": "Nothing saved yet",
      "saved.empty.sub": "Tap the ♥ heart on any card in Atlas or Library to save it here.",
      "saved.empty.bind": "Already saved on another device? <button class=\"text-link\" data-action=\"open-bind-sync\">Bind a sync code</button>",
      "saved.footer.note": "browser-local storage",
      "footer.tagline": "CURATED · OPEN · FREE",

      "sync.eyebrow": "Carry saves across devices",
      "sync.lead": "Want to bring this browser's saves to your phone or another computer? Generate a sync code. No email, no password.",
      "sync.action.create": "Generate sync code",
      "sync.action.bind": "Bind a sync code",
      "sync.create.eyebrow": "Sync code · generated",
      "sync.create.title": "Save this somewhere",
      "sync.create.copy": "Copy",
      "sync.create.copied": "Copied to clipboard",
      "sync.create.note": "On another device, open opendesign.cc → My Saves → Bind a sync code → paste this string. Your saves will follow.",
      "sync.create.warn": "⚠️ Anyone with this code can see this browser's saves. Don't share it; don't post it publicly.",
      "sync.bind.eyebrow": "Sync code · bind",
      "sync.bind.title": "Enter the code generated on another device",
      "sync.bind.submit": "Bind",
      "sync.bind.submitting": "Binding…",
      "sync.bind.cancel": "Cancel",
      "sync.bind.success": "Bound. Loading saves…",
      "sync.bind.note": "After binding, this browser switches to that device's saves. Any existing saves here will be replaced (not deleted in the cloud, just no longer shown).",
      "sync.bind.error.notfound": "No such sync code. Check the spelling.",
      "sync.bind.error.generic": "Bind failed. Please try again.",
      "sync.close.aria": "Close",
      "sync.error.offline": "Network not ready, sync unavailable right now.",
      "sync.error.create": "Generation failed, please try again.",

      "about.aria": "About OpenDesign",
      "about.eyebrow": "About · OpenDesign",
      "about.heading": "Decompose the websites that look expensive into tokens that AI can actually learn from.",
      "about.lead": "OpenDesign is an open library of curated web aesthetics. Every entry ships with a Markdown design-system spec — not copy, not PSDs — abstracting visuals, layout, interaction, and motion into AI-ready transfer instructions.",
      "about.card.01.label": "Standard",
      "about.card.01.title": "An 11-layer token structure",
      "about.card.01.body": "Every entry follows the same shape: Identity, Colors, Typography, Spacing, Surfaces, Layout, Components, Motion, Interaction, Voice, Don'ts, plus a ready-to-paste System Prompt. Predictable structure → AI learns better.",
      "about.card.02.label": "How to use",
      "about.card.02.title": "Feed AI to generate same-spirit pages",
      "about.card.02.body": "Pick an entry, copy or download its Markdown, paste it into Claude, Cursor, v0, or Lovable. The AI generates a new page in the same spirit — without copying brand assets or copy.",
      "about.card.03.label": "Stance",
      "about.card.03.title": "Restraint is the only criterion",
      "about.card.03.body": "We do not include showy pages without substance. What earns inclusion are sites that did fewer things — sites with judgement about whitespace, density, and motion purpose.",
      "about.card.04.label": "Open",
      "about.card.04.title": "All specs are open for reuse",
      "about.card.04.body": "Every Markdown spec is free to copy, download, and reuse — including for commercial work. No license fees for AI vendors, no newsletter wall, no ads. This site is a public resource.",
      "about.card.05.label": "Open source",
      "about.card.05.title": "Code, specs, and tools — all on GitHub",
      "about.card.05.body": "The frontend, extract CLI, Edge Function, and all specs live on GitHub. Code is MIT, curated specs are CC BY 4.0. Fork it, improve it, propose a new site.",
      "about.card.05.cta": "View on GitHub",
      "github.viewOnGitHub": "View on GitHub",
      "github.aria": "View OpenDesign source code and docs on GitHub",
      "about.sample.eyebrow": "Sample · What a spec looks like",
      "about.sample.lead": "Below is a complete Markdown design-system spec from the current library — you can copy it verbatim into any AI coding tool.",
      "about.contact.eyebrow": "Submit",
      "about.contact.heading": "Found a site worth including?",
      "about.contact.lead": "Send us the link. Sites that meet the bar will be added to the library.",
      "about.footer.updated": "Last updated",

      "drawer.close.aria": "Close detail",
      "drawer.visit.aria": "Open the original website",
      "drawer.visit.text": "Visit",
      "drawer.media.visit": "Visit",
      "drawer.download.text": "Design Pack",
      "drawer.download.aria": "Download design pack ZIP (11-layer MD spec + real token data + full screenshot set)",
      "pack.eyebrow": "DESIGN PACK",
      "pack.files": "files",
      "pack.pitch": "Not just an MD — real computed styles, actual font list, full scroll-segment screenshot evidence, AI-ready markdown. Feed it directly into any coding agent.",
      "pack.download.zip": "Download ZIP",
      "pack.copy.agentUrl": "Copy Agent URL",
      "pack.copy.agentUrl.aria": "Copy permanent link to DESIGN_SPEC.md for Claude / Cursor / v0",
      "pack.copied": "Folder URL copied — paste into Claude / Cursor and the AI fetches spec + screenshots + fonts list as a whole",
      "pack.cat.spec": "Spec",
      "pack.cat.data": "Data",
      "pack.cat.shot": "Screenshot",
      "preview.download": "Download",
      "preview.close": "Close preview",
      "preview.loading": "Loading…",
      "preview.error": "Failed to load",
      "preview.openRaw": "Open raw file",
      "drawer.save": "Save",
      "drawer.save.done": "Saved",
      "drawer.save.aria": "Save",
      "drawer.like": "Like",
      "drawer.like.done": "Liked",
      "drawer.like.aria": "Like",
      "drawer.md.title": "MD Design Spec",
      "drawer.md.copy": "Copy",
      "drawer.md.download": "Download",
      "drawer.md.copyJson": "Copy JSON",
      "drawer.insight.color": "Visual Language",
      "drawer.insight.layout": "Layout Pattern",
      "drawer.insight.interaction": "Interaction",
      "drawer.insight.motion": "Motion",

      "modal.close.aria": "Close",
      "modal.eyebrow": "Automated intake",
      "modal.heading": "Drop a URL, auto-generate an entry",
      "modal.url.label": "Paste or drop URL",
      "modal.preview.waiting.title": "Awaiting URL",
      "modal.preview.waiting.meta": "Paste a URL and click Analyze — we'll fetch the page, screenshot it, extract colors, and generate an 11-layer design spec.",
      "modal.palette.aria": "Extracted palette",
      "modal.pipeline.aria": "Ingestion pipeline",
      "modal.pipeline.url": "① Clean URL",
      "modal.pipeline.meta": "② microlink fetch",
      "modal.pipeline.palette": "③ Extract palette",
      "modal.pipeline.ai": "④ AI analysis",
      "modal.button.start": "Analyze",
      "modal.button.running": "Analyzing…",
      "modal.button.commit": "✓ Add & download MD",
      "modal.button.retry": "Retry",

      "spec.hint.ai": "✓ Full 11-layer design-system spec generated (typography / spacing / motion / voice / don'ts included)",
      "spec.hint.colorsOnly": "⚠ Colors auto-extracted from screenshot; the other 10 layers require AI (see below).",
      "spec.hint.stub": "⚠ Only skeletal structure for now; AI fills the rest once connected.",

      "toast.md.copied": "Markdown copied",
      "toast.json.copied": "JSON copied — paste into sites.js",
      "toast.save.added": "Saved",
      "toast.save.removed": "Save removed",
      "toast.like.added": "Liked",
      "toast.like.removed": "Unliked",
      "toast.url.invalid": "Please enter a valid URL",
      "toast.url.empty": "Please paste a link first",
      "toast.collect.success": "Added · MD downloaded · don't forget Copy JSON into sites.js",

      "card.open.aria": "Open {title} detail",
      "card.visit.aria": "Open {title}",
      "img.alt.screenshot": "{title} screenshot"
    }
  };

  function detectInitial() {
    // URL ?lang= 优先
    const urlLang = new URLSearchParams(location.search).get("lang");
    if (urlLang && SUPPORTED.includes(urlLang)) return urlLang;
    // localStorage 次之
    const stored = localStorage.getItem(LANG_KEY);
    if (stored && SUPPORTED.includes(stored)) return stored;
    // navigator.language
    const nav = (navigator.language || "").toLowerCase();
    if (nav.startsWith("zh")) return "zh";
    if (nav.startsWith("en")) return "en";
    return FALLBACK;
  }

  let currentLang = detectInitial();

  function t(key, params) {
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS[FALLBACK];
    let str = dict[key];
    if (str == null) {
      // 回退到默认语言
      str = TRANSLATIONS[FALLBACK][key];
      if (str == null) return key; // 没找到 → 显示 key 自己（便于发现遗漏）
    }
    if (params) {
      str = str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
    }
    return str;
  }

  /** 扫描 DOM 应用所有 data-i18n 系列属性 */
  function applyI18n(root) {
    const scope = root || document;
    // 文本内容
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      el.textContent = t(key);
    });
    // 富文本（含 HTML / <button>）—— 谨慎使用，仅用于可控的内部翻译值
    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    // placeholder
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
    });
    // aria-label
    scope.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
    });
    // 任意属性: data-i18n-attr-foo="key" → 设置 foo 属性
    scope.querySelectorAll("*").forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const m = attr.name.match(/^data-i18n-attr-(.+)$/);
        if (m) el.setAttribute(m[1], t(attr.value));
      });
    });
    // 同步 <html lang="..."> 给浏览器 / 搜索引擎 / 屏幕阅读器
    document.documentElement.setAttribute("lang", currentLang === "zh" ? "zh-CN" : "en");
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang) || lang === currentLang) return;
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    applyI18n();
    // 通知 app.js 重新渲染动态内容
    window.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang } }));
  }

  window.i18n = {
    t,
    get current() { return currentLang; },
    set: setLang,
    supported: SUPPORTED,
    apply: applyI18n
  };

  // DOM 准备好后立即应用一次
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => applyI18n());
  } else {
    applyI18n();
  }
})();
