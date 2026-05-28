# OpenDesign Roadmap

公开的产品和标准路线图。**不承诺时间**，但承诺方向。

> 想推动某项前进？开 [issue](https://github.com/qiuyiwu1989-star/opendesign/issues) 让它升优先级 —— 或直接 PR。

---

## 北极星

> 让任何 AI 编码工具，输入一个网页 URL，就能直接复用它的设计 DNA 生成新页面。

具体指标：

- ✅ 给 AI **一个 URL** 拿到完整上下文 —— `opendesign.cc/packs/<slug>/`
- ✅ 一个 spec 至少覆盖 **11 层**可迁移要素
- ✅ 数据是**可验证的**（来源截图 / computed styles）
- 🚧 第三方工具直接支持「OpenDesign URL」作为 design context input

---

## v0.2 ✅ 已完成（2026-05）

- ✅ 补完 v0.1 所有 vision 失败站，新增 5-10 站
- ✅ 发布 `docs/11-layer-spec.md` 开放标准 + `docs/site-schema.json` JSON Schema
- ✅ 每条独立 SEO 静态详情页（5000+ pages，hreflang）

---

## v0.3 ✅ 已完成（2026-05 下）

### 数据栈
- ✅ **8 种语言 UI**：zh-CN / zh-TW / en / ja / ko + UN 大语种 fr / es / ru
- ✅ **VoltAgent 65 站** + 自有 20+ 站，扩张到 80+ 收录
- ✅ **质量门** —— colors / 字体类别 / donts / 5 lang coverage 自动校验
- ✅ **截图 fallback 链** —— thum.io → microlink → Google Pagespeed

### 流水线
- ✅ `ingest.py --auto-publish` 一条命令 URL → live URL
- ✅ Prompt #1/#2/#3 锁定 v0.3 版本（vision + translate + narrative）
- ✅ `build.py` 双格式输出：DESIGN_SPEC.<lang>.md + Google DESIGN.md

### UX
- ✅ Tag 频次排序 + 计数 badge + 同现 tag 关联
- ✅ 详情抽屉「同气质推荐」（Jaccard + 颜色相似度）
- ✅ Saved sync code 跨设备携带（无账号）

### 协议
- ✅ Google Stitch / VoltAgent DESIGN.md 格式兼容（每 pack 双文件）

---

## v0.4 · 下一里程碑（2026-06）

### 内容
- 🚧 1000 站收录目标（预算 $100，~24 小时跑完）
- 🚧 中文设计站专题（Bestfolios CN / 站酷 top）
- 🚧 大厂 design system showcase（Material / Carbon / Polaris）

### 协议 / 集成
- 🚧 发布 npm 包 `@opendesign/fetch-spec`
- 🚧 发布 VS Code / Cursor 插件 (`:OpenDesign apple`)
- 🚧 推动至少 1 个第三方 AI 编码工具显式支持

### 国际化
- 🚧 Arabic (ar) UI + RTL CSS 全站镜像
- 🚧 现存站 fr/es/ru 内容翻译 backfill (~$3)

### 工具
- 🚧 `extract.py` 加 **hover state** + **dark mode** 抓取
- 🚧 AI vision 二次校验（critique + refine）

---

## v0.4 · 提取精度 + 自动化

### 工具
- **Track A vision 精度** —— 切换 Claude Sonnet 4.5 vision 作为默认（mimo 作 fallback）
- **Track B 抽取** —— 加 dark mode 自动探测、加键盘 focus 状态抽取
- **多种语言提取器** —— TypeScript port of synthesize.py（让前端社区也能贡献）

### 后端
- **审核工作流** —— 社区提名 → 自动跑 Track A → curator 1-click 批准 / 拒绝
- **变更追踪** —— 网站设计改了，自动跑 diff，列出 token 变化

### 标准
- 新增 **darkMode 层（v0.4）** —— 浅 / 深 token mapping

---

## v0.5+ · 标准生态长尾

不规划具体时间，但方向：

- **多模态扩展** —— 视频 demo / Lottie 动效 / 3D 资产规范
- **品牌系统 vs 产品 UI 区分** —— 同一公司可能 marketing site 和 app 风格不同
- **训练数据贡献** —— 把所有 CC BY 4.0 specs 打包成 HF dataset
- **AI 编码工具反馈循环** —— 工具用了 OpenDesign 生成的页面，可以反馈"哪条 Don't 没生效"

---

## 不会做的（明确边界）

- ❌ **付费墙** —— spec 永远免费、CC BY 4.0
- ❌ **关闭 RPC / API gating** —— 永远是 plain HTTP folder URL
- ❌ **品牌资产托管** —— 截图是参考，不重新发布 Apple/Stripe 的官方素材
- ❌ **审美评分系统** —— "好设计 vs 坏设计" 不可量化；OpenDesign 收录的是有清晰立场的设计，不评高下
- ❌ **趋势报告 / Best of 2026** —— 我们做的是工具，不是 listicle

---

## 反馈优先级

按这个排序提升任何 issue 的优先级：

1. **核心标准的修复** —— spec 字段定义有歧义、JSON Schema 错
2. **AI 集成实测 broken** —— 给 Claude / Cursor URL 没拿到正确上下文
3. **数据错误** —— spec 颜色 / 字体 / token 不对
4. **工具 bug** —— extract / synthesize / pack 跑挂
5. **前端 bug**
6. **新功能 / 新站提名**

---

## 现在能帮上忙的

最有价值的贡献（按时间投入 ascending）：

| 时间 | 任务 |
|---|---|
| 1 分钟 | 提名 1 个值得收录的网站（[issue 模板](.github/ISSUE_TEMPLATE/propose-site.yml)）|
| 5 分钟 | review 1 个现有 spec，发现 token 错误 → PR 修正 |
| 30 分钟 | 跑一遍 [extract CLI](extract/README.md) 对一个新站 → 提交 pack |
| 2 小时 | 翻译 i18n.js 到一门新语言 |
| 半天 | 实现 v0.2 的某个具体子项 |

---

## 联系 / 协作

- Issue: https://github.com/qiuyiwu1989-star/opendesign/issues
- Discussion: https://github.com/qiuyiwu1989-star/opendesign/discussions
- 商业合作 / 数据集授权 / 共建邀请：contact at qiuyiwu.com
