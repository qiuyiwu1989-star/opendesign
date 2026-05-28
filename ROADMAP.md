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

## v0.2 · 完整度 + 标准成熟（下一里程碑）

### 内容
- 补完剩余 15 个 pack（Vercel / Framer / Raycast / Cosmos / Mobbin / Pitch / Amie / ...）
- 重跑 4 个 vision 失败站
- 新增 5-10 个社区提名站

### 标准
- 发布 `docs/11-layer-schema.json` —— JSON Schema 形式
- 新增 **responsive 层（v0.2）** —— 断点策略 token
- 提供 `validate-spec.js` CLI —— 检查 spec 是否合标准

### 工具
- `extract/extract.py` 加 **hover state** 抓取
- `extract/synthesize.py` 加 **dark mode** token mapping（自动跑两次）
- AI vision **二次校验** —— vision 输出后，让另一个 LLM critique 并修正

### 前端
- 每条 **独立 SEO 详情页** —— `/sites/<slug>.html` 静态生成，hash routing 兼容
- 11-layer spec **可视化预览** —— 详情页直接渲染 token、字号阶、间距阶
- 比对模式 —— 同时打开 2 个 spec 对比

---

## v0.3 · 协议化 + 工具生态

### 协议
- 推动至少 1 个第三方 AI 编码工具显式支持 `opendesign.cc/packs/` URL
- 发布 npm 包 `@opendesign/fetch-spec` —— 给 LLM toolkit 用
- 发布 VS Code 插件 —— 在 Cursor / VSCode 里直接 `:OpenDesign apple` 拉规范

### 标准
- 新增 **accessibility 层（v0.3）** —— 对比度、focus visible、aria
- 反向标准：网站可在 `/.well-known/design-spec.md` 暴露自己的 11 层 spec
- 标准 RFC 流程化（PR 模板 + 评论期 + 投票）

### 内容
- 收录数突破 50
- 至少 3 个 "design system showcase"（Material / Carbon / Polaris 等大厂系统）
- 中文设计站专题（Bestfolios CN / 站酷 top 推荐风格）

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
