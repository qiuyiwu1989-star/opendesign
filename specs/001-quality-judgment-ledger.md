# 001: Quality Judgment Ledger v2

## 要什么
管理员需要在同一后台看见每一条 AI 策展建议和对应人工终审，并能明确回答：谁认为、关于哪个候选、什么判断、何时成立、依据在哪。人工终审是追加的审计事件，不能覆盖 AI 原判断；后续 Agent 能读取这些判断来诊断内容质量和生成发布候选变更集。

## 不做什么
- 不自动发布、入队、删除候选或执行永久拒绝。
- 不接入生产数据库、不安装 cron、不部署后台。
- 不做自由文本实体解析；本阶段 subject 使用已有稳定 discovery UUID。
- 不做推荐曝光、点击、点赞或排序学习；只为下一阶段保留方向。
- 不做启发式历史推断；迁移只把已有完整终审字段确定性转成事件，且由后续授权窗口执行。

## 验收清单
- [x] `0012_curation_review_events.sql` 创建 append-only 终审事件，事件带 holder、subject、statement、as_of、provenance 和 supersession 关系。
- [x] 同一 decision 只能产生一条终审事件；重复终审返回冲突且不覆盖历史。
- [x] AI recommendation、signals、policy、model、decided_at 永远保持不变。
- [x] review-only 数据库角色只能执行统一终审函数，不能直接读写事件表或基础表。
- [x] operations 只读 API 返回 AI 判断和人工判断事件，不暴露 review reason 以外的敏感信息。
- [x] 后台详情并列显示 AI 判断与人工判断的五位结构和取代链。
- [x] `npm run typecheck && npm test && npm run build` 通过。
- [x] `npm run test:release --workspace @opendesign/library-admin-api` 通过完整 0002–0012 迁移和权限矩阵。
- [x] `python3 -m unittest discover -s scripts/tests -p 'test_*.py'` 通过。

## 实现约束
- 单一回写守卫仍是 `opendesign_admin_read.review_curation_decision(...)`。
- 使用 PostgreSQL 事务和唯一约束保证幂等；禁止应用层先查后写。
- AI 记录是 agent holder；人工事件是 user holder。`subject_id` 必须是 discovery UUID 外键。
- `as_of` 是判断成立时间；数据库写入时间单列为 `recorded_at`。
- provenance 指向 AI decision/policy/model 或 human review/API request，不存 Cookie、IP、密码、连接串。
- UI 成功后只更新本地快照；真实事实仍以重新读取 API 为准。

## 状态
done
