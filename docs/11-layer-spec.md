# OpenDesign 11-Layer Tokens · 开放标准 v0.1

> 把网页的视觉、结构、交互、动效、文案抽象成 11 层 token + 1 段 System Prompt，让 AI 编码工具直接复用一个网站的设计 DNA。

**License**: CC BY 4.0 · 任何工具、AI 应用、设计系统都可以采用、扩展此标准，保留出处即可。

---

## 为什么需要这个标准

主流网页美学站给出的是：
- ❌ 一张截图（AI 抓不到结构）
- ❌ 一句模糊描述（"克制现代"，喂给 Claude 等于没说）
- ❌ 一些 tag（"SaaS / Editorial"，不可执行）

OpenDesign 提倡的是：

> ✅ **结构化、可被 AI 直接读到、可粘进代码的 11 层 Tokens。**

11 层是覆盖网页设计**所有可迁移要素**的最小完整集 —— 少一层（如缺 Don'ts）AI 就会犯错，多一层（如 SEO meta）就跨界了。

---

## Schema 形式

完整 JSON Schema 见 [11-layer-schema.json](11-layer-schema.json)（即将提供）。

简化结构：

```typescript
interface DesignSpec {
  identity: {
    keywords: string[];        // 5-7 个中文 / 英文关键词，从可观察元素归纳
    analogy: string;           // 类比一个不同领域的事物（杂志 / 电影 / 物件）
    oneLiner: string;          // 一句话定位
  };
  colors: {
    bg: string | null;          // 主背景 hex
    bgSoft: string | null;
    bgQuiet: string | null;
    ink: string | null;         // 正文色
    inkSoft: string | null;
    muted: string | null;
    mutedSoft: string | null;
    accent: string | null;      // 唯一强调色（如有），高彩度才填
    line: string | null;        // 分隔线色（含 alpha）
    principle: string;          // 用色原则一句话
  };
  typography: {
    display: string | null;     // 字体类别（不是品牌名）：humanist-sans / grotesque / transitional-serif / didone-serif / slab / mono / display
    body: string | null;
    mono: string | null;
    scale: Array<{
      token: "display" | "h1" | "h2" | "h3" | "body" | "small" | "caption";
      size: number;             // px
      lh?: number;              // line-height
      weight?: number;          // 100-900
      ls?: string;              // letter-spacing
      use?: string;             // 中文用法描述
    }>;
    rules: string[];            // 从截图可验证的字体规则
  };
  spacing: {
    base: number;               // 基础单位 px (通常 4 或 8)
    scale: number[];            // 间距阶 [4, 8, 16, 24, 32, 48, 64, 96]
    rhythm: string;             // 节奏描述一句话
  };
  surfaces: {
    radius: { sm: number; md: number; lg: number; pill?: 999 };
    shadows: string[];          // 阴影使用强度描述（数组每条一个观察）
    borders: string;            // 边线策略
  };
  layout: {
    container?: number;         // 主内容最大宽 px
    paragraph?: number;
    columns?: number;
    gutter?: number;
    breakpoints?: number[];
    skeleton: string;           // 页面骨架一句话
  };
  components: {
    button?: string | null;     // 配方描述
    card?: string | null;
    chip?: string | null;
    input?: string | null;
    hero?: string | null;
  };
  motion: {
    durations?: { micro?: number; small?: number; medium?: number };  // ms
    easing?: string;            // cubic-bezier(...)
    patterns?: string[];        // 动效模式
  };
  interaction: {
    hover?: string | null;
    click?: string | null;
    transition?: string | null;
    keyboard?: string | null;
  };
  voice: {
    tone?: string;              // 语气
    headlineStyle?: string;     // 标题写法
    ctaStyle?: string;          // CTA 风格
    avoid?: string[];           // 避免的写法
  };
  donts: string[];              // 至少 6 条，每条可在截图反验证
  systemPrompt: string;         // 250 字内的可直接喂 AI 的 system prompt
}
```

---

## 每层的设计原则

