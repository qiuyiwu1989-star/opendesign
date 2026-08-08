# 待办清单

> 2026-08-08 更新。分成「只有你能做」和「我能做」两类。

## 🔴 只有你能做(需要凭证/权限/决策)

### 1. ~~跑 Supabase 安全迁移~~ ✅ 已随迁库完成
数据层已于 2026-08 迁到自建 PostgreSQL + PostgREST（见 [self-hosted-db.md](self-hosted-db.md)）。
`0009_lockdown_anon_writes.sql` 的收紧规则已在自建库上生效并**线上验证过**：

- `likes` / `saves`：只能 INSERT，DELETE / PATCH 一律 `42501 permission denied`
- `submissions`：只能 INSERT，连读都不给

`42501` 是 PostgreSQL 自己的权限拒绝码 —— 拦截发生在数据库里，不是某段可绕过的应用逻辑。
随时可复验：`python3 scripts/healthcheck.py`

**Supabase 项目可以关了**（原计划留一周作回滚网，数据已全量迁移 + 每日备份 + 恢复演练通过）。

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
- **新增**:迁移期间在对话里出现过的服务器口令、以及 Supabase 的 service_role JWT
  —— 迁移已完成,这两个都可以立刻作废(具体值不写在这里,见你自己的记录)

### 6. 决定:内容管线要不要重新开起来
三个 systemd timer(jobrunner / publisher / cos-sync)还是你当初要求的**暂停**状态。

- 现状:队列已清空,不开也不会有积压
- 开了会怎样:`discover.py` 每天爬新候选 → `auto-evaluate` 自动评分 → 高分自动收录(每天上限 10 站,约 $1/天)
- 这轮修完的东西:预算记账、死站重试、schema 剪枝、探活误杀、锁竞争,都是为了让它开着不出事
- **2026-08-05 补**:顺带发现服务器上整个 `extract/` 目录缺失(迁移时 rsync 漏了),
  意味着 Tier-2 出完整包链路(`upgrade-pack.sh` → `extract/extract.py`)本来是断的
  ——管线暂停着所以没暴露,你一旦重开,upgrade 任务会全部失败。**已补回并验证。**

要开的话告诉我,我来 `systemctl enable --now`。

**2026-08-08 补**:现在开比之前安全了——部署链路加了完整性硬闸门
(残缺构建推不上线)、数据库有每日备份 + 恢复演练、线上有 `healthcheck.py` 可随时复验。

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
- ~~`docs/ai-agent-integration.md` 过时~~ ✅ 已修(端点表按实测校准)
- ~~"11 层 spec" vs "8 章 DESIGN.md" 口径不一~~ ✅ 已统一:实测后确认 11 层对
  **有完整素材包的 920 站**是真的(填充率 98–100%),全部 1,486 站是 6 层实测 token。
  README / 11-layer-spec.md 都改成分两档说,并给了逐层落地状态表
- `mcp/opendesign_mcp.py`(Python 版)只有 4 个工具且下载 6.4MB 数据,建议标 deprecated 或补齐
- 服务器上 `/home/ubuntu/opendesign` 仓库在 `master` 分支且有本地改动,`git pull` 拉不动,
  更新服务端代码只能逐文件 scp —— 该理一次(已开独立任务)

---

## ✅ 已完成(本轮)

- 949 站数据收回 git(此前只在服务器单点存放,零备份)
- 服务器目录转成真正的 git checkout(此前 rsync 没带 `.git`,漂移不可见)
- 30+ 项 bug 修复(4 个安全 P0、MCP 崩溃洞、33% 库对 Agent 隐形、探活误杀 368 站)
- 检索精准度:tag 归一化、summary 换高信号字段、同义词层、未命中诚实反馈、**tokens 完整度进 catalog**
- npm 包 + MCP 目录材料 + 发布文章(中英)+ README 重写
- 定位文档(`docs/positioning.md`)+ 经验沉淀(`docs/lessons-2026-08.md`)

### 2026-08-08 这一轮
- **数据层完全脱离 Supabase**:自建 PG 18.4 + PostgREST 16.0,前端零业务代码改动
- **备份闭环**(自建后这是我们自己的责任,而且不会有任何报错提醒你):
  每日 dump + `pg_restore -l` 验证 + manifest 行数清单 + 恢复演练(8 张表全对)+ Mac 异地副本
- **部署完整性硬闸门**:dist 条目数低于 sites/ 可发布数 95% 即中止
  —— 起因是当天用 `SKIP_BUILD=1` 把一份 527 条的陈旧构建推上线,全程零报错
- **`/packs/` COS 反代**改运行时 DNS 解析(原来 IP 缓存到进程重启,COS 换 IP 就全站图挂)
- **中文检索**:原来命中 0 条(catalog 全英文标签);加中→英词表 + CJK 最长优先扫描,
  前端的整串 includes 也改成按词 AND
- **噪音清理**:schema 按 status 分档、缩略图脚本无源图时一句话退出
  —— 长期红着的检查等于没有检查
- 五个部署脚本的旧服务器 IP 收口到 `scripts/deploy-target.env`
- 494 个只有 COS 素材的站补上本地缩略图
- 新增 `scripts/healthcheck.py`(28 项线上验证,已接进 `smoke.sh --remote`)
