# 003: Structured HTML 安全导入

## 要什么

把 Studio Foundation v0.2 的声明协议升级为真实导入闭环。设计总监 Skill 生成带 OpenDesign 属性的 HTML；本地 API 将 HTML 作为不可信文本解析，不执行脚本、样式或网络请求；合法页面转换为 Scene IR，保留稳定 ID、Design Pack pin、来源、编辑能力和导出提示。Studio 在 Sources 阶段显示导入结果与逐节点诊断，并打开可继续人工修改的作品。

本阶段同时让本地 Brief 生成 API 写入 Design Pack pin 和 provenance，避免工作台显示了设计包但持久化文档没有证据。

## 导入格式

- 根节点必须声明 contract version、document ID、Design Pack ID/version 和标题。
- 页面节点使用 `data-od-scene-*` 属性声明稳定 ID、顺序、页面角色和布局。
- 元素节点使用 `data-od-element-id`、role、frame、editable capability、PPTX export hint 和 source IDs。
- 文字来自元素文本内容；图片来源只接受 `asset://` 或同源 `/api/assets/` 路径。
- provenance 由调用方作为结构化 sidecar 提供；HTML 只能引用已经声明的 source ID。

## 不做什么

- 不执行 `<script>`、事件处理器、iframe、对象、外部样式、远程字体或任意 JavaScript。
- 不把任意网页或自由 HTML 猜测成 Scene IR。
- 不抓取远程 URL，不连接生产数据库、COS 或第三方素材服务。
- 不实现完整 CSS cascade、动画、响应式布局、SVG、图表或插件。
- 不部署、不迁移、不推送 GitHub。

## 验收清单

- [x] `@opendesign/studio-html-importer` 使用 inert parser，不创建浏览器执行上下文。
- [x] Golden HTML 导入后保留 document/scene/element ID、Pack pin、provenance、frame、文字与编辑能力。
- [x] script、事件属性、危险 URL、未知/缺失节点产生定位 diagnostic；不能静默丢弃。
- [x] 重复 ID、来源越权、Pack 不存在、越界 frame 和非法数值拒绝导入。
- [x] `POST /api/imports/html` 有尺寸上限，仅 accepted 才持久化并建立初始 revision；partial/rejected 都不落盘。
- [x] Brief 生成 API 写入所选 Design Pack pin 与来源，并实际应用该 Pack tokens。
- [x] Studio Sources 阶段可粘贴 HTML、显示 accepted/partial/rejected 与 diagnostics，成功后打开 Scene IR。
- [x] 导入不使用 `dangerouslySetInnerHTML`，也不把输入 HTML 插入 DOM。
- [x] 老项目、现有导出与 v0.2 编辑测试保持兼容。
- [x] 全仓 typecheck、test、build 与 `git diff --check` 通过。
- [x] 未包含凭证、生产数据或大二进制。

## 实现约束

- 使用 `parse5` 直接解析为 AST；它是显式依赖，不能依赖 jsdom 的传递依赖。
- 安全策略默认拒绝；仅解析 OpenDesign allowlist 属性。
- Scene IR 仍是编辑、revision、QA 和导出的唯一事实源。
- Import Result 必须符合现有 `HtmlImportResult` schema。
- Design Pack 必须从版本化本地 catalog 精确解析，不接受只凭 ID 猜版本。

## 状态

done
