# Supabase 接入指南

整个流程约 **5 分钟**。完成后访客的收藏 / 点赞会真持久化 + 跨设备同步 + 点赞数全局聚合。

代码已经全部写好；你只需要做 4 件事：建项目、跑 SQL、复制凭据、填配置。

---

## 1. 注册并新建项目（约 2 分钟）

1. 打开 https://supabase.com → Sign in（推荐 GitHub 登录）
2. 进入 Dashboard → 点 **New project**
3. 填：
   - **Name**：`style-atlas`（随意）
   - **Database Password**：强密码，记一下（后续大概率用不到，但别丢）
   - **Region**：选 **Southeast Asia (Singapore)** 或 **East Asia (Tokyo)**，对国内访问最快
   - **Pricing Plan**：Free（够用）
4. 点 **Create new project**，等 ~1 分钟项目就绪

---

## 2. 跑 SQL 建表（约 30 秒）

1. 项目 Dashboard 左侧 → **SQL Editor** → **New query**
2. 打开本仓库的 [`supabase/schema.sql`](./supabase/schema.sql)，**整段复制**到 SQL Editor
3. 点右下 **Run**（或 ⌘+Enter）
4. 应看到 `Success. No rows returned`
5. 验证：左侧 **Table Editor** → 应有 `saves` 和 `likes` 两张表

---

## 3. 复制凭据（约 30 秒）

1. 左侧 **Project Settings** → **API**
2. 找到两个值：
   - **Project URL**：形如 `https://xxxxxxxxxxxxx.supabase.co`
   - **Project API keys → anon public**：形如 `eyJhbGc...`（很长）
3. **anon key 是设计给客户端用的公开 key，可以放进 git，没有安全问题。** 不要复制 service_role key（那是密钥，不能放客户端）

---

## 4. 填入 supabase-config.js（约 10 秒）

打开仓库根目录的 [`supabase-config.js`](./supabase-config.js)，把两个值填进去：

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxxxxxxxxxxx.supabase.co",
  anonKey: "eyJhbGc..."
};
```

保存。

---

## 5. 刷新页面验证

打开 http://127.0.0.1:4174/（或你的部署地址）：

1. 开浏览器控制台（⌥⌘I → Console）
2. **没有** `[supabase] ...` 报错 → 配置正确
3. 点几个心形收藏 / 点赞
4. 去 Supabase Dashboard → **Table Editor** → `saves` 或 `likes` 应看到新行
5. 在另一台设备（或无痕窗口）打开同一个网址 —— 你会看到**全局点赞数**已经更新

---

## 失败时怎么办

- **控制台报 `CORS` 错误**：项目 URL 填错了，回 step 3 重新复制
- **控制台报 `401 / new row violates row-level security`**：SQL 没跑完整，回 step 2 重新粘并 Run
- **不想接 Supabase 了**：把 `supabase-config.js` 里两个值清空即可，自动降级到 localStorage（功能不丢，但没有云端同步和聚合计数）

---

## 后续会怎么用这套数据

- **下一步**：每个网站详情显示**全网总收藏数 / 总点赞数**（hot 排序的素材）
- **再下一步**：owner 模式接入 `submissions` 表，新条目直接入 Supabase 不再走 sites.js git commit
- **再再下一步**：替换截图托管（Supabase Storage 代替 R2 / mshots）
