-- 自建 PostgreSQL 引导:补齐 Supabase 内置、裸 PG 没有的角色体系
--
-- Supabase 帮你预置了 anon / authenticated / service_role 三个角色,以及
-- PostgREST 用的 authenticator。迁到自建 PG 必须自己建,否则所有
-- "grant ... to anon" 和 RLS policy 都会报 role 不存在。
--
-- 角色模型(和 Supabase 一致):
--   authenticator  ← PostgREST 用它连库。NOINHERIT + 无实权,只能 SET ROLE 切换
--   anon           ← 匿名访客。RLS policy 全都针对它写
--
-- 用法(在 146 服务器上):
--   sudo -u postgres psql -d opendesign -v authenticator_pw="<强密码>" -f 0000_bootstrap_roles.sql
--
-- 注意:角色创建必须走 \gexec,不能包在 do $$ $$ 里——psql 变量在 dollar-quoted
-- 块内部不做替换,会原样传成字面量 ":'authenticator_pw'" 然后语法报错(踩过)。

-- ── 角色 ─────────────────────────────────────────────────────────
select 'create role anon nologin'
where not exists (select 1 from pg_roles where rolname = 'anon')
\gexec

select format('create role authenticator login noinherit password %L', :'authenticator_pw')
where not exists (select 1 from pg_roles where rolname = 'authenticator')
\gexec

-- 已存在则同步密码(重复执行安全)
select format('alter role authenticator login noinherit password %L', :'authenticator_pw')
where exists (select 1 from pg_roles where rolname = 'authenticator')
\gexec

-- authenticator 唯一的能力就是切换到 anon(它自己什么都干不了)
grant anon to authenticator;

-- ── Schema 可见性 ────────────────────────────────────────────────
grant usage on schema public to anon;

-- 这里【不】给 anon 任何默认表权限。每张表的 grant 跟着它的 RLS policy 一起走
-- (见 0100_grants.sql),保持"表级 grant 和行级 policy 一一对应",
-- 避免出现"policy 收紧了但 grant 还敞着"这种半吊子状态。
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;

-- PostgREST 需要读 information_schema 来生成 API
grant usage on schema information_schema to anon;
