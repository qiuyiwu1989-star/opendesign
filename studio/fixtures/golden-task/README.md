# Studio Foundation v0.2 Golden Task

`design-studio-brief-v01.json` 是一个完全离线、项目自有内容的验收输入。它同时提供 Sources、品牌说明、预期大纲、三种 Design Pack 方向与基于任务约束的选择判断。

## 使用方式

1. Sources 阶段只读取内联 `content`；`fixture://` 是证据标识，不是待抓取 URL。
2. Outline 阶段保留 `sourceIds`，不得补造市场数字。
3. Direction 阶段展示三个方向，但默认选择 `direction-proposal`。
4. Studio 阶段生成 pin `executive-proposal-cn@1.0.0` 的 Structured HTML，再安全导入 Scene IR。
5. 至少完成一次人工 patch、revision、QA 与 HTML/PPTX/PNG 导出预检。

此 fixture 不包含字体、图片或其他二进制资产。`asset://` 素材由受控资产解析器处理；本任务默认使用文本 Logo 与原生 Shape，因此无需网络。
