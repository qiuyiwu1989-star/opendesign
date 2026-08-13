# @opendesign/studio-design-director

确定性的 Design Director 编译边界。输入先通过严格 schema 与语义验证，再按版本化 Design Pack 编译为 OpenDesign Structured HTML；输出只有经过 `@opendesign/studio-html-importer` 完整接受后才会标记为 `accepted`。

## Public API

- `compileDesignDirector(value: unknown): DesignDirectorOutput`
- `validateDesignDirectorInput(value: unknown)`
- `validateDesignDirectorOutput(value: unknown)`
- `DesignDirectorInput`、`DesignDirectorOutput`、`DesignDirectorManifest`、`DesignDirectorDiagnostic`
- `designDirectorInputSchema`、`designDirectorOutputSchema`

## Invariants

- 输入与输出契约版本均为 `0.1.0`。
- 同一输入产生逐字节相同的 HTML、manifest 与稳定 ID。
- 每个输入事实点必须绑定已声明的 `sourceId`，输出 manifest 记录完整来源覆盖。
- 未知 Pack、交付物与 Pack 不匹配、超限内容、缺失来源或破坏编辑性的要求一律拒绝。
- 文本只经转义进入 HTML；编译器不执行脚本、不加载远程资产、不持久化结果。
- 生成物必须保留原生文字、可替换资产、可调整 frame 与可重排页面，发布仍需人工确认。
