# 011: Progressive Artifacts and Change Gate

## 要什么

让 Studio 在生成过程中逐步显示真实阶段成果，而不是只显示百分比；同时建立一个供应商中立的局部修改门禁，让未来 Kimi 只能提出可审查的 ScenePatch 候选。

用户旅程：

1. 用户批准大纲并启动任务后，继续看到当前人工稿。
2. Structured HTML 与 Scene IR 出现时，任务卡显示真实产物状态。
3. Scene IR 可作为只读阶段预览打开；它不会成为当前编辑事实源。
4. QA 完成后显示生成稿的 blocker / error / warning / note；失败报告也必须保留。
5. 只有用户点击“打开新作品”才切换到已持久化项目。
6. 未来模型提出局部修改时，只能返回受限 ScenePatch JSON；门禁生成 before / after 和候选文档，人工接受前不写 revision。

## 渐进式产物

- Web 继续有界轮询 Job 与 owner-scoped Work Order，不增加 WebSocket。
- Job 在 importer 接受后登记 Structured HTML 与 Scene IR；QA 无论通过或拒绝都登记 QA Artifact。
- 阶段预览只消费服务端 Artifact Payload，并严格验证 Scene IR / QA 基本结构。
- 预览区明确标记“只读阶段预览”“未覆盖当前稿”；不开放编辑、保存和导出。
- Job 失败时保留已登记的合法 Artifact，当前项目不改变。

## Change Adapter

- 新包 `@opendesign/studio-change-adapter` 只接受版本化 request 与不可信 provider candidate。
- provider candidate 只能包含 rationale 与 ScenePatch；不得返回整份文档、revision、发布决定或额外字段。
- request 固定 project / base revision / target / instruction；输出必须由门禁从 base Scene IR 重新应用 patch 得到。
- patch 数量、候选字节、目标范围、字段 capability、frame 边界、asset scheme、结果 Scene IR 均 fail closed。
- provider timeout、abort 和错误正文必须脱敏；本阶段只使用离线 fixture provider。

## 不做什么

- 不调用真实 Kimi、图像模型或远程 URL。
- 不做 token streaming、逐字渲染、WebSocket 或生产队列迁移。
- 不让阶段预览成为可保存的项目，也不自动接受局部修改。
- 不新增发布、分享、数据库写入或生产部署。
- 不用单一美学分替代 QA 与人工判断。

## 验收清单

- [x] QA 通过和失败都会形成不可变 QA Artifact，且跨匿名空间不可读。
- [x] Web 轮询时更新 HTML / Scene IR / QA 的真实状态。
- [x] 只读阶段预览可查看页面但不能改动当前人工稿。
- [x] 用户显式打开完成项目后才切换编辑事实源。
- [x] Change Adapter 接受合法目标 patch，输出 before / after 与新 Scene IR，输入不被修改。
- [x] Change Adapter 拒绝整文档、额外字段、跨目标、无 capability、危险 asset、越界 frame、超大、超时与泄密错误。
- [x] 新功能有 `011` 测试追溯；既有 Agent Change Candidate 与 Artifact 测试继续通过。
- [x] `cd studio && npm run typecheck && npm test && npm run build` 通过。
- [x] `git diff --check` 与凭证扫描通过。

## 状态

complete
