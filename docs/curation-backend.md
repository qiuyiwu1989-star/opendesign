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
| `admin.html` / `admin.js` | 口令门 triage 看板（读 RPC、标状态、复制命令） |
| `app.js · submitRequest()` | 用户"请求收录" → 写 submissions + 本地 |
| `app.js · renderMyRequests()` | 「我的收藏 → 我请求的」展示 |
| `scripts/ingest.py --auto-publish` | 本地发布一条龙 |
| `supabase-config.js` | 公开 anon key（前端 + 后台共用） |
