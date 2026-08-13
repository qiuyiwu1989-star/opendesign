#!/usr/bin/env python3
"""线上健康检查 —— 一条命令确认四条链路都活着：
   站点与合规 / Agent 接口 / 数据 API 权限边界 / 资源与缓存 / 远程 MCP。

为什么是 Python 而不是 shell：第一版是 bash，靠 `curl -w` + `tail`/`sed` 从响应里
切状态码。catalog.json 1.2MB、sitemap.xml 2.7MB，超时截断后这套字符串手术会给出
**假失败**——而一个会假报警的检查脚本，比没有更糟(见 docs/lessons-2026-08.md 第 11 条)。

默认模式严格只读，适合 CI、cron 和日常巡检。写链路验证必须显式加
--write-probe；它会插入一条唯一的测试 like，随后调用现有 remove_like RPC
立即删除并再次查询确认，不在生产库留下测试数据。

用法：
  python3 scripts/healthcheck.py
  BASE=http://localhost:4173 python3 scripts/healthcheck.py
  python3 scripts/healthcheck.py --quiet       # 只在失败时输出，适合挂 cron
  python3 scripts/healthcheck.py --write-probe # 显式验证写入并自动清理
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("BASE", "https://opendesign.cc").rstrip("/")
QUIET = "--quiet" in sys.argv
WRITE_PROBE = "--write-probe" in sys.argv
TIMEOUT = 60          # 大文件走慢网络时 25s 会截断,给足
results = []          # (ok, 名称, 详情)


def out(ok, name, detail=""):
    results.append((ok, name, detail))
    if not QUIET or not ok:
        print(f"  {'✓' if ok else '✗'} {name:<32} {detail}")


def fetch(path, method="GET", body=None, headers=None, want_bytes=True, retries=2):
    """返回 (status, body_bytes)。网络异常返回 (0, b'<错误>')。

    只对【网络层】失败(连不上、读超时)重试，不对 HTTP 状态码重试——
    401/404 是我们要断言的结果，重试它们等于自欺。
    重试的理由：跨境链路本身就抖，一次读超时不代表线上坏了；
    一个会因为抖动假报警的检查脚本，用两次就没人再信它。
    """
    url = path if path.startswith("http") else BASE + path
    data = body.encode() if isinstance(body, str) else body
    last = b""
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("User-Agent", "opendesign-healthcheck/1.0")
        req.add_header("Connection", "close")
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return r.status, (r.read() if want_bytes else b"")
        except urllib.error.HTTPError as e:
            # 4xx/5xx 不是异常,是我们要断言的结果 —— 直接返回，不重试
            return e.code, e.read()[:4096]
        except Exception as e:
            last = f"{type(e).__name__}: {e}（重试 {attempt + 1}/{retries + 1} 次后仍失败）".encode()
    return 0, last


def check(name, path, want_status, must_contain=None, **kw):
    st, b = fetch(path, **kw)
    ok = st == want_status
    if ok and must_contain and must_contain.encode() not in b:
        ok = False
        return out(False, name, f"{st} 但响应里找不到 {must_contain!r}")
    out(ok, name, f"{st}" if ok else f"got={st} want={want_status} {b[:90].decode('utf-8','replace')}")


print(f"▸ 目标 {BASE}\n")

print("站点与合规")
check("首页", "/", 200, "OpenDesign")
check("ICP 备案号", "/", 200, "浙ICP备2021038972号-5")
check("SEO 详情页 en", "/en/sites/apple", 200)
check("SEO 详情页 ja", "/ja/sites/apple", 200)

print("\nAgent 接口")
check("llms.txt", "/llms.txt", 200)
check("skill.md", "/skill.md", 200)
check("sitemap.xml", "/sitemap.xml", 200, "<urlset")
st, b = fetch("/catalog.json")
try:
    cat = json.loads(b)
    items = cat if isinstance(cat, list) else (cat.get("designs") or cat.get("items") or [])
    withc = sum(1 for e in items if isinstance(e.get("spec_completeness"), (int, float)))
    # 条目数下限:曾经发布过一次陈旧的局部构建,线上从 1,486 掉到 527 而无人察觉
    out(len(items) >= 1400, "catalog 条目数 ≥1400", f"{len(items)} 条")
    out(withc >= len(items) * 0.9, "catalog 带 spec_completeness",
        f"{withc}/{len(items)} —— Agent 靠它判断这条够不够开工")
except Exception as e:
    out(False, "catalog.json", f"{st} 解析失败: {e}")

print("\n前端数据文件（缺一个首页就是空的）")
# sites-i18n.json（全量合并、~1.7MB gzip）不测：它是「按语言文件加载失败」时才会
# 用到的兼容性兜底，真实浏览器 99% 走的是下面这条小得多的按语言文件（~80-100KB）。
# 测大文件只是在验证"这条几乎不会走的路径是否可达"，却会因为体积在慢网络下超时,
# 拿一次网络抖动误判成"数据文件缺失"——这类误报比不测更糟。
for f in ("sites-index.json", "packs-index.json", "sites-specs.json", "sites-i18n.en.json"):
    check(f, f"/{f}", 200)
st, b = fetch("/sites-index.json")
try:
    d = json.loads(b)
    rows = d if isinstance(d, list) else (d.get("sites") or list(d.values()))
    out(len(rows) >= 1400, "站点条目数 ≥1400", f"{len(rows)} 条")
    out(len(b) <= 900_000, "首页索引体积预算", f"{len(b):,} bytes / 900,000")
    previews = sum(bool(row.get("pack_preview")) for row in rows)
    out(previews >= 450, "首页轻量 COS 预览覆盖", f"{previews}/{len(rows)} 条；其余 pack 用本地 WebP")
except Exception as e:
    out(False, "sites-index.json 解析", str(e))

print("\n数据 API（自建 PostgREST）")
JSON_H = {"Content-Type": "application/json", "Prefer": "return=minimal"}
check("读 likes", "/db/rest/v1/likes?select=site_id&limit=1", 200)
if WRITE_PROBE:
    vid = str(uuid.uuid4())
    probe_site = "__healthcheck__"
    st, b = fetch(
        "/db/rest/v1/likes", method="POST", headers=JSON_H,
        body=json.dumps({"visitor_id": vid, "site_id": probe_site}),
    )
    wrote = st == 201
    out(wrote, "写 likes", f"{st}" if wrote else f"got={st} want=201 {b[:90].decode('utf-8','replace')}")

    if wrote:
        cleanup_body = json.dumps({"p_visitor_id": vid, "p_site_id": probe_site})
        cst, cb = fetch(
            "/db/rest/v1/rpc/remove_like", method="POST", headers=JSON_H,
            body=cleanup_body,
        )
        cleanup_called = cst in (200, 204)
        out(
            cleanup_called, "清理写探针",
            f"{cst}" if cleanup_called else f"got={cst} want=200/204 {cb[:90].decode('utf-8','replace')}",
        )

        vst, vb = fetch(
            f"/db/rest/v1/likes?select=site_id&visitor_id=eq.{vid}&site_id=eq.{probe_site}"
        )
        try:
            remaining = json.loads(vb) if vst == 200 else None
        except Exception:
            remaining = None
        cleaned = vst == 200 and remaining == []
        out(cleaned, "确认写探针已清理", f"{vst} remaining={remaining!r}")
elif not QUIET:
    print("  — 写链路探针已跳过（需要显式 --write-probe）")

# 权限边界:这几条【必须】被数据库拒掉。42501 是 PostgreSQL 自己的权限拒绝码,
# 说明拦截发生在库里,而不是某段可以被绕过的应用逻辑。
check("拒 DELETE likes", "/db/rest/v1/likes?site_id=eq.__nope__", 401, "42501", method="DELETE")
check("拒 PATCH likes", "/db/rest/v1/likes?site_id=eq.__nope__", 401, "42501",
      method="PATCH", headers=JSON_H, body='{"site_id":"x"}')
check("拒读 submissions", "/db/rest/v1/submissions?select=*&limit=1", 401, "42501")

print("\n资源与缓存")
check("缩略图", "/thumbs/apple.webp", 200)
check("设计包 DESIGN.md", "/packs/apple/DESIGN.md", 200, "#")
check("11 层 spec", "/packs/apple/sites-entry.json", 200, "systemPrompt")
check("缺失图返回 404", "/__nope__.webp", 404)
# 404 绝不能带长缓存:带了浏览器会把"这张图当时没有"记 30 天,
# 服务器后来补上也刷不出来——这是卡图长期空白的真凶
try:
    req = urllib.request.Request(BASE + "/__nope__.webp", method="HEAD")
    urllib.request.urlopen(req, timeout=TIMEOUT)
    cc = ""
except urllib.error.HTTPError as e:
    cc = e.headers.get("Cache-Control", "") or ""
except Exception:
    cc = ""
long_cache = bool(re.search(r"max-age=\d{5,}", cc))
out(not long_cache, "404 无长缓存", f"Cache-Control: {cc or '（无）'}")

print("\n远程 MCP")
MCP_H = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}


def mcp(method, params=None, _id=1):
    payload = {"jsonrpc": "2.0", "id": _id, "method": method}
    if params:
        payload["params"] = params
    st, b = fetch("/mcp/http", method="POST", headers=MCP_H, body=json.dumps(payload))
    m = re.search(rb"\{.*\}", b, re.S)
    if not m:
        return st, None
    try:
        return st, json.loads(m.group(0))
    except Exception:
        return st, None


st, r = mcp("tools/list")
tools = [t["name"] for t in ((r or {}).get("result", {}) or {}).get("tools", [])]
out("search_designs" in tools, "tools/list", f"{len(tools)} 个工具")


def mcp_search(q):
    st, r = mcp("tools/call", {"name": "search_designs", "arguments": {"query": q, "limit": 3}}, 2)
    res = (r or {}).get("result") or {}
    if "content" in res:
        try:
            res = json.loads(res["content"][0]["text"])
        except Exception:
            return None
    return res


en = mcp_search("minimal dark developer tools")
out(bool(en and en.get("count")), "英文检索", f"{(en or {}).get('count', 0)} 条")
# 中文入口断过一次(catalog 全英文标签,中文查询命中 0 条),值得常驻监控
cn = mcp_search("极简 深色 开发者工具")
out(bool(cn and cn.get("count")), "中文检索",
    f"{(cn or {}).get('count', 0)} 条: {', '.join(d['slug'] for d in (cn or {}).get('designs', []))}")
# 诚实反馈:查询词一个站都没命中时必须说出来,不能默默返回不相关结果
bogus = mcp_search("极简 火星车")
out(bool(bogus and bogus.get("unmatched_terms")), "未命中词如实上报",
    f"unmatched_terms={(bogus or {}).get('unmatched_terms')}")

bad = [n for ok, n, _ in results if not ok]
print("\n" + "─" * 46)
if bad:
    print(f"  通过 {len(results) - len(bad)} · ✗ 失败 {len(bad)}: {', '.join(bad)}")
    sys.exit(1)
print(f"  ✓ 全部通过（{len(results)} 项）")
if WRITE_PROBE:
    print("\n  ✓ 写链路探针已通过 remove_like RPC 自动清理并查询确认。")
