# Curator Workflow · 官方收录流程

> 你是 OpenDesign 的 curator（策展人）—— 这份文档是你**正式**收录新站的操作指南。
> 不是看的「关于」，是用的「手册」。

---

## TL;DR

```bash
# 一条命令搞定：URL → mimo 分析 → schema 校验 → build → commit → push → deploy → live
python3 scripts/ingest.py --url https://example.com --auto-publish
```

90 秒后，`https://opendesign.cc/en/sites/example`（× 5 语言）live、被 Google 索引、可下载完整 design pack。

---

## 一、三种收录路径

### 路径 A · 一键单站 ⭐ 推荐（90 秒）

适用场景：你想正式收录一个站，从 URL 到上线一条命令。

```bash
export ANTHROPIC_API_KEY=tp-你的-mimo-key
export ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
export ANTHROPIC_MODEL=mimo-v2.5

python3 scripts/ingest.py \
  --url https://example.com \
  --tags "SaaS,Editorial,Refined" \
  --auto-publish
```

**做了什么**：
1. 抓首页截图（thum.io）
2. mimo vision → 11 层 spec + en desc + tags
3. mimo 翻译 → zh-CN / zh-TW / ja / ko (desc + spec_i18n)
4. mimo 写 narrative en + 4 lang
5. 写入 `sites/<slug>.json`
6. `python3 scripts/validate-sites.py --strict`
7. `python3 scripts/build.py` 产 5 个 SEO HTML + 5 个 DESIGN_SPEC.md
8. `git add . && git commit && git push origin main`
9. `bash scripts/deploy.sh` 推到 nginx
10. 打印 live URL

**成本**：~$0.10/站（mimo 跑 11 次调用）

**配额**：每天 100 站不成问题

### 路径 B · 批量收录（推荐量 > 10 站）

适用场景：你有一份候选站点 URL 清单，想一次性全部上架。

```bash
# 1. 准备 URL 清单
cat > /tmp/batch.txt <<EOF
https://airbnb.design
https://klim.co.nz
https://figma.com
# 注释行被忽略
EOF

# 2. 跑批
python3 scripts/ingest.py \
  --input /tmp/batch.txt \
  --budget 10.00 \
  --auto-publish
```

**特性**：
- 幂等 —— 重跑只跑没完成的。`--retry-failed` 只重试失败站
- 预算硬上限：超过 `--budget` 立即停
- 断点续跑 —— `_meta.status` 持久化每一步进度
- 每个 URL 独立失败，不影响别人

跑 100 站约 **$10、2 小时**。

### 路径 C · Web 预览（不持久化）

适用场景：你在浏览器里想**快速看一眼** mimo 对某个站的判断，**不打算正式收录**。

1. 打开 `https://opendesign.cc/?owner=1`
2. 粘 URL → 点「开始分析」
3. ~30 秒后看到 11 层 spec
4. 觉得 spec 不准 → 关掉重来
5. **觉得好 → 也不会被收录** —— Owner mode 只在前端内存里生成，刷新就没

**重要**：Owner mode **不是正式提交入口**。要正式收录走路径 A 或 B。

---

## 二、Owner mode + CLI 接力（半推半就）

如果你在 Web 上看了一眼觉得好，想正式收录：

1. Owner mode 里点「✓ 入库并下载 MD」拿到 `<slug>-style-spec.md`（**仅是预览文档，不是 v0.3 数据**）
2. 然后回到本地终端跑：
   ```bash
   python3 scripts/ingest.py --url https://that-site.com --auto-publish
   ```
3. CLI 会从头跑一遍 v0.3 流水线（不复用 Web 上的临时结果）

---

## 三、收录前的"该不该收"快速判断

