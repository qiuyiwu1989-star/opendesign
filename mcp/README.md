# OpenDesign MCP

把 [opendesign.cc](https://opendesign.cc) 的 100+ 真实站点「grounded 设计系统」接进
**Cursor / Claude Desktop / 任何 MCP 客户端**。

> 当你对 Agent 说"做一个 **Linear 风格**的落地页"，它可以直接 `get_design_system("linear")`
> 拿到 Linear 真实的色板 / 字阶 / 间距 / 圆角 / 动效 tokens —— 不是瞎编，是我们用 Playwright
> 抓真页 + AI grounding 出来的 —— 照着构建同款风格。

数据全部来自线上 opendesign.cc（只读、无需密钥、无需鉴权）。

## 工具

| 工具 | 作用 |
|------|------|
| `list_designs(limit, offset)` | 分页列出库里所有设计系统（slug / 标题 / 标签 / 一句话） |
| `search_designs(query, tags, limit)` | 按关键词/标签搜（如 `"fintech dark"`、`tags=["ai","minimal"]`） |
| `get_design_system(slug)` | **核心**：取某站完整 11 层设计 tokens + 可下载完整包 URL |
| `fetch_design_spec_markdown(slug)` | 取该站 `DESIGN_SPEC.md` 全文（适合整段塞进 prompt） |

## 安装

需要 [uv](https://docs.astral.sh/uv/)（推荐，免装依赖）或 `pip install mcp httpx`。

**Claude Desktop** — 编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```jsonc
{
  "mcpServers": {
    "opendesign": {
      "command": "uv",
      "args": ["run", "/绝对路径/opendesign/mcp/opendesign_mcp.py"]
    }
  }
}
```

**Cursor** — `~/.cursor/mcp.json`（或项目 `.cursor/mcp.json`）用同样的 `opendesign` 块。

没有 uv 就先 `pip install mcp httpx`，把 `"command": "uv", "args": ["run", …]`
换成 `"command": "python3", "args": ["/绝对路径/.../opendesign_mcp.py"]`。

重启客户端即可在工具列表看到 `opendesign`。

## 用法示例（对 Agent 说）

- 「列一下 OpenDesign 里有哪些 AI 产品风格的站」→ `search_designs(tags=["ai"])`
- 「用 Stripe 的设计系统给我做一个定价页」→ `get_design_system("stripe")` → 照 tokens 写
- 「把 teenage-engineering 的设计规范全文给我」→ `fetch_design_spec_markdown("teenage-engineering")`

## 自测（不依赖客户端）

```bash
uv run mcp/opendesign_mcp.py        # stdio 起服务（Ctrl-C 退出）
# 或用官方 Inspector：
npx @modelcontextprotocol/inspector uv run mcp/opendesign_mcp.py
```
