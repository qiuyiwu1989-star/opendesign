# AI Agent 集成指南

把 OpenDesign 的设计 pack 直接喂给 AI 编码工具。

---

## 核心约定：folder URL 协议

每个收录都暴露一个**目录 URL**：

```
https://opendesign.cc/packs/<slug>/
```

例如：
- `https://opendesign.cc/packs/apple/`
- `https://opendesign.cc/packs/linear/`
- `https://opendesign.cc/packs/stripe-press/`

**这个 URL 的行为**：

| 访问方式 | 返回 |
|---|---|
| GET `/packs/apple/` | `DESIGN_SPEC.md` 内容（8 章规范，含 `:root` CSS 变量）|
| GET `/packs/apple/sites-entry.json` | 11 层 spec JSON |
| GET `/packs/apple/fonts.json` | 实际字体清单 |
| GET `/packs/apple/summary.json` | 真 token 频次数据 |
| GET `/packs/apple/01_desktop_full.png` | 桌面全页截图 |
| GET `/packs/apple/<any-file>` | 直接 serve |
| GET `/packs/apple/` (no index 时) | autoindex 列出全部文件 |

**好处**：

- AI agent 只要一个 URL 就能拿到完整上下文
- Agent 自己决定要不要 fetch 兄弟文件（截图 / json）
- 没有任何"特殊格式"或"约定字段" —— 纯标准 HTTP

---

## 在 Claude / Claude Code 里用

最简单的方式：

```text
用户：
   请按这个 spec 给我生成一个 SaaS 落地页：
   https://opendesign.cc/packs/linear/
   
   我的内容是：[你的产品介绍]

Claude:
   [自动 fetch URL → 读到 Linear 的 :root 变量 / 字体 / 间距 / 禁用清单]
   [按规范生成 HTML + CSS 落地页]
```

进阶 —— 显式拉多个上下文文件：

```text
请综合 OpenDesign 的 Apple 和 Linear 两个 spec，
给我一个产品页设计：

- https://opendesign.cc/packs/apple/      （硬件页气质）
- https://opendesign.cc/packs/linear/     （SaaS 产品 UI 范式）
- https://opendesign.cc/packs/apple/02_desktop_hero.png  （hero 排版参考）
```

---

## 在 Cursor 里用

Cursor 的 `@` 上下文可以接 URL。直接：

```
@https://opendesign.cc/packs/apple/  

请按这个 spec 改我 hero section 的设计
```

Cursor fetch → 读 spec → 改你的 hero。

---

## 在 v0.dev 里用

v0 接受 markdown 作为设计规范。粘整段：

```
https://opendesign.cc/packs/stripe-press/
```

或者直接复制 spec 内容：

```bash
curl https://opendesign.cc/packs/stripe-press/ > spec.md
# 把 spec.md 粘进 v0 的 chat
```

---

## 在你自己的 AI 应用里集成

任何 LLM 调用，把 spec URL 作为 system message 或 tool input：

```python
import requests

slug = "apple"
url = f"https://opendesign.cc/packs/{slug}/"
spec = requests.get(url).text

prompt = f"""
你是一位严格按设计规范工作的前端设计师。
请按以下规范生成新页面：

{spec}

用户需求：[...]
"""
```

或者用 Anthropic / OpenAI 的 tool_use：

```typescript
const tools = [{
  name: "fetch_opendesign_spec",
  description: "Fetch a design system spec from OpenDesign",
  input_schema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Site slug e.g. 'apple', 'linear', 'stripe-press'" }
    }
  }
}];

// Implementation: fetch https://opendesign.cc/packs/{slug}/ and return the spec
```

---

## 已索引的 pack（5 个就绪，剩余补完中）

最新列表见 [packs-index.json](https://opendesign.cc/packs-index.json)。

| Slug | Agent URL | 适合场景 |
|---|---|---|
| `apple` | `/packs/apple/` | 硬件产品页 / 极简产品摄影 / 大字 hero |
| `linear` | `/packs/linear/` | SaaS / Productivity / 暗融化 UI |
| `stripe-press` | `/packs/stripe-press/` | Editorial / 出版物 / 衬线 |
| `lusion` | `/packs/lusion/` | 工作室 / 暗黑 3D / 加载仪式感 |
| `arc` | `/packs/arc/` | 消费品 / 友好暖色 / 手绘装饰 |

---

## 反向：给 OpenDesign 索引你的设计系统

如果你的项目用 OpenDesign 11-layer spec 描述自己的设计系统，可以把 `DESIGN_SPEC.md` 暴露在你域名下：

```
https://yoursite.com/.well-known/design-spec.md
https://yoursite.com/packs/main/
```

这样任何 AI 都可以按相同协议 fetch 你的规范。这是我们想推动的"网页设计可被 AI 直接读"标准化。

---

## 反馈 / 提案

- 觉得 folder URL 还不够好？提 [issue](https://github.com/qiuyiwu1989-star/opendesign/issues)
- 想看到某个 AI 工具直接支持？也提 issue
- 想看到自己网站被 indexed？走 [提名表单](../.github/ISSUE_TEMPLATE/propose-site.yml)
