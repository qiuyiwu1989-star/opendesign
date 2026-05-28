const IMAGE_BASE = "https://pub-8c02bb0f8aa04c19b7b7ee44644801fd.r2.dev/images/768/";

/**
 * Site Spec Schema —— 11 层设计系统富数据结构
 * ============================================
 * 旧字段 (palette/layout/interaction/motion/notes) 保留作 fallback；
 * 新条目通过 owner 管道生成时填 `spec` 对象。
 *
 * spec: {
 *   identity:    { keywords[], analogy, oneLiner }
 *   colors:      { bg, bgSoft, bgQuiet, ink, inkSoft, muted, mutedSoft, accent, line, principle }
 *   typography:  { display, body, mono, scale[{token,size,lh,weight,ls,use}], rules[] }
 *   spacing:     { base, scale[], rhythm }
 *   surfaces:    { radius:{sm,md,lg,pill}, shadows[], borders }
 *   layout:      { container, paragraph, columns, gutter, breakpoints[], skeleton }
 *   components:  { button, card, chip, input, hero }
 *   motion:      { durations:{micro,small,medium}, easing, patterns[] }
 *   interaction: { hover, click, transition, keyboard }
 *   voice:       { tone, headlineStyle, ctaStyle, avoid[] }
 *   donts[],
 *   systemPrompt
 * }
 */

/** 截图工具：thum.io 免费服务，URL 直接拼接，对大部分站点稳定（mshots 2026 起对自动化请求 403）*/
function shot(url, w = 1440) {
  return `https://image.thum.io/get/width/${w}/${url}`;
}

