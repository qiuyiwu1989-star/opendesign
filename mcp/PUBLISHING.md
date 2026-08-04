# 发布 opendesign-mcp 到 npm

包已经准备到「只差最后一条命令」。发布需要你的 npm 账号,我没有凭证,这步必须你来跑。

## 发布前状态(已验证)

```
opendesign-mcp@1.2.0 · 10.5 kB · 4 files
├── opendesign-mcp.mjs   (stdio server)
├── lib/core.mjs         (7 个工具的实现)
├── README.md
└── package.json
```

已验证:`npm pack` 文件清单正确(`lib/` 在内——漏掉它 npx 会直接 `ERR_MODULE_NOT_FOUND`)、
本地安装 tarball 后 `tools/list` 返回 7 个工具、`tools/call` 端到端打通线上库。

## 发布步骤

```bash
cd mcp

# 1. 登录(第一次会开浏览器)
npm login

# 2. 确认包名没被占(应该报 404 = 可用)
npm view opendesign-mcp 2>&1 | head -3

# 3. 最后确认一次要发的文件
npm pack --dry-run

# 4. 发布
npm publish --access public
```

## 发布后立刻验证

```bash
# 换一台机器/或清掉缓存,模拟真实用户
npx -y opendesign-mcp <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
应返回 7 个工具。然后把这段配置贴进 Claude Desktop / Cursor 试一次:

```json
{ "mcpServers": { "opendesign": { "command": "npx", "args": ["-y", "opendesign-mcp"] } } }
```

## 发布后要同步改的地方

发布成功后,这几处的安装说明可以从「curl 下载文件」升级成「npx 一行」:

- `mcp/index.html`(安装页)——加一个 npx 方案,放在远程 HTTP 方案后面
- `mcp/README.md`
- 根 `README.md`
- `skill/SKILL.md` 的 endpoints 段落

## 版本约定

- `lib/core.mjs` 改工具行为 → minor(1.3.0)
- 只修 bug → patch(1.2.1)
- 工具增删/入参不兼容 → major

发布后记得 `git tag mcp-v1.2.0 && git push --tags`。
