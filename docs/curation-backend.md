# Curation Backend · 提交 → 审核 → 上架 闭环

> 用户怎么"推荐"一个站、你怎么在后台"审"、怎么"发"到广场 —— 这份是操作手册，不是介绍。
>
> 配套：`curator-workflow.md`（你主动收录的命令行流程）· `supabase.md`（DB 配置）

---

## 模型：需求驱动的策展

我们**不做公开投稿**。理由：开放投稿稀释质量、带来审核负担、信号还容易造假。

取而代之：

```
用户侧（零摩擦）          我们侧（质量在手）            产物
─────────────────       ────────────────────         ──────────
收藏一个已收录的站   →   （热度 +1，排行用）
推荐一个没收录的站   →   submissions 队列  →  /admin 审  →  本地 ingest  →  广场
   ↓                         ↓
本地 od-requests          按需求排行
（自己立刻看得到）        （几人推荐 · 几次）
```

- **收藏**是用户为自己做的事 → 它产生的是诚实的"显示性偏好"，比投稿表单可信。
- **广场只展示我们发布的**（`build.py` 只发 `status=completed` 的站）。
- 质量决策权 100% 在我们手里。

---

## 一次性配置（必做，否则后台/队列不工作）

### 1) 应用 SQL 迁移

打开 **Supabase Dashboard → SQL Editor → New query**，把 `supabase/migrations/0003_submissions.sql` **整段**粘进去 → **Run**。

它创建：
- `submissions` 表（anon 只能 insert，不能 select/update/delete）
- 私有 `app_config` 表（存 admin 口令，anon 完全读不到）
- 两个 `security definer` RPC：`admin_list_submissions(p_pass)` / `admin_update_status(p_pass, p_id, p_status)`（口令校验后绕 RLS 读写）

重复执行安全（`if not exists` / `on conflict do nothing` 兜底）。

### 2) 改掉默认口令（重要）

```sql
update public.app_config set value = '你的强口令' where key = 'admin_passphrase';
```

默认种的是 `CHANGE-ME-opendesign-2026`，**务必换掉**。口令只在你登录 `/admin` 时输入，存浏览器 `sessionStorage`，不进 git、不上传。

### 3) 验证

```sql
select * from public.submissions;   -- 能查到用户提交的请求即 OK
```

> **跑 SQL 之前会怎样**：用户提交只进本地 `od-requests`（自己看得到），云端写入静默失败、不报错；`/admin` 显示"加载失败"。跑完即全通。

---

## 日常：在 /admin 审 → 本地发布

### Step 1 · 打开后台

访问 **`https://opendesign.cc/admin.html`** → 输入口令 → 进队列。

> `/admin` 已在 `robots.txt` 屏蔽、页面带 `noindex`，不会被搜索引擎收录。

看到的是**按需求排行**的请求列表：网站 · `几人推荐 · 几次` · 提交时间 · 状态。
顶部可按 待处理 / 已接受 / 已发布 / 已拒绝 / 全部 过滤。

### Step 2 · 决策

| 操作 | 做什么 |
|------|--------|
| **接受 + 复制命令** | 把状态标 `accepted`，并**自动复制**该站的本地收录命令到剪贴板 |
| **拒绝** | 标 `rejected`（不符合收录标准的） |
| **标已发布** | 本地跑完命令、站已上广场后，回来标 `published` 闭环 |

### Step 3 · 本地发布（钥匙不上服务器，所以这步在本地跑）

把"接受"复制的命令粘到**本地终端**：

```bash
# 命令长这样（接受时已自动填好 url + title）：
export ANTHROPIC_API_KEY=tp-你的-mimo-key
export ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
export ANTHROPIC_MODEL=mimo-v2.5

python3 scripts/ingest.py "https://被推荐的站.com" --auto-publish --title "站名"
```

`--auto-publish` 一条龙做完（≈ 90 秒）：

```
mimo 分析（11 层 spec + 5 语言 desc/narrative）
  → validate-sites.py --strict      （schema 校验，错了就停）
  → quality-check.py --auto-quarantine（质量门，差的自动隔离成 needs_review）
  → build.py                         （出 SEO HTML × 5 语言 + DESIGN.md + DESIGN_SPEC）
  → git add / commit / push
  → deploy.sh                        （推 nginx，SKIP_BUILD 复用上面 build）
```

完成后该站 live：`opendesign.cc/{lang}/sites/{slug}`（× 5 语言、带 SEO）+ `/packs/{slug}/` 出 DESIGN.md。

### Step 4 · 回后台标「已发布」

回 `/admin`，给那条记录点 **「标已发布」**。闭环完成。

---

## 全链路一图

```
┌─ 用户 ─────────────┐      ┌─ Supabase ──────────┐      ┌─ 你（本地）──────────┐
│ 收录框推荐 URL      │─────▶│ submissions(pending) │      │                      │
│ od-requests 本地留痕│      │ (anon insert only)   │      │                      │
└────────────────────┘      └──────────┬───────────┘      │                      │
                                        │ admin_list_submissions(pass)            │
                            ┌───────────▼───────────┐      │                      │
                            │ /admin.html 看板       │      │                      │
                            │  接受 → 复制 ingest 命令 │─────▶│ ingest.py --auto-    │
                            │  拒绝 / 标已发布         │◀──── │   publish（90s 一条龙）│
                            └────────────────────────┘ 标   └──────────┬───────────┘
                                                       published        │ deploy
                                                                ┌───────▼────────┐
                                                                │ opendesign.cc   │
                                                                │ 广场 + SEO + pack│
                                                                └─────────────────┘
```

