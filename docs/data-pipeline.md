# OpenDesign 数据管线 · v0.3 规范

> **这是规模化前的核心架构文档**。所有 LLM agent / 人类 curator 读这一份就能正确实施。
> **改这份文档 = 改全站架构**，谨慎，走 RFC 流程。

**Audience**：mimo / Claude / Cursor / 任何 ingest agent；以及未来接手的工程师。

**Last locked**: 2026-05-29 · **Schema version**: 0.3

---

## 0. 北极星 · 为什么这份文档存在

OpenDesign 即将从 **20 个种子站** 扩张到 **1000+ 个收录**。一个错误的 schema 决策会导致 token 浪费 5-10 倍、PR 流程瘫痪、SEO 失效。

这份文档的作用是：**在大规模 ingest 之前，把所有「会被反复调用」的决策锁死**。

锁死的内容：
1. 数据存储格式（per-site JSON 文件）
2. spec 内部分层（语言无关 vs 语言相关）
3. AI 调用路径（vision-once + translate-cheap）
4. 流水线状态机（幂等 + 断点续跑）
5. SEO 路由（每站每语言一个静态 HTML）

---

## 1. 文件结构（canonical source of truth）

### 1.1 仓库布局

```
sites/                       ← canonical 数据，curator + ingest 写这里
  apple.json
  linear.json
  stripe.json
  ... (N 个)

docs/
  site-schema.json           ← JSON Schema 定义（机器可验证）
  data-pipeline.md           ← 本文档
  prompts.md                 ← mimo 调用 prompt 模板（必读）

scripts/
  ingest.py                  ← 批量收录流水线（幂等）
  validate-sites.py          ← schema 校验
  build.py                   ← 出运行时 dist/ 产物
  translate-spec.py          ← 单站翻译（vision 之外的廉价文本调用）

dist/                        ← build 产物，不入 git
  sites-index.json           ← 列表页瘦数据（id+title+tags+image）
  sites/
    apple.json               ← 详情完整数据
    apple.en.html            ← SEO 静态页面
    apple.zh-CN.html
    apple.zh-TW.html
    apple.ja.html
    apple.ko.html
  sitemap.xml                ← 含 hreflang
```

### 1.2 单站文件结构 (`sites/<slug>.json`)

详见 `docs/site-schema.json`。简版：

```jsonc
{
  "id": "linear",                          // ← 必须等于文件名（无扩展名）
  "schema_version": "0.3",                 // ← 改 schema 后能批量识别老数据
  "url": "https://linear.app",
  "title": "Linear",
  "image": "https://image.thum.io/...",
  "tags": ["SaaS", "Productivity", "Dark Mode"],   // ← canonical 英文 tag
  "status": "completed",                   // pending | vision_done | translated | completed | failed
  "added_at": "2026-05-29",
  "added_by": "curator",                   // curator | community:<github_handle>

  "_meta": {
    "vision_model": "mimo-v2.5",
    "vision_at": "2026-05-29T08:00:00Z",
    "vision_tokens": 4521,
    "vision_cost_usd": 0.0452,
    "translation_at": "2026-05-29T08:01:00Z",
    "translation_tokens": 1820,
    "translation_cost_usd": 0.0072,
    "total_cost_usd": 0.0524,
    "last_error": null
  },

  "spec": {                                // 11 层 spec · 语言无关数据
    "identity":    { /* keywords / analogy / oneLiner (语言相关，see desc) */ },
    "colors":      { "bg": "#08090A", "ink": "#F4F4F5", ... },   // ← 跨语言不变
    "typography":  { "display": "humanist-sans", ... },           // ← 跨语言不变
    "spacing":     { "base": 4, "scale": [4,8,16,...] },          // ← 跨语言不变
    "surfaces":    { "radius": {...}, "shadows": [...] },         // ← 跨语言不变
    "layout":      { "container": 1280, "skeleton": "{lang}" },   // 部分文案
    "components":  { "button": "{lang}", ... },                   // 描述需翻译
    "motion":      { "durations": {...}, "easing": "..." },       // 跨语言不变
    "interaction": { "hover": "{lang}", ... },                    // 描述需翻译
    "voice":       { "tone": "{lang}", ... },                     // 全文案
    "donts":       ["{lang}", "{lang}", ...],                     // 全文案
    "systemPrompt": "{lang}"                                      // 全文案
  },

  "desc": {                                // 卡片摘要 + 详情抽屉的 4 大方面
    "en": {
      "palette":     "...",
      "layout":      "...",
      "interaction": "...",
      "motion":      "...",
      "notes":       "..."
    },
    "zh-CN": { /* 5 个字段 */ },
    "zh-TW": { /* 5 个字段 */ },
    "ja":    { /* 5 个字段 */ },
    "ko":    { /* 5 个字段 */ }
  },

  "spec_i18n": {                           // spec 内部需翻译的描述字段
    "en": {                                // canonical
      "identity": { "keywords": [...], "analogy": "...", "oneLiner": "..." },
      "colors":   { "principle": "..." },
      "voice":    { "tone": "...", "headlineStyle": "...", "ctaStyle": "...", "avoid": [...] },
      "donts":    ["...", "..."],
      "systemPrompt": "...",
      "layout":   { "skeleton": "..." },
      "components": { "button": "...", "card": "...", "chip": "...", "input": "...", "hero": "..." },
      "motion":   { "patterns": [...] },
      "interaction": { "hover": "...", "click": "...", "transition": "...", "keyboard": "..." }
    },
    "zh-CN": { /* 同结构 */ },
    "zh-TW": { ... },
    "ja":    { ... },
    "ko":    { ... }
  },

  "pack": {                                // 可选：是否有完整 Playwright 抓取的 design pack
    "available": true,
    "zip_url": "/packs/linear-design-pack.zip",
    "zip_size": 41943040,
    "folder_url": "/packs/linear/",
    "file_count": 21
  }
}
```

