# Decisions

- 2026-08-14: OpenDesign 从“Library + Studio”双层产品升级为 Agent Design OS：Library 提供证据，Capability Registry 管理 Design Pack/Skill/Industry Kit/Tool/Eval，Agent Studio 承载创作和人工确认，Runtime 解耦模型与工具，Connect 面向第三方分发。Studio 的核心对象改为 DesignWorkOrder，而不是 Chat、模板或单个 PPT 文件。理由：用户明确希望把公共库当作可调用知识，把 Studio 作为专家 Skill 分阶段工作的设计 Agent，并让同一能力可被其他产品调用。备选：继续扩展模板编辑器（无法形成专家方法与第三方能力复用）；把 Kimi 等单一模型当产品核心（造成供应商锁定且缺少可验证边界）。Confidence: high. (spec: 007)
- 2026-08-14: Agent Studio 的标准旅程固定为理解与诊断 → 计划确认 → 研究/检索 → 大纲与三方向 → Structured HTML/Scene IR 创作 → QA/Design Critic → 人工编辑 → 候选确认 → 显式发布；Agent 对 dirty revision 的修改必须先形成 diff，不得静默覆盖。理由：连续工作区能提供 Tosea 式低摩擦体验，同时保留 OpenDesign 在来源、Skill、可编辑性和审计上的差异化。备选：单次 Prompt 直接生成整套 PPT（快但不可控）；画布优先（让用户先学工具而非先完成任务）。Confidence: high. (spec: 007)
- 2026-08-14: Studio v0.6 采用 conversation-first 三栏工作台：左侧项目与历史，中间 Design Director 对话/素材/生成，右侧文件、图片、大纲与页面结果；编辑、QA、版本和导出改为按需抽屉。理由：普通创作者的首要任务是描述目标并看到成果，Scene IR、Pack、Benchmark 等工程证据仍保留但不应成为首屏认知负担。备选：延续流程轨道+常驻双侧检查器（功能完整但学习成本高）；照搬 Tosea 视觉（缺少 OpenDesign 的质量与可编辑差异化）。Confidence: high.
- 2026-08-14: `/studio/` 进入无需 Admin 登录的公开预览期；`/api/` 同步开放，但继续由 loopback Studio 服务承载，并在 Nginx 施加每 IP 30 次/分钟、burst 20、请求体 6 MiB 的边界。Admin API 认证保持不变。理由：先降低体验门槛，验证从输入到 HTML/PNG/PPTX 的创作旅程。当前项目存储仍是服务器共享目录，因此不得处理机密材料；匿名会话隔离、数据过期和配额是公开测试转正式产品前的 P0 门禁。备选：继续复用 Admin 登录（阻碍普通用户试用）；直接开放且不设流量边界（滥用风险过高）。Confidence: high.
- 2026-08-13: Studio Candidate 与 Design Quality Benchmark 共用 QA 发布口径：blocker 或 error 均禁止形成候选，warning 保留并允许人工知情确认。理由：当前确定性 QA 的布局碰撞和越界属于 error；若只阻止 blocker，会出现 Benchmark 判失败但候选仍获批的矛盾。备选：仅阻止 blocker（当前规则下几乎失去质量门禁作用）。Confidence: high.
- 2026-08-13: Studio 下一阶段采用 provider-neutral Model Adapter → 人工审核 Candidate Ledger → Design Quality Benchmark 三层闭环；候选与发布继续分离。理由：模型生成、人工确认和生产发布具有不同证据与风险边界，必须独立验收和回滚。备选：模型生成后直接发布（会静默覆盖编辑且扩大生产风险）；只做供应商 SDK 接入（形成锁定且无法离线复现）。Confidence: high.
- 2026-08-13: Design Quality Benchmark 分离机器可验证指标与人工审美 rubric，不生成单一“设计总分”。理由：契约、来源、可编辑率和 QA 可确定性测量，但层级、节奏、品牌贴合需要带上下文的人工判断。备选：让模型给统一审美分（不可稳定复现且易产生伪精确）。Confidence: high.
- 2026-08-13: Design Director 采用仓库内正式 Skill + 确定性 compiler 双层架构；Skill 负责诊断与交接协议，compiler 负责严格输入验证、版本化 Pack 编译、来源覆盖和真实 importer 门禁。理由：让其他 Agent 可复用设计总监思维，同时不把自然语言输出误当成已验证产物。备选：只写提示词（无法自动验收）；让模型直接写 Scene IR（缺少 HTML 创作层与安全导入边界）。Confidence: high.
- 2026-08-13: Studio v0.2 采用 Skill-first Structured HTML → Scene IR → 人工编辑 → QA → 多格式导出的主流程；Scene IR 是版本、编辑、QA 与导出的事实源，HTML 是主要预览和发布结果。理由：兼顾 HTML 生成自由度、人工可编辑性与 PPTX 原生对象输出。备选：任意 HTML 作为唯一事实源（安全、版本和可编辑性不可控）；HTML 截图转 PPTX（不可编辑）。Confidence: high.
- 2026-08-13: 模板升级为结构化 Design Pack，必须包含 Design DNA、Tokens、Narrative Arc、Page Roles、Agent Guidance、编辑/导出/QA 规则；首轮只做三套 Golden Pack。理由：模板需要同时服务人和 Agent，质量优先于数量。备选：继续扩充图片模板库（无法稳定组合和编辑）。Confidence: high.
- 2026-08-13: Studio 浏览器端只消费经过构建门禁验证的 Design Pack catalog，完整 Ajv/schema 校验留在契约、导入和构建边界。理由：直接把校验器打进 Web 会让主 JS 从约 265KB 增至约 431KB。备选：浏览器运行完整包校验（重复校验且显著增加加载成本）。Confidence: high.
- 2026-08-13: Structured HTML 导入使用服务端 parse5 inert AST 与 OpenDesign 属性 allowlist；只持久化完全 accepted 的 Scene IR，出现脚本、事件、危险 URL、未知事实源或结构错误即拒绝且保留定位诊断。理由：用户 HTML 是不可信输入，partial 文档也不应进入 revision 历史。备选：浏览器 iframe/jsdom 预览后抽取（扩大执行和网络边界）；仅删除 script 后继续（容易遗漏其他执行面）。Confidence: high.
- 2026-08-13: 项目按 G3 生产档管理。理由：已有真实公开站、数据库、安全边界和定时自动化。备选：G2（无法覆盖生产安全与发布门禁）。Confidence: high.
- 2026-08-13: 内容质量系统保存 AI 建议和人工终审为两个不可变判断层，人工终审通过独立事件追加，不覆盖 AI 建议。理由：需要回答谁认为、何时成立、依据在哪，并保留判断演变。备选：只更新 `curation_decisions` 终态（审计粒度不足）。Confidence: high.
- 2026-08-13: 人工终审仍不自动发布、入队、删除或永久拒绝。理由：当前能力边界只授权判断留痕，发布需要独立变更集与批准。备选：终审后自动发布（影响面过大且不可安全回滚）。Confidence: high.
- 2026-08-13: 用户反馈未来只影响内容推荐排序，不修改 AI/人工判断的可信度。理由：偏好与证据可信度是不同信号。备选：用采纳率更新置信度（会污染判断语义）。Confidence: high.
- 2026-08-14: Studio v0.7 公开体验采用 7 天匿名 HttpOnly 签名会话、有界轮询生成任务和文件分区持久化；不先引入账号/数据库/WebSocket。理由：最快闭合“对话生成→刷新找回→继续编辑”，同时阻断当前共享项目暴露。备选：先做账号体系（阻力过大）、继续共享存储（隐私不可接受）。Confidence: high. (spec: 006)
