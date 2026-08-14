# 007: OpenDesign Agent Design OS v1

## 产品升级

OpenDesign 从“设计资源库 + PPT 编辑器”升级为 **Agent Design OS**：把真实设计证据、专家方法、模型工具、可编辑作品和人工判断组织成一条可追溯的创作链。

对外定位：**The design intelligence layer for agents.**

- Library 不是模板货架，而是设计证据与可复用知识的来源。
- Studio 不是画布优先的 PPT 工具，而是由 Design Director 组织专家 Skill 完成任务的工作区。
- 模型不是产品事实源；Kimi、OpenAI-compatible 模型和图像模型都是可替换的 Worker。
- 人工确认不是生成后的补丁，而是形成发布候选的必要阶段。
- 同一套能力必须能被 Studio、Skill、MCP、API 和第三方产品复用。

## 产品结构

### 1. OpenDesign Library：设计证据层

保存真实网站、截图、computed tokens、字体、布局、交互、来源、许可和时间状态。每条资源区分：

- `reference`：真实来源及采集证据；
- `pattern`：从多个来源提炼的可复用设计判断；
- `asset`：可授权使用的图片、字体、图标或组件；
- `designPack`：面向具体叙事任务的版本化设计系统；
- `evaluation`：机器检查与人工审美判断。

Library 检索必须返回“为什么适合当前任务”，不能只返回相似图片或标签。

### 2. Capability Registry：Agent 可调用能力层

把 Library 的知识和专家做法注册为可组合能力：

- `SkillManifest`：专家角色、适用任务、输入、阶段、工具权限、停止条件和输出；
- `DesignPack`：Design DNA、Tokens、Narrative Arc、Page Roles、编辑与导出规则；
- `IndustryKit`：行业术语、典型叙事、证据要求、合规边界、页面角色和评测集；
- `ToolAdapter`：模型、浏览器、代码生成、图像生成、渲染、导出和存储；
- `EvalSuite`：契约、来源、可编辑率、视觉 QA、人工修正和审美复核。

所有能力必须有 ID、语义版本、来源、权限、兼容契约和评测状态。首阶段是受治理的 Registry，不做开放市场。

### 3. OpenDesign Studio：Agent 创作层

Studio 围绕一个 `DesignWorkOrder` 工作，而不是围绕一段 Chat 或一个文件：

1. **理解**：读取 Brief、文件、品牌、受众和交付要求；只问高信息量问题。
2. **诊断**：明确决策目标、证据缺口、设计立场和成功标准。
3. **计划**：选择并 pin 专家 Skills、Industry Kit、Design Pack、模型和工具。
4. **研究**：从用户材料和 Library 检索证据、Pattern 与可用资产。
5. **创作**：先形成大纲和方向，再生成 Structured HTML 与 Scene IR。
6. **评审**：执行来源、契约、可编辑、视觉和导出 QA；Design Critic 提出可执行修正。
7. **编辑**：用户可直接编辑，也可按页、元素或目标要求 Agent 局部重生成；不得静默覆盖人工修改。
8. **确认**：冻结候选、差异、来源、Pack/Skill 版本和 QA 证据。
9. **发布**：由明确动作导出 HTML、PNG、PDF、PPTX，或发送给第三方。
10. **学习**：只记录采纳、修正和结果反馈；不能反向篡改历史判断。

### 4. Agent Runtime：模型与工具执行层

建立 provider-neutral Router，按能力而不是品牌调度：

- 需求理解、叙事、研究与批评；
- HTML/CSS/前端 coding；
- 图像生成、编辑和版权/品牌安全检查；
- Structured HTML 导入、Scene IR、QA 和多格式渲染；
- 成本、延迟、失败、重试、取消和降级。

Kimi 可作为 HTML/CSS Worker 接入，但输出仍必须经过相同 compiler、inert importer、Scene IR 和 QA。任何供应商都不能直接产生“已批准作品”。

### 5. OpenDesign Connect：第三方平台层

统一提供：

- Skill 包：让 Coding Agent 加载 `SKILL.md` 后执行设计总监流程；
- MCP：检索 Library、选择 Pack、诊断和运行评测；
- Design Agent API：创建 Work Order、上传资料、订阅事件、读取 Artifact；
- Embed Review：在第三方产品内打开可编辑预览和人工确认；
- Webhook/SDK：任务完成、需要选择、QA 失败、候选批准等事件。

