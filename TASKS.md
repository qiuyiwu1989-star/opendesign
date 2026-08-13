# Tasks

## Now（本次会话正在做，最多 3 项）

- [ ] 为 Studio v0.7 配置生产 Session secret 与模型 provider，执行隔离预检后部署 (spec: 006)
- [ ] 制作 proposal 纵向切片：诊断 → 计划确认 → 三方向 → 局部编辑 → 人工批准 → PPTX/HTML (spec: 007)

## Next（已排序的待办）
- [ ] 建立任务感知的 Library Pattern 检索，返回适用理由、来源和许可状态
- [ ] 增加 Kimi HTML/CSS Worker adapter；输出继续经过 compiler/importer/Scene IR/QA
- [ ] 修复 Benchmark 已识别的研究演讲 7 个、文章配图 12 个 QA error
- [ ] 扩展首批 10 套经过 Golden Task 验证的 Design Pack
- [ ] 建立设计质量、人工修正时间与可编辑率 Benchmark
- [ ] 取得服务器只读预检证据并核验证书续期
- [ ] 在单独授权窗口准备并激活一致的 Admin RC
- [ ] 增加策展曝光/反馈事件；反馈只影响排序，不修改判断可信度
- [ ] 定义人工确认后的发布候选变更集，继续保持 preview-first

## Done（倒序，保留最近 20 条，附 commit hash）
- [x] Agent Design OS Phase 0：核心对象 schema、Capability Manifest、跨对象门禁与可重放运行事件状态机（待本次提交，spec: 007）
- [x] 将产品升级为 Agent Design OS，冻结 Library/Registry/Studio/Runtime/Connect 五面架构与用户旅程（9e5c868，spec: 007）
- [x] Studio v0.7：真实模型生成 Job、匿名会话隔离/配额/清理、对话区任务体验与跨 Cookie 安全门禁（待本次提交，spec: 006）
- [x] Studio v0.6：项目—设计总监对话—实时作品三栏工作台、结果视图与按需检查器（待本次提交）
- [x] Studio 公开预览：移除 Admin 登录门禁，保留独立 API 限流、6 MiB 上限与可回滚配置（待本次提交）
- [x] Studio 0.5：Model Adapter、人工审核 Candidate Ledger、Design Quality Benchmark 与工作台闭环（待本次提交）
- [x] Studio 初版隔离部署至 `/studio/`，复用 Admin 会话门禁并完成回滚路径（7ef53c7, c607725）
- [x] Design Director Skill、确定性 HTML compiler、三类 Golden eval 与 Studio/API 闭环（待本次提交）
- [x] Studio 0.3：Structured HTML inert 导入、诊断、持久化和 Pack/provenance 生成链路（0eb46b0）
- [x] Studio Foundation v0.2：契约、可编辑画布、三套 Design Pack 与 Golden 工作流（1cec9c5）
- [x] Quality Judgment Ledger v2：追加式人工判断、五位展示与迁移门禁（a4f0953）
- [x] 生产公网/服务器只读预检工具与 No-Go 证据（ca5561c）
- [x] Admin RC2 不可变构建、激活和回滚合同（4584c48）
- [x] 每日 AI 策展、人工终审和质量控制初版（e78eb48, 758eb4b）
- [x] Studio 本地创作闭环及字体/图片插入（d2d0d57, fa5bf90）

## Blocked
- RC2 生产激活：公网预检仅 10/17，TLS 证书续期与数据库/服务内部状态尚未证明。
