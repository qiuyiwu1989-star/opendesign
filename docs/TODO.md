# 待办清单

> 2026-08-05 对账后整理。分成「只有你能做」和「我能做」两类。

## 🔴 只有你能做(需要凭证/权限/决策)

### 1. 跑 Supabase 安全迁移 ⚠️ 最紧急
文件:`supabase/migrations/0009_lockdown_anon_writes.sql`

**现在的风险**:任何人拿浏览器 DevTools 里就能看到的 anon key,发一条 curl 就能清空全站所有人的收藏和点赞;`sync_codes` 全表可读可改,意味着可以接管任意用户的收藏夹。

**做法**:Supabase Dashboard → SQL Editor → New query → 整段粘贴 → Run。重复执行安全。

跑完之后**告诉我**,我要改前端调用方式(现在前端还在用会被这个迁移收回的直接 DELETE,跑完迁移后"取消收藏"的云端同步会暂时失效,本地不受影响)。

### 2. npm publish
文件:`mcp/PUBLISHING.md`(完整步骤)

```bash
cd mcp && npm login && npm publish --access public
```
包已经验证过:4 文件 10.5kB、`lib/` 在包内、真机装 tarball 冒烟通过。

### 3. 提交 MCP 目录
文件:`mcp/DIRECTORY-SUBMISSIONS.md`(6 个目录的逐个步骤 + 可复制素材)

必须在 npm publish **之后**(多数目录要求包已在 npm)。官方注册表要 GitHub OAuth 登录验证命名空间归属,只能你来。

### 4. 发文章
文件:`docs/launch/`(英文版 / 中文版 / checklist)

顺序:npm publish → 提交目录 → 发文(文章里写了 `npx -y opendesign-mcp`,发文时它必须真能跑)。

### 5. 轮换聊天里出现过的凭证 🔒
这些在对话里以明文出现过,应当作已泄露处理:

- 新服务器 `ubuntu` 密码(密钥登录已配好,可直接禁用密码登录)
- 旧服务器 root 密码
- `RUNNER_TOKEN`(Supabase `app_config` 表里改)
- mimo API key(`tp-` 开头那个,mimo 后台 rotate)
- admin 口令(`app_config.admin_passphrase`)

### 6. 决定:内容管线要不要重新开起来
三个 systemd timer(jobrunner / publisher / cos-sync)还是你当初要求的**暂停**状态。

- 现状:队列已清空,不开也不会有积压
- 开了会怎样:`discover.py` 每天爬新候选 → `auto-evaluate` 自动评分 → 高分自动收录(每天上限 10 站,约 $1/天)
- 这轮修完的东西:预算记账、死站重试、schema 剪枝、探活误杀、锁竞争,都是为了让它开着不出事
- **2026-08-05 补**:顺带发现服务器上整个 `extract/` 目录缺失(迁移时 rsync 漏了),
  意味着 Tier-2 出完整包链路(`upgrade-pack.sh` → `extract/extract.py`)本来是断的
  ——管线暂停着所以没暴露,你一旦重开,upgrade 任务会全部失败。**已补回并验证。**

要开的话告诉我,我来 `systemctl enable --now`。

---

## 🟢 我能做的(说一声就动手)

### 高价值
- **语义检索(embedding)** — 现在 `search_designs` 是关键词打分。"trustworthy" 这种词在设计元数据里根本不出现,字面匹配几乎无意义。做法:构建期算好离线 embedding(零运行时依赖),检索按语义相似度排。这是检索精准度的下一个台阶。
- **用真 tokens 重做美学家族** — 现在的 5 个家族是手写 tag 规则(`clean` 一个词占了半个库,分类必然粗糙)。真正该做的是从 `spec.json` 里已有的对比度/色相数/字阶跨度/圆角/动效时长做聚类。**这是只有这个数据集能做的事**,也是"推荐"从关键词匹配进化成品味判断的关键一步。

### 中等
- **质量分层** — 1,486 站不等值。加一个"编辑推荐"tier,让 Agent 优先看策展过的。策展本身就是产品的一部分。
- **thumbs 备份策略** — 943 张缩略图(23MB)现在只在服务器上,`.gitignore` 排除了。可再生(脚本+COS 源图),但重跑要几小时。要不要进 git 是个取舍,你定。
- **SEO 孤儿页清理** — 下架的站,它的 `/{lang}/sites/<slug>` 静态页还留在服务器上(build 只增不删),和 sitemap 不一致。

### 小
- `docs/ai-agent-integration.md` 严重过时(还写着"5 个 pack 就绪",且只字未提 MCP)
- "11 层 spec" vs "8 章 DESIGN.md" 两套口径贯穿多个文件,该统一一次
- `mcp/opendesign_mcp.py`(Python 版)只有 4 个工具且下载 6.4MB 数据,建议标 deprecated 或补齐

---

## ✅ 已完成(本轮)

- 949 站数据收回 git(此前只在服务器单点存放,零备份)
- 服务器目录转成真正的 git checkout(此前 rsync 没带 `.git`,漂移不可见)
- 30+ 项 bug 修复(4 个安全 P0、MCP 崩溃洞、33% 库对 Agent 隐形、探活误杀 368 站)
- 检索精准度:tag 归一化、summary 换高信号字段、同义词层、未命中诚实反馈、**tokens 完整度进 catalog**
- npm 包 + MCP 目录材料 + 发布文章(中英)+ README 重写
- 定位文档(`docs/positioning.md`)+ 经验沉淀(`docs/lessons-2026-08.md`)
