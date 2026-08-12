# 每日 AI 策展运行手册

> 状态：代码与契约说明。未经发布授权，不安装 cron、不执行数据库迁移、不连接生产写入。

每日策展是一个“建议生成器”，不是自动发布器。它可以读取待审候选、抓取有限公开证据、请求模型，并追加一条可审计建议；最终收录、拒绝、创建设计包和发布都必须由后台人工确认。

## 安全边界

- 只接受 `http://`、`https://` 公共 URL；拒绝含用户名或密码的 URL、localhost、私网/保留地址，以及解析到私网的域名。
- 跟随重定向时再次执行公共地址检查，避免通过跳转访问内网。
- 单站 HTML 最多读取 64 KiB，模型输出最多读取 32 KiB。
- 模型必须返回固定七类信号：`design-value`、`originality`、`utility`、`evidence`、`spam-risk`、`ad-risk`、`safety`。每类限 1–3 条证据、每条不超过 160 字，全部 signals 序列化后不超过 15 KB；未知字段也会触发校验失败。
- `spam-risk`、`ad-risk` 或 `safety` 为 `fail` 时强制给出 `reject` 建议。
- `evidence` 为 `fail` 或分数低于 50 时强制给出 `review` 建议。
- 模型超时、非 JSON、缺字段、重复信号、分数越界或证据超限，一律 fail closed 为 `review`。
- 每条记录带 `policy_version + model + discovery_id` 生成的 SHA-256 指纹。同一策略、模型和候选重复运行时应复用已有决定，不重复写入。
- 脚本不发布、不创建 job、不删除候选，也不把 AI 建议当成人工结论。

## 发布前演练（完全离线）

Fixture 既可用于单测，也可用于人工查看决策格式。Fixture 模式隐含 `--dry-run`，不访问 DNS、站点、模型或数据库：

```bash
python3 scripts/auto-evaluate.py --fixture scripts/fixtures/daily-curation-sample.json --limit 10
```

格式：

```json
[
  {
    "id": "fixture-001",
    "slug": "sample-studio",
    "url": "https://example.com",
    "meta": {
      "reachable": true,
      "title": "Sample Studio",
      "description": "Independent design practice"
    },
    "modelDecision": {
      "recommendation": "review",
      "confidence": 60,
      "reason": "需要更多一手项目证据。",
      "signals": [
        {"id":"design-value","label":"设计参考价值","state":"pass","score":78,"evidence":["有公开案例页面"]},
        {"id":"originality","label":"原创性","state":"warn","score":60,"evidence":["作者归属需要人工确认"]},
        {"id":"utility","label":"可复用价值","state":"pass","score":72,"evidence":["可观察版式和字体关系"]},
        {"id":"evidence","label":"证据完整度","state":"warn","score":45,"evidence":["仅有首页摘要"]},
        {"id":"spam-risk","label":"垃圾风险控制","state":"pass","score":90,"evidence":["未发现关键词堆砌"]},
        {"id":"ad-risk","label":"广告风险控制","state":"pass","score":92,"evidence":["未发现联盟导流"]},
        {"id":"safety","label":"安全性","state":"pass","score":95,"evidence":["公开 HTTPS 页面"]}
      ]
    }
  }
]
```

即使 fixture 把推荐写成 `approve`，只要证据低于 50，输出也会被规范化为 `review`。

## 只读网络演练

下面会读取数据库候选、抓取公开站点并调用已配置模型，但不会写 decision RPC：

```bash
python3 scripts/auto-evaluate.py --dry-run --limit 5
```

这不是离线模式。如果不希望产生任何外部调用，请使用 `--fixture`。

## 正式每日运行契约

正式运行前必须先应用与脚本版本配套的迁移。除了已有的候选读取 RPC，数据库侧还要提供：

```text
runner_find_curation_decision(p_token, p_decision_fingerprint)
runner_record_curation_decision(..., p_decision_fingerprint)
```

`runner_record_curation_decision` 必须对 `decision_fingerprint` 建唯一约束并安全地返回已有记录；不能创建 job、发布内容或把 `discoveries.status` 改成最终状态。若幂等查询 RPC 缺失或失败，脚本会拒绝盲写并以非零状态退出。

确认迁移、只读演练和后台审计页面均通过后，才可在明确发布窗口中安装：

```bash
0 10 * * * /home/ubuntu/opendesign/scripts/cron-auto-evaluate.sh
```

脚本从 `~/.opendesign-runner.env` 读取数据库、runner token 和模型配置。日志默认写到 `~/auto-evaluate.log`。密钥不得进入仓库或 cron 表文本。

## 失败处理

| 现象 | 脚本行为 | 处理方式 |
|---|---|---|
| 模型超时或 schema 错误 | 记录 `review` 建议，置信度 0 | 后台人工评估；排查 provider 后可在新 policy/model 下重跑 |
| DNS/站点暂时不可达 | `review`，不永久拒绝 | 稍后人工重试，核验源站状态 |
| URL 指向本地/私网或凭证 URL | `reject` 安全建议 | 后台保留审计痕迹，不访问目标 |
| 垃圾、广告或安全信号 fail | 强制 `reject` 建议 | 人工确认后才设置最终拒绝状态 |
| 幂等查询失败 | 不写记录，进程非零退出 | 修复数据库 RPC/网络；不要绕过检查重跑 |
| 写入 RPC 失败 | 当前候选标记错误，继续后续候选，最终非零退出 | 依据 fingerprint 查重后重跑 |
| cron 连续失败 | 不影响线上内容；无发布、无入队 | 暂停 cron，保留日志，离线 fixture 验证后再恢复 |

## 停用与回滚

1. 先注释或删除 `cron-auto-evaluate.sh` 的 crontab 行，防止产生新建议。
2. 不删除历史 `curation_decisions`；审计记录应保持追加且可追溯。
3. 将运行程序回退到上一已验证提交，但不要回退成“自动发布/自动入队”逻辑。
4. 如果策略有缺陷，发布新的 `POLICY_VERSION`；旧记录保留旧版本号，不原地改写。
5. 在恢复定时任务前依次通过：`py_compile`、离线单测、fixture 演练、只读 `--dry-run`、后台可见性检查。

## 本地验证

```bash
python3 -m py_compile scripts/auto-evaluate.py
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
```

验证过程不需要网络和密钥。
