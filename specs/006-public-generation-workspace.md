# 006: Studio 公开生成工作台 v0.7

## 要什么

公开访客无需登录即可在 Studio 提交一个设计需求，看到生成任务的明确阶段，生成成功后进入现有可编辑画布；刷新页面后仍能找回自己的项目。不同匿名访客之间的项目、修订、素材、导出和任务必须隔离。

## 用户旅程

1. 首次访问时，服务端签发不含个人信息的匿名会话 Cookie。
2. 用户在 Design Director 对话区提交目标、受众、内容与期望交付物。
3. API 创建异步生成任务并立即返回 `202 + jobId`。
4. 页面轮询任务状态：`queued → analyzing → generating → validating → completed|failed`。
5. 成功任务返回仅属于当前会话的 `projectId`，页面加载 Scene IR 并允许编辑、QA、修订和导出。
6. 刷新或再次访问时，只显示当前匿名会话创建的项目。

## HTTP 契约

- 匿名会话：服务端使用 `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800` Cookie。Cookie 值为高熵随机标识的签名封装；日志、文件名和响应不得出现原始值。
- `POST /api/generation-jobs`：请求体上限 128 KiB；返回 `202 {job}`。同一会话最多 2 个运行中任务。
- `GET /api/generation-jobs/:jobId`：只允许任务所有者读取。
- `POST /api/generation-jobs/:jobId/cancel`：只允许任务所有者取消；终态幂等。
- 项目、修订、素材、导出、审核相关路由都必须按当前会话授权；跨会话统一返回 404，避免枚举。
- `GET /api/projects` 仅返回当前会话项目。

## 生成提供方

- 生产使用显式环境变量配置的 OpenAI-compatible endpoint/model/key；缺少配置时生成接口返回可诊断的 `provider_unavailable`，不得悄悄伪装成真实 AI。
- 测试和本地演示可显式选择 fixture provider；健康检查必须公开当前 `generationMode: live|fixture|unavailable`。
- 模型只能返回 `DesignDirectorInput` candidate，必须继续经过既有 schema、compiler、HTML importer、来源覆盖和 QA 门禁。
- 供应商密钥只存在于服务端环境；错误与日志必须脱敏。

## 隔离、配额与保留

- 磁盘以不可逆 session scope hash 分区，不以原始 Cookie 命名。
- 每会话最多 20 个项目、100 个修订、100 MiB 素材、20 个导出、2 个运行中任务。
- 匿名数据默认保留 7 天；访问可续期但最长不超过创建后 30 天。
- 清理器只删除已过期 session scope，先写结构化摘要；不接受客户端指定任意路径。
- v0.7 不迁移现有共享预览数据；它只作为明确标识的 demo fixture，不出现在匿名项目列表。

## Web 体验

- 中栏输入框成为主要生成入口；提交后显示阶段、耗时、取消和失败后的可执行建议。
- 生成时保留当前项目，不用空白页覆盖；完成后由用户确认“打开新作品”。
- 首次进入提供一个可点击的示例需求，但示例与真实生成状态必须有明显区别。
- 离线、429、provider unavailable、输入不合格、任务失败分别呈现，不使用笼统“出错了”。
- 不要求登录；清除浏览器 Cookie 会失去该匿名空间的访问权，界面需提前说明。

## 不做什么

- 不做账号系统、跨设备同步、分享链接、团队协作、计费或公开作品发布。
- 不允许客户端选择模型 endpoint、传入 API key 或绕过 Design Director compiler。
- 不用 WebSocket；v0.7 使用有界轮询。
- 不自动审批、自动发布或覆盖用户已编辑的版本。

## 验收清单

- [ ] 两个独立 Cookie jar 创建项目后，双方列表互不可见，直接访问对方 ID 返回 404。
- [ ] 无 Cookie 首次请求签发符合属性要求的匿名 Cookie，响应和日志不泄漏原值。
- [ ] 同一会话第 3 个并发任务返回 429；终态任务不占并发配额。
- [ ] fixture provider 的任务阶段可重复测试；live provider 用 mock HTTP 验证超时、取消、429、非法 JSON、超大响应和脱敏。
- [ ] 未配置 live provider 时健康检查与生成错误都如实显示 unavailable。
- [ ] 项目/修订/图片/导出均有跨会话负向测试。
- [ ] 过期清理只影响目标 scope，路径穿越和伪造 scope 均被拒绝。
- [ ] Web 测试覆盖成功、失败、取消、刷新恢复和“打开新作品”确认。
- [ ] `cd studio && npm run typecheck && npm test && npm run build` 通过。
- [ ] 发布合同检查 Cookie、安全头、限流、环境变量与回滚路径；生产部署另行执行。

## 实现约束

- Node.js 标准库优先；持久化继续使用原子文件写入，不新增数据库迁移。
- Cookie 签名密钥必须独立于 Admin 密码和模型密钥，启动时缺失则 fail closed。
- 共享契约放 `studio/apps/local-api/src/public-session.ts`、`generation-jobs.ts` 与 Web `api.ts`，避免修改 Scene IR。
- 所有时间、随机数、provider 和清理行为必须可注入以便确定性测试。

## 状态

done（代码与离线门禁完成；生产 provider 配置和部署待单独发布步骤）
