# 给 OpenDesign 贡献

感谢你愿意让这个项目变得更好。OpenDesign 接受三种贡献：

1. **[提名一个新网站](#1-提名一个新网站)** — 1 分钟
2. **[改进现有 spec](#2-改进现有-spec)** — 直接 PR
3. **[完善文档 / 工具 / 翻译](#3-完善文档--工具--翻译)** — 任何 PR

---

## 1. 提名一个新网站

**最简单的贡献方式**。

走 [提名表单 issue](https://github.com/qiuyiwu1989-star/opendesign/issues/new?template=propose-site.yml)，填：

- 网站 URL
- 为什么值得收录（1-2 句你认为有什么独特设计气质）
- 推荐的「类比」（"像 xxx 但更 xxx"）
- 至少 1 个能体现气质的页面 URL（不一定是首页）

### 选片标准

我们倾向收录：

✅ **有清晰设计 DNA** —— 看 3 个页面能 grasp 整体气质  
✅ **气质能拆成 token** —— 颜色、字体、节奏、动效都有立场  
✅ **有禁用清单** —— 它**不**做什么（不堆装饰、不用 emoji、不放 carousel）  
✅ **对独立设计师/前端有迁移价值** —— 学了能用在自己项目里  

我们倾向不收录：

❌ 内容农场 / 信息密集型工具（设计气质太薄）  
❌ 纯营销落地页（缺乏完整产品体验）  
❌ 用了大量第三方组件、看不出 own design system 的站  
❌ 极度同质化（"又一个 SaaS 暗色模板"）  

### 收录后流程

1. 我们（或 owner mode 用户）跑轨 A 自动 vision 分析 → 入 sites.js + sites-specs.json
2. （可选）跑轨 B Playwright 抓真 computed styles → 出完整 pack
3. 上传 pack ZIP 到 `/packs/<slug>/`
4. 更新 `packs-index.json` → deploy

被收录后，**你会成为该条目的 contributor**（GitHub 提名 issue 自动归档为贡献记录）。

---

## 2. 改进现有 spec

如果你觉得某个站的 spec 不准（颜色错了、字体类别错了、Don'ts 不够锐利），直接 PR 改：

### 改基础数据（标题、描述、标签）

编辑 `sites.js` 对应条目：

```js
{
  slug: 'apple',
  name: 'Apple',
  url: 'https://www.apple.com',
  desc: { zh: '...', en: '...' },
  tags: ['硬件', '极简', '黑白红'],
  // ...
}
```

PR 标题：`fix(apple): 标签修正 / 描述润色`

### 改 11 层 spec

编辑 `sites-specs.json` 对应条目（直接编辑 JSON 是 OK 的，前端会 merge）：

```json
{
  "apple": {
    "identity": { ... },
    "colors": { ... },
    "donts": [...]
  }
}
```

**注意**：颜色 token 必须来自该站实际出现的 hex；字体只能填类别，不写品牌名（详见 [11-layer-spec.md](docs/11-layer-spec.md)）。

PR 标题：`fix(spec/apple): 颜色 token 修正 + Don'ts 加 2 条`

### 重新生成 spec

如果你想用 AI vision 重新跑：

```bash
# 需要 SUPABASE_URL + SUPABASE_ANON_KEY env
node scripts/backfill-specs.mjs apple
```

或者用 Playwright 真浏览器抓：

```bash
cd extract
python3 extract.py https://www.apple.com
python3 synthesize.py extracts/apple-com
```

把生成的 `sites-entry.json` 内容粘进 `sites-specs.json[<slug>]`。

---

## 3. 完善文档 / 工具 / 翻译

任何 PR 都欢迎：

- **文档**：`docs/` 下所有 md、`README.md`、`extract/README.md`
- **翻译**：`i18n.js` 增 / 改条目，或新增语言（西语 / 日语 / 韩语）
- **工具**：`extract/` 抽取器改进、`scripts/` 部署脚本改进
- **CSS / JS**：前端 bug 修复、可访问性改进、性能优化

### 翻译新增一门语言

```js
// i18n.js
const STRINGS = {
  zh: { ... },
  en: { ... },
  ja: {  // 新增
    'site.title': 'OpenDesign · 厳選されたウェブデザインライブラリ',
    // ...
  }
};
```

然后在 `index.html` 顶部语言切换器加按钮：

```html
<button onclick="setLang('ja')">日</button>
```

---

## PR 流程

```bash
git clone https://github.com/qiuyiwu1989-star/opendesign
cd opendesign
git checkout -b fix/your-change

# 改文件 ...

git add -A
git commit -m "type(scope): 一句话描述"
git push origin fix/your-change
# 然后在 GitHub 开 PR
```

### Commit 风格

我们用 [conventional commits](https://www.conventionalcommits.org/) 但很宽松：

- `feat:` 新功能
- `fix:` 修 bug / 修 spec
- `docs:` 文档
- `style:` 前端样式
- `refactor:` 重构（无功能变化）
- `chore:` 杂项（依赖升级、deploy 脚本）

例：

```
feat(extract): 加 hover state 抓取
fix(spec/linear): 颜色 token 漏了 --line
docs(11-layer): 补充 v0.2 路线图
```

### PR Checklist

- [ ] 我读了 [CODE_OF_CONDUCT.md](#行为准则) 并同意
- [ ] 如果改了 spec，颜色 hex 是该站实际出现的（不是脑补）
- [ ] 如果改了 spec，字体填的是类别（humanist-sans / grotesque-sans 等），不是品牌名
- [ ] 如果加了新功能，更新了 `docs/architecture.md` 相关章节
- [ ] commit message 大致符合 conventional commits

---

## 本地开发

### 跑前端

```bash
cd opendesign
python3 -m http.server 8000
# 浏览器开 http://localhost:8000
```

零依赖、零构建步骤。

### 跑 Edge Function（需要 Supabase 项目）

```bash
supabase functions serve analyze-site
```

### 跑 extract CLI

```bash
cd extract
./setup.sh       # 装 Python 依赖 + Playwright Chromium
python3 extract.py https://target.com
python3 synthesize.py extracts/target-com
./pack.sh extracts/target-com
```

---

## 行为准则

简版：

- 对人友好，对事严苛
- 不接受人身攻击、骚扰、刻意挑衅
- 设计审美有差异是正常的 —— 用论据，不用情绪
- 推动让 spec 更准、文档更清晰、工具更稳定

如有问题请发邮件至 contact at qiuyiwu.com。

---

## 联系

- Issue: https://github.com/qiuyiwu1989-star/opendesign/issues
- Discussion: https://github.com/qiuyiwu1989-star/opendesign/discussions
- 邮件: contact at qiuyiwu.com
- 作者主页: https://qiuyiwu.com