window.STYLE_ATLAS_SITES = [
  /* ────────── 2026 策展批次 1：高分参考站 ────────── */
  {
    id: "linear",
    title: "Linear",
    url: "https://linear.app",
    image: shot("https://linear.app"),
    tags: ["SaaS", "Productivity", "App UI", "Dark Mode"],
    palette: "深空底配高对比白文字，紫蓝信号色克制点缀，hover 出渐变光晕",
    layout: "首屏直接放真实产品 UI 截图，下方按功能模块分区，每个 section 节奏紧凑无冗余 marketing copy",
    interaction: "Hover 上有微妙渐变扫光，feature 卡片用 3D parallax 增加层次",
    motion: "200-400ms ease-out 为主，光晕动画用更长的缓动制造高级感",
    notes: "项目管理工具里设计天花板，几乎是每个 SaaS 产品想抄的目标"
  },
  {
    id: "stripe",
    title: "Stripe",
    url: "https://stripe.com",
    image: shot("https://stripe.com"),
    tags: ["Fintech", "Editorial", "Premium", "Gradient"],
    palette: "近黑紫底色 + 流动渐变 hero（蓝紫橙绿），ink 文字干净，强烈高级感",
    layout: "Editorial-grade 排版：极大留白 + 大字标题 + 严谨网格；feature 区用真实数据可视化",
    interaction: "Hero 渐变持续流动但极慢，hover 微抬阴影，无任何打扰",
    motion: "180-280ms 短促 + 慢速永动 hero gradient，张弛有度",
    notes: "Fintech 站设计的金标准，从字体到色彩到节奏都被反复模仿"
  },
  {
    id: "vercel",
    title: "Vercel",
    url: "https://vercel.com",
    image: shot("https://vercel.com"),
    tags: ["Developer Tools", "Geometric", "Monochrome", "Bold"],
    palette: "纯白底纯黑墨，仅用一个几何渐变三角作装饰，零强调色",
    layout: "极简栅格，hero 居中大字 + 双按钮 + 三角形装饰，下方功能区按 12 列对齐",
    interaction: "Hover 几乎不动，靠 cursor + 文字对比建立可点击感；按钮 active 压暗 4%",
    motion: "Pill 按钮 fade，no parallax，整站克制",
    notes: "是开发者世界的 Apple.com —— 用最少元素讲清产品定位"
  },
  {
    id: "framer",
    title: "Framer",
    url: "https://framer.com",
    image: shot("https://framer.com"),
    tags: ["Design Tools", "Expressive", "Motion", "Playful"],
    palette: "黑底配高饱和品牌蓝 / 橙 / 粉，hero 用大幅彩色 mesh gradient",
    layout: "Hero 占满首屏放真实编辑器交互，下方分章节展示功能 → 案例 → 模板",
    interaction: "Hover 处处有交互细节：cursor 跟随、卡片 3D 倾斜、scroll-linked 动画",
    motion: "300-800ms 富有表达的缓动，spring-like 弹性运动，用动效本身证明工具能力",
    notes: "用产品本身的动效能力当 marketing —— 站本身就是 Framer 做的最好的范例"
  },
  {
    id: "arc",
    title: "Arc Browser",
    url: "https://arc.net",
    image: shot("https://arc.net"),
    tags: ["Consumer", "Warm", "Friendly", "Product"],
    palette: "暖白底 + 手绘风彩色装饰（黄绿粉），有人情味不冷峻",
    layout: "Hero 是大幅产品摄影 + 短促文案；feature 区用 GIF 动图 + 手写注释",
    interaction: "scroll-driven 故事感强，元素入场 stagger 错落出现",
    motion: "400-700ms 柔和曲线，手绘装饰元素轻微浮动",
    notes: "把浏览器这种工科产品做出了消费品的温度感"
  },
  {
    id: "raycast",
    title: "Raycast",
    url: "https://raycast.com",
    image: shot("https://raycast.com"),
    tags: ["Productivity", "Dark Mode", "Refined", "Developer Tools"],
    palette: "深紫黑底 + 暖橙强调色 + 高对比白文字，整站像精致的暗色 macOS 应用",
    layout: "Hero 是真实 spotlight 启动器截图；下方功能区像 macOS App Store 的 feature 卡",
    interaction: "Hover 出微妙渐变光环；键盘快捷键提示无处不在",
    motion: "150-250ms 短促精确，符合 keyboard-first 用户的预期",
    notes: "Mac 工具站的当代代表，深色模式做得极克制极高级"
  },
  {
    id: "stripe-press",
    title: "Stripe Press",
    url: "https://press.stripe.com",
    image: shot("https://press.stripe.com"),
    tags: ["Editorial", "Books", "Premium", "Typography"],
    palette: "象牙白底配深墨绿/酒红/深蓝等出版风强调色，每本书独立色调",
    layout: "完全 editorial：书的封面作为 hero，正文用真正的报刊网格、衬线字体、慷慨行距",
    interaction: "翻页式滚动，hover 仅微微抬起书封，不打扰阅读",
    motion: "极少动效，仅用于 page transition，配合书页翻动的隐喻",
    notes: "把出版物的设计语言迁到网页的标杆 —— 每个想做 editorial 风格的站都该看"
  },
  {
    id: "cosmos",
    title: "Cosmos",
    url: "https://www.cosmos.so",
    image: shot("https://www.cosmos.so"),
    tags: ["Curation", "Gallery", "Photographic", "Editorial"],
    palette: "纯白画廊底色 + 全靠收录作品本身的色彩驱动视觉",
    layout: "Pinterest-like 瀑布流但更克制 —— 卡片间距大、不挤、有呼吸",
    interaction: "Hover 卡片极轻微上浮 + 标题渐显，点击进入沉浸式 lightbox",
    motion: "600-900ms 缓慢图片缩放，cinema 感",
    notes: "灵感采集类站的天花板，OpenDesign 在这个赛道的同行（也是参照）"
  },
  {
    id: "brittany-chiang",
    title: "Brittany Chiang",
    url: "https://brittanychiang.com",
    image: shot("https://brittanychiang.com"),
    tags: ["Portfolio", "Developer", "Dark Mode", "Editorial"],
    palette: "深海军蓝底 + 薄荷绿强调色 + 米白正文，技术感和优雅并存",
    layout: "经典开发者作品集：左侧 sticky nav + 右侧滚动 sections（About / Work / Contact）",
    interaction: "Cursor 跟随发光晕，scroll spy 同步左侧高亮，所有交互都有键盘可达",
    motion: "200-400ms ease-in-out，光晕跟随 cursor 是唯一持续动效",
    notes: "前端开发者作品集事实上的模板，无数克隆，但原版还是最克制最美"
  },
  {
    id: "mobbin",
    title: "Mobbin",
    url: "https://mobbin.com",
    image: shot("https://mobbin.com"),
    tags: ["Reference", "Mobile UI", "Library", "Grid"],
    palette: "纯白工作台底色 + 黑文字 + 一点品牌橙，让收录作品本身做主角",
    layout: "三列响应式 grid，每张卡是真实 app 截图 + 极简 caption",
    interaction: "Hover 卡片轻微上浮 + tag 浮出；点击进入 flow 级深度浏览",
    motion: "200ms hover 反馈 + 600ms lightbox 过渡，克制有效",
    notes: "Mobile UI 参考库标杆，OpenDesign 桌面端 → Mobbin 移动端"
  },
  {
    id: "apple",
    title: "Apple",
    url: "https://www.apple.com",
    image: shot("https://www.apple.com"),
    tags: ["Hardware", "Premium", "Restraint", "Editorial"],
    palette: "纯白底 + 纯黑文字 + 产品自带色彩主导画面，绝不加任何 UI accent",
    layout: "每个产品独占一屏：大产品图 + 一行标题 + 短副标 + 双按钮，重复但极致",
    interaction: "Scroll-driven 产品动效是核心：scroll 控制颜色切换、视角旋转、放大缩小",
    motion: "300-800ms 缓动 + 大量 scroll-tied 关键帧动画，cinematic 节奏",
    notes: "硬件产品页的母语，所有想做 premium product 的站绕不过去的参照"
  },
  {
    id: "pitch",
    title: "Pitch",
    url: "https://pitch.com",
    image: shot("https://pitch.com"),
    tags: ["SaaS", "Bold Typography", "Editorial", "Collaboration"],
    palette: "近黑底配高饱和橙红强调，文字大胆 + 大幅留白",
    layout: "Editorial bold：超大斜体标题压在 hero 中央，下方功能用 magazine 式分章节",
    interaction: "Hover 出微妙下划线，scroll 触发标题切换",
    motion: "中速 fade + slide，节奏稳定不夸张",
    notes: "Presentation 工具站里设计感最强的，证明 SaaS 可以不像 SaaS"
  },

  /* ────────── 早期种子（v0 时期）────────── */
  {
    id: "opal-camera",
    title: "Opal Camera Inc.",
    url: "https://opalcamera.com",
    image: `${IMAGE_BASE}nmvqc65hdiixl4nt0ppz.jpg`,
    tags: ["Product", "Hardware", "Minimal"],
    palette: "warm neutrals, high contrast product black, careful whitespace",
    layout: "Full viewport product storytelling with disciplined sections and strong image hierarchy.",
    interaction: "Subtle scroll reveals, crisp product transitions, small controls that feel physical.",
    motion: "Short, confident easing with low bounce and cinematic product media.",
    notes: "Great reference for premium hardware landing pages that need restraint and confidence.",
    spec: {
      identity: {
        keywords: ["克制", "产品摄影优先", "暖中性", "无衬线 mono", "慷慨留白"],
        analogy: "杂志的话，是 Apartamento × Wallpaper",
        oneLiner: "把硬件当作奢侈品来讲，让产品本身做主角"
      },
      colors: {
        bg: "#F7F4ED",
        bgSoft: "#FFFDF8",
        bgQuiet: "#0F0F0F",
        ink: "#101010",
        inkSoft: "#262625",
        muted: "#62615D",
        mutedSoft: "#A3A29D",
        accent: null,
        line: "rgba(16,16,16,0.08)",
        principle: "主页面 80% 是暖纸 + ink；深色区只用于产品 showcase；不用品牌色做按钮，按钮永远是 ink 黑"
      },
      typography: {
        display: "GT America Mono",
        body: "GT America",
        mono: "GT America Mono",
        scale: [
          { token: "display", size: 96, lh: 0.95, weight: 500, ls: "-2px", use: "首屏单一标题" },
          { token: "h1",      size: 56, lh: 1.0,  weight: 500, ls: "-1px", use: "section 标题" },
          { token: "h2",      size: 32, lh: 1.1,  weight: 500, ls: "-0.4px", use: "卡片标题" },
          { token: "body-lg", size: 20, lh: 1.5,  weight: 400, ls: "0",    use: "营销正文" },
          { token: "body",    size: 16, lh: 1.6,  weight: 400, ls: "0",    use: "默认正文" },
          { token: "caption", size: 12, lh: 1.4,  weight: 500, ls: "0.06em uppercase", use: "规格 metadata" }
        ],
        rules: [
          "标题永远 500 weight（不上 600/700）",
          "永不使用 italic",
          "caption 永远 uppercase + 0.06em letter-spacing"
        ]
      },
      spacing: {
        base: 4,
        scale: [4, 8, 16, 24, 32, 48, 64, 96, 128],
        rhythm: "section padding 96-128px；卡片内 24-32px；hero 极其慷慨"
      },
      surfaces: {
        radius: { sm: 0, md: 0, lg: 0, pill: 999 },
        shadows: ["几乎不用 box-shadow", "产品图自带光影即可"],
        borders: "极少 hairline，主要靠空间分隔而非线"
      },
      layout: {
        container: 1280,
        paragraph: 680,
        columns: 12,
        gutter: 24,
        breakpoints: [768, 1024],
        skeleton: "Top: 极简文字 nav 无 backdrop / Hero: 全屏产品摄影 + 一句话标题 / Sections: 大图 + 大字 + 极少正文，密度递减 / Footer: 单行"
      },
      components: {
        button: "黑底白字方按钮，高 44-48px，padding 24-32px，永不带 icon 永不带阴影",
        card: "卡片是一张图 + 下方 caption，外部无 panel 框",
        chip: "几乎不用 chip / tag UI（产品页不需要）",
        input: "newsletter form 用 underline-only input + 黑色按钮拼在右侧",
        hero: "全屏产品 still life，标题压在留白处而非图上"
      },
      motion: {
        durations: { micro: 220, small: 400, medium: 800 },
        easing: "cubic-bezier(0.2, 0.6, 0.2, 1)",
        patterns: [
          "scroll reveal: 大块淡入 + 上移 16px",
          "image transition: 600-800ms crossfade，无 parallax",
          "hover 几乎不动作，靠 cursor 变化提示可点"
        ]
      },
      interaction: {
        hover: "极少 hover 反馈，cursor: pointer 即视觉提示",
        click: "按钮 active 状态压暗 4%，无 scale",
        transition: "切页 fade only, 不滑动",
        keyboard: "form focus 用 outline，无装饰"
      },
      voice: {
        tone: "克制、self-assured、技术细节当文学讲",
        headlineStyle: "短句、句尾不加叹号、用名词不用动词",
        ctaStyle: "Order / Reserve / See more · 一个动词，最多两词",
        avoid: ["营销 fluff", "比喻式 hero copy", "emoji", "感叹号"]
      },
      donts: [
        "不用任何渐变背景",
        "不用 emoji 或装饰 icon",
        "hero 不放自动播放视频",
        "不放 testimonial 大头像墙",
        "不在 hero 用 carousel",
        "按钮永不带 emoji 或 arrow icon",
        "永不用 cookie banner / popup",
        "标题永不超过 7 个汉字 / 5 个英文词"
      ],
      systemPrompt: "你是一位极简产品页面设计师。请按以下规范生成新页面：配色用暖纸底 #F7F4ED + ink #101010，深色区用 #0F0F0F；标题字体 GT America Mono 500 weight 永不斜体，正文 GT America 400；留白慷慨，section padding 96-128px；不用渐变、不用阴影做层级、不用 chip；卡片是图 + 下方 caption 结构，不要 panel 框；动效都在 220-800ms 区间，ease-out；hero 永远是产品 still life，标题压在留白处而非图上；CTA 一个动词最多两词；禁用清单：不用 emoji / 不用感叹号 / 不用 carousel / 不用 cookie banner / 标题不超过 7 字。"
    }
  },
  {
    id: "atlas",
    title: "Atlas",
    url: "https://atlascard.com",
    image: `${IMAGE_BASE}q8ooruutehujuhreaeje.jpg`,
    tags: ["Fintech", "Editorial", "Premium"],
    palette: "deep graphite, restrained metallic accents, off-white content surfaces",
    layout: "Editorial blocks mixed with product cards; density increases after the hero.",
    interaction: "Hover states are quiet but precise; navigation stays out of the way.",
    motion: "Slow image parallax and compact card micro-interactions.",
    notes: "Useful when building trust-heavy financial products without looking generic."
  },
  {
    id: "lusion",
    title: "Lusion",
    url: "https://lusion.co",
    image: `${IMAGE_BASE}k3hmpdepwmim1f6fzbap.jpg`,
    tags: ["Studio", "3D", "Experimental"],
    palette: "black field, luminous accents, strong image contrast",
    layout: "Immersive canvas-first composition with sparse navigation and large media.",
    interaction: "Pointer movement drives visual feedback; browsing feels like exploring a scene.",
    motion: "Continuous ambient movement balanced by quick hover responses.",
    notes: "Strong reference for portfolio work where the interaction itself is the proof."
  },
  {
    id: "metalab",
    title: "Metalab",
    url: "https://metalab.com",
    image: `${IMAGE_BASE}e305d9fe-c103-4dc1-a3c1-c5101a11ad73.jpg`,
    tags: ["Agency", "Case Study", "Clean"],
    palette: "bright white, sharp black type, confident accent color moments",
    layout: "Case-study index with generous thumbnails and direct project framing.",
    interaction: "Fast card transitions, readable hover labels, direct external-path actions.",
    motion: "Snappy fades and image scale, no decorative delay.",
    notes: "Good template for turning project collections into decision-friendly browsing."
  },
  {
    id: "height",
    title: "Height",
    url: "https://height.app",
    image: `${IMAGE_BASE}3549d2b7-9fa8-45b7-83c8-7ec64b63913e.jpg`,
    tags: ["SaaS", "Productivity", "App UI"],
    palette: "cool neutrals, blue signal states, tidy interface surfaces",
    layout: "Product UI is the center; marketing copy supports real workflow screens.",
    interaction: "Interface previews behave like working software rather than static decoration.",
    motion: "Short UI-state transitions with clear before and after states.",
    notes: "Best for app pages where screenshots must teach the product model quickly."
  },
  {
    id: "amie",
    title: "Amie",
    url: "https://amie.so",
    image: `${IMAGE_BASE}242d304a-affb-4b89-bc8d-8b7ee6938630.jpg`,
    tags: ["Calendar", "Consumer", "Friendly"],
    palette: "soft light surfaces, lively accent colors, rounded product details",
    layout: "Friendly consumer SaaS rhythm with product moments embedded in copy.",
    interaction: "Microcopy and hover states create personality without losing utility.",
    motion: "Gentle card movement and expressive product state changes.",
    notes: "Useful when an app should feel personal, polished, and still functional."
  },
  {
    id: "diagram",
    title: "Diagram",
    url: "https://diagram.com",
    image: `${IMAGE_BASE}a1a30e74-b76f-4aba-8b96-ab50c9cc2d8a.jpg`,
    tags: ["AI", "Tooling", "Gradient"],
    palette: "high contrast UI, bright generative accents, clean product chrome",
    layout: "Tool capability is introduced through focused modules and short proof points.",
    interaction: "Generated moments are previewed as small, legible transformations.",
    motion: "Magical but controlled: quick previews, crisp state swaps, visible cause and effect.",
    notes: "Reference for AI tooling where the interface needs to explain the magic."
  },
  {
    id: "reflect",
    title: "Reflect",
    url: "https://reflect.app/home",
    image: `${IMAGE_BASE}7a1f58c3-e160-4004-8420-866d5b03b2a2.jpg`,
    tags: ["Notes", "SaaS", "Calm"],
    palette: "paper white, muted gray, focused blue-black text",
    layout: "A calm writing/product narrative with feature blocks that never overwhelm.",
    interaction: "Keyboard-centric product cues and quiet hover affordances.",
    motion: "Minimal motion, mostly used to clarify mental model transitions.",
    notes: "Good for productivity tools that should feel thoughtful instead of loud."
  }
];
