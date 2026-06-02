# Design Pack Standard · v1

> 每一个作品（site）对外都提供**同一套标准**：一个**可展示、可被 Agent 读取**的设计系统。
> 这份文档是**锁死的契约**——所有产出管线、前端展示、Agent 协议都必须遵守它。
> 金标准参考样本：`extract/extracts/apple-design-pack.zip`（21 文件，~40 MB）。

---

## 0. 两个层级（每个作品都有）

| 层级 | 是什么 | 给谁 | 必有？ |
|------|--------|------|--------|
| **Tier 1 · 简化版（文档）** | `DESIGN.md`（Google design.md 格式）+ `DESIGN_SPEC.<lang>.md`（OpenDesign 11 层，5 语言）+ `spec.json`（11 层 tokens） | 人快速读 / 直接粘进 Claude·Cursor·v0 | ✅ 每个作品都有 |
| **Tier 2 · 完整版（文件集）** | Tier 1 全部 **+** 真 computed styles（`summary.json`）+ 真字体清单（`fonts.json`）+ 视觉证据截图（desktop/mobile full+hero+滚动分段） | 严肃复刻 / 做深度迁移 / 训练 | ⬆️ 跑过 Playwright 提取的作品有（金标准） |

**铁律**：Tier 1 是底线，**任何上架作品都必须满足**。Tier 2 是金标准升级，对 UI 含金量高的作品做。
前端永远展示「这个作品有什么」，Agent 永远能从一个 folder URL 读到它。

---

## 1. 完整包（Tier 2）文件清单 —— 锁死命名

ZIP 名：`<slug>-design-pack.zip`。解开后**扁平**（无子目录），文件名严格如下：

```
DESIGN_SPEC.md            # 8 章 magazine 风格设计规范（人 + AI 可读）
sites-entry.json          # 11 层结构化 spec（= 站点 canonical 条目，见 §3）
summary.json              # 真 computed styles 聚合（见 §4）
fonts.json                # 实际加载字体 + 完整 fallback chain（见 §5）
01_desktop_full.png       # 桌面整页截图（1440 宽 @2x）
02_desktop_hero.png       # 桌面首屏
03_desktop_section_00.png # 桌面滚动分段（按 90% viewport 步进）
03_desktop_section_01.png
…                         # 分段数量随页面高度，命名零填充两位
04_mobile_full.png        # 移动整页（390 宽 @3x）
05_mobile_hero.png        # 移动首屏
```

**命名是契约**：前缀序号（`01_`…`05_`）+ 语义名固定。新增文件类型必须先改本文件再改代码。
打包时**排除**中间产物：`elements.json` / `dom.html` / `requests.json` 不进包。

部署后线上多语言文档另出（build.py 生成，放同目录）：
```
DESIGN.md                 # Google 格式（YAML front matter + 8 段）
DESIGN_SPEC.en.md         # 11 层 · 英
DESIGN_SPEC.zh-CN.md      # 11 层 · 简中
DESIGN_SPEC.zh-TW.md / .ja.md / .ko.md
```

---

## 2. 在线 folder URL 协议（Agent 入口 —— 锁死）

```
https://opendesign.cc/packs/<slug>/
```

- nginx 以 `DESIGN.md` 为目录 index → Agent 直接 GET 这个 URL 就拿到 Google 格式规范。
- 同目录可按名取任意文件：`/packs/<slug>/DESIGN_SPEC.zh-CN.md`、`/packs/<slug>/summary.json`、`/packs/<slug>/02_desktop_hero.png` …
- 完整 ZIP（Tier 2 有时）：`/packs/<slug>/<slug>-design-pack.zip`。
- **每个作品页都暴露这个 URL**（详情抽屉的 Agent 区 + 「复制 Agent 链接」）。

> 这是对 Agent 的唯一稳定契约：**给它一个 folder URL，它能自助读完整套设计系统**。

---

## 3. `sites-entry.json` / `sites/<slug>.json` —— 11 层 spec（锁死字段）

站点的 canonical 结构化规范。Tier 1 的 `spec.json` = 此对象的 `spec` 部分。

```
identity      { keywords[], analogy, oneLiner }
colors        { bg, bgSoft, ink, inkSoft, accent, principle }
typography    { display, body, displayActualName, bodyActualName, scale[{token,size,frequency}] }
spacing       { base, scale[], rhythm }
surfaces      { radius, shadow, border, … }
layout        { grid, maxWidth, sectionRhythm, … }
components     [ { name, anatomy, … } ]
motion        { durations, easings, principles }
interaction    { hover, scroll, feedback }
voice         { tone, doList[], … }
donts          [ ">=6 条，每条可在截图反验证" ]
```

字段级 JSON Schema 见 `docs/site-schema.json`（校验用）。本文件只锁"必须有这 11 层"。

---

## 4. `summary.json` —— 真 computed styles（锁死顶层键）

Playwright 抓真实页面、按频次聚合的**事实来源**（不是 AI 猜的）。顶层键：

