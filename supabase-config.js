// 数据层配置。
//
// 2026-08 已从 Supabase 迁到自建：146 服务器上的 PostgreSQL 18.4 + PostgREST，
// 走 nginx 反代 https://opendesign.cc/db/。数据库和网站同机，PG 只监听 127.0.0.1，
// 权限边界在库里（GRANT + RLS），不在前端——这里的 key 只是占位，泄露也无所谓。
//
// 为什么路径是 /db 而不是 /db/rest/v1：supabase-js SDK 内部会自己拼 `${url}/rest/v1`，
// nginx 那边也按这个路径开的口，所以那 35 处 supabaseClient.from(...) 调用一行没改。
//
// anonKey 保留是因为 SDK 要求非空；nginx 会把 Authorization / apikey 头剥掉，
// 请求一律以数据库的 anon 角色执行。要换回 Supabase 只需把 url/anonKey 改回去。
window.SUPABASE_CONFIG = {
  url: "https://opendesign.cc/db",
  anonKey: "anon-not-used-auth-stripped-at-nginx"
};
