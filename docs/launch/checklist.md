# 发布清单

长文两版已写好:[英文](post-en.md) · [中文](post-zh.md)。下面是各平台的短文案和发布顺序。

## 顺序(重要)

1. **先 npm publish**(见 [mcp/PUBLISHING.md](../../mcp/PUBLISHING.md))——文章里写了 `npx -y opendesign-mcp`,发文时它必须真能跑
2. **再提交 MCP 目录**(见 [mcp/DIRECTORY-SUBMISSIONS.md](../../mcp/DIRECTORY-SUBMISSIONS.md))——目录收录要几天,先提交后发文,发文时正好被搜到
3. **最后发文**

发文前最后确认一遍:远程端点活着、npx 能跑、README 数字和现实一致。

```bash
curl -s https://opendesign.cc/mcp/http/health
npx -y opendesign-mcp <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 200
curl -s https://opendesign.cc/catalog.json | python3 -c "import json,sys; print(json.load(sys.stdin)['count'])"
```

---

## Hacker News

**标题**(HN 讨厌营销腔,越平实越好):
```
Show HN: OpenDesign – 1,486 design systems with real extracted tokens, as MCP
```

**首条评论**(HN 惯例,作者自己补充背景):
> Author here. The thing I found most surprising building this: if you let a vision model produce the token *values*, you're back to the same problem — it produces plausible-but-wrong numbers. The model has to be constrained to *explaining* measurements it isn't allowed to contradict. Playwright reads getComputedStyle off the real DOM, aggregates by frequency, and that's the ground truth.
>
> Open about the gaps: retrieval is still keyword scoring rather than embeddings, and the "aesthetic families" used for diversifying recommendations are hand-written tag rules — the honest version clusters on the measured tokens themselves (contrast, hue count, type-scale range, motion durations), which is the next piece of work.
>
> Free and public, no account. Happy to answer anything.

**发布时段**:美东时间工作日 8-10am(北京时间 20:00-22:00)。

## X / Twitter

```
Every AI-generated landing page looks the same: Inter, a blue-violet
gradient, rounded-2xl, soft shadows.

That's not laziness — it's the training data's average. And an average
can't be anyone's brand.

So I extracted real tokens from 1,486 shipped sites with Playwright
+ getComputedStyle, and put it behind MCP:

{ "opendesign": { "url": "https://opendesign.cc/mcp/http" } }

Your agent picks a real reference and builds from its ACTUAL hex values,
not from memory. Free, no account.
```

## 即刻

```
所有 AI 做出来的落地页都长一样:Inter、蓝紫渐变、满屏圆角、卡片阴影。

这不是模型偷懒,是算术——它输出的是训练数据的平均值,而平均值天然不可能
是任何人的品牌。

prompt 也救不了:「做得高级点」不可执行,丢截图只能得到印象(那个黑到底是
#08090A 还是 #0A0A0A?),让模型"参考 Linear"它给的是记忆,而盗版感就是
一堆"接近"堆出来的。

所以我用 Playwright 驱动真浏览器,把 1,486 个真实站点的 getComputedStyle
实测出来,做成机器可读的 11 层规范,接到 MCP 上。Agent 挑一个真参照,用它
的实际数值来做,而不是靠回忆。

免费公开不用注册 → opendesign.cc
```

## V2EX(分享创造节点)

标题:`[分享创造] OpenDesign - 把 1486 个网站的设计系统实测成 tokens,做成 MCP 给 AI 用`

正文用[中文长文](post-zh.md)的删节版:问题 → 为什么 prompt 不行 → 做法 → 接入方式 → 未解决的部分。V2EX 读者技术密度高,**「还没解决的部分」那节别删**,那是可信度来源。

## 公众号 / 少数派

直接用[中文长文](post-zh.md)全文,补一张首页截图和一段 Cursor 里调用的录屏。

---

## 发布后

- [ ] 盯 GitHub issue 和各平台评论,当天回复(发布日的回复率决定第二天的曝光)
- [ ] 收集「它在我这儿崩了」的反馈——这是最有价值的输入
- [ ] 一周后看 `catalog.json` / `/mcp/http` 的 nginx 访问日志,统计真实 Agent 调用量(北极星指标,见 [positioning.md](../positioning.md))

## 别做的事

- 别在标题里写「革命性」「颠覆」——这套受众对营销腔免疫,反而扣分
- 别隐藏局限。「还没解决的部分」那一节是可信度的来源,不是弱点
- 别刷 star。冷启动慢没关系,虚假信号会毁掉长期口碑
