# OpenDesign Studio Design Pack v0.1

Design Pack 不是一组静态模板截图，而是一份同时服务人、Studio 与 Agent 的版本化设计决策包。它说明一套视觉语言适合什么任务、叙事如何展开、页面需要什么内容、哪些内容可编辑，以及什么情况必须被 QA 阻断。

## 事实源与版本

- 类型与 JSON Schema 的唯一事实源是 `@opendesign/studio-contracts` 的 `DesignPack`、`validateDesignPack` 与 `design-pack-schema` 导出。
- 本包不复制 Contracts Schema，只增加跨字段语义校验。
- `id + version` 是不可变引用；Scene IR 使用 `designPack: { id, version }` 固定版本。
- Agent 生成的 Structured HTML 必须同时 pin Design Pack 与 `contractVersion`。
- 修改现有 Pack 的规则或视觉语义时必须发布新版本，不能静默覆盖历史作品所引用的版本。

## 字段如何被消费

| 字段 | 人看到什么 | Agent / Studio 如何使用 |
|---|---|---|
| `positioning` | 适用场景、受众与内容类型 | 在 Direction 阶段筛选候选 Pack |
| `designDna` | 设计原则、情绪、构图和字体说明 | 约束方向生成，避免只按截图模仿 |
| `tokens` | 颜色与字体预览 | 转为 Scene IR direction tokens |
| `narrativeArc` | 完整内容故事线 | 生成、检查页面顺序与必需角色 |
| `pageRoles` | 每类页面的目的和槽位 | 约束内容容量与布局选择 |
| `assetStrategy` | 素材使用说明 | 限制素材来源、URL scheme 与 alt |
| `agentGuidance` | 这套方案为何成立 | 作为设计总监生成规则 |
| `editability` | 可人工修改范围 | 建立编辑器 capability 和降级预期 |
| `export` | HTML/PPTX/PNG 能力 | 约束 renderer 与 editability report |
| `qaRules` | 质量门槛 | 合并到确定性 QA 与人工审核 |
| `agentAnnotation` | 可复制给其他 Agent 的说明 | `copyText`、能力集合与 Contract 版本可机器读取 |

## 首批三套 Golden Pack

### `executive-proposal-cn@1.0.0`

适合商业提案、战略评审和客户汇报。它要求先识别决策者与决策请求，以结论、证据、取舍和路线图形成闭环。主张与数字必须绑定来源；原生可编辑 PPTX 是主要交付约束。

### `research-keynote-cn@1.0.0`

适合研究报告、主题演讲和课程分享。它区分问题、事实、推论和建议，并让方法、样本范围与限制保持可见。页面按问题—方法—发现—案例—启示展开。

### `editorial-story-graphics-cn@1.0.0`

适合文章头图、章节配图和传播卡片。它不按段落机械配图，而是提取主命题、转折、引语与概念关系。重要文字保持原生对象，并同时检查 16:9 与 4:5 裁切安全。

三套 Pack 是不同任务的真实适配，不是同一模板的换色版本。Golden Task 将它们作为三个方向比较，并根据受众、交付和决策约束选择方向，不使用审美分数。

## Agent 使用协议

Agent 应读取 `agentAnnotation` 的三个字段：

1. 复制 `copyText` 进入任务上下文。
2. 确认 Studio 支持全部 `requiredCapabilities`。
3. 确认 Structured HTML 使用一致的 `contractVersion`。

生成前还必须读取完整 Pack，而不是只复制 annotation。Annotation 是安全、紧凑的交接摘要，不是完整设计协议。

## 素材与安全

- Golden Pack 只允许 `asset://` 受控资产引用，不依赖远程图片或字体。
- `asset://` 不是浏览器 URL，必须经 Studio 资产解析器转换。
- 图片必须提供表达信息意义的 alt，不能只写“图片”或视觉外观。
- 不附带字体二进制；字体栈必须允许本地替换并在导出前报告 fallback。
- 不使用来源不明资产，不模仿在世艺术家，不复制竞品模板。
- 任意 HTML 仍是不可信输入；Pack 不能放宽脚本、事件处理器或 URL 安全规则。
- 当前 Scene IR 没有原生 chart 元素；首版证据图使用可编辑的 metric、text 与 Shape 组合。不能把截图图表宣称为原生可编辑图表。

## 质量治理

Contracts validator 检查字段、枚举、格式和基本约束；Design Packs 包额外检查：

- Narrative order 连续且唯一。
- Narrative role 必须存在对应 `pageRoles`。
- 同一 page role 的 slot ID 唯一。
- QA rule ID 唯一。
- Agent annotation 包含精确 `id@version` pin。
- Annotation 至少声明一种编辑能力。

Pack 通过 schema 只代表结构合法，不代表设计已经优秀。每次升级还应跑 Golden Task，检查内容准确、修改时间、编辑能力、QA 问题与导出降级。

## Golden Task

`studio/fixtures/golden-task/design-studio-brief-v01.json` 提供一个无网络依赖的端到端输入：

- 三份项目自有 Sources snapshot。
- OpenDesign 品牌语气、颜色与字体说明。
- 七页预期大纲及 sourceIds。
- 三套 Pack 对应的 Direction metadata。
- 基于任务约束的选择理由与明确 trade-off。
- 人工编辑、QA 和多格式导出验收条件。

Fixture 中的 `fixture://` 是证据引用而不是抓取地址。Golden 路径不得读取生产数据库、COS、远程图片或外部脚本。
