# 009: Agent 局部修改候选与 Revision 防漂移

## 状态

complete

## 要什么

Studio 允许用户对当前页面或元素提出自然语言修改要求，但 Agent 的结果必须先成为独立候选。用户看到改了什么、为什么改、基于哪个 revision 后，才能接受或拒绝；候选不得静默覆盖当前人工稿。

## 用户旅程

1. 用户选中页面或可编辑文字元素，输入一条局部修改要求。
2. 服务端读取当前 owner-scoped Scene IR 与最新 revision，生成一个不可变 `AgentChangeCandidate`，不改项目。
3. Studio 在当前画布旁展示 before / after、目标、解释、patch 数和基线 revision。
4. 用户选择“接受修改”或“拒绝修改”。
5. 接受时服务端再次检查最新 revision 与候选基线完全一致，再写入一条 `regenerate` revision；已漂移则返回 409，保留当前稿与候选。
6. 拒绝只追加决定状态，不写项目 revision；刷新后仍能读取该决定。

## 候选契约

`AgentChangeCandidate` 包含：

- `candidateId`、`projectId`、`baseRevisionId`、`createdAt`；
- `status`: `proposed | accepted | rejected | conflicted`；
- `target`: `scene | element` 及稳定 scene/element ID；
- 用户 `instruction`、受限解释 `rationale`；
- 经过中央 ScenePatch 契约验证的 `patches`；
- `diffs`: 每项包含 element、field、before、after；
- 完整 `proposedDocument`，只作为候选快照；
- `decision` 可包含发生时间和人类理由；
- `notPublished: true`。

候选文件只保存在 `sessions/<scope>/agent-changes/<projectId>/`。响应不返回 scope、Cookie、密钥或模型原始内容。

## API

- `POST /api/projects/:projectId/agent-changes`
  - body: `{ instruction, target: { kind: "scene", sceneId } | { kind: "element", sceneId, elementId } }`
  - 返回 `201 { candidate }`；只创建候选。
- `GET /api/projects/:projectId/agent-changes`
  - 返回 `200 { candidates }`，按新到旧排列。
- `POST /api/projects/:projectId/agent-changes/:candidateId/accept`
  - body: `{ reason }`；返回 `{ candidate, document, revision }`。
- `POST /api/projects/:projectId/agent-changes/:candidateId/reject`
  - body: `{ reason }`；返回 `{ candidate }`。

跨匿名空间、项目或候选统一 404。终态重复相同决定幂等；相反决定返回 409。

## 首版局部 Agent

本阶段使用确定性、无网络的受限解释器证明交互与安全边界，不伪装成真实 Kimi：

- 只支持文字元素；scene 目标选择该页的 title；
- 指令必须包含 `改成：新文字`、`改为：新文字` 或英文 `replace with: new text`；
- 新文字 1–500 字，生成单个 `content` patch；
- 元素必须可编辑并允许 `text` capability；
- 不支持的指令以 422 返回明确诊断，不创建候选。

真实模型以后只能替换“提议 patch”的 adapter，不能绕过候选、ScenePatch、revision 和人工决定门禁。

## 实现约束

- 使用现有 Scene IR、`applyPatch`/`createRevision` 语义和 `LocalProjectStore`；不复制一套编辑规则。
- 候选与决定使用原子 JSON 写入；每匿名空间最多保留 50 个候选。
- 创建、接受和拒绝按 `scope + project + candidate` 串行化，避免双接受或检查后漂移。
- 接受前验证候选快照、当前文档、最新 revision 和所有 patch；QA 不在本阶段自动批准发布。
- 浏览器只保存当前 candidate ID，不保存 instruction 或 proposed document。

## 验收清单

- [x] 创建候选不会改变当前项目或 revision 数量。
- [x] scene 与 element 目标都生成一个可解释 content diff。
- [x] 跨 scope 不可读取或决定候选。
- [x] 人工修改产生新 revision 后，旧候选接受返回 409 且不覆盖。
- [x] 接受写一条 `regenerate` revision；拒绝不写 revision。
- [x] 同一终态决定幂等，相反决定冲突。
- [x] 无效目标、不可编辑元素、未知指令、过长文本和坏持久化文件 fail closed。
- [x] Web 明确展示 before / after，并在接受前保持当前画布不变。
- [x] dirty draft 时禁止请求 Agent 修改，先提示保存人工修订。
- [x] `cd studio && npm run typecheck && npm test && npm run build` 通过。

## 不做什么

- 不调用真实 Kimi、图像模型或远程 URL。
- 不做整份文档重生成、结构性增删页、布局智能重排或多候选并排。
- 不自动接受、送审、导出、发布或写公共 Library。
- 不声称确定性解释器代表最终 Agent 质量。