第三方默认得到版本化 Artifact 和 Review URL，不得到服务器密钥或越权发布能力。

## 核心事实源与契约

| 对象 | 作用 | 不可缺字段 |
|---|---|---|
| `DesignWorkOrder` | 一次创作任务 | 目标、受众、交付物、来源、品牌、约束、成功标准 |
| `ExecutionPlan` | Agent 阶段计划 | 阶段、Skill/Pack/Kit pin、工具、审批点、预算 |
| `EvidenceBundle` | 可信输入 | source ID、内容 hash、许可、支持的 claim、采集时间 |
| `ArtifactEnvelope` | 阶段产物 | 类型、版本、来源覆盖、Scene revision、可编辑能力 |
| `AgentRunEvent` | 过程留痕 | 阶段、actor、input/output hash、状态、诊断、耗时 |
| `ReviewCandidate` | 人工确认对象 | 冻结 revision、diff、QA、来源、导出报告、notPublished |
| `FeedbackEvent` | 学习信号 | 采纳/拒绝/修改、作用对象、理由、不可改历史 |

Scene IR 继续是编辑、版本、QA 与导出的事实源；Structured HTML 是高自由度创作输入和 Web 交付物。PPTX 直接消费 Scene IR，不走整页 HTML 截图。

## Studio 交互模型

桌面端使用“项目 + Agent + 作品”连续工作区：

- 左栏：新任务、项目、最近作品、Library、Skills、Assets；
- 中栏：Design Director 对话、材料、阶段计划、关键选择和运行状态；
- 右栏：File / Sources / Outline / Directions / Slides / QA / Export；
- 画布：直接选中编辑；同一对象也能通过自然语言修改；
- 版本：每次 Agent 修改先显示 diff，可接受、拒绝或另存方向；
- 解释：显示正在使用的 Skill、Pack、来源和“为什么这样做”，隐藏底层开发日志；
- 失败：指出卡在哪一阶段、保留已有成果，并提供继续、重试或换方案。

“丝滑”的标准不是没有步骤，而是用户始终知道当前成果、下一项选择和已经保留的内容。

## 从竞品学习什么

- Tosea：学习同一工作区里的材料理解、少量澄清、Outline、逐页版本、局部编辑和导出；加强来源与专家方法透明度。
- Bento：学习可携带的纯数据文档、单一模型驱动编辑/预览/演示，以及 Agent 可 round-trip 的开放格式；不复制其协作和自更新范围。
- Slidev：学习内容源文件、Theme/Add-on/组件生态和可扩展作者体验；不把 Markdown 作为 OpenDesign 唯一布局事实源。
- Huashu Design：学习品牌资产协议、三方向可视化、尽早展示、HTML-native、Playwright 复核和 anti-slop 规则；把自然语言规则升级成契约与评测。
- Presenton/PPTAgent/DeepPresenter/PptxGenJS：分别借鉴产品流程、反思循环和原生可编辑 PPTX 渲染，不让任一项目成为整套架构。

## 还必须补上的问题

- **版权与相似性**：Reference 是证据，不等于可复制资产；输出保存来源、许可和相似性风险。
- **不可信内容**：网页、文档和图片元数据都可能包含 prompt injection；检索内容只作为数据，不作为指令。
- **隐私与租户**：公开匿名空间只用于非机密试用；账号、团队和第三方 API 上线前必须有租户隔离和删除策略。
- **成本与延迟**：阶段有预算、超时、取消、缓存和可替换 Provider；不为“自动化”无限堆 Agent。
- **美学与真实性**：机器不输出单一审美总分；事实、推断、推荐和占位符在作品中可区分。
- **图像生成**：先定义 asset request、授权、尺寸/裁切、provenance 和替换能力，再接供应商。
- **学习边界**：用户修改可以改善排序和评测，但不能自动把私有内容写入公共 Library。

## 北极星与质量指标

北极星：**15 分钟内形成“用户批准且可编辑”的作品比例（Approved Editable Artifact Rate）**。

辅助指标：首个有用方向耗时、澄清轮次、方向选择率、人工修正操作/时长、来源覆盖、原生可编辑率、QA error、导出成功率、局部重生成采纳率、Skill/Pack 复用率。模板数、站点数、Chat 消息数和总生成量不是北极星。

## 分阶段实施

### Phase 0：冻结协议与体验原型