---

## 自动发现 → 一键收录（爬虫 + 任务队列）

上面是「用户推荐 → 你审」的被动流。另有一条**主动**流：爬虫定期全网找有设计感的站，进「发现队列」，你点一下就走完整包管线。

```
①发现(全自动)              ②审阅(你)             ③收录(你点)          ④上线(一键)
─────────────             ──────────           ──────────          ──────────
服务器每天09:30 cron        后台「发现队列」        点「收录」           本地 bash scripts/drain.sh
discover.py 爬 HN(多源)  →  缩略图+热度,收录/忽略 → collect 任务入队  →  跑完队列(升级/收录/刷新)→ 上线
(benign:只读+写队列,不花钱)                                            (人在环,scp部署,仓库canonical)
```

**为什么发现能全自动、收录不能**：发现只读 HN API + 写队列，benign → 服务器 cron 放行。收录会跑 mimo（花钱）+ 部署 → 留「你跑一行 drain」的人工触发点（全自动 prod cron 会被安全护栏拦，也该拦）。

### 一次性配置
1. 应用 `0005_jobs.sql`（任务队列）+ `0006_discoveries.sql`（发现队列）—— SQL Editor 粘贴 Run。
2. 本地建 `~/.opendesign-runner.env`（`chmod 600`，**不进 git**）：
   ```bash
   SB_URL=https://<proj>.supabase.co
   SB_ANON_KEY=sb_publishable_xxx          # 公开 key，安全
   RUNNER_TOKEN=<app_config.runner_token>  # scoped，drain 领活用
   ANTHROPIC_API_KEY=tp-xxx                # 跑 升级/收录(mimo) 才需要
   ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
   ANTHROPIC_MODEL=mimo-v2.5
   ```
3. 服务器发现 cron（已装）：`30 9 * * * /home/ubuntu/opendesign/scripts/cron-discover.sh`，日志 `~/discover.log`。
   手动触发发现：本地 `python3 scripts/discover.py`（`--dry-run` 只看不写）。

### 日常
1. 瞄一眼 `/admin.html` →「发现队列 · 待收录」(缩略图 + 来源 + HN 热度)。
2. 看上的点 **「收录」**(写一条 `collect` 任务) / 不行点 **「忽略」**。站点管理里也能点 **「升级」**(Tier-1→Tier-2) / **「刷新主图」**。
3. 本地一行 **`bash scripts/drain.sh`** → 把队列里点过的任务全跑完上线（升级/收录跑 Playwright+mimo→Tier-2；刷新只换主图）。
   - 没配 mimo key 时：刷新照常；升级/收录优雅失败（等你填 key）。

---

## 安全 & 已知限制（MVP 取舍）

- **口令明文比对、无限速** → 可经公开 RPC 暴力破解。靠**强口令**缓解。真正限速需服务端状态，后续可加。
- **submissions 匿名可插，`host`/`visitor_id` 客户端填** → 需求计数可刷、可灌水。反正广场只发我们人工审过的，信号污染不影响最终质量；以后可加去重/限速。
- **后台渲染已做 HTML 转义**（`esc()` / `safeHref()`），用户提交的 `note`/`url` 不会在你开 `/admin` 时执行（防存储型 XSS）。
- **mimo / service_role / sbp 密钥永不进 git、永不上服务器**；本地从环境变量读。`sb_publishable_*` 是公开 key（RLS 保证安全），可提交。

---

## 文件索引

| 文件 | 作用 |
|------|------|
| `supabase/migrations/0003_submissions.sql` | submissions 表 + app_config + admin RPC |
| `supabase/migrations/0004_pack_requests.sql` | 完整包请求(kind=pack) |
| `supabase/migrations/0005_jobs.sql` | 任务队列 jobs + runner_token + 入队/领活 RPC |
| `supabase/migrations/0006_discoveries.sql` | 发现队列 discoveries + 爬虫写入/审阅 RPC |
| `admin.html` / `admin.js` | 口令门后台（总览 / 站点管理 / 任务队列 / 发现队列 / 收录请求） |
| `scripts/discover.py` | 全网发现爬虫（HN 多源 + 去重）→ 发现队列 |
| `scripts/job_runner.py` | 领任务队列的活并执行（upgrade / collect / refresh） |
| `scripts/drain.sh` | 一键 drain：本地把队列跑完上线（人在环、不碰 prod cron） |
| `scripts/cron-discover.sh` / `cron-jobrunner.sh` | 服务器 cron 包装（发现已装；任务用 drain 代替自动 cron） |
| `scripts/upgrade-pack.sh` | 任意站升 Tier-2 grounded 完整包（Playwright + mimo） |
| `app.js · submitRequest()` | 用户"请求收录" → 写 submissions + 本地 |
| `scripts/ingest.py --auto-publish` | 本地发布一条龙 |
| `supabase-config.js` | 公开 anon key（前端 + 后台共用） |
