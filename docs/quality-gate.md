# Quality Gate · 收录质量门

> Schema 校验只查格式合法。质量门查内容是否真有用。
> 大批量 ingest 时这一层是防 mimo 退化的最后一道防线。

---

## 跑

```bash
# 全部 sites 校验
python3 scripts/quality-check.py

# 指定几个
python3 scripts/quality-check.py linear stripe cursor

# strict mode：warning 也算失败
python3 scripts/quality-check.py --strict

# 自动隔离：失败的 status → "needs_review"，curator 可后续处理
python3 scripts/quality-check.py --auto-quarantine
```

`ingest.py --auto-publish` 自动跑这个，质量过的 publish，过不了的安静 quarantine（不阻塞别的）。

---

## 检查项

### Errors（阻止上架）

| 项 | 规则 |
|---|---|
| `colors` block | 至少 bg/ink 之一有值，至少 3 个非 null token |
| `typography.display/body` | 不能命中品牌名黑名单（Inter/Söhne/GT America/Geist/Circular...） |
| `donts` | ≥ 6 条 |
| `identity.oneLiner` | 必须有，15-200 字符 |
| `systemPrompt` | 必须有 |
| 5 lang coverage | `desc` / `spec_i18n` / `narrative` 每个 lang 都齐 |
| `narrative.<lang>.<slot>` | 关键 slot（ch1/ch2/ch6/ch8）≥ 20 字符 |

### Warnings（不阻止，但 review 提示）

| 项 | 触发 |
|---|---|
| typography 类别陌生 | 不在 canonical category list 里 |
| typography.scale 太短 | < 4 entries（典型 5-7） |
| donts 太短 | > 1 条 < 30 字符（八成 stub） |
| identity.analogy 过短 | < 25 字符（"like a magazine" 这种不够） |
| identity.keywords 不足 | < 3 个 |
| systemPrompt 极短/极长 | < 200 或 > 1500 字符 |
| tags 不足 | < 2（curator 应该补） |

---

## 品牌名字体黑名单

mimo 应该输出**类别**，不是品牌名。这些命中即拒：

```
inter, söhne / sohne, gt america, gt walsheim, circular, graphik,
founders grotesk, neue haas, helvetica neue, futura, ibm plex,
sf pro, geist, instrument serif, ivar, manuka, sodosans, nouvelr
```

为什么：spec 是要喂 AI 复用的，品牌字体有版权 + 多数项目用不上。**类别**（humanist-sans / grotesque-sans / didone-serif 等）才是可迁移的。

---

## Canonical typography categories

mimo 应该从这里选：

```
humanist-sans, grotesque-sans, geometric-sans, neo-grotesque-sans
transitional-serif, didone-serif, slab-serif, modern-serif,
old-style-serif, antiqua-serif
monospace, mono
display
script, handwritten
```

---

## Auto-quarantine 工作流

```
ingest --auto-publish
  ├─ schema validate ✓
  ├─ quality check
  │   ├─ pass → status: completed  → build → commit → push → deploy
  │   └─ fail → status: needs_review
  │                └─ _meta.quality_errors: [...]
  │                   curator 后续处理
  └─ build/deploy（只 publish 没被隔离的）
```

Curator 处理被隔离的 site：

```bash
# 1. 看哪些被隔离
python3 -c "
import json,os
for f in os.listdir('sites'):
  s=json.load(open(f'sites/{f}'))
  if s.get('status')=='needs_review':
    print(s['id'], s['_meta'].get('quality_errors')[:2])
"

# 2. 选项 A: 重 vision（mimo 重新看一次）
python3 -c "
import json
s=json.load(open('sites/foo.json'))
s['spec']=None; s['spec_i18n']={}; s['narrative']={}; s['status']='pending'
open('sites/foo.json','w').write(json.dumps(s,ensure_ascii=False,indent=2))
"
python3 scripts/ingest.py --slug foo --auto-publish

# 选项 B: 手动修
$EDITOR sites/foo.json   # 把缺的 hex / 改字体类别
python3 scripts/quality-check.py foo  # 看修没修对
python3 scripts/build.py && bash scripts/deploy.sh
```

---

## 何时调阈值

这些数字是经验，看下面就改：

| 现象 | 调整 |
|---|---|
| mimo 经常被拒但人看着没问题 | 阈值放松 |
| 收录数据有明显垃圾 | 阈值收紧 |
| 某类字段总被错判 | 加单独 check 函数 |

改阈值的方法：编辑 `scripts/quality-check.py`，看具体函数。

---

## 反馈

发现新类型的 mimo 输出问题：[开 issue](https://github.com/qiuyiwu1989-star/opendesign/issues) 描述场景，我们加 check。
