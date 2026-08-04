-- 0009 · 封死匿名破坏性写入（安全审查发现的两个 P0）
--
-- P0-1: saves/likes 的 DELETE policy 是 using(true)——任何人拿公开 anon key
--        一条 REST 请求就能清空全站所有人的收藏和点赞:
--        DELETE /rest/v1/saves?site_id=neq.__x__
-- P0-2: sync_codes 的 SELECT/UPDATE policy 是 using(true)——可以拖走全表
--        (visitor_id, code) 映射,拿任一 visitor_id 即可接管他人收藏夹。
--
-- 修法:破坏性操作全部收回,只留 security-definer RPC 按 visitor_id 精确匹配。
-- 在 Supabase Dashboard → SQL Editor 整段粘贴 Run。重复执行安全。

-- ── 1. 收回 saves/likes 的裸 DELETE ───────────────────────────────
drop policy if exists "anyone can unsave" on public.saves;
drop policy if exists "anyone can unlike" on public.likes;

-- 删除改走 RPC:只能删自己 visitor_id 名下的记录
create or replace function public.remove_save(p_visitor_id text, p_site_id text)
returns void language sql security definer set search_path = public as $$
  delete from public.saves where visitor_id = p_visitor_id and site_id = p_site_id;
$$;

create or replace function public.remove_like(p_visitor_id text, p_site_id text)
returns void language sql security definer set search_path = public as $$
  delete from public.likes where visitor_id = p_visitor_id and site_id = p_site_id;
$$;

grant execute on function public.remove_save(text, text) to anon;
grant execute on function public.remove_like(text, text) to anon;

-- ── 2. 封死 sync_codes 的全表读和任意改 ──────────────────────────
drop policy if exists "anon can lookup sync code" on public.sync_codes;
drop policy if exists "anon can touch sync code" on public.sync_codes;

-- 查询改走 RPC:只按精确 code 匹配返回单条,不暴露全表
create or replace function public.lookup_sync_code(p_code text)
returns table (visitor_id text) language sql security definer set search_path = public as $$
  select s.visitor_id from public.sync_codes s where s.code = p_code limit 1;
$$;

-- touch(续期)改走 RPC:同样只按精确 code
create or replace function public.touch_sync_code(p_code text)
returns void language sql security definer set search_path = public as $$
  update public.sync_codes set last_used_at = now() where code = p_code;
$$;

grant execute on function public.lookup_sync_code(text) to anon;
grant execute on function public.touch_sync_code(text) to anon;

-- 说明:前端 app.js 需同步改造(lookupSyncCode / unsave / unlike 改调 RPC)。
-- 前端未上线前,老代码的直接 DELETE/SELECT 会开始报权限错——功能短暂降级
-- (点"取消收藏"云端不生效,本地仍生效),但堵住洞优先。
