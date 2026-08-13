# Decisions

- 2026-08-13: Studio v0.2 采用 Skill-first Structured HTML → Scene IR → 人工编辑 → QA → 多格式导出的主流程；Scene IR 是版本、编辑、QA 与导出的事实源，HTML 是主要预览和发布结果。理由：兼顾 HTML 生成自由度、人工可编辑性与 PPTX 原生对象输出。备选：任意 HTML 作为唯一事实源（安全、版本和可编辑性不可控）；HTML 截图转 PPTX（不可编辑）。Confidence: high.
- 2026-08-13: 模板升级为结构化 Design Pack，必须包含 Design DNA、Tokens、Narrative Arc、Page Roles、Agent Guidance、编辑/导出/QA 规则；首轮只做三套 Golden Pack。理由：模板需要同时服务人和 Agent，质量优先于数量。备选：继续扩充图片模板库（无法稳定组合和编辑）。Confidence: high.
- 2026-08-13: Studio 浏览器端只消费经过构建门禁验证的 Design Pack catalog，完整 Ajv/schema 校验留在契约、导入和构建边界。理由：直接把校验器打进 Web 会让主 JS 从约 265KB 增至约 431KB。备选：浏览器运行完整包校验（重复校验且显著增加加载成本）。Confidence: high.
- 2026-08-13: Structured HTML 导入使用服务端 parse5 inert AST 与 OpenDesign 属性 allowlist；只持久化完全 accepted 的 Scene IR，出现脚本、事件、危险 URL、未知事实源或结构错误即拒绝且保留定位诊断。理由：用户 HTML 是不可信输入，partial 文档也不应进入 revision 历史。备选：浏览器 iframe/jsdom 预览后抽取（扩大执行和网络边界）；仅删除 script 后继续（容易遗漏其他执行面）。Confidence: high.
- 2026-08-13: 项目按 G3 生产档管理。理由：已有真实公开站、数据库、安全边界和定时自动化。备选：G2（无法覆盖生产安全与发布门禁）。Confidence: high.
- 2026-08-13: 内容质量系统保存 AI 建议和人工终审为两个不可变判断层，人工终审通过独立事件追加，不覆盖 AI 建议。理由：需要回答谁认为、何时成立、依据在哪，并保留判断演变。备选：只更新 `curation_decisions` 终态（审计粒度不足）。Confidence: high.
- 2026-08-13: 人工终审仍不自动发布、入队、删除或永久拒绝。理由：当前能力边界只授权判断留痕，发布需要独立变更集与批准。备选：终审后自动发布（影响面过大且不可安全回滚）。Confidence: high.
- 2026-08-13: 用户反馈未来只影响内容推荐排序，不修改 AI/人工判断的可信度。理由：偏好与证据可信度是不同信号。备选：用采纳率更新置信度（会污染判断语义）。Confidence: high.