### 1. Identity · 设计气质 DNA

**目标**：让 AI 在 50 token 内 grasp 这个设计的灵魂。

- `keywords` 必须**可观察**（"克制留白" ✓ / "高端" ✗ —— 高端不可观察）
- `analogy` 要**刁钻具体**（"是 Apartamento 不是 Wallpaper" ✓ / "像杂志" ✗）
- `oneLiner` 是一句话品牌定位

### 2. Colors · 颜色 Tokens

**目标**：8 个语义角色覆盖 95% 网页配色用例。

| Token | 用法 | 选取原则 |
|---|---|---|
| `bg` | 主背景 | 频次最高 + 明度最高的不透明色 |
| `bgSoft` | 次级表面 / 卡片底 | 次亮的不透明色 |
| `bgQuiet` | 安静区 / chip 底 | 中明度低饱和 |
| `ink` | 正文文字 | 频次最高 + 明度最低的不透明色 |
| `inkSoft` | 次级文字 | 次暗 |
| `muted` | metadata / placeholder | 中明度低饱和**灰色**（不能是彩色）|
| `mutedSoft` | 更弱的提示 | 比 muted 浅 |
| `accent` | 唯一强调色 | 全站最高彩度的不透明色（若无明显高彩度色 → `null`）|

**关键约束**：
- 颜色 token 必须是**实际出现在网站的 hex**，禁止凭空生成
- alpha < 0.9 的半透明色不作 bg/ink/accent 候选（多是 overlay）
- `accent` 不能等于 `bg` 或 `ink`

### 3. Typography · 字体

**目标**：让 AI 知道字体气质 + 准确字号阶，但不强制具体品牌字体（版权 + 加载问题）。

`display` / `body` / `mono` 只填**类别**，不写品牌名：

| 类别 | 例子 |
|---|---|
| `humanist-sans` | Inter, Roboto, Open Sans |
| `grotesque-sans` | Söhne, GT America, Helvetica |
| `geometric-sans` | Futura, Avenir, Circular |
| `transitional-serif` | Ivar, Garamond, Caslon |
| `didone-serif` | Didot, Bodoni |
| `slab-serif` | Rockwell |
| `mono` | JetBrains Mono, IBM Plex Mono |
| `display` | Instrument Serif (italic), Fraunces |

字号 scale 7 阶覆盖：`display` / `h1` / `h2` / `h3` / `body` / `small` / `caption`，按 px 降序。

### 4. Spacing · 间距

**目标**：让 AI 知道留白节奏。

- `base` 4 或 8（绝大多数现代站）
- `scale` 是 base 的倍数序列
- `rhythm` 描述节奏感（拥挤 / 适中 / 慷慨 / "松-紧-松"）

### 5. Surfaces · 圆角阴影边线

**目标**：捕捉"卡片不卡片"的关键差异。

- `radius` 给 3-4 档（sm/md/lg/pill）
- `shadows` 是字符串数组，描述使用强度 —— 极少 → 几乎不用 → 重度 elevation
- `borders` 描述策略 —— hairline / 粗 outline / 无

### 6. Layout · 布局

**目标**：从 element rect 推断骨架。

- `container` 主内容最大宽（常见 1180 / 1240 / 1280）
- `paragraph` 段落最大宽（保 reading width）
- `skeleton` 一句话描述："top nav → hero 大图 → 三栏特性 → 案例列表 → footer"

### 7. Components · 组件配方

**目标**：button / card / chip / input / hero 五大件 each 一句话配方。

每条配方包含：形状 + 颜色 + 大小 + 状态。

例："button: pill 形状, 黑底白字, 高 44-48px, padding 24px, hover translateY(-1px), 无 icon"

### 8. Motion · 动效

**目标**：给出可执行的时长 + 缓动。

- 时长桶：`micro` (hover/focus) / `small` (transitions) / `medium` (page) / `large` (cinematic)
- `easing` cubic-bezier 或常用关键字
- `patterns` 列出从静态截图可推断的动效线索（"nav fixed + backdrop blur 暗示 sticky"）

