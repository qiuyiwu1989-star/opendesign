# OpenDesign Studio

## 目标
为设计师和其他 Agent 提供可追溯的设计资源、设计判断与可编辑的 HTML/PPT 创作能力。

## 技术栈
- 公共站：静态 HTML/CSS/JavaScript，内容索引和 Design Pack 为 JSON/文件资产。
- Studio/Admin：Node.js 22、TypeScript、React、Vite、Vitest、node:test。
- 数据：自托管 PostgreSQL 18.4 目标、PostgREST、最小权限 SQL 视图/函数。
- 自动化：Python 3 标准库优先、Bash、GitHub Actions。
- 禁止引入：未经 spec 说明的新运行时框架、会扩大生产写权限的 SDK、客户端直连高权限数据库。

## 约定
- `studio/apps/*` 放产品应用，`studio/packages/*` 放共享契约与渲染能力。
- `supabase/migrations/*` 为可审查迁移草案；生产执行必须单独授权。
- 外部输入 fail closed；来源状态必须区分 live/snapshot/unavailable。
- AI 建议与人工判断分别保存，历史判断不覆盖、不删除。
- 每个跨会话新能力先写 `specs/NNN-*.md`，验收由测试和命令证明。

## 红线
- 不把 AI 建议直接变成发布、永久拒绝、删除或任务入队。
- 不让浏览器直接写数据库，不让应用绕过单一写入守卫。
- 不把密码、令牌、连接串、Cookie、生产记录正文写入仓库或日志。
- 不擅自迁移、部署、重启、改 nginx、推送 GitHub 或操作生产数据。
- 删除数据、改生产 schema、外部写请求和发布动作必须先取得对应授权。

## 当前档位
G3 生产档。真实公开站、数据库、安全边界和定时自动化已经存在；任何完成声明必须有自动化测试和发布门禁。
