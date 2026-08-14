# 008: Studio 澄清与真实方向确认

## 状态

complete

## 目的

在 Creation Contract 与生成任务之间补齐两个可审查的决策点：只追问缺失的高信息量上下文，并让用户从三个真实 Design Pack 方向中明确选择。两者完成前不得调用模型或创建 Generation Job。

## 用户旅程

1. 用户提交 Brief，服务端建立 owner-scoped Work Order。
2. 系统确定性判断是否缺少受众或期望行动；最多提出一轮、两个问题。
3. 用户回答全部必要问题，回答写回 Work Order、Execution Plan 输入与持久化快照。
4. 页面同时展示三个来自受治理 catalog 的方向预览：颜色、字体、构图、密度、叙事立场和适用理由。
5. 用户必须明确选择一个方向；选择写回 pinned Design Pack 和生成输入。
6. 只有澄清完成且方向已确认，用户才能确认 Creation Contract 并启动生成。

## 服务端契约

`WorkOrderWorkflow` 新增：

- `clarification`: `required | complete | not-needed`，固定 `round <= 1`、`maxQuestions = 2`，问题包含稳定 ID、提示、原因与可选回答；
- `directionPreviews`: 固定三项，每项绑定真实 `DesignPackPin`，包含颜色 token、字体、构图、密度、节奏和理由；
- `selectedDirectionId`: 当前建议方向；
- `directionConfirmed`: 用户是否明确确认；
- `readyForConfirmation`: 澄清完成且方向已确认。

新增 owner-scoped API：

- `POST /api/work-orders/:id/clarifications`，body 为 `{ answers: [{ questionId, answer }] }`；
- `POST /api/work-orders/:id/direction`，body 为 `{ directionId }`。

规则：

- 回答长度 2–240 字，必须一次回答当前全部问题；未知、重复、追加轮次或已有运行事件时 fail closed；
- 方向必须来自该 Work Order 已冻结的三项预览；已有运行事件时不可改；
- 两类修改均重建尚无事件的 Plan/ledger，并原子持久化；
- `POST /confirm` 在 `readyForConfirmation=false` 时返回 409，不产生事件或 Job；
- 跨匿名会话仍统一 404；公开响应不得含 scope、Cookie、密钥或原始 provider body。

## 澄清策略

首版只检查两个对创作影响最大的变量：

- 缺少明确受众：询问“这份作品主要给谁看？”；
- 缺少期望行动：询问“看完后希望对方做出什么决定或行动？”。

这是确定性启发式，不声称理解了行业事实。已有明确线索时不追问；本阶段不做模型追问、第二轮动态追问或自由对话记忆。

## 方向预览

三个方向必须来自 `@opendesign/studio-design-packs/catalog`，不是临时文字风格名。预览至少显示 Pack 名称/版本、主色、背景、标题字体、真实 composition grid/density/rhythm、适用理由与主/备立场。选择只改变 pin 与后续生成输入，不复制 Library Reference 资产。

## 验收

- [x] 无受众和行动线索时恰好返回两个问题；信息完整时不追问。
- [x] Creation Contract 始终返回三个不同、可验证 Pack 的视觉预览。
- [x] 回答和方向选择可刷新恢复，跨 Cookie 不可读写。
- [x] 未完成任一决策点时 confirm 返回 409 且无 Generation Job。
- [x] 完成后只创建一个 Job，重复 confirm 仍幂等。
- [x] Web 能完成提问、选择方向、确认计划，并保留 dirty draft。
- [x] 严格响应解析拒绝畸形问题、方向或 ready 状态。
- [x] `cd studio && npm run typecheck && npm test && npm run build` 通过。

## 非目标

- 不调用真实 Kimi 或其他外部模型；不写入任何 API key。
- 不做图像生成、Library 智能检索、开放模板市场或自动发布。
- 不把方向预览冒充最终页面，也不以单一审美分替代人工选择。
