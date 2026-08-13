# 002: Studio Foundation v0.2

## 要什么

建立一条可验证的 HTML-first 人机共创闭环：设计总监 Skill 根据内容、品牌资产与 Design Pack 生成受约束的结构化 HTML；Studio 将其安全导入 Scene IR；人工可以修改文字、字体、图片、几何与层级；所有修改保留 revision，经过 QA 后输出 HTML 与可编辑 PPTX。

工作台采用四个首版阶段：

1. Sources：内容、品牌资产与来源状态。
2. Outline：页面叙事与内容结构。
3. Direction：三种设计方向与 Design Pack 选择。
4. Studio：结构化 HTML 预览、人工编辑、QA 与导出预检。

## 用户故事

- 作为提案作者，我可以提供文章或提案内容，让 Skill 先生成可看的 HTML 初稿。
- 作为非设计师，我可以在画布中修改文字、字体、图片、位置和层级，而不必编辑代码。
- 作为设计负责人，我可以知道每个页面使用了哪个 Design Pack、为什么这样设计以及哪些元素可编辑。
- 作为交付者，我可以在导出前看到溢出、碰撞、缺资产、字体替换和 PPTX 降级问题。
- 作为 Agent，我可以读取稳定的结构化协议和 Design Pack 标注，而不是依赖截图猜测设计。

## 并行工作流与所有权

### Lane A：Contracts

所有权：`studio/packages/contracts/**`

- Structured HTML Contract v0.1
- Design Pack Schema v0.1
- HTML Import Result / Diagnostic
- text/font/image/frame/order Patch
- Revision 与 editability hints

### Lane B：Editor

所有权：`studio/apps/web/**`、`studio/packages/ui/**`

- 文字与字体编辑
- 图片插入、替换、alt 与适配方式
- 元素选择、拖动、缩放、层级与边界约束
- 页面管理、undo/redo、dirty/revision 状态
- QA 定位与安全修复预览
- AI 重新生成与人工修改冲突提示

### Lane C：Design Packs

所有权：`studio/packages/design-packs/**`、`studio/fixtures/**`、`docs/studio-design-pack-v01.md`

- 商业提案、研究演讲、文章配图三套 Design Pack
- Design DNA、Tokens、Narrative Arc、Page Roles
- Agent Guidance、可复制标注、QA 与导出规则
- 一个无网络依赖的 Golden Task

### Lane D：Workspace Integration

所有权：主 Agent；在 Lane A 接口稳定后确定最小改动范围。

- Sources / Outline / Direction / Studio 状态机
- Design Pack 选择与 HTML 导入入口
- 统一空、加载、错误、unsupported 与 mock 状态
- 保持现有本地 API 和 Renderer 的兼容性

## 统一接口原则

- Scene IR 是版本、编辑、QA 和导出的事实源；HTML 是主要预览和发布形式。
- Skill 生成的 HTML 必须包含稳定 scene/element ID、role、editable capability、Design Pack version pin 和来源信息。
- 任意 HTML 都是不可信输入；脚本、事件处理器和未允许的 URL 不得执行。
- 不支持的节点必须形成 diagnostic，不能静默丢失。
- AI 重新生成产生新 revision，不得默认覆盖人工 patch。
- HTML 与 PPTX 都消费同一 Scene IR；不得把整页截图伪装为可编辑 PPTX。
- 高保真栅格降级必须逐元素报告。

## 验收清单

- [x] Contracts 的 JSON Schema、TS 类型、Ajv 校验和负向测试通过。
- [ ] 一份 Golden Structured HTML 可安全导入且保留稳定 ID、来源和 Design Pack pin。（当前已冻结声明契约与 Import Result，真实 DOM parser/sanitizer 留待 0.3）
- [ ] 危险脚本、事件处理器、非法 URL 与未知节点被拒绝或显式诊断。（契约和 diagnostic 已验证，真实 DOM 导入执行尚未实现）
- [x] 人工可修改文字、字体、图片、frame 和层级。
- [x] undo/redo 不破坏元素 ID，人工修改状态可见。
- [x] AI 更新与人工修改冲突不会静默覆盖。
- [x] QA issue 可以定位到页面和元素，并显示修复影响。
- [x] 三套 Design Pack 全部通过 schema/validator，并提供 Agent 标注。
- [x] Golden Task 完成 Sources → Outline → Direction → Studio 演示。
- [x] HTML、PPTX、PNG 导出预检明确显示真实/模拟状态。
- [x] 可编辑性报告区分 native、raster、omitted。
- [x] Studio 全仓 typecheck、test、build 通过。
- [x] `git diff --check` 通过，未包含凭证、生产数据或大二进制。

## 不做什么

- 不实现任意 HTML/JS 的无约束执行。
- 不实现完整 Figma 级自由画布。
- 不实现实时多人协作或 CRDT。
- 不实现插件市场、计费或企业权限扩张。
- 不一次性制作数百个模板。
- 不自动发布、部署、迁移或连接生产数据库/COS。
- 不推送 GitHub；提交与推送需在总验收后单独决定。

## 风险与降级

- Contracts 未稳定：各 lane 使用集中 adapter，不复制或私改契约。
- HTML 无法结构化：保留预览并返回 unsupported diagnostics，不伪造可编辑性。
- 浏览器/Playwright 不可用：运行纯函数和 DOM fixture 测试，视觉验收标明未验证。
- PPTX 不支持复杂视觉：组件级 raster fallback，并输出 editability report。
- 并行工作树冲突：所有 lane 严格遵守目录所有权，不修改共享 lock/config。

## 状态

approved
