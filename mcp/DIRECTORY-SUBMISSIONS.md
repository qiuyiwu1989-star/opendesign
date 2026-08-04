# MCP 目录提交清单

分发的最大杠杆:MCP 目录是用户找服务器的地方。材料已备好,按下面顺序提交。

**前置条件**:先完成 `npm publish`(见 `PUBLISHING.md`)——多数目录要求包已在 npm 上。

---

## 通用素材(各处复制粘贴用)

**名称**:`opendesign`

**一句话**(≤ 100 字符):
> Give your AI agent real design taste — 1,400+ design systems with grounded tokens.

**短描述**(≤ 300 字符):
> 1,400+ curated websites, each with design tokens (color, type scale, spacing, surfaces, layout, motion) extracted from the live site and verified against actual computed styles. Your agent builds from a real reference's ACTUAL values instead of the training-data average that makes every AI page look identical.

**长描述**:
> Every AI coding agent produces the same interface: Inter, a blue-violet gradient, rounded-2xl, a soft shadow on every card. That's not a bug — it's the mathematical average of the training data, and averages have no brand.
>
> OpenDesign fixes this at the point of generation. It's a library of 1,400+ real, shipped websites where each entry carries an 11-layer machine-readable spec — extracted from the live browser and grounded against real `getComputedStyle` values, not an LLM's impression of the site.
>
> The agent workflow: read the design-director protocol → describe the need → get one primary reference plus two alternates from deliberately different aesthetic families → pull that reference's actual tokens → build with those exact values. Every choice traces back to a design real humans shipped.
>
> Free, public, no account, no API key. 920 entries also ship full Playwright screenshot packs.

**标签**:`design` `design-systems` `design-tokens` `frontend` `ui` `css` `creative` `web`

**链接**:
- Homepage: https://opendesign.cc
- MCP page: https://opendesign.cc/mcp/
- Repo: https://github.com/qiuyiwu1989-star/opendesign
- npm: https://www.npmjs.com/package/opendesign-mcp
- 远程端点(零安装): `https://opendesign.cc/mcp/http`

**配置片段**:
```json
{ "mcpServers": { "opendesign": { "command": "npx", "args": ["-y", "opendesign-mcp"] } } }
```
远程版:
```json
{ "mcpServers": { "opendesign": { "url": "https://opendesign.cc/mcp/http" } } }
```

---

## 逐个目录

### 1. 官方注册表 · modelcontextprotocol/registry ⭐ 优先级最高
用 `mcp/server.json`(已写好)。

```bash
# 装官方发布器
npm i -g @modelcontextprotocol/publisher   # 或按仓库 README 最新方式

cd mcp
mcp-publisher login github          # GitHub OAuth,证明你拥有 io.github.qiuyiwu1989-star/*
mcp-publisher publish               # 读同目录的 server.json
```
命名空间 `io.github.qiuyiwu1989-star/opendesign` 与你的 GitHub 账号绑定,登录即可验证所有权。

> 注:官方注册表 CLI 名称/流程仍在演进,提交前先看一眼
> https://github.com/modelcontextprotocol/registry 的当前 README,以那里为准。

### 2. Smithery(https://smithery.ai)
用 `mcp/smithery.yaml`(已写好)。

1. 打开 https://smithery.ai/new,用 GitHub 登录
2. 选 `qiuyiwu1989-star/opendesign` 仓库
3. Smithery 会扫描到 `mcp/smithery.yaml`——若它只在仓库根找,把该文件复制一份到根目录
4. 提交后它会跑一次连接测试(我们的 server 无需任何配置,应直接通过)

### 3. PulseMCP(https://www.pulsemcp.com)
提交表单:https://www.pulsemcp.com/submit
- 填上面的通用素材即可,人工审核,通常几天内收录

### 4. Glama(https://glama.ai/mcp/servers)
自动爬 GitHub 上带 MCP 标识的仓库。加速方式:
- 给 repo 打上 topics:`mcp`、`model-context-protocol`、`mcp-server`
- 也可在 https://glama.ai/mcp/servers 页面手动提交

### 5. mcp.so(https://mcp.so)
https://mcp.so/submit — 填通用素材。

### 6. Awesome MCP Servers(GitHub 列表)
向 https://github.com/punkpeye/awesome-mcp-servers 提 PR,加一行到合适分类
(建议 Art & Culture 或 Developer Tools):

```markdown
- [OpenDesign](https://github.com/qiuyiwu1989-star/opendesign) 🎖️ 📇 ☁️ - 1,400+ real design systems with grounded tokens (color/type/spacing/motion) extracted from live sites — gives agents real design taste instead of the training-data average.
```
(图例按该仓库当前约定核对一下)

---

## 提交后

- [ ] 给 GitHub repo 加 topics:`mcp` `model-context-protocol` `mcp-server` `design-tokens` `design-systems` `ai-agents`
- [ ] repo Description 换成上面的一句话
- [ ] repo Website 填 https://opendesign.cc
- [ ] 各目录收录后,把徽章加进 README

## 提交材料的事实核对(2026-08-04 实测)

| 声称 | 实际 | 出处 |
|---|---|---|
| 1,400+ 站 | 1,486 | `catalog.json` → `count` |
| 完整截图包 | 920 | `has_pack:true` 计数 |
| 7 个工具 | 7 | `tools/list` |
| 11 层 spec | 11 | `docs/11-layer-spec.md` |

**别在材料里写死数字**,库还在长;用 "1,400+" 这种下限表述。
