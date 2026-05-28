# OpenDesign 架构

> 一张图看懂"双轨制收录 + Supabase 后端 + 静态前端 + AI vision"

```
┌──────────────────────────────────────────────────────────────────┐
│                         访客 / 设计师                              │
└──────────────────────────────────────────────────────────────────┘
                                │
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
        ┌─────────────────┐         ┌─────────────────┐
        │  浏览图集 / 列表  │         │  下载 pack ZIP   │
        │  收藏 ♥ / 点赞 👍 │         │  /packs/<slug>/  │
        └─────────────────┘         └─────────────────┘
                  │                           │
                  ▼                           ▼
        ┌─────────────────────────────────────────────────────────┐
        │  opendesign.cc (Nginx 静态托管 + Let's Encrypt)         │
        │  ────────────────────────────────────────────────────  │
        │  index.html + app.js + sites.js + sites-specs.json     │
        │  /packs/<slug>/  (解压后的 21+ 文件)                    │
        │  /packs/<slug>-design-pack.zip                          │
        └─────────────────────────────────────────────────────────┘
                  │                           ▲
                  │ saves/likes 写            │ Curator 部署
                  ▼                           │
        ┌─────────────────────────┐           │
        │  Supabase (Postgres+    │           │
        │  Edge Function)         │           │
        │  · saves, likes tables  │           │
        │  · analyze-site fn      │           │
        └─────────────────────────┘           │
                                              │
        ┌─────────────────────────────────────┴─────────────────┐
        │              Curator（你 / 我）的两轨工作流              │
        │  ──────────────────────────────────────────────────  │
        │                                                       │
        │  轨 A · 网页内 ?owner=1                                │
        │   粘 URL → microlink 抓截图 → Edge Function           │
        │   → mimo-v2.5 vision → 11 层 spec → 入 sites.js       │
        │                                                       │
        │  轨 B · CLI extract.py                                │
        │   Playwright 真浏览器 → computed styles → 统计聚合    │
        │   → synthesize.py → DESIGN_SPEC.md + 11 层 spec       │
        │   → pack.sh → ZIP → 上传 /packs/                      │
        │                                                       │
        └──────────────────────────────────────────────────────┘
```

## 关键模块

### 前端（零依赖，零构建步骤）

| 文件 | 用途 |
|---|---|
| `index.html` | SPA shell + `<noscript>` 全站清单（爬虫友好）+ JSON-LD |
| `app.js` | 路由 / 画布 / 详情抽屉 / Pack manifest / 资产预览 |
| `styles.css` | 编辑型极简风格设计系统 |
| `i18n.js` | zh / en 多语言 + 数据驱动 i18n |
| `sites.js` | 20 个精选网站基础数据 |
| `sites-specs.json` | AI 生成的 16 个 11 层 spec（旁路文件，启动时 merge）|
| `packs-index.json` | Pack 文件清单 + agentUrl |
| `supabase-config.js` | Supabase 公开 anon key |

### 后端 / 持久化

| 项 | 在哪 |
|---|---|
| Postgres | Supabase 项目 `nlsvjigoltvyfpqsbygh` |
| 表 | `saves(visitor_id, site_id)`, `likes(visitor_id, site_id)` |
| 视图 | `site_like_counts` (按 site_id 聚合 like_count) |
| RLS | 允许 anon select/insert/delete 自己 visitor_id 的行 |
| Edge Function | `analyze-site` (Deno) → 调 mimo-v2.5 vision |

### Curator 工具

| 文件 | 用途 |
|---|---|
| `extract/extract.py` | Playwright 浏览器抓取 |
| `extract/synthesize.py` | summary.json → DESIGN_SPEC.md + sites-entry.json |
| `extract/pack.sh` | 打包成 ZIP |
| `scripts/backfill-specs.mjs` | 批跑现有 sites.js 过 AI vision |
| `scripts/build-packs-index.py` | 服务器拉文件清单 → 富 manifest |
| `scripts/deploy.sh` | 推 web 文件到 nginx |
| `scripts/baidu-push.sh` | 主动推百度站长 |

### nginx 配置（生产）

```nginx
server {
  listen 443 ssl http2;
  server_name opendesign.cc www.opendesign.cc;
  
  # /packs/ 子目录 —— AI agent folder URL 协议
  location ^~ /packs/ {
    index DESIGN_SPEC.md;        # folder URL 默认 serve spec
    autoindex on;                # 没 index 时列出全部
    autoindex_format html;
    add_header Access-Control-Allow-Origin "*";
  }
  
  # SPA fallback
  location / {
    try_files $uri $uri/ /index.html;
  }
  
  # 静态资源缓存 + HSTS + CSP（详见 deploy/nginx-opendesign.cc.conf）
}
```

## 数据流

### 访客点收藏的完整路径

```
点 ♥
  → app.js: handleSaveToggle()
  → store.toggleSaved() ── 立即写 localStorage（即时响应）
  → store._push() ───────── 后台异步 POST 到 Supabase
                            （断网不阻塞 UI，下次启动重试）
  → renderSaved() ───────── 重渲收藏页
```

### Curator 添加新站的完整路径（轨 A）

```
浏览器 ?owner=1
  → 粘 URL → 点「开始分析」
  → microlink.io API → 真截图 + title + description
  → canvas 抽 palette (6 主色)
  → POST /functions/v1/analyze-site
       ↓ Supabase Edge Function
       ↓ 下载截图 → base64
       ↓ POST mimo-v2.5 with vision prompt
       ↓ 解析 JSON → 返回 11 层 spec
  → 客户端：sites.unshift(candidate) + 渲染
  → MD spec 自动下载
  → 用户点「复制 JSON」→ 粘进 sites.js → git commit
```

### Curator 生成 pack 的完整路径（轨 B）

```
本地终端
  → python3 extract.py https://target.com
       ↓ Playwright headless 1440×900 @2x
       ↓ wait networkidle + 3s 动效
       ↓ 跑 collect.js → 抓所有可见元素 computed styles
       ↓ 抓 document.fonts → 字体清单
       ↓ 13 段滚动截图 + 全页 + mobile
       ↓ 输出 elements.json + summary.json + fonts.json + 截图
  → python3 synthesize.py extracts/target-com
       ↓ Counter 频次聚合 → token 分配
       ↓ 输出 DESIGN_SPEC.md (8 章) + sites-entry.json (11 层)
  → ./pack.sh extracts/target-com
       ↓ zip 全部产物
       ↓ 输出 target-com-design-pack.zip
  → scp 上传到 /var/www/opendesign.cc/packs/
  → 服务器 unzip 到 /var/www/opendesign.cc/packs/<slug>/
  → 更新 packs-index.json
  → deploy.sh
```

## 部署

完整步骤见 [deployment.md](deployment.md) 和 [supabase.md](supabase.md)。

## 反馈

架构问题 / 改进想法欢迎 [开 issue](https://github.com/qiuyiwu1989-star/opendesign/issues)。