### 1.3 字段拆分原则（重要 · 决定 token 经济性）

| 字段类型 | 例子 | 位置 | 翻译策略 |
|---|---|---|---|
| **数值** | hex 颜色、px 大小、字重、毫秒 | `spec.*`（顶层）| **不翻译**（语言无关）|
| **类别名** | 字体类别 humanist-sans / serif | `spec.typography.display` | **不翻译**（英文规范术语）|
| **品牌名** | "OpenDesign"、"Apple"、"Linear" | `title` | **不翻译**（专有名词）|
| **核心描述** | palette / layout / interaction / motion / notes | `desc.<lang>.*` | **必须翻译**（用户可见）|
| **spec 文案** | identity.oneLiner / voice.tone / donts | `spec_i18n.<lang>.*` | **必须翻译**（喂 AI）|

**所以一个站翻译时只需要翻 desc + spec_i18n 两部分**，spec 顶层数值字段一次写好永不重翻。

---

## 2. AI 调用路径（token 经济性）

### 2.1 三阶段：截图 → vision → 翻译

```
URL
  ↓
[Step 1] microlink/playwright 截图 + metadata        ← 不调 LLM，便宜
  ↓
[Step 2] mimo-v2.5 vision（输入截图，输出 en JSON）  ← 1 次 vision 调用 (~$0.05)
  ↓
[Step 3] mimo-v2.5 text（en → zh-CN/zh-TW/ja/ko）   ← 4 次纯文本调用 (~$0.01 each)
  ↓
sites/<slug>.json
```

### 2.2 为什么 vision 只调一次

- Vision call 是最贵的（input tokens × screenshot encoding 占大头）
- 输出语言一致才方便后续翻译（每次输出语言不同会引入不一致）
- en 是 mimo 训练分布中 markdown/structured-data 最强的语言
- 后续每个翻译只需 vision 输出 ~1/3 的 token 量

**永远不要在 vision call 里要求 5 种语言并行输出** —— 那会让 output token 翻 3-5 倍，且各语言间会互相干扰质量。

### 2.3 字段级缓存（防止部分失败导致全部重跑）

ingest 过程把每步结果实时写回 `sites/<slug>.json`：

```
status: pending          → 还没开始
status: vision_done      → spec 已生成，等翻译
status: translated       → en 翻译完，等其它 4 lang
status: completed        → 5 lang 全完成
status: failed:<reason>  → 失败，可单独重试
```

任何阶段挂了，**重跑 pipeline 只跑没完成的步骤**：

```python
if not site.spec:
    site.spec = run_vision(url)
    save(site)

if not site.desc.get("en"):
    site.desc["en"] = extract_from_spec(site.spec)
    save(site)

for lang in ["zh-CN", "zh-TW", "ja", "ko"]:
    if not site.desc.get(lang):
        site.desc[lang] = translate(site.desc["en"], lang)
        save(site)
```

---

## 3. Prompt 锁定原则

详见 `docs/prompts.md`。**核心约束**：

- prompt 改了 → 旧 spec 与新 spec 风格不一致 → curator 看出来很难受
- 所以 prompt 必须**版本化**：`prompt_version: "0.3"` 记在 `_meta` 里
- 升级 prompt 时，老站可以选择「保留 v0.2 输出」或「批量重跑」

---

## 4. 状态机 · ingest.py 的契约

### 4.1 单站状态转换

```
                            ┌────────┐
                            │pending │ ← 新加的站
                            └────┬───┘
                                 │ screenshot OK
                                 ↓
                          ┌────────────┐
                          │screenshot  │
                          └─────┬──────┘
                                │ vision OK
                                ↓
                          ┌────────────┐
                          │vision_done │ ← spec 已有，en desc 已抽出
                          └─────┬──────┘
                                │ translate to 4 langs
                                ↓
                          ┌────────────┐
                          │ translated │ ← desc.zh-CN/zh-TW/ja/ko 都齐
                          └─────┬──────┘
                                │ (optional) Playwright pack
                                ↓
                          ┌────────────┐
                          │ completed  │ ← 全齐，可上架
                          └────────────┘
                                
                          ┌────────────┐
                          │failed:<x>  │ ← 任一步抛错都进这里
                          └────────────┘   单独 retry 不影响其它
```

