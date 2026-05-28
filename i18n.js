/* OpenDesign · i18n 模块（v0.3 · 5 语言）
 * 支持：简体中文 / 繁體中文 / English / 日本語 / 한국어
 * 加新语言：在 TRANSLATIONS 加一个完整 key block + 在 LANG_META 加显示元数据
 *
 * 用法：
 *   - 静态 HTML：在元素上加 data-i18n="key"，本模块自动 applyI18n() 时填文本
 *   - 属性：data-i18n-placeholder="key" / data-i18n-aria-label="key" / data-i18n-html="key"
 *   - JS 动态串：调用 i18n.t("key", { count: 5 }) 取译文
 *   - 切换：i18n.set("ja")
 *   - 自动检测：URL ?lang= → localStorage → navigator.languages → FALLBACK
 *   - 不再用 IP 地理位置 —— navigator.language 是用户主动设的，更准更隐私
 */

(function () {
  const LANG_KEY = "opendesign-lang";
  const FALLBACK = "en";

  // 5 种受支持的语言（顺序 = 下拉菜单显示顺序）
  const SUPPORTED = ["zh-CN", "zh-TW", "en", "ja", "ko"];

  // 显示元数据：native 用在下拉菜单，code 用在顶栏（节省空间）
  const LANG_META = {
    "zh-CN": { native: "简体中文", code: "中" },
    "zh-TW": { native: "繁體中文", code: "繁" },
    "en":    { native: "English",  code: "EN" },
    "ja":    { native: "日本語",   code: "日" },
    "ko":    { native: "한국어",   code: "한" }
  };

  // 平滑迁移老用户 localStorage "zh" → "zh-CN"
  const LEGACY_LANG_MAP = { "zh": "zh-CN" };

  /** 把 navigator / URL / localStorage 给的任意 BCP47 tag 归一化到 SUPPORTED 中的一个 */
  function normalizeLang(raw) {
    if (!raw) return null;
    const s = String(raw).toLowerCase().trim();
    if (!s) return null;
    // 1) 直接命中（含 legacy "zh"）
    if (LEGACY_LANG_MAP[s]) return LEGACY_LANG_MAP[s];
    for (const code of SUPPORTED) if (s === code.toLowerCase()) return code;
    // 2) Chinese 细分
    if (s.startsWith("zh")) {
      // zh-tw / zh-hk / zh-mo / zh-hant-* → 繁体
      if (/^zh-(tw|hk|mo|hant)/.test(s)) return "zh-TW";
      // zh-cn / zh-sg / zh-hans-* / 裸 zh → 简体
      return "zh-CN";
    }
    // 3) 其它语言按前缀
    if (s.startsWith("ja")) return "ja";
    if (s.startsWith("ko")) return "ko";
    if (s.startsWith("en")) return "en";
    return null;
  }

  const TRANSLATIONS = {
    "zh-CN": {
      "brand.aria": "OpenDesign 首页",
      "brand.sub": "策展网页美学",

      "nav.aria": "导航",
      "nav.atlas": "图集",
      "nav.library": "列表",
      "nav.saved": "收藏",
      "nav.about": "关于",

      "actions.collect": "＋ 收录",
      "actions.reset": "重置",
      "actions.reset.aria": "重置画布",
      "actions.lang.aria": "切换语言",
      "actions.lang.label": "语言",

      "filter.aria": "筛选",
      "filter.search.placeholder": "搜索 · 风格 / 标签 / URL",
      "chip.all": "全部",

      "canvas.aria": "灵感图集",
      "canvas.surface.aria": "拖拽浏览灵感图集",
      "canvas.footnote": "共 {count} 个网站 · 拖拽 · ⌘ + 滚轮缩放 · 点击查看",

      "library.aria": "列表视图",
      "library.eyebrow": "列表 · 共 {count} 个网站",
      "library.heading": "把好网站沉淀成可复用的设计语料。",
      "library.lead": "列表视图便于快速扫描和搜索。点击任意一条进入详情，可复制或下载它的 Markdown 风格迁移规范。",
      "library.num": "第 {n} 号",
      "library.footer.brand": "OpenDesign",
      "library.footer.url": "opendesign.cc",

      "saved.aria": "我的收藏",
      "saved.eyebrow": "收藏 · 共 {count} 个网站",
      "saved.heading": "你保存下来的网页美学。",
      "sort.curated": "精选顺序",
      "sort.popular": "热门",
      "sort.popular.aria": "按全站累计收藏从高到低排序",
      "count.saves": "{n} 收藏",
      "count.saves.aria": "全站累计被 {n} 人收藏",

      "saved.lead": "收藏存在这个浏览器，云端有备份。换设备？用「同步码」把收藏带过去 —— 不需要账号。",
      "saved.empty.title": "还没收藏任何网站",
      "saved.empty.sub": "在图集或列表里点心形 ♥ 收藏喜欢的条目，会出现在这里。",
      "saved.empty.bind": "在另一台设备已经收藏过？<button class=\"text-link\" data-action=\"open-bind-sync\">绑定一个同步码</button>",
      "saved.footer.note": "本浏览器存储",
      "footer.tagline": "精选 · 开放 · 免费",

      "sync.eyebrow": "跨设备携带",
      "sync.lead": "这个浏览器有一个固定的同步码 —— 在另一台设备输入它，那台设备就会跟着同步。不需要账号。",
      "sync.action.create": "查看我的同步码",
      "sync.action.bind": "绑定一个同步码",
      "sync.create.eyebrow": "我的同步码 · 这个浏览器",
      "sync.create.title": "这串码代表这个浏览器",
      "sync.create.copy": "复制",
      "sync.create.copied": "已复制到剪贴板",
      "sync.create.note": "在另一台设备打开 opendesign.cc → 「我的收藏」→ 「绑定一个同步码」→ 粘进这串。那台设备的收藏会变成这台的。这个码是固定的，不会变。",
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

      "spec.hint.ai": "✓ 已生成完整 11 层设计系统 spec（含字体 / 间距 / 动效 / 文案 / 禁用清单）",
      "spec.hint.colorsOnly": "⚠ 颜色层从截图自动抽取；其他 10 层等 AI 接通（见下方提示）",
      "spec.hint.stub": "⚠ 当前只能生成结构骨架，AI 接通后会自动填充",

      "toast.md.copied": "已复制 Markdown",
      "toast.json.copied": "已复制 JSON · 粘到 sites.js 即可",
      "toast.save.added": "已加入收藏",
      "toast.save.removed": "已取消收藏",
      "toast.like.added": "已点赞",
      "toast.like.removed": "已取消点赞",
      "toast.url.invalid": "请输入有效网址",
      "toast.url.empty": "请先粘一个链接",
      "toast.collect.success": "已入库 · MD 已下载 · 别忘了复制 JSON 粘到 sites.js",

      "card.open.aria": "查看 {title} 的详情",
      "card.visit.aria": "打开 {title} 原站",
      "img.alt.screenshot": "{title} 网站截图"
    },

    "zh-TW": {
      "brand.aria": "OpenDesign 首頁",
      "brand.sub": "策展網頁美學",

      "nav.aria": "導覽",
      "nav.atlas": "圖集",
      "nav.library": "列表",
      "nav.saved": "收藏",
      "nav.about": "關於",

      "actions.collect": "＋ 收錄",
      "actions.reset": "重置",
      "actions.reset.aria": "重置畫布",
      "actions.lang.aria": "切換語言",
      "actions.lang.label": "語言",

      "filter.aria": "篩選",
      "filter.search.placeholder": "搜尋 · 風格 / 標籤 / URL",
      "chip.all": "全部",

      "canvas.aria": "靈感圖集",
      "canvas.surface.aria": "拖曳瀏覽靈感圖集",
      "canvas.footnote": "共 {count} 個網站 · 拖曳 · ⌘ + 滾輪縮放 · 點擊檢視",

      "library.aria": "列表檢視",
      "library.eyebrow": "列表 · 共 {count} 個網站",
      "library.heading": "把好網站沉澱成可複用的設計語料。",
      "library.lead": "列表檢視便於快速瀏覽與搜尋。點擊任意一條進入詳情，可複製或下載它的 Markdown 風格遷移規範。",
      "library.num": "第 {n} 號",
      "library.footer.brand": "OpenDesign",
      "library.footer.url": "opendesign.cc",

      "saved.aria": "我的收藏",
      "saved.eyebrow": "收藏 · 共 {count} 個網站",
      "saved.heading": "你儲存下來的網頁美學。",
      "sort.curated": "精選順序",
      "sort.popular": "熱門",
      "sort.popular.aria": "依全站累計收藏由高至低排序",
      "count.saves": "{n} 收藏",
      "count.saves.aria": "全站累計被 {n} 人收藏",

      "saved.lead": "收藏存在這個瀏覽器，雲端有備份。換裝置?用「同步碼」把收藏帶過去 —— 不需要帳號。",
      "saved.empty.title": "還沒收藏任何網站",
      "saved.empty.sub": "在圖集或列表裡點愛心 ♥ 收藏喜歡的項目,會出現在這裡。",
      "saved.empty.bind": "在另一臺裝置已經收藏過?<button class=\"text-link\" data-action=\"open-bind-sync\">綁定一個同步碼</button>",
      "saved.footer.note": "本瀏覽器儲存",
      "footer.tagline": "精選 · 開放 · 免費",

      "sync.eyebrow": "跨裝置攜帶",
      "sync.lead": "這個瀏覽器有一個固定的同步碼 —— 在另一臺裝置輸入它,那臺裝置就會跟著同步。不需要帳號。",
      "sync.action.create": "查看我的同步碼",
      "sync.action.bind": "綁定一個同步碼",
      "sync.create.eyebrow": "我的同步碼 · 這個瀏覽器",
      "sync.create.title": "這串碼代表這個瀏覽器",
      "sync.create.copy": "複製",
      "sync.create.copied": "已複製到剪貼簿",
      "sync.create.note": "在另一臺裝置開啟 opendesign.cc → 「我的收藏」→「綁定一個同步碼」→ 貼進這串。那臺裝置的收藏會變成這臺的。這個碼是固定的,不會變。",
      "sync.create.warn": "⚠️ 任何拿到這個碼的人都能看到這個瀏覽器的收藏。不要傳給別人,不要貼到公開頁面。",
      "sync.bind.eyebrow": "同步碼 · 綁定",
      "sync.bind.title": "輸入在另一臺裝置產生的碼",
      "sync.bind.submit": "綁定",
      "sync.bind.submitting": "綁定中…",
      "sync.bind.cancel": "取消",
      "sync.bind.success": "已綁定,正在載入收藏…",
      "sync.bind.note": "綁定後,這個瀏覽器會切換到那臺裝置的收藏夾。目前瀏覽器原本的收藏(若有)會被取代為新的(舊資料未刪,但不再顯示)。",
      "sync.bind.error.notfound": "沒找到這個同步碼。請檢查拼字。",
      "sync.bind.error.generic": "綁定失敗。請稍後再試。",
      "sync.close.aria": "關閉",
      "sync.error.offline": "網路未就緒,暫時無法同步。",
      "sync.error.create": "產生失敗,請稍後再試。",

      "about.aria": "關於 OpenDesign",
      "about.eyebrow": "關於 · OpenDesign",
      "about.heading": "把那些「一眼就看得出很貴」的網站,拆成 AI 也能學的語料。",
      "about.lead": "OpenDesign 是一個開放的網頁美學資源庫。每一個收錄都附帶一份 Markdown 設計系統規範 —— 不是文案,不是版型 PSD,而是把視覺、版面、互動、動效抽象成 AI 可直接複用的遷移指令。",
      "about.card.01.label": "標準",
      "about.card.01.title": "統一的 11 層 Tokens 結構",
      "about.card.01.body": "每個項目按相同結構整理:身份 / 顏色 / 字型 / 間距 / 圓角陰影 / 版面 / 元件 / 動效 / 互動 / 文案 / 禁用清單 + 可直接餵 AI 的 System Prompt。結構穩定,AI 學起來才穩。",
      "about.card.02.label": "用法",
      "about.card.02.title": "餵給 AI 產生同氣質網頁",
      "about.card.02.body": "在圖集或列表裡挑一個,進入詳情,複製或下載 Markdown,丟進 Claude、Cursor、v0、Lovable 這類工具,讓它按這份規範產生你的新頁面 —— 不複製品牌資產、只遷移氣質。",
      "about.card.03.label": "立場",
      "about.card.03.title": "克制,是這裡的唯一標準",
      "about.card.03.body": "不收錄炫技但沒有內容的頁面。值得反覆回看的是那些「少做了幾件事」的網站 —— 它們對留白、資訊密度、動效目的都有判斷。",
      "about.card.04.label": "開放",
      "about.card.04.title": "所有規範開放複用",
      "about.card.04.body": "所有 Markdown 規範開放給任何人複製、下載、二次使用。不向 AI 工具收授權費,不向訪客收 newsletter,不接廣告 —— 這是這個站作為「公共資源」的承諾。",
      "about.card.05.label": "開源",
      "about.card.05.title": "程式碼 + 規範 + 工具,全在 GitHub",
      "about.card.05.body": "OpenDesign 的前端、抽取 CLI、Edge Function、所有 spec 都在 GitHub 上:程式碼 MIT,curated specs 走 CC BY 4.0。歡迎 fork、改進、提名新站。",
      "about.card.05.cta": "在 GitHub 上檢視",
      "github.viewOnGitHub": "在 GitHub 上檢視",
      "github.aria": "在 GitHub 上檢視 OpenDesign 的原始碼和文件",
      "about.sample.eyebrow": "範例 · 一份規範長什麼樣",
      "about.sample.lead": "下面是目前精選中的一份完整 Markdown 設計系統規範 —— 你可以直接複製走,餵給任何 AI 編碼工具。",
      "about.contact.eyebrow": "投稿",
      "about.contact.heading": "發現了值得收錄的網站?",
      "about.contact.lead": "把連結傳給我們,符合收錄標準的會被加入資源庫。",
      "about.footer.updated": "最近更新",

      "drawer.close.aria": "關閉詳情",
      "drawer.visit.aria": "開啟原始網頁",
      "drawer.visit.text": "開啟原站",
      "drawer.media.visit": "開啟原站",
      "drawer.download.text": "下載素材包",
      "drawer.download.aria": "下載設計素材 ZIP(含 11 層 MD 規範 + 真 Token 資料 + 全套截圖)",
      "pack.eyebrow": "設計素材包 / DESIGN PACK",
      "pack.files": "個檔案",
      "pack.pitch": "不只是一個 MD —— 含真 computed styles + 真字型清單 + 捲動分段證據截圖 + AI 就緒 markdown,可直接餵任意編碼 agent。",
      "pack.download.zip": "下載 ZIP",
      "pack.copy.agentUrl": "複製 AI Agent URL",
      "pack.copy.agentUrl.aria": "複製 DESIGN_SPEC.md 的永久連結給 Claude / Cursor / v0 等 AI 工具",
      "pack.copied": "已複製目錄連結 —— 貼給 Claude / Cursor,AI 會自動讀到規範 + 截圖 + 字型清單全套",
      "pack.cat.spec": "規範",
      "pack.cat.data": "資料",
      "pack.cat.shot": "截圖",
      "preview.download": "下載",
      "preview.close": "關閉預覽",
      "preview.loading": "載入中…",
      "preview.error": "載入失敗",
      "preview.openRaw": "新視窗檢視原始檔案",
      "drawer.save": "收藏",
      "drawer.save.done": "已收藏",
      "drawer.save.aria": "收藏",
      "drawer.like": "按讚",
      "drawer.like.done": "已讚",
      "drawer.like.aria": "按讚",
      "drawer.md.title": "MD 設計規範",
      "drawer.md.copy": "複製",
      "drawer.md.download": "下載",
      "drawer.md.copyJson": "複製 JSON",
      "drawer.insight.color": "視覺語言",
      "drawer.insight.layout": "版面結構",
      "drawer.insight.interaction": "互動形態",
      "drawer.insight.motion": "動效規則",

      "modal.close.aria": "關閉",
      "modal.eyebrow": "自動收錄",
      "modal.heading": "丟進一個連結,自動產生靈感項目",
      "modal.url.label": "貼上或拖入網址",
      "modal.preview.waiting.title": "等待連結",
      "modal.preview.waiting.meta": "貼 URL 後點「開始分析」—— 系統會真實抓頁面、截圖、抽顏色、產生 11 層設計系統規範。",
      "modal.palette.aria": "抽取到的主色",
      "modal.pipeline.aria": "自動收錄流水線",
      "modal.pipeline.url": "① 清洗 URL",
      "modal.pipeline.meta": "② microlink 抓取",
      "modal.pipeline.palette": "③ 抽取色盤",
      "modal.pipeline.ai": "④ AI 解讀",
      "modal.button.start": "開始分析",
      "modal.button.running": "分析中…",
      "modal.button.commit": "✓ 入庫並下載 MD",
      "modal.button.retry": "重試",

      "spec.hint.ai": "✓ 已產生完整 11 層設計系統 spec(含字型 / 間距 / 動效 / 文案 / 禁用清單)",
      "spec.hint.colorsOnly": "⚠ 顏色層從截圖自動抽取;其它 10 層等 AI 接通(見下方提示)",
      "spec.hint.stub": "⚠ 目前只能產生結構骨架,AI 接通後會自動填充",

      "toast.md.copied": "已複製 Markdown",
      "toast.json.copied": "已複製 JSON · 貼到 sites.js 即可",
      "toast.save.added": "已加入收藏",
      "toast.save.removed": "已取消收藏",
      "toast.like.added": "已按讚",
      "toast.like.removed": "已取消讚",
      "toast.url.invalid": "請輸入有效網址",
      "toast.url.empty": "請先貼一個連結",
      "toast.collect.success": "已入庫 · MD 已下載 · 別忘了複製 JSON 貼到 sites.js",

      "card.open.aria": "檢視 {title} 的詳情",
      "card.visit.aria": "開啟 {title} 原站",
      "img.alt.screenshot": "{title} 網站截圖"
    },

    "en": {
      "brand.aria": "OpenDesign home",
      "brand.sub": "CURATED · WEB AESTHETICS",

      "nav.aria": "Navigation",
      "nav.atlas": "Atlas",
      "nav.library": "Library",
      "nav.saved": "Saved",
      "nav.about": "About",

      "actions.collect": "＋ Add",
      "actions.reset": "Reset",
      "actions.reset.aria": "Reset canvas",
      "actions.lang.aria": "Switch language",
      "actions.lang.label": "Language",

      "filter.aria": "Filter",
      "filter.search.placeholder": "Search · vibe / tag / URL",
      "chip.all": "All",

      "canvas.aria": "Inspiration atlas",
      "canvas.surface.aria": "Drag-pan the inspiration atlas",
      "canvas.footnote": "{count} sites · drag · ⌘ + scroll to zoom · click to view",

      "library.aria": "Library view",
      "library.eyebrow": "Library · {count} sites",
      "library.heading": "Distilling great sites into reusable design assets.",
      "library.lead": "List view for quick scan and search. Click any entry to open the detail panel and copy or download its Markdown style-migration spec.",
      "library.num": "No. {n}",
      "library.footer.brand": "OpenDesign",
      "library.footer.url": "opendesign.cc",

      "saved.aria": "My saves",
      "saved.eyebrow": "Saved · {count} sites",
      "saved.heading": "Your collected web aesthetics.",
      "sort.curated": "Curated",
      "sort.popular": "Popular",
      "sort.popular.aria": "Sort by total saves, descending",
      "count.saves": "{n} saves",
      "count.saves.aria": "Saved {n} times across all visitors",

      "saved.lead": "Saves live in this browser, with a cloud backup. Switching devices? Use a sync code to bring them along — no account needed.",
      "saved.empty.title": "Nothing saved yet",
      "saved.empty.sub": "Tap the ♥ heart on any card in Atlas or Library to save it here.",
      "saved.empty.bind": "Already saved on another device? <button class=\"text-link\" data-action=\"open-bind-sync\">Bind a sync code</button>",
      "saved.footer.note": "browser-local storage",
      "footer.tagline": "CURATED · OPEN · FREE",

      "sync.eyebrow": "Carry saves across devices",
      "sync.lead": "This browser has a stable sync code. Enter it on another device and that device will mirror this one's saves. No account needed.",
      "sync.action.create": "Show my sync code",
      "sync.action.bind": "Bind a sync code",
      "sync.create.eyebrow": "My sync code · this browser",
      "sync.create.title": "This string represents this browser",
      "sync.create.copy": "Copy",
      "sync.create.copied": "Copied to clipboard",
      "sync.create.note": "On another device, open opendesign.cc → My Saves → Bind a sync code → paste this. That device's saves will mirror this one's. The code stays the same.",
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
      "about.heading": "Distilling sites that look effortlessly expensive into language an AI can learn from.",
      "about.lead": "OpenDesign is an open library of web aesthetics. Each entry ships with a Markdown design-system spec — not copy, not a PSD, but vision, layout, interaction, and motion abstracted into directives an AI can reuse directly.",
      "about.card.01.label": "Standard",
      "about.card.01.title": "A unified 11-layer Tokens shape",
      "about.card.01.body": "Every entry follows the same shape: Identity / Colors / Typography / Spacing / Surfaces / Layout / Components / Motion / Interaction / Voice / Don'ts, plus a ready-to-paste System Prompt. Predictable structure → AI learns better.",
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
      "about.footer.updated": "Last update",

      "drawer.close.aria": "Close detail",
      "drawer.visit.aria": "Open original site",
      "drawer.visit.text": "Open original",
      "drawer.media.visit": "Open original",
      "drawer.download.text": "Download pack",
      "drawer.download.aria": "Download design pack ZIP (11-layer MD spec + real token data + all screenshots)",
      "pack.eyebrow": "DESIGN PACK",
      "pack.files": "files",
      "pack.pitch": "More than just a Markdown — includes real computed styles, the actual font list, scroll-segment evidence screenshots, and AI-ready markdown that any coding agent can consume.",
      "pack.download.zip": "Download ZIP",
      "pack.copy.agentUrl": "Copy AI Agent URL",
      "pack.copy.agentUrl.aria": "Copy the permanent DESIGN_SPEC.md URL for Claude / Cursor / v0 etc.",
      "pack.copied": "Copied folder URL — paste it into Claude / Cursor and the AI gets the full spec + screenshots + font list.",
      "pack.cat.spec": "Spec",
      "pack.cat.data": "Data",
      "pack.cat.shot": "Shots",
      "preview.download": "Download file",
      "preview.close": "Close preview",
      "preview.loading": "Loading…",
      "preview.error": "Failed to load",
      "preview.openRaw": "Open raw in new tab",
      "drawer.save": "Save",
      "drawer.save.done": "Saved",
      "drawer.save.aria": "Save",
      "drawer.like": "Like",
      "drawer.like.done": "Liked",
      "drawer.like.aria": "Like",
      "drawer.md.title": "Design system spec (MD)",
      "drawer.md.copy": "Copy",
      "drawer.md.download": "Download",
      "drawer.md.copyJson": "Copy JSON",
      "drawer.insight.color": "Visual language",
      "drawer.insight.layout": "Layout structure",
      "drawer.insight.interaction": "Interaction shape",
      "drawer.insight.motion": "Motion rules",

      "modal.close.aria": "Close",
      "modal.eyebrow": "Auto-ingest",
      "modal.heading": "Drop a link, auto-generate an entry",
      "modal.url.label": "Paste or drop a URL",
      "modal.preview.waiting.title": "Awaiting URL",
      "modal.preview.waiting.meta": "Paste a URL and hit \"Start analysis\" — the system will fetch the page, screenshot, extract palette, and generate an 11-layer design-system spec.",
      "modal.palette.aria": "Extracted primary palette",
      "modal.pipeline.aria": "Auto-ingest pipeline",
      "modal.pipeline.url": "① Clean URL",
      "modal.pipeline.meta": "② microlink fetch",
      "modal.pipeline.palette": "③ Extract palette",
      "modal.pipeline.ai": "④ AI reading",
      "modal.button.start": "Start analysis",
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
    },

    "ja": {
      "brand.aria": "OpenDesign ホーム",
      "brand.sub": "厳選・ウェブ美学",

      "nav.aria": "ナビゲーション",
      "nav.atlas": "アトラス",
      "nav.library": "リスト",
      "nav.saved": "保存",
      "nav.about": "概要",

      "actions.collect": "＋ 追加",
      "actions.reset": "リセット",
      "actions.reset.aria": "キャンバスをリセット",
      "actions.lang.aria": "言語を切り替え",
      "actions.lang.label": "言語",

      "filter.aria": "フィルター",
      "filter.search.placeholder": "検索・スタイル / タグ / URL",
      "chip.all": "すべて",

      "canvas.aria": "インスピレーション・アトラス",
      "canvas.surface.aria": "ドラッグでアトラスを閲覧",
      "canvas.footnote": "{count} サイト・ドラッグ・⌘ + スクロールで拡大・クリックで詳細",

      "library.aria": "リスト表示",
      "library.eyebrow": "リスト・{count} サイト",
      "library.heading": "優れたサイトを、再利用できる設計資料へ。",
      "library.lead": "リスト表示は素早く一覧して検索したいときに。任意の項目をクリックすると詳細が開き、その Markdown スタイル移植仕様をコピー・ダウンロードできます。",
      "library.num": "No. {n}",
      "library.footer.brand": "OpenDesign",
      "library.footer.url": "opendesign.cc",

      "saved.aria": "保存済み",
      "saved.eyebrow": "保存・{count} サイト",
      "saved.heading": "あなたが集めたウェブ美学。",
      "sort.curated": "厳選順",
      "sort.popular": "人気順",
      "sort.popular.aria": "全訪問者の累計保存数で降順ソート",
      "count.saves": "{n} 件の保存",
      "count.saves.aria": "全訪問者の累計で {n} 回保存されました",

      "saved.lead": "保存はこのブラウザに残り、クラウドにバックアップされます。端末を変える?「同期コード」で持ち運べます — アカウントは不要。",
      "saved.empty.title": "まだ保存されていません",
      "saved.empty.sub": "アトラスかリストでカードの ♥ を押すと、ここに集まります。",
      "saved.empty.bind": "別の端末で既に保存している?<button class=\"text-link\" data-action=\"open-bind-sync\">同期コードをバインド</button>",
      "saved.footer.note": "このブラウザに保存",
      "footer.tagline": "厳選・オープン・無料",

      "sync.eyebrow": "端末間で持ち運ぶ",
      "sync.lead": "このブラウザには固定の同期コードがあります。別の端末で入力すれば、その端末がこのブラウザの保存をミラーします。アカウントは不要。",
      "sync.action.create": "同期コードを表示",
      "sync.action.bind": "同期コードをバインド",
      "sync.create.eyebrow": "同期コード・このブラウザ",
      "sync.create.title": "この文字列がこのブラウザを表します",
      "sync.create.copy": "コピー",
      "sync.create.copied": "クリップボードにコピーしました",
      "sync.create.note": "別の端末で opendesign.cc を開き、「保存」→「同期コードをバインド」→ ここにこの文字列を貼ってください。その端末の保存がこのブラウザのものに変わります。コードは固定です。",
      "sync.create.warn": "⚠️ このコードを持つ人は誰でもこのブラウザの保存を見られます。他人に渡さないでください。公開ページに貼らないでください。",
      "sync.bind.eyebrow": "同期コード・バインド",
      "sync.bind.title": "別の端末で生成されたコードを入力",
      "sync.bind.submit": "バインド",
      "sync.bind.submitting": "バインド中…",
      "sync.bind.cancel": "キャンセル",
      "sync.bind.success": "バインドしました。保存を読み込み中…",
      "sync.bind.note": "バインド後、このブラウザはその端末の保存に切り替わります。現在の保存(あれば)は新しいものに置き換わります(クラウドからは消えませんが、ここには表示されません)。",
      "sync.bind.error.notfound": "そのコードは見つかりません。スペルを確認してください。",
      "sync.bind.error.generic": "バインドに失敗しました。しばらく経ってからもう一度お試しください。",
      "sync.close.aria": "閉じる",
      "sync.error.offline": "ネットワーク未準備のため、同期できません。",
      "sync.error.create": "生成に失敗しました。しばらく経ってから再試行してください。",

      "about.aria": "OpenDesign について",
      "about.eyebrow": "About・OpenDesign",
      "about.heading": "「一目で値段がわかる」サイトを、AI も学べる言語へ。",
      "about.lead": "OpenDesign はウェブ美学のオープン・ライブラリです。各エントリには Markdown のデザインシステム仕様が付属します — コピーでも PSD でもなく、視覚・レイアウト・インタラクション・モーションを、AI が直接再利用できる移植指示に抽象化したものです。",
      "about.card.01.label": "標準",
      "about.card.01.title": "統一された 11 層トークン構造",
      "about.card.01.body": "全エントリが同じ形式に従います:アイデンティティ / 色 / 書体 / 余白 / 表面(角丸・影) / レイアウト / コンポーネント / モーション / インタラクション / 文体 / 禁止事項 + そのまま貼れる System Prompt。構造が安定するほど、AI もしっかり学べます。",
      "about.card.02.label": "使い方",
      "about.card.02.title": "AI に渡して同じ気質の新ページを生成",
      "about.card.02.body": "アトラスかリストから 1 つ選び、詳細を開き、Markdown をコピー/ダウンロード。Claude、Cursor、v0、Lovable などに渡せば、その仕様に沿った新ページを AI が生成します — ブランド資産は持ち込まず、気質だけを移植します。",
      "about.card.03.label": "立場",
      "about.card.03.title": "ここでの唯一の基準は「抑制」",
      "about.card.03.body": "見せ場だけで中身のないページは載せません。何度も眺めたくなるのは、「やらないことを決めた」サイト — 余白、情報密度、モーションの目的に対する判断が見えるサイトです。",
      "about.card.04.label": "オープン",
      "about.card.04.title": "すべての仕様は再利用可能",
      "about.card.04.body": "すべての Markdown 仕様は誰でも自由にコピー・ダウンロード・再利用できます(商用も可)。AI ベンダーへの課金もニュースレターの壁も広告もありません — それがこの「公共資源」としての約束です。",
      "about.card.05.label": "オープンソース",
      "about.card.05.title": "コードも仕様もツールも、すべて GitHub に",
      "about.card.05.body": "OpenDesign のフロントエンド、抽出 CLI、Edge Function、全 spec が GitHub にあります:コードは MIT、curated specs は CC BY 4.0。fork、改善、サイト提案、歓迎します。",
      "about.card.05.cta": "GitHub で見る",
      "github.viewOnGitHub": "GitHub で見る",
      "github.aria": "OpenDesign のソースコードとドキュメントを GitHub で見る",
      "about.sample.eyebrow": "サンプル・仕様の見た目",
      "about.sample.lead": "下記は現在のライブラリから 1 つの完全な Markdown デザインシステム仕様 —— そのままコピーして、お好みの AI コーディングツールに渡せます。",
      "about.contact.eyebrow": "投稿",
      "about.contact.heading": "収録に値するサイトを見つけた?",
      "about.contact.lead": "リンクをお送りください。基準を満たすものはライブラリに追加します。",
      "about.footer.updated": "最終更新",

      "drawer.close.aria": "詳細を閉じる",
      "drawer.visit.aria": "オリジナルサイトを開く",
      "drawer.visit.text": "オリジナルを開く",
      "drawer.media.visit": "オリジナルを開く",
      "drawer.download.text": "パックをダウンロード",
      "drawer.download.aria": "デザインパック ZIP をダウンロード(11 層 MD 仕様 + 実トークンデータ + 全スクリーンショット)",
      "pack.eyebrow": "DESIGN PACK",
      "pack.files": "ファイル",
      "pack.pitch": "Markdown だけではなく — 実 computed styles + 実フォント一覧 + スクロール分割のエビデンススクリーンショット + AI 対応 markdown。あらゆるコーディング agent にそのまま渡せます。",
      "pack.download.zip": "ZIP をダウンロード",
      "pack.copy.agentUrl": "AI Agent URL をコピー",
      "pack.copy.agentUrl.aria": "DESIGN_SPEC.md の永続リンクを Claude / Cursor / v0 などへコピー",
      "pack.copied": "フォルダ URL をコピーしました — Claude / Cursor に貼ると、仕様 + スクショ + フォント一覧を AI が自動で読みます",
      "pack.cat.spec": "仕様",
      "pack.cat.data": "データ",
      "pack.cat.shot": "画像",
      "preview.download": "ダウンロード",
      "preview.close": "プレビューを閉じる",
      "preview.loading": "読み込み中…",
      "preview.error": "読み込みに失敗",
      "preview.openRaw": "新しいタブで原本を開く",
      "drawer.save": "保存",
      "drawer.save.done": "保存済み",
      "drawer.save.aria": "保存",
      "drawer.like": "いいね",
      "drawer.like.done": "いいね済み",
      "drawer.like.aria": "いいね",
      "drawer.md.title": "デザインシステム仕様(MD)",
      "drawer.md.copy": "コピー",
      "drawer.md.download": "ダウンロード",
      "drawer.md.copyJson": "JSON をコピー",
      "drawer.insight.color": "視覚言語",
      "drawer.insight.layout": "レイアウト構造",
      "drawer.insight.interaction": "インタラクション形態",
      "drawer.insight.motion": "モーション規則",

      "modal.close.aria": "閉じる",
      "modal.eyebrow": "自動収録",
      "modal.heading": "リンクを入れるだけで、エントリを自動生成",
      "modal.url.label": "URL を貼る / ドロップ",
      "modal.preview.waiting.title": "リンク待ち",
      "modal.preview.waiting.meta": "URL を貼って「分析開始」—— ページ取得、スクショ、色抽出、11 層デザインシステム仕様の生成まで自動で行います。",
      "modal.palette.aria": "抽出された主要パレット",
      "modal.pipeline.aria": "自動収録パイプライン",
      "modal.pipeline.url": "① URL 正規化",
      "modal.pipeline.meta": "② microlink 取得",
      "modal.pipeline.palette": "③ パレット抽出",
      "modal.pipeline.ai": "④ AI による読み取り",
      "modal.button.start": "分析開始",
      "modal.button.running": "分析中…",
      "modal.button.commit": "✓ 登録して MD をダウンロード",
      "modal.button.retry": "再試行",

      "spec.hint.ai": "✓ 11 層フルスペック生成済み(書体 / 余白 / モーション / 文体 / 禁止事項を含む)",
      "spec.hint.colorsOnly": "⚠ 色層はスクショから自動抽出。他 10 層は AI 接続が必要(下記参照)。",
      "spec.hint.stub": "⚠ 現状は構造のみ。AI 接続後に自動充填されます。",

      "toast.md.copied": "Markdown をコピーしました",
      "toast.json.copied": "JSON をコピーしました・sites.js に貼ってください",
      "toast.save.added": "保存しました",
      "toast.save.removed": "保存を解除しました",
      "toast.like.added": "いいね",
      "toast.like.removed": "いいねを解除",
      "toast.url.invalid": "有効な URL を入力してください",
      "toast.url.empty": "先にリンクを貼ってください",
      "toast.collect.success": "登録完了・MD をダウンロードしました・JSON のコピーを sites.js に貼り忘れずに",

      "card.open.aria": "{title} の詳細を開く",
      "card.visit.aria": "{title} を開く",
      "img.alt.screenshot": "{title} のスクリーンショット"
    },

    "ko": {
      "brand.aria": "OpenDesign 홈",
      "brand.sub": "큐레이션 · 웹 미학",

      "nav.aria": "내비게이션",
      "nav.atlas": "아틀라스",
      "nav.library": "목록",
      "nav.saved": "저장",
      "nav.about": "소개",

      "actions.collect": "＋ 추가",
      "actions.reset": "초기화",
      "actions.reset.aria": "캔버스 초기화",
      "actions.lang.aria": "언어 전환",
      "actions.lang.label": "언어",

      "filter.aria": "필터",
      "filter.search.placeholder": "검색 · 스타일 / 태그 / URL",
      "chip.all": "전체",

      "canvas.aria": "영감 아틀라스",
      "canvas.surface.aria": "드래그로 아틀라스 탐색",
      "canvas.footnote": "{count} 개 사이트 · 드래그 · ⌘ + 스크롤 확대 · 클릭하여 상세 보기",

      "library.aria": "목록 보기",
      "library.eyebrow": "목록 · {count} 개 사이트",
      "library.heading": "좋은 사이트를 재사용 가능한 디자인 자산으로.",
      "library.lead": "목록 보기는 빠른 탐색과 검색에 좋습니다. 어떤 항목이든 클릭하면 상세 패널이 열리고, 그 사이트의 Markdown 스타일 이식 사양을 복사하거나 다운로드할 수 있습니다.",
      "library.num": "No. {n}",
      "library.footer.brand": "OpenDesign",
      "library.footer.url": "opendesign.cc",

      "saved.aria": "내 저장",
      "saved.eyebrow": "저장 · {count} 개 사이트",
      "saved.heading": "당신이 모은 웹 미학.",
      "sort.curated": "큐레이션 순",
      "sort.popular": "인기 순",
      "sort.popular.aria": "전체 누적 저장수 내림차순",
      "count.saves": "{n} 회 저장",
      "count.saves.aria": "전체 방문자 누적 {n} 회 저장됨",

      "saved.lead": "저장은 이 브라우저에 남고, 클라우드에 백업됩니다. 기기를 바꾸시나요? '동기화 코드'로 가져가세요 — 계정 필요 없음.",
      "saved.empty.title": "아직 저장한 사이트가 없습니다",
      "saved.empty.sub": "아틀라스나 목록에서 카드의 ♥ 를 누르면 여기에 모입니다.",
      "saved.empty.bind": "다른 기기에서 이미 저장하셨나요? <button class=\"text-link\" data-action=\"open-bind-sync\">동기화 코드 바인드</button>",
      "saved.footer.note": "이 브라우저에 저장",
      "footer.tagline": "큐레이션 · 오픈 · 무료",

      "sync.eyebrow": "기기 간 이동",
      "sync.lead": "이 브라우저에는 고정된 동기화 코드가 있습니다. 다른 기기에서 입력하면 그 기기가 이 브라우저의 저장을 미러링합니다. 계정은 필요 없습니다.",
      "sync.action.create": "내 동기화 코드 보기",
      "sync.action.bind": "동기화 코드 바인드",
      "sync.create.eyebrow": "내 동기화 코드 · 이 브라우저",
      "sync.create.title": "이 문자열이 이 브라우저를 나타냅니다",
      "sync.create.copy": "복사",
      "sync.create.copied": "클립보드에 복사됨",
      "sync.create.note": "다른 기기에서 opendesign.cc 를 열고 '내 저장' → '동기화 코드 바인드' → 이 문자열을 붙여넣으세요. 그 기기의 저장이 이 브라우저의 것과 같아집니다. 코드는 고정이고 바뀌지 않습니다.",
      "sync.create.warn": "⚠️ 이 코드를 가진 사람은 누구나 이 브라우저의 저장을 볼 수 있습니다. 다른 사람에게 보내지 마세요. 공개 페이지에 게시하지 마세요.",
      "sync.bind.eyebrow": "동기화 코드 · 바인드",
      "sync.bind.title": "다른 기기에서 생성된 코드를 입력하세요",
      "sync.bind.submit": "바인드",
      "sync.bind.submitting": "바인딩 중…",
      "sync.bind.cancel": "취소",
      "sync.bind.success": "바인드 완료, 저장을 불러오는 중…",
      "sync.bind.note": "바인드 후 이 브라우저는 그 기기의 저장으로 전환됩니다. 현재 저장(있다면)은 새 것으로 교체됩니다(클라우드에서 삭제되지는 않지만 이곳에 더 이상 표시되지 않습니다).",
      "sync.bind.error.notfound": "해당 동기화 코드를 찾을 수 없습니다. 철자를 확인하세요.",
      "sync.bind.error.generic": "바인드 실패. 잠시 후 다시 시도해 주세요.",
      "sync.close.aria": "닫기",
      "sync.error.offline": "네트워크 미준비로 동기화할 수 없습니다.",
      "sync.error.create": "생성 실패. 잠시 후 다시 시도해 주세요.",

      "about.aria": "OpenDesign 소개",
      "about.eyebrow": "About · OpenDesign",
      "about.heading": "'한눈에 비싸 보이는' 사이트를, AI 도 학습할 수 있는 언어로.",
      "about.lead": "OpenDesign 은 웹 미학의 오픈 라이브러리입니다. 모든 항목에는 Markdown 디자인 시스템 사양이 함께 제공됩니다 —— 카피도 PSD 도 아닌, 시각 · 레이아웃 · 인터랙션 · 모션을 AI 가 곧바로 재사용할 수 있는 이식 지시로 추상화한 것입니다.",
      "about.card.01.label": "표준",
      "about.card.01.title": "통일된 11 층 Tokens 구조",
      "about.card.01.body": "모든 항목이 같은 형태로 정리됩니다: 아이덴티티 / 색 / 타이포 / 간격 / 표면(라운드 · 그림자) / 레이아웃 / 컴포넌트 / 모션 / 인터랙션 / 보이스 / 금지 목록 + 곧바로 붙여 쓸 System Prompt. 구조가 안정될수록 AI 도 잘 학습합니다.",
      "about.card.02.label": "사용법",
      "about.card.02.title": "같은 결의 새 페이지를 AI 로 생성",
      "about.card.02.body": "아틀라스나 목록에서 하나 골라 상세를 열고, Markdown 을 복사 / 다운로드 한 뒤 Claude · Cursor · v0 · Lovable 같은 도구에 붙여 넣으세요. AI 가 이 사양에 맞춰 새 페이지를 생성합니다 —— 브랜드 자산은 가져오지 않고 결만 이식합니다.",
      "about.card.03.label": "관점",
      "about.card.03.title": "여기서 유일한 기준은 '절제'",
      "about.card.03.body": "겉만 화려하고 내용이 없는 페이지는 싣지 않습니다. 다시 보고 싶어지는 것은 '몇 가지를 하지 않기로 한' 사이트 —— 여백, 정보 밀도, 모션의 목적에 대한 판단이 있는 사이트입니다.",
      "about.card.04.label": "오픈",
      "about.card.04.title": "모든 사양은 재사용 가능",
      "about.card.04.body": "모든 Markdown 사양은 누구나 자유롭게 복사 · 다운로드 · 2차 사용 가능합니다(상업 사용 포함). AI 도구에 라이선스를 받지 않고, 방문자에게 뉴스레터를 강요하지 않으며, 광고도 받지 않습니다 —— 이것이 '공공 자원'으로서의 약속입니다.",
      "about.card.05.label": "오픈소스",
      "about.card.05.title": "코드 · 사양 · 도구 모두 GitHub 에",
      "about.card.05.body": "OpenDesign 의 프런트엔드, 추출 CLI, Edge Function, 모든 spec 이 GitHub 에 있습니다: 코드는 MIT, curated specs 는 CC BY 4.0. fork, 개선, 사이트 제안 모두 환영합니다.",
      "about.card.05.cta": "GitHub 에서 보기",
      "github.viewOnGitHub": "GitHub 에서 보기",
      "github.aria": "OpenDesign 소스 코드와 문서를 GitHub 에서 보기",
      "about.sample.eyebrow": "샘플 · 사양은 이렇게 생겼습니다",
      "about.sample.lead": "아래는 현재 라이브러리의 완전한 Markdown 디자인 시스템 사양 한 부 —— 그대로 복사해 AI 코딩 도구에 붙여 넣을 수 있습니다.",
      "about.contact.eyebrow": "제안",
      "about.contact.heading": "수록할 만한 사이트를 발견하셨나요?",
      "about.contact.lead": "링크를 보내주세요. 기준에 맞는 곳은 라이브러리에 추가합니다.",
      "about.footer.updated": "마지막 업데이트",

      "drawer.close.aria": "상세 닫기",
      "drawer.visit.aria": "원본 사이트 열기",
      "drawer.visit.text": "원본 열기",
      "drawer.media.visit": "원본 열기",
      "drawer.download.text": "팩 다운로드",
      "drawer.download.aria": "디자인 팩 ZIP 다운로드(11 층 MD 사양 + 실제 토큰 데이터 + 전체 스크린샷)",
      "pack.eyebrow": "DESIGN PACK",
      "pack.files": "개 파일",
      "pack.pitch": "단순한 MD 가 아닌 —— 실 computed styles + 실 폰트 목록 + 스크롤 분할 증거 스크린샷 + AI 대응 markdown. 어떤 코딩 agent 에든 그대로 넘길 수 있습니다.",
      "pack.download.zip": "ZIP 다운로드",
      "pack.copy.agentUrl": "AI Agent URL 복사",
      "pack.copy.agentUrl.aria": "DESIGN_SPEC.md 영구 링크를 Claude / Cursor / v0 등에 복사",
      "pack.copied": "폴더 URL 복사됨 —— Claude / Cursor 에 붙여 넣으면 AI 가 사양 + 스크린샷 + 폰트 목록을 자동으로 읽습니다",
      "pack.cat.spec": "사양",
      "pack.cat.data": "데이터",
      "pack.cat.shot": "스크린샷",
      "preview.download": "다운로드",
      "preview.close": "미리보기 닫기",
      "preview.loading": "불러오는 중…",
      "preview.error": "불러오기 실패",
      "preview.openRaw": "새 탭에서 원본 열기",
      "drawer.save": "저장",
      "drawer.save.done": "저장됨",
      "drawer.save.aria": "저장",
      "drawer.like": "좋아요",
      "drawer.like.done": "좋아요 됨",
      "drawer.like.aria": "좋아요",
      "drawer.md.title": "디자인 시스템 사양(MD)",
      "drawer.md.copy": "복사",
      "drawer.md.download": "다운로드",
      "drawer.md.copyJson": "JSON 복사",
      "drawer.insight.color": "시각 언어",
      "drawer.insight.layout": "레이아웃 구조",
      "drawer.insight.interaction": "인터랙션 형태",
      "drawer.insight.motion": "모션 규칙",

      "modal.close.aria": "닫기",
      "modal.eyebrow": "자동 수록",
      "modal.heading": "링크를 넣으면 항목이 자동 생성",
      "modal.url.label": "URL 붙여넣기 / 드롭",
      "modal.preview.waiting.title": "링크 대기",
      "modal.preview.waiting.meta": "URL 을 붙이고 '분석 시작' —— 페이지 가져오기, 스크린샷, 색 추출, 11 층 디자인 시스템 사양 생성까지 자동으로 진행합니다.",
      "modal.palette.aria": "추출된 주요 팔레트",
      "modal.pipeline.aria": "자동 수록 파이프라인",
      "modal.pipeline.url": "① URL 정규화",
      "modal.pipeline.meta": "② microlink 가져오기",
      "modal.pipeline.palette": "③ 팔레트 추출",
      "modal.pipeline.ai": "④ AI 해석",
      "modal.button.start": "분석 시작",
      "modal.button.running": "분석 중…",
      "modal.button.commit": "✓ 등록 후 MD 다운로드",
      "modal.button.retry": "다시 시도",

      "spec.hint.ai": "✓ 11 층 전체 사양 생성 완료(타이포 / 간격 / 모션 / 보이스 / 금지 목록 포함)",
      "spec.hint.colorsOnly": "⚠ 색 층은 스크린샷에서 자동 추출. 나머지 10 층은 AI 연결 필요(아래 참고).",
      "spec.hint.stub": "⚠ 현재는 구조 골격만. AI 연결 후 자동 채워집니다.",

      "toast.md.copied": "Markdown 이 복사되었습니다",
      "toast.json.copied": "JSON 복사됨 · sites.js 에 붙여넣으세요",
      "toast.save.added": "저장됨",
      "toast.save.removed": "저장 해제",
      "toast.like.added": "좋아요",
      "toast.like.removed": "좋아요 해제",
      "toast.url.invalid": "유효한 URL 을 입력하세요",
      "toast.url.empty": "먼저 링크를 붙여넣으세요",
      "toast.collect.success": "등록 완료 · MD 다운로드 됨 · JSON 복사해서 sites.js 에 붙이는 것 잊지 마세요",

      "card.open.aria": "{title} 상세 열기",
      "card.visit.aria": "{title} 열기",
      "img.alt.screenshot": "{title} 스크린샷"
    }
  };

  function detectInitial() {
    // 1) URL ?lang= 优先
    const urlLang = normalizeLang(new URLSearchParams(location.search).get("lang"));
    if (urlLang) return urlLang;
    // 2) localStorage 次之（含老 "zh" 自动迁移）
    const stored = localStorage.getItem(LANG_KEY);
    const storedNorm = normalizeLang(stored);
    if (storedNorm) {
      // 顺手把老的 "zh" 写回成 "zh-CN"
      if (stored !== storedNorm) localStorage.setItem(LANG_KEY, storedNorm);
      return storedNorm;
    }
    // 3) navigator.languages 链（按用户偏好排序）
    const navLangs = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : (navigator.language ? [navigator.language] : []);
    for (const lang of navLangs) {
      const matched = normalizeLang(lang);
      if (matched) return matched;
    }
    return FALLBACK;
  }

  let currentLang = detectInitial();

  function t(key, params) {
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS[FALLBACK];
    let str = dict[key];
    if (str == null) {
      // 找不到 → 回退到默认语言；再找不到 → 显示 key 自己（便于发现遗漏）
      str = TRANSLATIONS[FALLBACK][key];
      if (str == null) return key;
    }
    if (params) {
      str = str.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : `{${k}}`));
    }
    return str;
  }

  /** 扫描 DOM 应用所有 data-i18n 系列属性 */
  function applyI18n(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
    });
    scope.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
    });
    scope.querySelectorAll("*").forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const m = attr.name.match(/^data-i18n-attr-(.+)$/);
        if (m) el.setAttribute(m[1], t(attr.value));
      });
    });
    // 同步 <html lang="..."> 给浏览器 / 搜索引擎 / 屏幕阅读器
    document.documentElement.setAttribute("lang", currentLang);
  }

  function setLang(rawLang) {
    const normalized = normalizeLang(rawLang);
    if (!normalized || normalized === currentLang) return;
    currentLang = normalized;
    localStorage.setItem(LANG_KEY, normalized);
    applyI18n();
    window.dispatchEvent(new CustomEvent("i18n:change", { detail: { lang: normalized } }));
  }

  window.i18n = {
    t,
    get current() { return currentLang; },
    set: setLang,
    supported: SUPPORTED,
    meta: LANG_META,         // 新增：给下拉菜单用
    normalize: normalizeLang, // 新增：导出归一化逻辑，方便调试
    apply: applyI18n
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => applyI18n());
  } else {
    applyI18n();
  }
})();
