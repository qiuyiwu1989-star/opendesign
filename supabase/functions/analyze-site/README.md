# analyze-site Edge Function

把网页截图喂给视觉模型，输出 11 层设计系统 JSON。

支持任意 **Anthropic-format API**：
- Anthropic 官方 Claude
- 小米 MiMo 代理 (`token-plan-cn.xiaomimimo.com/anthropic`)
- OpenRouter / deepbricks 等其他 Anthropic 兼容代理

切换 provider 只改环境变量，代码不动。

---

## 部署前你需要

1. 装 [Supabase CLI](https://supabase.com/docs/guides/cli)（一行命令）
2. 准备好 API key（任选一种 provider）

## 1. 装 CLI 并登录

```bash
brew install supabase/tap/supabase
supabase login
```

## 2. 链接到你的项目

仓库根目录跑：

```bash
supabase link --project-ref nlsvjigoltvyfpqsbygh
```

## 3. ⭐ **先在本地 curl 测一下 provider 通不通**

部署前自己跑一遍，确认 key + endpoint + 模型 vision 都 OK。这一步**强烈推荐**，免得部署后还要回头查问题。

### 选 A：Anthropic 官方

```bash
KEY="sk-ant-xxxxxxxxxxxx"

curl -s -X POST "https://api.anthropic.com/v1/messages" \
  -H "x-api-key: $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 100,
    "messages": [{"role":"user","content":"用一句中文回答你是谁"}]
  }' | jq .
```

### 选 B：小米 MiMo（Anthropic 兼容代理）

```bash
KEY="tp-xxxxxxxxxxxxxxxx"
BASE="https://token-plan-cn.xiaomimimo.com/anthropic"

# 基础文本
curl -s -X POST "$BASE/v1/messages" \
  -H "x-api-key: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiMo-V2.5-Pro",
    "max_tokens": 100,
    "messages": [{"role":"user","content":"用一句中文回答你是谁"}]
  }' | jq .

# 看图测试（关键 —— vision 能力验证）
curl -s -X POST "$BASE/v1/messages" \
  -H "x-api-key: $KEY" \
  -H "Authorization: Bearer $KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MiMo-V2.5-Pro",
    "max_tokens": 200,
    "messages": [{"role":"user","content":[
      {"type":"image","source":{"type":"url","url":"https://iad.microlink.io/-WXCr_JwHkf2C1tPujDQCYamrH14Utwzff0aoHjLLZI5apo1pBlr03zxkQRZt88vIMPOtXlrXQqDLQdqTYERHA.png"}},
      {"type":"text","text":"用三个中文形容词概括这张截图的设计气质"}
    ]}]
  }' | jq .
```

**如果图测返回的内容确实在描述截图本身**，说明 MiMo-V2.5-Pro 支持 vision，继续。
**如果返回错误或说看不到图**，换 `MiMo-V2-Omni` 试一次（"Omni" 表示多模态）。

---

## 4. 注入凭据到 Supabase secrets

根据你选的 provider 跑对应一组。

### A. Anthropic 官方
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
```

### B. 小米 MiMo（vision-capable）
```bash
supabase secrets set ANTHROPIC_API_KEY=<your-mimo-tp-key>
supabase secrets set ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
supabase secrets set ANTHROPIC_MODEL=mimo-v2.5
```

> **不要**把 key 提交到 git。Secrets 注入到 Supabase 的服务端环境，前端 anon key 调函数时不会看到。
> 用小写 `mimo-v2.5` 或 `mimo-v2-omni`（这两个是 vision-capable）；大写的 `MiMo-V2.5-Pro` 会返回 "Not supported model"。

## 5. 部署

```bash
supabase functions deploy analyze-site --no-verify-jwt
```

`--no-verify-jwt` 让前端的 anon key 也能调用。

## 6. 端到端验证

```bash
URL="https://nlsvjigoltvyfpqsbygh.supabase.co"
ANON="sb_publishable_e3rcpZdJG8e15iOrWOJQTA_dy3Zbgul"

curl -s -X POST "$URL/functions/v1/analyze-site" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{
    "url":"https://lusion.co",
    "screenshotUrl":"https://iad.microlink.io/-WXCr_JwHkf2C1tPujDQCYamrH14Utwzff0aoHjLLZI5apo1pBlr03zxkQRZt88vIMPOtXlrXQqDLQdqTYERHA.png",
    "palette":["#000000","#ffffff","#ff4500"],
    "meta":{"title":"Lusion","description":"3D and Interactive Web Studio"}
  }' | jq .
```

应该返回 `{ "spec": {...}, "model": "MiMo-V2.5-Pro" }`，spec 11 个字段全填。

## 7. 接通后前端会发生什么

完全不用改前端 —— `app.js` 里的 `analyzeWithAI()` 已经按这个 endpoint 调用。下次有人点「分析」：

- 旧分支：stub 只填颜色
- 新分支：MiMo / Claude 解读截图 → 自动填齐 11 层 spec → MD 直接是完整设计系统规范

---

## 切换 provider

随时切。比如想从 MiMo 换成 Claude 官方：

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
supabase secrets set ANTHROPIC_BASE_URL=https://api.anthropic.com
supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
supabase functions deploy analyze-site --no-verify-jwt   # 不一定需要重部署，secrets 立即生效
```

## 故障排查

- 调用返回 `LLM HTTP 401`：key 错了或被 rotate 了
- 调用返回 `LLM HTTP 404`：base URL 路径不对，检查是不是漏了 `/anthropic` 后缀
- 返回 `claude JSON parse failed`：模型没按 schema 输出，可能不支持 vision 或对中文 JSON 输出能力弱，换更大模型（MiMo-V2.5-Pro → MiMo-V2-Omni）
- 调用慢：vision 模型本来就慢，正常 3-8 秒