### 4.2 ingest.py 命令行接口

```bash
# 从 URL 列表批量收录
python3 scripts/ingest.py --input urls.txt

# 单站
python3 scripts/ingest.py --url https://example.com

# 重跑失败的
python3 scripts/ingest.py --retry-failed

# 强制重跑（schema 升级后用）
python3 scripts/ingest.py --rerun --slug linear

# 仅跑某一步（调试用）
python3 scripts/ingest.py --slug linear --only translate

# Dry run（看会做什么但不调 API）
python3 scripts/ingest.py --input urls.txt --dry-run
```

### 4.3 并发与限流

- mimo API 假设有 RPM 限制（待确认）
- ingest 默认并发 = 3，可调
- 失败重试 3 次（指数退避：1s, 4s, 16s）
- token 总预算上限：`--budget 100`（USD），超了停下来

---

## 5. SEO 路由（从 hash 路由切到静态 HTML）

### 5.1 URL 结构

| URL | 用途 |
|---|---|
| `opendesign.cc/` | 首页（多语言根据 Accept-Language 重定向）|
| `opendesign.cc/en/` | 英语首页 |
| `opendesign.cc/ja/` | 日语首页 |
| `opendesign.cc/sites/<slug>` | 自动重定向到用户语言版本 |
| `opendesign.cc/en/sites/<slug>` | 英语详情页（**Google indexed**）|
| `opendesign.cc/ja/sites/<slug>` | 日语详情页 |
| `opendesign.cc/zh-CN/sites/<slug>` | 简中详情页（**百度 indexed**）|
| `opendesign.cc/packs/<slug>/` | AI agent 入口（folder URL，serves DESIGN_SPEC.md）|

### 5.2 hreflang

每个语言版本的 HTML 包含 5 个 `<link rel="alternate" hreflang="...">` 指向兄弟语言：

```html
<link rel="alternate" hreflang="en"    href="https://opendesign.cc/en/sites/linear">
<link rel="alternate" hreflang="ja"    href="https://opendesign.cc/ja/sites/linear">
<link rel="alternate" hreflang="ko"    href="https://opendesign.cc/ko/sites/linear">
<link rel="alternate" hreflang="zh-CN" href="https://opendesign.cc/zh-CN/sites/linear">
<link rel="alternate" hreflang="zh-TW" href="https://opendesign.cc/zh-TW/sites/linear">
<link rel="alternate" hreflang="x-default" href="https://opendesign.cc/en/sites/linear">
```

### 5.3 sitemap 含多语言

`sitemap.xml` 每个 url 携带 alternate links（Google standard）。

### 5.4 静态 + SPA 混合

第一次访问：静态 HTML（Google / 用户都看到完整内容）。  
后续点击：JS 接管 `<a>` 链接 → history.pushState → 不刷新页面（SPA 体验）。  
两全其美。

---

## 6. 兼容性 · 向前兼容承诺

- `schema_version` 单调递增，**只加字段不删字段**
- 字段重命名走"加新字段 + 一个版本后再删旧"流程
- `_meta.prompt_version` 让我们能识别历史 spec 是哪版 prompt 出的
- 老 prompt 的 spec 永远能渲染（前端不能直接报错）

---

## 7. 数据治理 · 谁能改什么

| 角色 | 能改的字段 | 不能改 |
|---|---|---|
| **ingest.py（自动）** | spec, desc, spec_i18n, _meta, status, image | id, url, schema_version, added_by, added_at |
| **curator（人工）** | 任何字段 + 反向同步回 desc | — |
| **community PR** | 单站文件的内容，但 id/url 必须和现有不冲突 | sites/*.json 之外（除非 docs/）|
| **build.py** | 只读 sites/，写 dist/ | 永不动 sites/ |

---

## 8. 验收标准（v0.3 锁定前必跑）

- [ ] `python3 scripts/validate-sites.py` 通过所有现有站
- [ ] `python3 scripts/ingest.py --url https://example.com --dry-run` 输出符合预期
- [ ] `python3 scripts/build.py` 产出的 `dist/` 在本地能跑、能 SEO 抓取
- [ ] 切语言时 desc / spec_i18n 都跟着变
- [ ] 单站 ingest 实际 token 消耗在 $0.07 ± $0.03 之间
- [ ] 中断 ingest 后再跑能从断点续，不重复消耗

---

## 9. v0.3 → v0.4 → v0.5 路线

| 阶段 | 数量 | 内容 |
|---|---|---|
| **v0.3.x（now）**| 20 站 | 锁 schema、写 validator、迁移现有数据 |
| **v0.4** | 100 站 | 写 ingest.py、试跑 100 站验证 token 预算 |
| **v0.5** | 1000 站 | 大规模 ingest，开始预算 token 控制 |
| **v0.6** | 5000 站 | 社区贡献开放，PR 自动化 |

---

## 10. 反馈

这份文档可能错。请提 [issue / RFC](https://github.com/qiuyiwu1989-star/opendesign/discussions/categories/rfc) 改进。