- 定义上述七个核心对象和 Capability Registry manifest；
- 用现有 proposal Golden Task 制作可点击的完整旅程；
- 只保留一个 Design Director、三个专家 Skill、三个 Pack、一个模型 adapter。

### Phase 1：Agent Studio 可用闭环

- Brief/文件 → 诊断 → 计划确认 → Outline/三方向 → 生成 → 局部编辑 → 人工批准 → PPTX/HTML；
- 阶段事件、Skill/Pack/source 可见；
- 人工 dirty revision 永不被生成任务静默覆盖。

#### Phase 1A：Creation Contract 确认门禁（本次纵向切片）

先把现有“提交 Brief 即创建生成 Job”改为两个明确动作：

1. `POST /api/work-orders` 只做有界诊断，创建匿名会话隔离的 `DesignWorkOrder`、`ExecutionPlan` 与空运行账本；不得调用模型或写入作品。
2. Studio 展示目标、受众、成功标准、来源边界、被 pin 的 Design Director Skill / Design Pack、阶段计划和预算。
3. 只有用户点击“确认计划并开始创作”，`POST /api/work-orders/:id/confirm` 才追加 human `plan_confirmed` 事件并创建既有 Generation Job。
4. Generation Job 的 analyzing / generating / validating / completed / failed 状态同步为可重放的阶段事件；运行完成只结束自动创作与 QA 阶段，编辑、人工审核和导出继续保持待办。
5. Work Order、Plan、ledger 和 Job 关联只保存在 `sessions/<scope>/work-orders`，每个匿名空间最多保留 20 个 Work Order；跨匿名 Cookie 一律返回 404，响应不返回原始 scope、Cookie 或模型密钥。
6. 重复确认必须幂等：已有 Job 时返回同一 Job；Provider 不可用时保留已确认计划，允许稍后重试，不伪装已经生成。

首轮 API 响应统一为 `{ workflow }` 或 `{ workflow, job }`。Web 对响应执行严格结构检查，刷新恢复仍只在浏览器保存不含 Brief 的对象 ID；服务端是 Creation Contract 与运行状态的事实源。

### Phase 2：Library Intelligence

- 将高质量站点转为 Pattern、Pack candidate 和受许可 Asset；
- 建立任务感知检索、相似性/许可门禁和人工策展发布；
- 用真实修正数据校准 Pack 与 Eval，不污染证据可信度。

### Phase 3：Connect 与行业能力

- 发布只读 MCP、Work Order API、Webhook 和 Embed Review；
- 首批 Industry Kit 只选 2–3 个证据要求明确的场景；
- 图像能力走独立 ToolAdapter 与 Asset 管线。

## 首个纵向切片验收

- [ ] 用户可上传一份文章/PDF 或输入 Brief，系统最多两轮高价值澄清并生成 Creation Contract。
- [ ] 页面展示被 pin 的 Skills、Pack、来源覆盖和阶段计划。
- [ ] 用户能在三个真实方向中选择，而不是在文字风格名中盲选。
- [ ] 生成产物通过真实 importer、QA、editability 和 PPTX export；失败保留已有 Artifact。
- [ ] 用户可直接编辑文字/图片/布局，也能对一个页面或元素发出 Agent 修改请求。
- [ ] Agent 修改以 diff 候选出现，不覆盖人工 revision；批准事件独立且 notPublished。
- [ ] 同一 Work Order 可由 Web Studio 和 API fixture 重放，核心 Artifact hash 可解释。
- [ ] 记录首稿时间、修正操作/时长、来源覆盖、可编辑率、QA 与导出证据。
- [ ] `cd studio && npm run typecheck && npm test && npm run build` 通过。

## 不做什么

- 本阶段不做开放 Skill 市场、多人实时协作、计费、移动端完整编辑或自动发布。
- 不把 1,486 个网站直接批量变成可复制模板。
- 不让模型自行选择未知工具权限、绕过来源/导入/QA 或修改已批准版本。
- 不先扩到十个行业；先证明一个提案任务的端到端质量和可复现性。

## 状态

in progress（Phase 0 核心契约与运行事件状态机已在 `@opendesign/studio-agent-os` 实现；Phase 1A 已接入 owner-scoped Work Order API、Creation Contract 人工确认门禁、Job 阶段事件与确定性 QA 写入门禁。下一步继续补齐高信息量澄清、方向选择前置、局部 Agent diff 与完整候选/导出证据。）
