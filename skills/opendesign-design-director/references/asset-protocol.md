# OpenDesign 资产协议

每条收录分别维护四类产物：

1. Preview：可公开展示的主预览图，记录来源、尺寸、生成或采集时间。
2. Spec：结构化设计规范与人类可读说明，含 11 层 token。
3. Pack：可下载 ZIP，包含 spec、真实截图、DESIGN.md 和授权说明。
4. Assets：字体声明、图片、图标、纹理、组件示例及其来源与授权元数据。

状态使用 `ready / missing / stale / failed / unknown`。缺失、过期、失败不得折叠为同一种状态。

交付给其他 Agent 时附带：

- `skill.md` 或 `SKILL.md`
- 参考 slug 与来源 URL
- 使用的 token 与修改过的 token
- 禁用清单
- 资产路径、授权、hash 或 revision
- 可编辑性说明
- QA 结果与遗留问题

图片用于预览不等于可复用授权。无法确认授权时标记为 reference-only，不打入可分发设计包。
