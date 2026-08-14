# OpenDesign · 第一性原理定位

> 2026-08 全面复盘时写下，2026-08-12 接管更新。回答两个问题：
> 公共设计资源库应该是什么？Studio 如何在不削弱开放生态的前提下成为第一方应用？

---

## 一、从第一性原理推导

**事实 1**:世界上的设计品味,物化在已上线的网站里。这些品味对人可见、对机器不可见——锁在像素里。

**事实 2**:新界面的生产权正在移交给 AI 编程 Agent(Cursor/Claude/v0/Lovable)。但 Agent 的默认输出是训练数据的均值——Inter + 蓝渐变 + rounded-2xl,即"slop"。**品味成了 AI 生产界面的最大瓶颈。**

**事实 3**:解决品味瓶颈,靠 prompt 里写"好看点"没用(不可执行),靠喂截图也没用(不可验证)。唯一可靠的办法是:**在生成的那一刻,把一个真实设计系统的可验证 tokens 灌进 Agent 的上下文。**

由此推出 OpenDesign 的本质:

> **OpenDesign 不是"设计灵感网站",是"品味的基础设施"——**
> **把人类已验证的设计品味,转译成机器可读、可验证、可复用的形式,**
> **并在 Agent 工作的地方(MCP/skill.md)即插即用地供给。**

一句话定位(对外):**The taste layer for AI-built software.**
一句话定位(对内):给任何 Agent 即插即用的"品味外挂"。

## 产品结构：从双层产品升级为 Agent Design OS

- **OpenDesign Library / Evidence Plane**：开放的设计证据基础设施，负责真实设计系统、来源、tokens、Pattern、受许可资产和策展。
- **Capability Registry**：把 Design Pack、专家 Skill、Industry Kit、Tool Adapter 和 Eval Suite 注册为版本化能力。
- **OpenDesign Studio / Creation Plane**：Design Director 组织专家方法，把 Brief 和资料变成可编辑、可评审、可导出的作品。
- **Runtime Plane**：以 provider-neutral adapter 调度 Kimi、OpenAI-compatible 模型、图像模型、浏览器、renderer 和存储。
- **Connect / Platform Plane**：通过 Skill、MCP、API、Webhook 和 Embed Review 让第三方 Agent 与产品复用同一能力。

Library 和 Studio 继续分开部署、分开数据权限。Studio 消费 Library 的公开协议，不把公共设计资产锁进第一方产品；第三方 Agent 也能直接使用 Registry 和 Connect。

完整升级定义见 [Agent Design OS v1](../specs/007-agent-design-operating-system.md)。


"设计总监"的原始愿景在这个框架里是准确的,但要拆开看:设计总监的价值 = 判断力 + 参照系 + 落地能力。**判断力来自调用方的大模型(它们已经很强),OpenDesign 供给的是后两者**——1,400+ 个真实参照系,和每个参照系可直接执行的 11 层 tokens。skill.md 的作用是把三者组装成一个完整的总监人格。

## 二、真正的护城河是什么(以及不是什么)

| 是护城河 | 为什么 |
|---|---|
| **Grounded tokens 资产** | 1,400+ 站 × 11 层 spec,从真实浏览器 computed styles 抽取并验证。awwwards/godly 只有链接和截图;这里有可执行的数据。复制它需要重跑整条抽取管线。 |
| **Agent-native 分发** | skill.md 协议 + 远程 MCP + 全静态 JSON 三层接入,是"为 Agent 而建"而不是"顺便给 Agent 用"。先发卡位。 |
| **抽取管线本身** | ~$0.10/站的边际成本,可持续扩库、可整库重刷。资产会持续增值。 |

| 不是护城河 | 结论 |
|---|---|
| 站点列表本身 | 任何人都能爬一份列表。别把"收录了多少站"当核心 KPI。 |
| 网站前端 | 画布再漂亮,Agent 不看。前端是给人类策展人和口碑传播用的。 |

## 三、北极星指标

**Library：每周成功向 Agent 提供可用设计系统的次数。** 统计 MCP tools/call、skill.md 与 catalog.json 的有效调用，并关注调用成功率和 tokens 可用率，不把网站 PV 当核心指标。

**Studio：每周完成并导出视觉作品的项目数。** 只有内容成功走到 HTML、PPTX、PDF、PNG 或文章配图导出，才算真正交付价值。

两层指标共享一个判断：OpenDesign 是否让真实设计品味进入了最终作品，而不只是被浏览。

## 四、路线图(按序,不并行)

### Phase 1 · 可信赖(现在 → 1 个月)
Agent 每一次调用都拿到准确、诚实的结果。这是一切的前提——Agent 生态里坏一次口碑,配置就被删了。
- ✅ 本轮已做:安全洞修复、MCP 崩溃修复、33% 库隐形修复、tag 词表归一化、同义词层、未命中词诚实反馈、summary 换高信号字段、数字口径统一
- ✅ catalog 已有 `spec_completeness`，1,486 条公开记录均可在检索阶段判断 tokens 可用度
- ⬜ 质量分层:1,400 站不等值,给"编辑推荐"tier(策展是产品的一部分)

### Phase 2 · 被发现(1-3 个月)
- ⬜ npm 发布 `opendesign-mcp`(npx 一行接入;package.json 已修好 files 字段)
- ⬜ 提交 MCP 目录:modelcontextprotocol/servers、Smithery、PulseMCP、Glama、mcp.so
- ⬜ 一篇发布文章:「为什么 AI 生成的界面都长一样(以及怎么破)」——HN + V2EX + 即刻
- ⬜ GitHub README 重写为面向 star 的叙事(repo 本身是最大分发渠道)
- ⬜ .cursorrules / CLAUDE.md 模板片段,让用户一行把 OpenDesign 接进自己项目

### Phase 3 · 不可替代(3-6 个月)
- ⬜ 语义检索:离线 embedding(构建期算好,运行时零依赖),`search_designs` 按语义相似度排
- ⬜ 真 token 美学家族:用 spec.json 里的对比度/色相数/字号跨度/圆角/动效时长做聚类,替代手写 tag 表——**这是独家数据才能做的事,也是"推荐"从关键词匹配进化成品味判断的关键**
- ⬜ 反馈闭环:critique 工具的使用信号回流到排名与策展

## 五、克制清单(决定不做的)

1. **不把 Library 变成封闭生成器**。Studio 是第一方调用样板和创作环境；公共数据、Skill 与 MCP 继续开放给其他 Agent。
2. **不做账号/付费墙**。公开、免费、无摩擦是 GEO(生成引擎优化)的燃料;商业化如果有,在数据服务层(API 配额/企业内网部署),不在内容层。
3. **不追站点数量**。1,400 已经够讲故事;下一个数量级的价值在质量分层和检索精准,不在 3,000 站。
4. **公共库不做重前端**。Library 维持静态优先；需要账号、编辑器和异步任务的复杂度全部进入独立 Studio。


## 六、Studio 路线（第一方应用层）

1. 以 Scene IR 作为内容、布局和设计 tokens 的共同源文件，不把 HTML 当唯一源。
2. 第一阶段完成 Brief / Markdown → 6–10 个 Scene → HTML → PNG / PDF / 可编辑 PPTX。
3. 编辑能力分为文字与素材、单页或组件重生成、全局设计 token 三层。
4. 视觉 QA 覆盖溢出、碰撞、裁剪、对比度、层级和导出安全区。
5. Studio 上线不得改变 Library 的公开、免费、Agent-native 分发原则。
