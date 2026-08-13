# 004: Design Director Skill 与生成闭环

## 要什么

把 OpenDesign Studio 的设计判断、Design Pack 和 Structured HTML 契约封装成可被 Codex、Claude Code 或其他文件型 Agent 读取的正式 Skill。Agent 接收内容、来源、品牌约束、交付形式和人工可编辑需求，先做设计总监式诊断，再选择版本化 Design Pack，输出可安全导入 Studio 的 HTML 与机器可读 manifest。

Studio 本地 API 提供确定性编译入口：同一输入包生成符合契约的 HTML，立即经过 0.3 importer 验证，失败不持久化。工作台可以从 Brief、来源和所选 Pack 创建这一 Skill draft，并展示生成证据。

## 并行工作流

### Lane A：Skill package

- `skills/opendesign-design-director/**`
- `SKILL.md`、UI metadata、契约/Design Pack 引用、可复制输入模板。
- 设计诊断必须先于视觉生成；禁止虚构证据或抄竞品模板。

### Lane B：Compiler

- `studio/packages/design-director/**`
- 输入包 schema、validator、确定性 HTML compiler、source coverage 检查。
- 输出 HTML 必须被现有 importer accepted。

### Lane C：Evaluation

- `studio/fixtures/design-director/**`、`studio/packages/design-director-evals/**`。
- 提案、研究演讲、文章配图三类任务；检查契约、可编辑性、来源覆盖、拒绝行为和设计判断。

### Lane D：Integration

- 主 Agent 负责 `studio/apps/local-api/**`、`studio/apps/web/**`、管理文件和全仓验收。

## 不做什么

- 不连接真实模型 API，不保存模型密钥，不让 Skill 自动发布。
- 不生成任意脚本、远程字体、远程图片或未经来源支持的数据。
- 不一次扩展 10 套新 Pack；本阶段只证明三种任务都能使用现有 Pack。
- 不把 Skill 复制到用户全局目录；仓库内版本是事实源，安装另行决定。
- 不部署、不迁移、不推送 GitHub。

## 验收清单

- [x] Skill 通过官方 `quick_validate.py`，`agents/openai.yaml` 与 SKILL.md 一致。
- [x] Skill 明确触发场景、设计总监诊断、Pack 选择、来源边界、生成、导入、QA 与人工确认流程。
- [x] Compiler 输入包具备内容、sources、brand、deliverable、Pack pin 和 editability requirements。
- [x] Compiler 输出 HTML 经 0.3 importer accepted，稳定 ID 与 sourceIds 不丢失。
- [x] 三类 Golden 任务分别选择合适 Pack，不只是换色。
- [x] 缺来源、未知 Pack、过长输入和非法需求 fail closed。
- [x] Studio/API 可以创建 Skill draft 并返回 HTML、manifest、import result。
- [x] 工作台可从当前 Brief/Pack 生成并打开 draft，真实状态与错误可见。
- [x] 独立 Agent forward-test 不依赖本轮对话隐藏上下文。
- [x] 全仓 typecheck、test、build 与 `git diff --check` 通过。

## 状态

complete