参考 [CONTRIBUTING.md 的选片标准](../CONTRIBUTING.md#选片标准)：

✅ 收：清晰设计 DNA / 可拆成 token / 有禁用清单 / 对独立设计师有迁移价值  
❌ 不收：内容农场 / 同质化 SaaS 模板 / 第三方组件堆砌

**判断时间限制**：1 分钟。打开站，看首页 + 2 个内页。如果 3 个页面看完气质统一、能讲出 1 句"它故意不做什么"，就收。

---

## 四、收录后的标签 / 描述微调

Mimo 自动给的 tags 和 desc 80% 准确。你看 `sites/<slug>.json` 觉得哪里不对：

```bash
# 1. 手动改 sites/<slug>.json（tags / image / desc.* 都能手动覆盖）
$EDITOR sites/figma.json

# 2. validate
python3 scripts/validate-sites.py figma

# 3. rebuild + redeploy（不再调 mimo，零成本）
python3 scripts/build.py && bash scripts/deploy.sh
```

**永远不要直接编辑 `dist/` 或根目录的 `sites.js`** —— 那些是 build.py 自动生成的。

---

## 五、重跑 / 修改已收录站

### 重跑某站的 spec（mimo 输出有问题）

```bash
# 标记 status 让 ingest 认为没完成
python3 -c "
import json
s = json.load(open('sites/figma.json'))
s['status'] = 'pending'  # 重新跑 vision + translate + narrative
s['spec'] = None
s['spec_i18n'] = {}
s['desc'] = {}
s['narrative'] = {}
open('sites/figma.json','w').write(json.dumps(s, indent=2, ensure_ascii=False))
"

# 重跑
python3 scripts/ingest.py --slug figma --auto-publish
```

### 只补翻译 / narrative（spec 已对）

```bash
python3 scripts/ingest.py --slug figma --only translate --auto-publish
python3 scripts/ingest.py --slug figma --only narrative --auto-publish
```

### 删除站

```bash
rm sites/figma.json
python3 scripts/build.py && bash scripts/deploy.sh
git add -A && git commit -m "remove figma" && git push
```

---

## 六、Token 预算 / 成本控制

每条 mimo 调用估算：

| 步骤 | 调用数 | 成本 |
|---|---|---|
| vision（看图）| 1 | ~$0.05 |
| translate spec_i18n × 4 lang | 4 | ~$0.01 each = $0.04 |
| narrative en | 1 | ~$0.02 |
| narrate × 4 lang | 4 | ~$0.01 each = $0.04 |
| **per site total** | 10 | **~$0.10** |

预算控制：
```bash
python3 scripts/ingest.py --input urls.txt --budget 5.00
# 超过 $5 立刻停，已存的进度都不丢
```

---

## 七、安全注意

- **`ANTHROPIC_API_KEY` 永远走环境变量**。不要写进任何 commit 的文件。
- 如果你不小心把 key 贴进了消息、issue、commit，**立刻去 mimo 后台 rotate** —— key 一旦被搜索引擎索引就是被全网拿到了。
- `sites/<slug>.json` 文件本身**没有 secret**（公开数据），可以放心 commit。

---

## 八、看 ingest 输出的方式

跑 ingest 时实时输出：

```
[1/3] figma (pending) → https://figma.com
  ▸ vision call (mimo)...
  ▸ translate (desc, spec_i18n) → zh-CN...
  ▸ translate (desc, spec_i18n) → zh-TW...
  ▸ translate (desc, spec_i18n) → ja...
  ▸ translate (desc, spec_i18n) → ko...
  ▸ narrative en (mimo)...
  ▸ narrative zh-CN...
  ...
  ✓ completed  · $0.0926  · cumulative $0.09
```

- ✓ completed = 全 11 个 lang × field 数据都齐
- ✗ JSONDecodeError = mimo 输出畸形，再跑一次（idempotent）
- ✗ HTTPError = 通常 microlink 死了，看图片 URL

---

## 九、不收哪些坑

避免在以下情况下跑 ingest：

1. **未登记的小流量域名**（`example.test`）—— mimo 看不到，会 fail
2. **需要登录才能看到设计的站**（`/dashboard`, `/app/...`）—— mimo 只能看 marketing 页
3. **纯文本 / 论坛**（HN, Reddit, GitHub）—— 不该是 OpenDesign 收录的
4. **已经在 sites/ 里的 slug**（除非你想覆盖）

---

## 十、紧急回滚

deploy 出 bug 了：

```bash
# 找到上一个 good commit
git log --oneline -5

# Revert
git revert <bad-commit-sha>
git push

# Force redeploy
bash scripts/deploy.sh
```

服务端不缓存版本（nginx no-cache 在前端），revert 推完用户立刻拿新版本。

---

## 反馈

工作流不顺手 / 漏了哪一步 / mimo 出错没处理：[开 issue](https://github.com/qiuyiwu1989-star/opendesign/issues)
