# tests/company fixtures（M2 公司详情/增强）

来源均为 **2026-11-15 匿名实测快照**（`recon/artifacts/`），供 M2（公司详情 + 会员识别 + 增强）离线单测使用。
所有 fixture 均不含登录态、Cookie、账号私有数据；公司公开档案信息仅用于回归测试。

| 路径 | 来源 | 说明 |
|---|---|---|
| `ssr-data/xingchenglass-info.json` | `recon/artifacts/api/mobile-company/xingchenglass-info-ssrData.json` | diamond / memberSince=2025 / sgsMember=true / stars=2 / rating 4.9/5 |
| `ssr-data/hnfinsulation-info.json` | `recon/artifacts/api/mobile-company/hnfinsulation-info-ssrData.json` | gold / memberSince=2025 / sgsMember=true / establishment=2019-12-20 |
| `ssr-data/lvxingmirror-info.json` | `recon/artifacts/api/mobile-company/lvxingmirror-info-ssrData.json` | diamond / memberSince=2018（since_year 解析回归） |
| `ssr-data/numeric-1800987236-home.json` | `recon/artifacts/api/mobile-company/numeric-1800987236-home-ssrData.json` | 数字 comId 页（含 logUsername），301 反查回归备用 |
| `ssr-data/freesampleco-info.json` | 由 `hnfinsulation-info.json` 派生（删除会员/认证/评分字段，`isDiamondMember=false`） | free 等级候选（无徽章、无 AS） |
| `ssr-data/unknownco-info.json` | 由 `freesampleco-info.json` 派生（`isDiamondMember=null`） | unknown 等级（无任何证据） |
| `html/xingchenglass-info.html` | `ssr-data/xingchenglass-info.json` + 正文标签块 | 正文员工数/地址/认证体系取自 `docs/research/upstream-api.md` §3.4 实测（Employees: 21、地址同 docs/03 §8.5、ISO 9001/BSCI） |
| `html/lvxingmirror-info.html` | `ssr-data/lvxingmirror-info.json` + 正文标签块 | memberSince=2018（since_year 回归）；正文地址仅示意 Qinhuangdao |
| `html/hnfinsulation-info.html` | `ssr-data/hnfinsulation-info.json` + 正文标签块 | 正文 Employees: 80 / Certification: ISO9001:2015, ISO14001, Others / 地址取自 research §3.4 |
| `html/freesampleco-info.html` / `html/unknownco-info.html` | 同上派生 | 会员/认证缺失场景 |
| `html/challenge-edgeone.html` | 复刻 2026-11-15 实测 EdgeOne JS challenge 响应（987B，`__tst_status`/`EO_Bot_Ssid`）| 挑战页判别回归（不作恶意用途） |
| `html/no-ssrdata-info.html` | 手工构造 | `ssrData` 缺失（UPSTREAM_CHANGED） |
| `html/invalid-ssrdata-info.html` | 手工构造 | `ssrData` 非法 JSON（PARSE_ERROR） |
| `html/broken-companyinfo-info.html` | 由 hnf ssrData 派生（code=500）| 契约校验失败（UPSTREAM_CHANGED） |
| `enrich/sgs-sections.json` | `recon/artifacts/api/company-json/sgs-audit-report-sections-salienceglass.json` | SGS 9 章节，5 已审 |
| `enrich/reply-rate.json` | `recon/artifacts/api/company-json/reply-rate-salienceglass.json` | 平均 1.74h / 及时率 1.0 / range ≤1.74h |
| `enrich/tm-sub-accounts.json` | `recon/artifacts/api/company-json/tm-sub-accounts-salienceglass.json` | TM 子账号 4 人（salienceglass 原始结构） |
| `enrich/tm-sub-accounts-xingchenglass.json` | 按上例结构复刻，encodeComId 换成 `xingchenglass` 的 `UCJfyzwThnqK` | 服务层端到端联系人映射（docs/03 §8.5 示例 cindy / `UCJfyzwThnqK_00`） |
| `enrich/reviews.json` | `recon/artifacts/api/company-json/company-reviews-xingchenglass.json` | 评分 5、totalCount=24（截断为 2 条） |

> 说明：m 站 `info.html` 原始 HTML 未入库（抓取时命中 EdgeOne 挑战，见 `docs/research/anonymous-completeness.md` §4.4），
> 故 HTML fixture 以 recon 的 `ssrData` JSON + research 实测正文标签值构造；解析器对真实页面的
> `<label>: <value>` 结构容错（换行/块级标签/实体/单行压缩文本均已覆盖）。