### 9. Interaction · 交互

**目标**：hover / click / transition / keyboard 四种状态的统一规则。

10. Voice · 文案语气

**目标**：让 AI 写出**同气质的文案**，而不是"什么内容都行"。

- `tone` 一句话
- `headlineStyle` 标题写法（句尾标点、长度、动词/名词偏好）
- `ctaStyle` 按钮文字风格
- `avoid` 避免的写法（emoji / 感叹号 / 营销 fluff）

### 11. Don'ts · 禁用清单（最值钱的一层）

**目标**：反向定义气质。**6 条最低**，每条必须可在截图反验证。

格式：`"不做 X —— 截图里 Y"`

例：
- "不用渐变背景 —— 截图全程纯色块"
- "不在 hero 用 carousel —— 截图是静态单图"
- "标题不超过 7 个字 —— 看到的标题就 6 字"

这层是 AI 最容易做错的地方：AI 默认会加各种"丰富感"装饰，需要明确告诉它**不要做什么**。

### 12. System Prompt · 可粘贴的总指令（额外层）

**目标**：把前 11 层压成 250 字内的一段 system prompt，**可直接复制粘进 AI 编码工具的对话**。

必须包含：
- 定位一句话
- 关键 hex 颜色
- 字体类别
- 至少 3 条最关键的 Don'ts

---

## 提取方法（参考实现）

OpenDesign 提供两种提取轨道：

### 轨 A: 网页内 AI Vision 分析
- 工具：[supabase/functions/analyze-site](../supabase/functions/analyze-site/)
- 用 Vision LLM（mimo-v2.5 / Claude Sonnet）看截图 → 直接输出符合本 schema 的 JSON
- 速度：~30 秒
- 精度：中（字体、间距是估算）

### 轨 B: Playwright 真浏览器 + 统计聚合
- 工具：[extract/extract.py](../extract/extract.py) + [extract/synthesize.py](../extract/synthesize.py)
- 在真浏览器抓所有可见元素的 `getComputedStyle()`，按频次统计聚合出真 token
- 速度：~60 秒
- 精度：高（hex 精确到 alpha、字体名直接读出、字号 px 真值）

两种都可以输出符合本 schema 的产物。

---

## 怎么使用

### 喂给 AI 工具

把 spec JSON 或 `DESIGN_SPEC.md` 直接粘进 Claude / Cursor / v0 的对话，前置一句：

> "请按以下设计 spec 生成新页面，但不要复制品牌资产、文案：[paste spec]"

或者用 [OpenDesign 协议](ai-agent-integration.md)：给 AI 一个 URL，让它自己 fetch。

### 作为自己设计系统的"源对照"

把 spec 的 `:root` CSS variables 段粘进你项目的 `:root`，立刻有一套已被验证的 token base。

### 作为团队 design review 的 checklist

每次新页面对照 11 层逐项确认，避免"风格漂移"。

---

## 扩展本标准

欢迎扩展。建议：

- **保留 1-11 核心层**（不要拆分或合并 —— AI 训练已对齐这 11 层）
- **额外字段加 `_` 前缀**（如 `_extractedAt`, `_extractionMethod`）—— 表示"非标准但有用"
- **新增层加版本号**（v0.2 / v0.3...）—— 不破坏旧消费者
- **如有重大变更**，提 PR 到 [opendesign repo](https://github.com/qiuyiwu1989-star/opendesign) 走 RFC 流程

---

## 版本

- **v0.1** (2026-05) · 首次发布，11 层定义稳定

未来计划：
- v0.2 · 加 `responsive` 层（断点策略）
- v0.3 · 加 `accessibility` 层（对比度 / 焦点 / aria）
- v0.4 · 加 `darkMode` 层（深色模式 token mapping）

---

## 反馈

- Issue: https://github.com/qiuyiwu1989-star/opendesign/issues
- Discussion: https://github.com/qiuyiwu1989-star/opendesign/discussions
