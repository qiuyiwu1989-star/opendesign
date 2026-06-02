#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["mcp>=1.2.0", "httpx>=0.27"]
# ///
"""OpenDesign MCP —— 把 opendesign.cc 的 100+ 真实站点「grounded 设计系统」接进
Cursor / Claude / 任何 MCP 客户端。

价值：当你对 Agent 说"做一个 Linear 风格的落地页"，Agent 可以直接调用
get_design_system("linear") 拿到 Linear 真实的色板 / 字阶 / 间距 / 圆角 / 动效 tokens
（不是瞎编，是我们用 Playwright 抓真页 + AI grounding 出来的），照着构建。

数据全部来自线上 opendesign.cc（sites.js 目录 + packs-index.json 资源），只读、无密钥。

安装（Claude Desktop / Cursor 的 mcpServers 配置）：
  { "opendesign": { "command": "uv", "args": ["run", "/abs/path/mcp/opendesign_mcp.py"] } }
或先 `pip install mcp httpx` 再用：
  { "opendesign": { "command": "python3", "args": ["/abs/path/mcp/opendesign_mcp.py"] } }
"""
import json
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

BASE = "https://opendesign.cc"
mcp = FastMCP("opendesign")
_cache: dict[str, Any] = {"sites": None, "packs": None}


async def _http_get(path: str) -> str:
    async with httpx.AsyncClient(timeout=30, follow_redirects=True,
                                 headers={"User-Agent": "opendesign-mcp"}) as c:
        r = await c.get(f"{BASE}{path}")
        r.raise_for_status()
        return r.text


async def _sites() -> list[dict]:
    """加载并缓存站点目录（解析线上 sites.js 的 window.STYLE_ATLAS_SITES 数组）。
    每条含 id / title / url / tags + 完整 spec（11 层设计系统）。"""
    if _cache["sites"] is None:
        txt = await _http_get("/sites.js")
        # sites.js 前面还有 IMAGE_BASE / shot() 等带 = 的行，必须锚定到 STYLE_ATLAS_SITES
        i = txt.find("window.STYLE_ATLAS_SITES")
        eq = txt.find("=", i)
        body = txt[eq + 1:].rsplit(";", 1)[0].strip()   # 剥 window.STYLE_ATLAS_SITES = [...];
        _cache["sites"] = json.loads(body)
    return _cache["sites"]


async def _packs() -> dict:
    """加载并缓存 packs-index.json（每站完整包的下载/资源 URL）。"""
    if _cache["packs"] is None:
        try:
            _cache["packs"] = json.loads(await _http_get("/packs-index.json"))
        except Exception:
            _cache["packs"] = {}
    return _cache["packs"]


def _slim(s: dict) -> dict:
    """目录条目的精简视图（搜索/列表用，省 context，不含庞大的 spec）。"""
    sp = s.get("spec") or {}
    return {
        "slug": s.get("id"),
        "title": s.get("title"),
        "url": s.get("url"),
        "tags": s.get("tags", []),
        "summary": (sp.get("identity", {}) or {}).get("essence")
        or s.get("notes") or s.get("palette") or "",
    }


@mcp.tool()
async def list_designs(limit: int = 40, offset: int = 0) -> dict:
    """列出 OpenDesign 库里所有可用的设计系统（精简目录：slug / 标题 / 标签 / 一句话）。
    用它先总览有哪些站可参考；再用 get_design_system 取某一个的完整 tokens。
    limit/offset 分页，默认每页 40。"""
    sites = await _sites()
    rows = [_slim(s) for s in sites]
    page = rows[offset: offset + limit]
    return {"total": len(rows), "offset": offset, "limit": limit, "count": len(page), "designs": page}


@mcp.tool()
async def search_designs(query: str = "", tags: list[str] | None = None, limit: int = 20) -> dict:
    """按关键词 / 标签搜索设计系统。query 匹配 标题/slug/url/标签/简述（不区分大小写）；
    tags 要求命中其中任一标签。返回精简命中列表（用 get_design_system 取完整 tokens）。
    例：search_designs("fintech dark") · search_designs(tags=["ai","minimal"])。"""
    sites = await _sites()
    q = (query or "").lower().strip()
    want = {t.lower() for t in (tags or [])}
    out = []
    for s in sites:
        slim = _slim(s)
        hay = " ".join([str(slim["slug"]), str(slim["title"]), str(slim["url"]),
                        " ".join(slim["tags"]), str(slim["summary"])]).lower()
        if q and q not in hay and not all(w in hay for w in q.split()):
            continue
        if want and not (want & {t.lower() for t in slim["tags"]}):
            continue
        out.append(slim)
        if len(out) >= limit:
            break
    return {"query": query, "tags": tags or [], "count": len(out), "designs": out}


@mcp.tool()
async def get_design_system(slug: str) -> dict:
    """取某个站的完整 grounded 设计系统 —— 这是核心工具。
    返回真实的 11 层设计 tokens（颜色/字体字阶/间距/圆角/阴影/布局/组件/交互/动效/语气/系统提示），
    外加可下载完整包（截图 + DESIGN.md + spec.json）的 URL。Agent 拿到后即可照此构建同款风格。
    slug 用 list_designs / search_designs 返回的那个（如 "linear"、"stripe"、"teenage-engineering"）。"""
    sites = await _sites()
    site = next((s for s in sites if s.get("id") == slug), None)
    if site is None:
        avail = ", ".join(sorted(s.get("id", "") for s in sites)[:30])
        raise ValueError(f"没有 slug '{slug}'。用 list_designs / search_designs 查可用 slug。样本：{avail} …")
    packs = await _packs()
    p = packs.get(slug, {})
    folder = f"{BASE}/packs/{slug}/"
    return {
        "slug": slug,
        "title": site.get("title"),
        "url": site.get("url"),
        "tags": site.get("tags", []),
        "spec": site.get("spec") or {},          # 完整 11 层设计系统 tokens
        "human_notes": {                          # 人话版速读
            "palette": site.get("palette", ""),
            "layout": site.get("layout", ""),
            "interaction": site.get("interaction", ""),
            "motion": site.get("motion", ""),
        },
        "resources": {
            "design_spec_md": f"{folder}DESIGN_SPEC.en.md",  # 可读的设计规范全文
            "design_md": f"{folder}DESIGN.md",
            "spec_json": p.get("specPreviewUrl") or f"{folder}spec.json",
            "pack_zip": f"{folder}{p.get('zipFile', slug + '-design-pack.zip')}",  # 完整包(含真截图)
            "agent_entry": p.get("agentUrl") or folder,
            "folder": folder,
            "detail_page": f"{BASE}/en/sites/{slug}",
        },
    }


@mcp.tool()
async def fetch_design_spec_markdown(slug: str) -> str:
    """取某站「DESIGN_SPEC.md」的完整 Markdown 原文（适合直接塞进 prompt 让 Agent 照着写）。
    比 get_design_system 的结构化 tokens 更适合"整段喂给模型"的用法。"""
    try:
        return await _http_get(f"/packs/{slug}/DESIGN_SPEC.en.md")
    except Exception as e:
        raise ValueError(f"取 {slug} 的 DESIGN_SPEC.md 失败：{e}。先用 get_design_system 确认 slug 有完整包。")


if __name__ == "__main__":
    mcp.run()  # stdio transport（本地 MCP 客户端用）