```
url                  string
totalElementsVisible int        # 可见元素数（如 apple 1364）
totalElementsAll     int
cssVariables         object     # 站点 :root 自定义属性快照
fonts                array      # 出现过的 font-family（按频次）
tokens               object     # 按维度聚合：colors/fontSizes/spacing/radius/shadows…
sections             array      # [{file, y}] 滚动分段对应截图
requests             object     # 资源请求摘要
```

`sites-entry.json.colors.principle` 等字段的"推断依据"必须引用 `summary.json` 的频次（如 `top color [('rgba(29,29,31,1.0)', 466), …]`），保证可追溯。

---

## 5. `fonts.json` —— 真字体清单（锁死）

实际加载的字体文件 + 每个 family 的完整 fallback chain。让"字体"层不是模板词，而是该站真实在用的栈。

---

## 6. 产出管线（两条路径，统一契约）

```
                                        ┌─ 必产出 Tier 1（DESIGN.md / DESIGN_SPEC.<lang>.md / spec.json）
路径 A · Playwright 金标准（Tier 2）       │
  extract/extract.py   → 截图 + summary.json + fonts.json + elements/dom/requests(中间产物)
  extract/synthesize.py→ DESIGN_SPEC.md + sites-entry.json（11 层）
  extract/pack.sh      → <slug>-design-pack.zip（按 §1 选文件，排除中间产物）
  → 落 sites/<slug>.json + 部署 /packs/<slug>/（含 ZIP + 单文件）

路径 B · mimo 轻量（仅 Tier 1）
  scripts/ingest.py --auto-publish
  → mimo vision 出 11 层 spec + 5 语言 desc/narrative → sites/<slug>.json
  → build.py 出 DESIGN.md + DESIGN_SPEC.<lang>.md → 部署 /packs/<slug>/
  → 前端「生成设计系统」按钮把 Tier 1 现场打包成 ZIP（零依赖客户端 ZIP）
```

- **build.py** 是统一出口：读 `sites/<slug>.json`（两条路径都落这里）→ 出所有线上文档 + SEO 页 + 更新 `packs-index.json`。
- **packs-index.json** 是 Tier 2 包的清单索引（哪些作品有完整 ZIP、文件列表、体积、agentUrl）。前端据此决定展示 Tier 2 还是「生成 Tier 1」。

---

## 7. 前端展示契约（详情抽屉，每个作品）

按 `packs-index.json` 有没有该 slug 分两种，但**入口结构一致**：

1. **Agent 区**（每个作品都有）：folder URL + 「复制 Agent 提示词 / 复制 URL / 查看 DESIGN.md」。
2. **设计系统区**：
   - 有 Tier 2 → 「设计素材包」：文件清单 + 下载完整 ZIP（含截图）+ 复制 Agent URL。
   - 无 Tier 2 → 「⚡ 生成设计系统」：现场打包 Tier 1 ZIP（5 语言规范 + DESIGN.md + spec.json）下载。
3. **MD 设计规范**：内联展示 `DESIGN_SPEC` 全文，可复制 / 下载。

---

## 8. 升级路径：把一个作品升到 Tier 2（一条命令，ZIP 走 mimo 生成）

**规范由 mimo 真生成**——把 Playwright 提取的真截图 + `summary.json` 的真 computed styles
喂给 mimo，产出 grounded 的 11 层 spec（不是 `synthesize.py` 的 `__待补__` 模板占位）。

```bash
export ANTHROPIC_API_KEY=<你的 mimo key>
export ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
export ANTHROPIC_MODEL=mimo-v2.5

# 一条命令：Playwright 提取 → mimo 处理 → 打包 ZIP → 写 packs-index → 部署
bash scripts/upgrade-pack.sh <slug> <url> [extract_dirname]
# 例：bash scripts/upgrade-pack.sh vercel https://vercel.com
```

`upgrade-pack.sh` 内部 6 步（每步都可单独跑）：
1. `extract/extract.py` —— Playwright 抓真页面（截图 + summary.json + fonts.json）。已存在则跳过。
2. `scripts/ingest.py --from-extract` —— mimo 处理真实提取 → grounded spec 落 `sites/<slug>.json`。
3. `validate-sites.py --strict` + `build.py` —— 校验 + 出 grounded DESIGN_SPEC / DESIGN.md / spec.json / manifest。
4. 把 grounded 文档写进 extract 目录 + `extract/pack.sh` 打包带截图 ZIP。
5. `scripts/pack_index_entry.py` —— 写 `packs-index.json` 条目（**前端据此从「请求生成」翻成「下载完整包」**）+ 重 build manifest。
6. scp ZIP → `/packs/<slug>/` + `deploy.sh` 推 grounded 文档/SEO。

> 前置：本机装好 Playwright（`pip install playwright && playwright install chromium`，见 `extract/setup.sh`）。
> 旧的 `extract/synthesize.py`（模板 + `__待补__`）保留作离线兜底，但**默认走 mimo 路径**。

---

## 9. 版本

- **Pack Standard v1** — 本文件。改任何文件名/必有字段/目录协议 = 升版本号 + 同步改：
  `extract/extract.py`、`extract/synthesize.py`、`extract/pack.sh`、`scripts/build.py`、`packs-index.json`、前端 `renderPackManifest` / `buildDesignSystemZip`。
- 金标准样本：`extract/extracts/apple-design-pack.zip`。
