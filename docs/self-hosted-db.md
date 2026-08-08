# 自建数据层（2026-08 起）

OpenDesign 的数据后端已从 Supabase 迁到自己的服务器。这份文档说明**它是怎么搭的、
边界在哪、出事怎么恢复**。

Supabase 时代的接入文档保留在 [supabase.md](supabase.md)，那是历史与回滚参考，
不是当前架构。

---

## 一句话架构

```
浏览器 / curl
     │  https://opendesign.cc/db/rest/v1/...
     ▼
  nginx（146.56.239.22）
     │  剥掉 Authorization / apikey 头
     │  限流 + CORS + no-store
     ▼
  PostgREST  127.0.0.1:3011      ← 只监听本机，永不直面公网
     │  以 db-anon-role = anon 执行
     ▼
  PostgreSQL 18.4  库 opendesign  ← 权限边界在这里：GRANT + RLS
```

**关键点：安全边界在数据库里，不在前端、也不在 PostgREST 进程里。**
前端代码就算被人改了，也越不过 `anon` 这个角色被授予的权限。

---

## 为什么前端一行业务代码都没改

`supabase-js` SDK 内部会把 base URL 拼成 `${url}/rest/v1`。所以只要把
`supabase-config.js` 里的 `url` 改成 `https://opendesign.cc/db`，nginx 那边按
`/db/rest/v1/` 开口，那 35 处 `supabaseClient.from(...)` 调用原样复用。

`anonKey` 保留是因为 SDK 要求非空；nginx 会把 `Authorization` / `apikey` 头**剥掉**——
那不是我们签的 JWT，PostgREST 验签失败会直接 401。剥掉之后请求就以 `anon`
身份执行，正是我们要的匿名访客。所以那个 key 泄露也无所谓，它不是凭据。

---

## 角色模型

| 角色 | 能干什么 |
|---|---|
| `authenticator` | LOGIN、NOINHERIT、**无任何实权**，只能 `SET ROLE` 切到 anon。PostgREST 用它连库 |
| `anon` | 匿名访客的真实身份。所有 RLS policy 都是针对它写的 |

分成两层是 PostgREST 的标准做法：连库的身份和执行的身份分开，
即使连接串泄露，对方拿到的也只是一个什么都干不了的角色。

## 权限边界（可自行验证）

```bash
# 能写
curl -X POST https://opendesign.cc/db/rest/v1/likes \
  -H 'Content-Type: application/json' \
  -d '{"visitor_id":"<uuid>","site_id":"apple"}'          # → 201

# 不能删、不能改
curl -X DELETE 'https://opendesign.cc/db/rest/v1/likes?site_id=eq.apple'
# → 401 {"code":"42501","message":"permission denied for table likes"}

# 投稿只能写不能读
curl 'https://opendesign.cc/db/rest/v1/submissions?select=*'
# → 401 permission denied for table submissions
```

`42501` 是 PostgreSQL 自己的权限拒绝码——说明拦截发生在**数据库**，
而不是某段可以被绕过的应用逻辑。

---

## 备份（迁完之后这是我们自己的责任）

Supabase 时代备份是平台顺手做的；自建之后**没有人做，而且不会有任何报错提醒你**。
现在的闭环：

| 什么 | 脚本 | 频率 |
|---|---|---|
| 每日 dump + 验证 + manifest | `scripts/backup-db.sh` | cron 每天 03:40 |
| 恢复演练（真恢复到临时库逐表核对） | `scripts/restore-drill.sh` | 建议每月 |
| 拉到 Mac 的异地副本 | `scripts/pull-backup.sh` | 手动 |

保留 14 日 + 8 周 + 6 月。备份完会立刻 `pg_restore -l` 验一遍——
**列不出目录的 dump 不叫备份，叫一个文件**；同时落一份 manifest 记录各表行数，
恢复后可以逐表核对，而不是"看着像成功了"。

服务器上的备份和数据库在同一块盘，挡得住误删表、挡不住磁盘挂掉。
`pull-backup.sh` 补的就是那一半。

**恢复手册**写在 `scripts/backup-db.sh` 文件末尾（跟脚本放一起，
免得真出事时还要翻文档）。

---

## 运维速查

```bash
# 服务状态
systemctl status opendesign-postgrest postgresql nginx

# 改了 schema 之后让 PostgREST 重新读
sudo systemctl reload opendesign-postgrest

# 看备份日志
tail -f /var/log/opendesign-backup.log

# 手动跑一次备份
/home/ubuntu/opendesign/scripts/backup-db.sh

# 恢复演练
bash /home/ubuntu/opendesign/scripts/restore-drill.sh
```

凭据在 `~/.opendesign-db.env`（chmod 600），**不进 git**。
配置模板见 `supabase/selfhost/`。

---

## 端口占用备忘

这台机器还跑着其它项目，选端口前先看清楚：

| 端口 | 谁 |
|---|---|
| 3001 | /opt/visit |
| 3002 | /opt/qiuyi |
| 3003 | python3 服务 |
| 3010 | next-server |
| **3011** | **opendesign PostgREST** |
| 8787 | opendesign MCP（Streamable HTTP） |
