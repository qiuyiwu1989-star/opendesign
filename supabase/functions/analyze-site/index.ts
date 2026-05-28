// 网页美学 · AI Vision 解读 Edge Function
// ----------------------------------------------------------------
// 输入: { url, screenshotUrl, palette[], meta: {title, description, ...} }
// 输出: { spec: { identity, colors, typography, ..., systemPrompt } }
//
// 设计要点：兼容任意 Anthropic-format API（包括 Claude 官方、Anthropic 兼容代理如 MiMo / OpenRouter 等）。
// 通过环境变量切换 provider，代码不动。
//
// 部署:
//   supabase functions deploy analyze-site --no-verify-jwt
//
// 注入密钥（任选一种 provider）:
//
//   # A. Anthropic 官方
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
//   supabase secrets set ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
//
//   # B. 小米 MiMo (Anthropic 兼容代理)
//   supabase secrets set ANTHROPIC_API_KEY=tp-xxxxxxxxxxxxxxxx
//   supabase secrets set ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
//   supabase secrets set ANTHROPIC_MODEL=MiMo-V2.5-Pro
//
//   # C. 其他 Anthropic 兼容代理（OpenRouter, deepbricks 等）
//   supabase secrets set ANTHROPIC_API_KEY=...
//   supabase secrets set ANTHROPIC_BASE_URL=https://...
//   supabase secrets set ANTHROPIC_MODEL=...

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_BASE_URL = (Deno.env.get("ANTHROPIC_BASE_URL") ?? "https://api.anthropic.com").replace(/\/$/, "");
const MODEL = Deno.env.get("ANTHROPIC_MODEL")
  ?? Deno.env.get("CLAUDE_MODEL")
  ?? "claude-sonnet-4-5-20250929";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!ANTHROPIC_API_KEY) {
    return json({
      error: "ANTHROPIC_API_KEY not configured",
      hint: "运行: supabase secrets set ANTHROPIC_API_KEY=...  (Anthropic-format key 即可，包括 MiMo / OpenRouter 等代理的 key)"
    }, 500);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const { url, screenshotUrl, palette = [], meta = {} } = payload || {};
  if (!url || !screenshotUrl) return json({ error: "url + screenshotUrl required" }, 400);

  // 1. 下载截图，转 base64 喂 Claude vision
  let imageBase64: string;
  let mediaType = "image/png";
  try {
    const imgRes = await fetch(screenshotUrl);
    if (!imgRes.ok) throw new Error(`screenshot HTTP ${imgRes.status}`);
    mediaType = imgRes.headers.get("content-type") || mediaType;
    const buf = await imgRes.arrayBuffer();
    imageBase64 = base64FromBuffer(buf);
  } catch (err) {
    return json({ error: `fetch screenshot failed: ${err.message}` }, 502);
  }

  // 2. 构造 prompt —— V2：两段式（先观察再投射），强制 palette 锚定，禁字体品牌猜测，禁品牌联想
  const systemPrompt = `你是一位资深 design system 逆向工程师，专门把网页截图拆成可被 AI 代码工具（Claude / Cursor / v0 / Lovable）直接复用的 token 系统。

# 工作流（必须严格按顺序）

PASS 1 · 在脑中完成（不输出）
用 5 句话纯像素级客观描述你看到的画面：背景色 / nav 形态 / hero 内容 / 主要 section 排列 / 是否有装饰元素。
禁止此时做任何"这是 SaaS / 这家定位高端"之类的推断。

PASS 2 · 输出 JSON
基于 PASS 1 的观察填下方 schema。每个字段都要能追溯回 PASS 1 的具体观察。
看不出 / 不确定的字段填 null —— 我们宁可缺也不要假。

# 硬约束（违反任何一条，输出无效）

1. **颜色只能从我提供的 palette 数组里选**。按明度/饱和度分配语义角色（bg=最亮、ink=最暗、accent=明显高彩度色）。palette 不够覆盖某个 token 就填 null，绝不凭空造 hex 值。
2. **不要猜字体品牌名**。display/body/mono 字段只填"字体类别"：humanist-sans / grotesque-sans / geometric-sans / transitional-serif / didone-serif / slab-serif / mono / display。猜不出填 null。绝不要写 "Inter" / "GT America" / "Söhne" 这种具体名字。
3. **不要从域名、标题、品牌名联想任何字段**。你看到的就是你看到的。
4. **donts 至少 6 条**，每一条必须可在截图里直接反验证。格式："不做 X —— 截图里 Y" 形式。空泛的"不做营销 fluff"不算。
5. **motion / interaction**：静态截图能推断的只填能推断的（如"nav 是 fixed + backdrop blur 暗示 sticky"），无法观察的字段填 null。不要瞎填时长数字。
6. **systemPrompt 字段**：把整套规范压成 1-2 段中文，控制在 250 字内，必须包含：一句话定位 + 关键 hex 颜色 + 字体类别 + 至少 3 条最关键的 don't。
7. **类比要刁钻**：identity.analogy 不要"杂志的话是杂志"这种废话，要给出能让设计师立刻 get 到气质的具体类比（"是 Apartamento 不是 Wallpaper" / "是 1990 年 Helvetica 海报不是 Bauhaus 包豪斯"）。

# Schema（严格遵守字段名和层级）

{
  "identity": {
    "keywords": ["5 个中文关键词，必须能追溯到观察"],
    "analogy": "刁钻具体的类比（中文）",
    "oneLiner": "一句话定位（中文）"
  },
  "colors": {
    "bg": "#HEX 或 null",
    "bgSoft": "#HEX 或 null",
    "bgQuiet": "#HEX 或 null",
    "ink": "#HEX 或 null",
    "inkSoft": "#HEX 或 null",
    "muted": "#HEX 或 null",
    "mutedSoft": "#HEX 或 null",
    "accent": "#HEX 或 null（只有 palette 里出现明显高彩度色才填）",
    "line": "rgba(...) 或 null",
    "principle": "用色原则一句话（中文）"
  },
  "typography": {
    "display": "字体类别 或 null",
    "body": "字体类别 或 null",
    "mono": "mono 或 null",
    "scale": [
      { "token": "display|h1|h2|body|caption",
        "size": 数字（按截图相对比例估算的 px）,
        "lh": 数字（估算 line-height）,
        "weight": 数字（100-900）,
        "ls": "字符串（如 '-1px' 或 '0.06em uppercase'）",
        "use": "中文用法描述" }
    ],
    "rules": ["从截图能直接验证的排版规则"]
  },
  "spacing": {
    "base": 4 或 8,
    "scale": [4, 8, 16, 24, 32, 48, 64, 96 等估算阶],
    "rhythm": "留白节奏一句话（中文）：拥挤 / 适中 / 慷慨 + 节奏说明"
  },
  "surfaces": {
    "radius": { "sm": 数字, "md": 数字, "lg": 数字, "pill": 999 },
    "shadows": ["中文描述阴影使用强度"],
    "borders": "中文描述边线使用方式"
  },
  "layout": {
    "container": 估算的主内容最大宽度 px,
    "paragraph": 估算的段落最大宽度 px,
    "columns": 估算列数,
    "gutter": 估算 px,
    "breakpoints": [常见断点估算],
    "skeleton": "页面骨架中文描述：top → hero → sections → footer"
  },
  "components": {
    "button": "看到按钮就描述形状/颜色/大小特征，看不到填 null",
    "card": "卡片样式 或 null",
    "chip": "chip 样式 或 null",
    "input": "输入框样式 或 null",
    "hero": "首屏 hero 形态（中文）"
  },
  "motion": {
    "durations": { "micro": 数字或 null, "small": 数字或 null, "medium": 数字或 null },
    "easing": "cubic-bezier(...) 或 null",
    "patterns": ["从静态截图能推断的动效线索（如悬停 elevation、scroll reveal 等），看不出就空数组"]
  },
  "interaction": {
    "hover": "从样式线索推断的 hover 行为 或 null",
    "click": "或 null",
    "transition": "或 null",
    "keyboard": "或 null"
  },
  "voice": {
    "tone": "从可见文案推断的语气",
    "headlineStyle": "从标题观察到的写法",
    "ctaStyle": "从可见按钮文字推断的 CTA 风格",
    "avoid": ["从语气推断该网站会避免的写法"]
  },
  "donts": [
    "至少 6 条，每条格式: '不做 X —— 截图里 Y'"
  ],
  "systemPrompt": "250 字内可直接粘进 AI 工具的中文 system prompt"
}

# 高分输出范例（calibration）

观察一个全白底、衬线斜体大标题、产品摄影主导的页面，期望产出类似：

{
  "identity": {
    "keywords": ["克制", "产品摄影优先", "暖中性", "衬线 italic", "慷慨留白"],
    "analogy": "杂志的话是 Apartamento × Wallpaper，不是 Vogue",
    "oneLiner": "把硬件当作奢侈品来讲"
  },
  "colors": {
    "bg": "#F7F4ED", "bgSoft": "#FFFDF8", "ink": "#101010",
    "inkSoft": "#262625", "muted": "#62615D", "accent": null,
    "principle": "暖纸 #F7F4ED + ink #101010 占据 80% 画面，不用品牌色做按钮"
  },
  "typography": {
    "display": "transitional-serif",
    "body": "humanist-sans",
    "mono": null,
    "scale": [
      { "token": "display", "size": 96, "lh": 0.95, "weight": 500, "ls": "-2px", "use": "首屏单一标题" }
    ],
    "rules": ["标题斜体、500 weight，永不 600+", "caption 全大写 + 0.06em letter-spacing"]
  },
  "donts": [
    "不做渐变背景 —— 截图全是单色块",
    "不用 emoji —— hero 文案纯文字无 emoji",
    "不用 carousel —— hero 是静态单图",
    "不在 nav 用 backdrop blur —— nav 是纯白实色",
    "标题不超过 5 个英文词 —— 看到的标题就 4 词",
    "不放 testimonial 大头像墙 —— 截图未见用户头像"
  ],
  "systemPrompt": "你是极简产品页面设计师。配色：暖纸 #F7F4ED + ink #101010 + 无 accent；标题用 transitional serif italic 500 weight，正文 humanist sans 400；section padding 96-128px；不用渐变 / 不用 emoji / 不用 carousel / nav 实色无 backdrop blur / 标题不超过 5 词。Hero 是静态产品摄影 + 大字标题压在留白处。"
}

# 输出格式
直接输出 JSON，不要 markdown 代码块包裹，不要任何前后解释文字。第一个字符必须是 {，最后一个字符必须是 }。`;

  const userMessage = [
    {
      type: "image",
      source: { type: "base64", media_type: mediaType, data: imageBase64 }
    },
    {
      type: "text",
      text: `URL: ${url}
Title: ${meta.title || "(无)"}
Description: ${meta.description || "(无)"}
自动抽取的 palette（颜色只能从这里选）: ${palette.length ? palette.join(" / ") : "(无 - colors 字段全填 null)"}

按 system prompt 的工作流和 schema 输出 JSON。`
    }
  ];

  // 3. 调 Anthropic-format endpoint（官方 or 兼容代理，由 ANTHROPIC_BASE_URL 决定）
  let anthropicRes;
  try {
    anthropicRes = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "Authorization": `Bearer ${ANTHROPIC_API_KEY}`,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }]
      })
    });
  } catch (err) {
    return json({ error: `LLM call failed: ${err.message}`, baseUrl: ANTHROPIC_BASE_URL }, 502);
  }

  if (!anthropicRes.ok) {
    const text = await anthropicRes.text();
    return json({ error: `LLM HTTP ${anthropicRes.status}`, detail: text.slice(0, 500), baseUrl: ANTHROPIC_BASE_URL, model: MODEL }, 502);
  }

  const body = await anthropicRes.json();
  const textBlock = (body.content || []).find((b: any) => b.type === "text");
  if (!textBlock) return json({ error: "claude returned no text" }, 502);

  // 4. 解析 JSON（Claude 可能裹 ```json ... ```）
  const raw = textBlock.text.trim();
  const jsonStr = raw.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  let spec;
  try {
    spec = JSON.parse(jsonStr);
  } catch (err) {
    return json({ error: "claude JSON parse failed", raw: raw.slice(0, 500) }, 502);
  }

  return json({ spec, model: MODEL });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

function base64FromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}
