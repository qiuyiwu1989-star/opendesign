# 005: Model → Review Candidate 闭环与设计质量 Benchmark

## Sprint

- 周期：2026-08-13 — 2026-08-20
- 团队：3 条并行实现 Lane + 1 条主线集成 Lane
- 目标：让 Studio 能以可替换模型生成一个有证据的 Design Director 草稿，经人工明确确认后形成发布候选，并用可复现指标衡量编辑成本与交付质量。
- 计划负载：按 75% 容量规划；真实供应商凭证、生产发布和新增 Design Pack 属于后续或 Stretch。

## 产品闭环

`Input Package → Model Adapter → Design Director validation → Structured HTML importer → Scene IR draft → Human review → Candidate snapshot → QA / export benchmark`

每个箭头都必须返回真实状态。模型成功不等于导入成功，导入成功不等于人工批准，人工批准也不等于已发布。

## Lane A：Provider-neutral Model Adapter

范围：`studio/packages/model-adapter/**`

- 冻结 provider-neutral request/result/error/usage 契约。
- 提供确定性 fixture provider，保证离线测试与演示可复现。
- 提供 OpenAI-compatible HTTP adapter，但必须显式注入 endpoint、凭证和 fetch；默认不联网、不读仓库外密钥。
- timeout、abort、响应大小、严格 JSON、schema validation、敏感字段清理和 provider 错误必须 fail closed。
- 产物必须经过现有 `compileDesignDirector` 或 Design Director output validator，不能绕过 importer 与来源覆盖门禁。

## Lane B：Human Review Candidate Ledger

范围：`studio/packages/publishing/**`

- 状态机固定为 `draft → in_review → approved_candidate | changes_requested | rejected`。
- 所有判断采用追加事件；AI 输出、人工理由、候选 snapshot 分离且不可原地覆盖。
- 批准必须包含 actor、时间、revision、Pack pin、source coverage、QA 摘要和 artifact hashes。
- revision 漂移、QA blocker、来源缺失、未通过 importer 时拒绝批准。
- 本阶段只形成 candidate，不自动写公共站、不推 GitHub、不部署。

## Lane C：Design Quality Benchmark

范围：`studio/packages/design-benchmark/**`、`studio/fixtures/design-benchmark/**`

- 对提案、研究演讲、文章配图建立可复现基准任务。
- 自动指标：契约通过率、来源覆盖、native editability、QA blocker/warning、导出成功、操作次数、人工修正时长字段完整性、确定性。
- 审美判断只记录人工 rubric（层级、节奏、构图、品牌贴合、模板感），不伪装成客观总分。
- 输出机器可读 report 与简洁 Markdown summary；基线回退必须被测试捕获。

## Lane D：主线集成

范围：`studio/apps/local-api/**`、`studio/apps/web/**`、workspace 配置与本 spec。

- 接入 generate job、review candidate 与 benchmark summary。
- 工作台显示 provider、阶段、diagnostics、usage、dirty/revision drift 和是否可批准。
- 生成结果进入冲突预览，绝不静默覆盖人工编辑。
- 对真实 provider 只提供显式配置入口；无配置时显示 unavailable，不伪装成功。

## P0 验收

- [ ] fixture provider 端到端生成 3 类任务，结果通过 Design Director 与 importer 门禁。
- [ ] 任一 provider 超时、非法 JSON、超限、缺来源或未知 Pack 均产生稳定错误码，且不落 draft。
- [ ] 人工批准形成追加式 candidate；旧 revision、QA blocker 或未接受导入均 fail closed。
- [ ] candidate 明确标注 `notPublished: true`，不存在自动发布副作用。
- [ ] Benchmark 同时报告机器指标和人工 rubric 空位，不输出虚假的综合审美分。
- [ ] Web 可以完成“生成 → 冲突预览 → 打开草稿 → 送审 → 批准候选”的本地闭环。
- [ ] 全仓 typecheck、test、build、diff check 和凭证扫描通过。

## P1 / Stretch

- P1：OpenAI-compatible adapter 的 mocked HTTP 合同测试与 token/cost telemetry 字段。
- P1：Benchmark 基线差异视图和 JSON/Markdown 下载。
- Stretch：真实模型 smoke test，仅在用户单独提供运行时配置并授权网络调用后执行。
- Stretch：扩展 10 套 Design Pack；必须分别通过 Golden Task，不与本 Sprint 的闭环混做。

## 风险与对策

- 模型输出不稳定：严格 schema、大小/时间边界、fixture 基线、失败不持久化。
- 人工编辑被覆盖：revision pin + conflict preview + append-only review event。
- 指标诱导“刷分”：机器指标与人工审美 rubric 分栏，不做单一总分。
- 供应商锁定：provider-neutral core；供应商 adapter 不进入领域对象。
- 发布影响生产：candidate 与 publication 明确分层，本 Sprint 不授权发布。

## Definition of Done

- 各 Lane 的公开接口、测试和限制均有文档。
- 主线完成跨包集成与三个 Golden 场景。
- CI 全绿，变更可独立回滚。
- 未写生产数据库、未自动发布、未新增明文凭证。

## 状态

in_progress
