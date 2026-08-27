# 010: Studio Artifact Workspace

## 要什么

把 Studio 已有的 Creation Contract、方向选择、生成任务、Scene IR、QA 与导出，组织为一个可刷新、可重放、可人工确认的阶段产物工作台。

用户旅程：

1. 建立 Work Order 后可查看来源与诊断产物。
2. 完成必要澄清并选择真实 Design Pack 方向，形成不可变 Direction Artifact。
3. 系统基于已声明来源形成 Outline Artifact；用户必须明确批准大纲，生成按钮才可用。
4. 自动生成完成后登记 Scene IR 与 QA Artifact；现有项目画布继续是编辑事实源。
5. 每次真实导出登记 Export Artifact；导出不会自动发布。
6. Studio 右侧固定显示 Sources / Outline / Directions / Slides / QA / Export 六个阶段，当前状态、版本和下一步动作始终可见。

## 服务端事实源

- `ArtifactEnvelope` 继续使用 `@opendesign/studio-agent-os` 的版本化契约。
- Work Order 持久化追加 `{ envelope, payload }` 记录；公开 Workflow 只返回 Envelope，Payload 通过 owner-scoped 精确读取。
- Artifact 追加而不覆盖；每种类型的最新 revision 由确定性 registry 投影。
- payload hash 必须由服务端计算，读取时重新验证；畸形、跨 Work Order、重复 ID 或 hash 漂移 fail closed。
- `stage_completed.outputArtifactIds` 必须引用已登记的真实 Artifact ID，不再生成不存在的占位 ID。
- 匿名会话之间读取 Artifact 一律返回 404。

## 大纲确认门

- 大纲条目包含稳定 ID、页面角色、标题、目的与来源 ID。
- 首版使用确定性结构器，不声称模型已经研究或理解用户材料。
- `POST /api/work-orders/:id/outline` 接受 `{ action: "approve", expectedArtifactId }`。
- 批准动作产生新的 accepted Outline Artifact；原 draft 保留。
- 重复批准同一 accepted revision 幂等；过期 artifact、未完成澄清或未确认方向返回 409。
- `readyForConfirmation` 必须同时满足：澄清完成、方向确认、大纲批准。

## API

- 既有 `GET /api/work-orders/:id` 的 `workflow` 增加 `artifacts` 与 `outlineReview`。
- `GET /api/work-orders/:id/artifacts/:artifactId` 返回 `{ artifact, payload }`。
- `POST /api/work-orders/:id/outline` 批准当前大纲。
- 其他创建、澄清、方向、确认与 Job API 保持兼容。

## 不做什么

- 不接真实模型、图像生成、远程 URL 抓取或 Library 自动检索。
- 不做逐 token/逐页流式输出；本阶段只建立以后可承载部分产物的协议。
- 不做开放模板市场、账号系统、分享发布或生产部署。
- 不把 Artifact 视为人工批准的发布候选；发布仍走独立人工审核边界。
- 不让浏览器自行伪造 Artifact、hash、来源覆盖或 QA 结论。

## 验收清单

- [x] Agent OS registry 拒绝重复 ID、跨 Work Order、非法 revision 与 hash 漂移。
- [x] 新 Work Order 返回真实 Diagnosis Artifact；方向、大纲、Scene IR、QA、Export 按动作追加。
- [x] 未批准大纲时确认计划返回 409，批准后可创建且只创建一个 Job。
- [x] Artifact Payload owner-scoped；跨 Cookie 读取返回 404。
- [x] 运行账本的 completed stage 只引用真实 Artifact ID。
- [x] Web 可在六个阶段间切换，并展示状态、版本、来源覆盖和下一步动作。
- [x] dirty 人工稿、Agent Change Candidate、现有编辑与导出能力不被覆盖。
- [x] `cd studio && npm run typecheck && npm test && npm run build` 通过。
- [x] `git diff --check` 与凭证扫描通过。

## 状态

complete
