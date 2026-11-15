# 架构决策记录（ADR）

> 状态图例：Proposed（提议）｜Accepted（已采纳）｜Superseded（被取代）｜Deprecated（废弃）
> 记录规则：一个决策一篇；写清「背景 / 决策 / 后果 / 替代方案 / 证据」。实现变更若不改变决策，无需新增；改变决策必须新增或标注 Superseded。

## 索引

| ADR | 标题 | 状态 | 日期 |
|---|---|---|---|
| [0001](0001-json-first-upstream.md) | 上游数据获取采用 JSON 优先、HTML/浏览器兜底 | Accepted | 2026-11-15 |
| [0002](0002-browser-fallback-and-captcha.md) | 浏览器仅用于兜底；Focus Captcha 自动通过 + 人工 `mic auth` 兜底 | Accepted | 2026-11-15 |
| [0003](0003-city-client-side-filter.md) | 城市筛选在客户端按 `city` 字段过滤 | Accepted | 2026-11-15 |
| [0004](0004-region-keyword-mode.md) | 地区词当 keyword 实现纯地区列举 | Accepted | 2026-11-15 |
| [0005](0005-membership-tier-enum.md) | 会员等级枚举与 KA/SKA 边界 | Accepted | 2026-11-15 |
| [0006](0006-docs-first-workflow.md) | 文档先行（docs-first）工作流 | Accepted | 2026-11-15 |
| [0007](0007-local-runtime-and-secrets.md) | 本地单进程运行时、数据/profile 目录与密钥边界 | Accepted | 2026-11-15 |
| [0008](0008-rest-self-describing-docs.md) | REST 自描述文档端点（`/openapi.json` + `/docs`） | Accepted | 2026-11-16 |

## 模板

```markdown
# ADR-XXXX：标题
- 状态：Proposed/Accepted/Superseded
- 日期：YYYY-MM-DD
- 关联：FR/NFR、文档链接

## 背景
## 决策
## 后果（正面/负面）
## 替代方案与不采用原因
## 证据
```
