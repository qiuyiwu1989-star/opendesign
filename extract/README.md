# OpenDesign Extract CLI · 轨 B

> Playwright 真浏览器抓 `getComputedStyle` → Python 统计聚合 → 出 8 章 MD + 11 层 JSON + 17 张截图。

[← 回到主项目](../README.md) · [11-layer 标准](../docs/11-layer-spec.md) · [架构总览](../docs/architecture.md)

把任意网站抓成一份完整的「设计系统迁移规范」包：真实 computed styles → 统计聚合 → 可粘进 `:root` 的 CSS 变量 + 11 层 spec JSON + 全屏滚动截图 + 字体文件清单。

**核心哲学**：抓 token，不抓像素。高频出现 = 真 token，低频 = outlier。

## 何时用这条 CLI（vs 网站内 owner mode）

| 场景 | 用法 |
|---|---|
| 想 30 秒粘个 URL 就有大致 spec | 网站 `?owner=1` 模式（轨 A · AI vision）|
| 想要**真实 hex / 真字号 px / 真字体名** | 这条 CLI（轨 B · 真浏览器）|
| 想出可下载的 design pack ZIP | 这条 CLI |
| 想生成 17 张证据截图 | 这条 CLI |

## 安装（一次性，约 2 分钟）

```bash
./setup.sh
```

会装 Playwright Python + Chromium 浏览器。失败常见原因是国内连 PyPI 不稳，已经用清华镜像兜底。

## 工作流（每个网站约 1-2 分钟）

```bash
# 1. 抓数据 + 截图
python3 extract.py https://linear.app

# 2. 把数据合成成可读的设计规范
python3 synthesize.py extracts/linear-app

# 3. 打包成可下载的 ZIP（给访客 / 开发用）
./pack.sh extracts/linear-app
```

产物（`extracts/<域名>/`）：

| 文件 | 用途 | 是否进 ZIP |
|---|---|---|
| `DESIGN_SPEC.md` | **核心产物**：8 章 magazine 风格设计规范，含可粘 `:root` 的 CSS 变量 | ✅ |
| `sites-entry.json` | **可直接粘进 sites.js** 的 11 层 spec 对象（手动补 id / title / image） | ✅ |
| `summary.json` | 按频次聚合的 token 数据（colors / fonts / sizes / spacing / radius / shadows） | ✅ |
| `fonts.json` | 实际加载的字体 family / weight / status | ✅ |
| `01_desktop_full.png` | 1440 宽全页截图 | ✅ |
| `02_desktop_hero.png` | 1440 宽首屏 | ✅ |
| `03_desktop_section_NN.png` | 按 90% viewport 步进的滚动分段 | ✅ |
| `04_mobile_full.png` | 390 宽全页 | ✅ |
| `05_mobile_hero.png` | 390 宽首屏 | ✅ |
| `elements.json` | 全部可见元素的原始 computed styles（中间产物，体积大） | ❌ |
| `requests.json` | 所有网络请求 URL（调试用） | ❌ |
| `dom.html` | 原始 HTML 快照前 200KB（调试用） | ❌ |

## 这一套工具相比"AI vision 直接看截图"的优势

| 方面 | AI vision 截图 | extract.py + synthesize.py |
|---|---|---|
| **颜色** | 像素采样近似，半透明叠色不准 | **真 `getComputedStyle` 值**，含 alpha |
| **字体** | 只能猜类别（serif/sans），编不出品牌名 | **真 font-family 名 + 加载文件列表** |
| **字号阶** | 大致估算 | **真 px 值 + 出现频次** |
| **间距** | 看不出 | **真 padding/gap 频次直方图** |
| **圆角阴影** | 估计 | **真 borderRadius / boxShadow 值** |
| **CSS 变量** | 无法访问 | **能读出原站 `:root` 自带的 CSS variables** |
| **动效** | 静态看不到 | 至少能拿到 CSS `transition` 值 |
| **语义层（气质 / 类比 / Don'ts）** | ✓ 强 | ⚠️ 留 `__待补__`，靠 AI 补 |

**两层合用最强**：extract 拿硬数据 + AI vision 补软语义。

## 已知限制

- **静态快照**：hover / active / focus 状态没抓（需要二次脚本对每个 a/button `.hover()` 后再抓 styles 求差）
- **JS 动效**：CSS `transition` 抓到了，但 Framer Motion / Three.js / GSAP 关键帧抓不到
- **装饰素材**：手绘 SVG / 品牌图标只是引用 URL，没抠出来（有版权风险，不应该抠）
- **响应式断点**：只跑 1440 和 390 两个 viewport，中间断点（768 / 1024）需要补跑
- **字体推断**：类别准（serif/sans/mono），具体品牌名靠 fontFamily 真值（一般准），但同站可能用 fallback
- **样本偏置**：`display:none` / 视口外元素不计入统计

## 怎么扩展

- **抓 hover 状态**：在 `extract.py` 加一段，对每个 `a / button` 跑 `.hover()` 再抓 styles，diff 出 hover-specific token
- **抓断点**：加 768 / 1024 viewport 各跑一遍
- **真 AI 语义补全**：写一个 `enrich.py`，把 `summary.json` + hero 截图发我们部署好的 Edge Function（mimo-v2.5 vision），返回 identity / voice / donts / systemPrompt，merge 进 sites-entry.json

## 关于版权

工具产出的所有内容（hex 颜色、字号、间距 token 等）**不构成版权侵犯** —— 你抽的是设计原则，不是受版权保护的素材。

但是：
- 截图保留以源站为版权所有者，仅作设计研究用，不要再发布
- 字体文件请求 URL 在 `requests.json` 里，**绝不要直接抓字体二进制文件用于商业** —— 字体单独购买授权
- 文案 / 图片 / 品牌 logo 不要复用
