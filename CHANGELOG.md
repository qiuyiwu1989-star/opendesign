# Changelog

OpenDesign 的版本记录。遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

格式：`Added / Changed / Fixed / Removed / Security / Deprecated`。

---

## [Unreleased]

计划中的下一批：

- 补完剩余 15 个 pack（仅 Apple / Linear / Lusion / Arc / Stripe Press 就绪）
- 重跑 4 个 vision 失败站（vercel / framer / pitch / amie）
- 11-layer JSON Schema（`docs/11-layer-schema.json`）
- 每条独立 SEO 友好详情页（`/sites/<slug>.html`）
- GitHub Releases 分发 pack ZIP
- Hover state 抽取

---

## [0.1.0] — 2026-05-28

**首次公开发布。**

### Added

#### 标准
- **11-layer Tokens 开放标准 v0.1** — identity / colors / typography / spacing / surfaces / layout / components / motion / interaction / voice / donts + systemPrompt
- **folder URL 协议** —— `/packs/<slug>/` 作为 AI agent 一站式入口（nginx 默认 serve `DESIGN_SPEC.md`）
- 完整开放标准文档：[docs/11-layer-spec.md](docs/11-layer-spec.md)
- AI Agent 集成指南：[docs/ai-agent-integration.md](docs/ai-agent-integration.md)
- 架构总览：[docs/architecture.md](docs/architecture.md)

#### 内容
- **20 个高质量种子站** —— Apple, Linear, Stripe, Vercel, Framer, Arc, Raycast, Cosmos, Mobbin, Pitch, Lusion, Stripe Press, etc.
- **16 个 AI 生成 spec**（mimo-v2.5 vision）—— `sites-specs.json`
- **5 个完整 pack 可下载** —— Apple (38.8 MB), Linear, Lusion, Arc, Stripe Press
  - 每包含：DESIGN_SPEC.md + sites-entry.json + summary.json + fonts.json + 17 张截图

#### 前端
- 零依赖、零构建步骤的 SPA（`index.html` + `app.js` + `styles.css`）
- 中英双语 UI（`i18n.js`，可扩展）
- Editorial-minimal 设计系统（Instrument Serif italic + Inter）
- 移动端适配
- Pack manifest 在线预览（MD / 图片 / JSON）
- 收藏 ♥ + 点赞 👍（Supabase 后端，匿名 visitor_id）
- Owner mode (`?owner=1`) —— 网页内 AI vision 添加新站
- SEO + GEO 完整：sitemap.xml / robots.txt / llms.txt / canonical / JSON-LD / OG cover

#### 后端
- Supabase Postgres + RLS（saves / likes 表 + site_like_counts 视图）
- Supabase Edge Function `analyze-site`（Deno）—— 调 mimo-v2.5 vision
- microlink.io 抓截图 + meta（无需 auth）

#### Curator 工具
- **extract/extract.py** —— Playwright 真浏览器，1440×900 @2x + 390×844 @3x mobile，13 段滚动截图，computed styles 全量抓取
- **extract/synthesize.py** —— 统计聚合 → DESIGN_SPEC.md (8 章) + sites-entry.json (11 层)
- **extract/pack.sh** —— 打包 ZIP
- **scripts/backfill-specs.mjs** —— 批量过 AI vision
- **scripts/build-packs-index.py** —— 拉文件清单建富 manifest
- **scripts/deploy.sh** —— 推 web 文件到 nginx

#### 基础设施
- Nginx + HTTP/2 + HSTS + CSP
- Let's Encrypt 自动续期
- 部署 skill（`qiuyiwu-tencent` SSH alias，passwordless sudo）
- 百度统计 + 百度站长主动推送
- 腾讯云 ICP 备案完成（域名 opendesign.cc）

#### 仓库
- MIT 许可（code）+ CC BY 4.0（curated data）双重许可
- 完整 README + CONTRIBUTING + 文档体系
- Issue templates（[propose-site](/.github/ISSUE_TEMPLATE/propose-site.yml) + bug + feature）

### Known Issues

- 4 个站 vision 失败（vercel timeout, framer/pitch/amie JSON parse） —— 待重跑
- pack 仅 5/20 就绪 —— Playwright 抓取耗时，分批补完
- 详情页用 hash routing（`#/sites/:slug`） —— SEO 仍主要靠首页 + sitemap，后续会加静态详情页
- 字体 spec 在轨 A 是估算（vision 看不到精确 px） —— 轨 B 才是真值

### Security

- `sb_publishable_*` key 公开 —— RLS 已保护写入边界
- `sb_secret_*` 和 `sbp_*` 不应进入仓库 —— 已加 `.gitignore` 防御
- Edge Function 调 mimo-v2.5 用项目 secret，不暴露给前端

---

## 早期阶段（pre-0.1，未版本化）

仅供历史参考，不在 git tag 中。

- **2026-04** · 项目从 "Style Atlas" 私人原型起步
- **2026-05 初** · 引入 Supabase 持久化、双语 UI
- **2026-05 中** · 重命名为 OpenDesign，迁到 opendesign.cc，引入 11 层 spec
- **2026-05 末** · v0.1.0 发布（本次）

---

[Unreleased]: https://github.com/qiuyiwu1989-star/opendesign/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/qiuyiwu1989-star/opendesign/releases/tag/v0.1.0
