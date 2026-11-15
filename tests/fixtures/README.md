# tests/fixtures — golden fixtures（测试用）

> 来源：`recon/artifacts/api/`（2026-11-15 匿名实测，见 [research/upstream-api.md](../../docs/research/upstream-api.md)）。
> 用途：离线契约/回归测试的 golden 数据；**测试只读，不得回写**。
> 维护：新增上游样例时先落 `recon/artifacts/api/` 并注明来源，再复制到此目录（保持同名同结构）。

## 1. 目录与文件

| 路径 | 内容 | 关键基线 | 使用测试 |
|---|---|---|---|
| `api/mobile-search/supplier-search-glass-p1.full.json` | `word=glass&page=1` 完整 20 条 × 全字段 | total=2000、totalNum=`"2,000+"`、totalPage=100、pageSize=20；含广告/等级/认证差异 | 分页、列表规范化、广告、tier |
| `api/mobile-search/supplier-search-province-hebei.json` | `word=hebei&province=Hebei`（dataList 截断为 2 条，带 `_note`） | total=1101、totalPage=56 | region 模式、缓存 |
| `api/mobile-search/supplier-search-province-hebei-diamond.json` | `province=Hebei&memberLevel=50`（截断 2 条） | total=522、totalPage=27 | 会员过滤 |
| `api/mobile-search/supplier-search-multifilter.json` | 5 条件组合（截断 2 条） | total=45、totalPage=3 | 过滤组合映射 |
| `api/mobile-search/supplier-refine-glass*.json` | 过滤器字典（无过滤/glass+Hebei） | 7 facet 组 | 字典/枚举校验（后续 M1+） |
| `api/filters/facet-dictionaries.json` | 字典汇总：province 31、memberLevel、certification 44、营收 7、能力 5、经营模式 4 | — | 枚举来源 |
| `api/filters/province-list.json` | 31 个英文省名（m 站 refine） | count=31 | 地区字典（32 省 = 31 + Qinghai，见 05） |
| `api/filters/seo-filter-codes.json` | SEO facet：32 省 + 河北 10 城 count | Hebei 1299、Langfang 45 等（SEO 口径，勿与 JSON 669 混用） | 城市字典/参照 |
| `api/keywords/region-keyword-matrix.json` | 地区词 × 关键词矩阵 | 669/1101/1666/278/1438/245/1102/0 | 地区模式基线 |
| `api/mobile-company/*-info-ssrData.json` | 公司详情 ssrData（钻石/金牌/钻石+stars=0） | xingchenglass: diamond/2025/2015-10-30；hnfinsulation: gold/2019-12-20；lvxingmirror: stars=0 | 会员合并、详情解析（M2 起） |
| `api/mobile-company/e2e-list-to-detail-validation.json` | 列表 csLevel ↔ 详情 memberLevel 一致性 | csLevel=50 ↔ diamond、auditType=1 ↔ sgsMember=true | 会员一致性 |
| `api/mobile-company/contact-page-visible-fields.json` | contact 页匿名可见字段解析样例 | xingchenglass/hnfinsulation | 正文补充（M2 起） |
| `api/company-json/sgs-audit-report-sections-*.json` | SGS 审核章节 | 9 章节、5 true/4 false | 增强契约（M2 起） |
| `api/company-json/reply-rate-*.json` | 响应率/时长 | `≤1.74h`、timely=1、avg=1.74 | 增强契约（M2 起） |
| `api/company-json/tm-sub-accounts-*.json` / `tm-online-status-*.json` | 联系人名单 / 在线状态 | 4 人（Lisa/Kaia/Luna/Amanda）/ `_00` online | 增强契约（M2 起） |
| `api/company-json/company-reviews-*.json` | 公司评价列表 | overallReview=5、senderName 打码 | 增强契约（M2 起） |
| `api/suggest/suggest-parsed.json` | 搜索联想响应（`null({...})` 解析后） | glass 34504、hebei 48、中文=0 | 联想（P2） |
| `api/headers/mobile-company-numeric-301.txt` 等 | 关键响应头（301/302/缺 XHR 头 404） | 302 → captcha | 挑战检测、重定向解析（M2 起） |

## 2. fixtures 使用规则

1. **只读**：测试通过 `tests/helpers/fixtures.ts` 的 `loadFixture()` 读取；不得修改本目录。
2. **截断标记**：`_note`/`_meta` 是人工标注，**不是上游字段**；映射测试应确认这些字段被忽略/不进入模型。
3. **派生数据**：多页拼接、page 夹取、total 封顶等场景在测试内用 `buildSearchPayload()`/`synthesizeItems()` 从 golden 行派生；派生文件只存在于内存，不落盘。
4. **口径纪律**：SEO 页 count（如 glass+Hebei=1299、Langfang=45）与 m 站 JSON total（669、245）**分属两套口径**，不得交叉断言。
5. **上游会变**：golden 是 2026-11-15 快照；live 回归（`scripts/e2e/live-smoke.mjs`）使用范围断言，发现契约变化先更新 `recon/artifacts/` 证据再改 fixtures。

## 3. 脱敏与安全

- 全部数据为**匿名公开**供应商档案（公司名/地区/主营/等级/认证/评分/公开联系人姓名），不含电话/邮箱/WhatsApp/微信（平台不公开，fixtures 中亦无）。
- `api/headers/*.txt` 为实测响应头副本，可能含 `set-cookie` 等**会话 cookie**：仅用于断言状态码/`Location`/头部语义；测试**不得**打印或持久化 cookie 值，日志断言不得包含敏感字段。
- 验证码图片/接口交换样本未复制到本目录（体积/敏感性原因）；验证码相关测试见 `recon/artifacts/captcha/` 与 [research/captcha-autosolve.md](../../docs/research/captcha-autosolve.md)。
- 如需对外发布本仓库，请先复核 `headers/*.txt` 中的 `set-cookie` 并脱敏。
