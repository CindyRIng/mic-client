# MIC 上游可编程接口调研（v1，2026-11-15）

> 目标：为「Made-in-China 本地客户端」找出可替代 HTML 解析的 **JSON/AJAX/移动站接口**，覆盖「按省市/keyword 搜工厂 → 列表（分页/总数/过滤）→ 公司详情 → 会员等级/认证/评分」全链路。
> 探针环境：纯 HTTP（curl）+ 浏览器导出 cookie 可选；**未使用浏览器**。全部结论来自 2026-11-15 22:32–22:50 的实测。
> 原始证据与样例：`recon/artifacts/api/`（索引见 `recon/artifacts/api/README.md`，机器可读清单 `endpoints.json`，可复现请求 `request-examples.sh`）。

---

## 0. TL;DR（结论先行）

**找到 3 个可直接替代 HTML 解析的 JSON 接口（全部匿名可访问，无需登录、无需浏览器）：**

| # | 能力 | 接口 | 格式 |
|---|---|---|---|
| 1 | **供应商搜索列表**（关键词+省+类目+会员等级+认证+营收+经营模式+R&D 能力，分页、total、每页 20） | `POST https://m.made-in-china.com/search/supplier` | JSON |
| 2 | **搜索过滤器字典**（省/市/类目/认证/会员等级/营收/经营模式，带 count） | `GET https://m.made-in-china.com/search/supplier/refine` | JSON |
| 3 | **公司详情**（名称/会员等级/Since/认证/成立年份/员工数/认证/地址/主营/评分） | `GET https://m.made-in-china.com/company-<账号>/info.html` → 页内 `<script type="text/json" id="ssrData">` | 结构化 JSON（嵌在 HTML 内） |

**另外挖到 6 个可用的补充 JSON 接口**：SGS 审核报告章节、平均响应时间/响应率、联系人（TradeMessenger 子账号）、TM 在线状态、公司评分/评价、搜索联想（带关键词结果量）。
行业搜索 + 产品搜索也都有 JSON 版本（`POST /search/product`），产品列表 36 条/页。

**关键限制（已实测确认）：**
- `word` 关键词仍**必填**（空关键词会触发 Focus Captcha）；不能只按省/市列举。
- **省过滤**已在 JSON 接口内原生支持（`province=Hebei`，英文省名）；**城市过滤和员工数过滤只在桌面 SEO 页 `company-search` 上**（HTML，匿名访问时好时坏，需要重试/暖 cookie）。但注意：搜索结果 JSON 里**每条都有 `city` 字段**，所以「先按省拉取、再客户端按城市过滤」完全可以替代服务端城市过滤（推荐做法）。
- **中文关键词 = 0 结果**（这是英文站；`河北`、`玻璃` 均返回 `total:0`，桌面页显示 "0 supplier found"）。
- 所有 JSON 接口都要求 `X-Requested-With: XMLHttpRequest` 头（m 站网关靠它路由，缺了直接 404）。
- 风控整体**很轻**：JSON 接口基本不限流；偶发 302/验证页（m 站公司页、SEO 页、产品搜索 GET）；带 cookie jar 的顺序请求 + 间隔 1.5–2.5s + 302 重试即可稳定。

---

## 1. 访问方式与通用事实

| 项 | 结论 | 证据 |
|---|---|---|
| 是否需要登录 | 全部核心接口**不需要**（匿名 200 + 完整 JSON） | `mobile-search/*.anon-no-cookie.json` 等 |
| 是否需要 cookie | **不需要**：本次 JSON / 公司页 / SEO 页均可用无 cookie 请求成功；带 warm 的 probe10 会话 cookie 也全部 200。若遇到 302/验证页，优先重试干净会话（见 §6） | `headers/seo-page-anon-200-sample.txt` |
| 是否必须浏览器 | **不需要**（本次全部用 curl 完成） | `request-examples.sh` |
| 必需请求头 | `X-Requested-With: XMLHttpRequest`（m 站 JSON 网关必需）；表单体用 `Content-Type: application/x-www-form-urlencoded`；公司页用移动端 UA 更稳 | `headers/get-refine-404-without-xhr-header.txt` |
| CORS | m 站 JSON 接口开启 CORS（回显 `Origin`，`allow-credentials: true`），浏览器端也能直接调 | `headers/post-search-supplier.cors-headers.txt` |
| 边缘节点 | `server: TencentEdgeOne`（说明 302 多为边缘风控/会话绑定，不是源站不可用） | 各 headers 样例 |
| 速率实测 | 1.5–2.5s/请求、总计约 120 次请求，无封禁；高峰期偶发 302（重试即恢复） | 见 §6 |

---

## 2. 接口总清单（机器可读版：`recon/artifacts/api/endpoints.json`）

优先级 P0 = 客户端主链路，P1 = 详情增强，P2 = 辅助/风控较高。

| P | ID | 方法 | URL | 鉴权 | 风控 | 用途 |
|---|---|---|---|---|---|---|
| P0 | mobile-supplier-search | POST | `m.made-in-china.com/search/supplier` | 匿名 | 低 | 供应商列表 JSON（分页+total+省/类目/会员/认证过滤） |
| P0 | mobile-supplier-refine | GET | `m.made-in-china.com/search/supplier/refine` | 匿名 | 低 | 过滤面板字典 + 各选项 count |
| P0 | company-info-mobile | GET | `m.made-in-china.com/company-<账号>/info.html` | 匿名 | 中（偶发验证页） | 公司详情 ssrData JSON（会员等级/Since/认证/成立/员工/地址/评分） |
| P0 | seo-company-search | GET | `www.made-in-china.com/company-search/<kw>/C1--.../<page>.html` | 匿名（flaky） | 高 | 城市级/员工数级过滤（JSON 缺失项的回退通道） |
| P1 | mobile-product-search | POST | `m.made-in-china.com/search/product` | 匿名 | 低（GET HTML 会验证，POST 不会） | 产品列表 JSON（36/页，含所属公司摘要） |
| P1 | mobile-product-refine | GET | `m.made-in-china.com/search/product/refine` | 匿名 | 低 | 产品过滤字典 |
| P1 | mobile-search-ssr-page | GET | `m.made-in-china.com/search/supplier?word=..&page=N` | 匿名 | 低 | 搜索页 SSR 全量 props（含 refineModels/appliedFilters） |
| P1 | sgs-audit-report-sections | GET | `www.made-in-china.com/multi-search/sgs/report?comId=<encodeComId>` | 匿名 | 低 | 审核报告 9 个章节有哪些已审 |
| P1 | reply-rate | GET/POST | `data.made-in-china.com/extend/busiMerge/replyRate` | 匿名 | 低 | 平均响应时长/及时回复率（近 30 天） |
| P1 | tm-sub-accounts | GET | `www.made-in-china.com/im.do?xcase=getSubAccount` | 匿名 | 低 | 公司联系人（TM 子账号名） |
| P1 | tm-online-status | GET | `www.made-in-china.com/ajaxfunction.do?xcase=getTmStatus` | 匿名 | 低 | 联系人在线状态 |
| P1 | company-reviews | GET | `m.made-in-china.com/user/review/front/next` | 匿名 | 低 | 公司评分/评价列表 |
| P1 | suggest-supplier | GET | `keywordsuggestions.made-in-china.com/suggest/getEnSupplierSuggest.do` | 匿名 | 低 | 供应商搜索联想（带结果量 count） |
| P1 | suggest-product | GET | `keywordsuggestions.made-in-china.com/suggest/getEnProdSuggest.do` | 匿名 | 低 | 产品搜索联想（带类目 catCode/enc） |
| P2 | head-gethead | GET | `www.made-in-china.com/head.do?xcase=getHead` | 匿名 | 低 | 登录态探针 |
| P2 | head-entrances | GET | `www.made-in-china.com/head.do?xcase=entrances` | 匿名 | 低 | 顶部导航菜单 JSON |
| P2 | head-basket | GET | `www.made-in-china.com/head.do?xcase=getBasketNum` | 匿名 | 低 | 询盘篮数量 |
| P2 | keyword-history | GET | `www.made-in-china.com/ajaxfunction.do?xcase=getKeywordHistory` | 匿名（读 cookie） | 低 | 最近搜索词 |
| P2 | youMayLike | GET | `www.made-in-china.com/multi-search/ajax/youMayLike4Com` | 匿名 | 低 | 相关产品推荐 |
| P2 | spotlight | GET | `www.made-in-china.com/multi-search/ajax/spotlightForCom` | 匿名 | 低 | 聚光产品推荐 |
| P2 | audited-report-page | GET | `<host>.en.made-in-china.com/audited-supplier-reports/report.html` | 匿名 | 中 | 审核报告页面（会 301 到公司页 `?xcase=auditReport`） |
| P2 | audit-report-detail | GET | `www.made-in-china.com/auditReport.do?xcase=viewReportDetail` | **需登录** | - | 302 登录，匿名不可得 |

---

## 3. 核心接口详解

### 3.1 供应商搜索 JSON（★主接口）

```
POST https://m.made-in-china.com/search/supplier
X-Requested-With: XMLHttpRequest
Content-Type: application/x-www-form-urlencoded

word=glass&page=1[&province=Hebei][&catCode=1500000000][&memberLevel=50][&managementCertification=-5][&comBusinessType=1][&annualRevenue=3][&rdCapacity=4]
```

**请求参数**

| 参数 | 必填 | 说明 |
|---|---|---|
| `word` | ✅ | 英文关键词；空 → Focus Captcha，`word=*` 空结果 |
| `page` | - | 从 1 开始；超过 totalPage 会被**夹到最后一页**（page=101 对 glass 返回 page=100 的内容） |
| `pageSize` | - | 默认 20。**实测：传 100 时响应 `pageSize=100`、`totalPage=20`，但 `dataList` 仍然只有 20 条** → 客户端固定用 20，翻页用 `page` |
| `province` | - | 英文省名（31 个，见 `filters/province-list.json`）。**非法/中文值 → total=0（不是忽略）** |
| `catCode` | - | 类目代码（移动 refine 只给 top-10；见 `filters/facet-dictionaries.json`） |
| `comBusinessType` | - | `1`=Manufacturer/Factory，`2`=Trading Company，`4`=Group Corporation，`8`=Other |
| `managementCertification` | - | ISO 等认证代码，如 `-5`=ISO9001:2015、`6`=ISO 14001、`10`=ISO 9001、`20`=BSCI…（共 44 项，见字典） |
| `memberLevel` | - | `50`=Diamond Member、`30`=Gold Member、`0,1,3`=Audited Supplier（逗号组合，实测有效） |
| `annualRevenue` | - | `1`=<1M USD、`2`=1~2.5M、`3`=2.5~5M、`4`=5~10M、`5`=10~50M、`6`=50~100M、`7`=>100M |
| `rdCapacity` | - | `4`=OEM、`5`=ODM、`01`=Quick Response、`02`=Fast Delivery、`03`=Small-amount payment |

**响应 JSON（顶层字段）**

```json
{
  "total": 669, "totalNum": "669", "page": 1, "pageSize": 20, "totalPage": 34,
  "dataList": [ /* 20 条公司 */ ],
  "dataFromCorrect": false, "correctKey": null, "correctResultNum": 0,
  "needSuggest": false, "redirectUrl": null, "crawlerFspError": false,
  "startIndex": 0, "adList": null, "calassifyWords": null,
  "showPlanB": false, "searchLanguageCode": "0", "searchTransEn": null, "foreignVisit": false
}
```

> `total` 规则：**>2000 时封顶 2000，`totalNum` 显示 `"2,000+"`（totalPage=100）**；过滤后 <2000 时是精确值（如 `glass&province=Hebei` → 669；`managementCertification=-5` → 1671；`annualRevenue=5` → 116；`province=Hebei&memberLevel=50` → 522；五条件组合 → 45）。

**`dataList` 单条公司字段（★客户端列表可直接用）**

| 字段 | 语义/示例 |
|---|---|
| `id` | 数字 comId（1752301672） |
| `name` | 公司名 |
| `mainUserAccount` | 迷你站账号（`salienceglass`，对应 `salienceglass.en.made-in-china.com`） |
| `encodeComId` | 加密 comId（`bSrtEKgyYcUf`）——调用 SGS 报告/回复率/联系人接口要用它 |
| `csLevel` | **会员等级码：50=Diamond，30=Gold，无=免费/未知**（实测 430 条 50/88 条 30） |
| `memberType` | 实测 10↔Diamond、1↔Gold（与 csLevel 等价，建议以 csLevel 为准） |
| `auditType` / `showAuditLogo` | 认证供应商：1/true=已认证（SGS/BV 等第三方验厂）；0/false=无 |
| `city` / `province` / `country` | 城市、省（英文，如 `Langfang` / `Hebei` / `China`）→ **客户端城市过滤的数据基础** |
| `mainProduct` | 主营产品（逗号分隔） |
| `businessTypeList` | `["Manufacturer/Factory","Trading Company"]`（可多值） |
| `systemCertificationList` | `["ISO 9001","ISO 14000",...]` |
| `comOwnerShip` | 公司性质（Limited Company / …） |
| `comTurnOver` / `comPlantArea` / `comEmployee` | 营收/厂区/员工（多为空，详情页更全） |
| `companySymbol.stars` | Supplier Capability Index 星级（0–5） |
| `companyUrl` / `companyInfoUrl` | 移动站公司页（`https://m.made-in-china.com/company-<账号>/`、`.../info.html`） |
| `productReduce[]` | 公司下推荐产品（id/name/url/图片/价格） |
| `quickResponse` / `fastDelivery` / `leadingFactory` / `rdCapacityList` | 各种服务/能力标签 |
| `showAd` / `ad` / `advertise` | 是否是广告位（**前几条常是广告，做纯净列表要过滤 `ad`/`showAd`**） |
| `companyUrl` 另见 `trafficComUrl` | 带广告追踪参数版本 |

**可用性**：2026-11-15 匿名实测稳定；需 cookie 场景：无。样例：`mobile-search/supplier-search-glass-p1.full.json`（完整 20 条 × 全字段）、`supplier-search-province-hebei.json`、`supplier-search-province-hebei-diamond.json`、`supplier-search-multifilter.json`。

### 3.2 过滤器字典 JSON（facet）

```
GET https://m.made-in-china.com/search/supplier/refine?word=glass&page=1[&province=Hebei]
X-Requested-With: XMLHttpRequest
```

响应是数组：`[{value, subject, childs:[{name, value, count}], categoriesRefine}]`。
- 无过滤时 7 组：`catCode`(Categories, top-10)、`comBusinessType`、`managementCertification`(44)、`memberLevel`(3)、`province`(31)、`annualRevenue`(7)、`rdCapacity`(5)。
- 施加过滤后 count 变为**当前过滤作用域内**的数量（如 glass+Hebei 时 `comBusinessType` 只剩 3 项、`province` 只剩 Hebei 1 项并出现 `rdCapacity`）。
- `memberLevel` 的 Audited Supplier 值就是 `"0,1,3"`。
- ⚠️ 移动接口**没有城市 facet，也没有员工数 facet**（这两项只有桌面 SEO 页有，见 §3.8）。

样例：`mobile-search/supplier-refine-glass.json`、`supplier-refine-glass-hebei.json`、汇总字典 `filters/facet-dictionaries.json`。

### 3.3 搜索页 SSR props（备用）

`GET https://m.made-in-china.com/search/supplier?word=glass&page=1` 返回 HTML，其中
`<script type="text/json" id="props">` 内含与 §3.1 完全同构的 JSON：`dataList / appliedFilters / refineModels / page / pageSize / totalPage / total / searchWord / i18n`。
用途：`refineModels` 与 JSON refine 同源；`appliedFilters` 可回显当前 URL 过滤。**优先用 POST JSON，SSR 作为兜底/调试**。样例：`mobile-search/supplier-search-ssr-props-glass.json`。

### 3.4 公司详情（mobile ssrData，★主接口）

```
GET https://m.made-in-china.com/company-<mainUserAccount>/info.html
User-Agent: 移动端 UA（用桌面 UA 会被 302 到 PC 迷你站）
```

页面内 `<script type="text/json" id="ssrData">`，结构：

```json
{
  "isDiamondMember": true, "comId": "1752301672", "logUsername": "salienceglass",
  "headInfo": {"logonBuyer": false, "userType": null, ...},
  "companyInfo": {"code":0,"success":true,"content":{
     "comId":"bSrtEKgyYcUf", "comName":"...", "memberLevel":"diamond",
     "memberSince":"2025",                      // 入驻/会员起始年 ★
     "sgsMember": true,                          // 认证供应商 ★
     "auditReportLogo": {...},                   // 认证徽章/文案
     "mainProducts":[...], "businessTypes":["Manufacturer/Factory & Trading Company"],
     "establishment":"2015-10-30",               // 成立日期 ★
     "reviewStatistics":{"rating":"4.9/5","reviewListUrl":"..."},
     "onlineTradeAble": true, "companySymbol":{"stars":"2","intStars":2},
     "logoUrl":"...", "om": true, "rd":["OEM"]  // OEM/ODM
  }},
  "suggestProducts": {"content":{"products":[{prodId,name,url,img550Url,unitPrice,minOrder}]}},
  "productFacetVo": {...}, "linkConfig": {"swrHomepageUrl":"...","swrContactUrl":"..."},
  "i18n": {...}
}
```

**路由等价关系**：`m.made-in-china.com/company/<数字comId>` → **301** → `/company-<账号>/`（可用数字 id 直接反查账号，响应头 `Location` 即可，见 `headers/mobile-company-numeric-301.txt`）。

**页面 HTML 里还有（匿名可见，ssrData 不含）**：`Business Type / R&D Capacity / Main Products / Year of Establishment / Rating / Number of Employees / Management System Certification / Address / Company Overview 长文本`。实测（本次抓取的 info.html 原文，未入库）：xingchenglass 页可解析出 `Number of Employees: 21`、完整中文地址、`Management System Certification`；hnfinsulation 页有 `Employees: 80 / Certification: ISO9001:2015, ISO14001, Others / Address`。
→ 公司详情推荐策略：**ssrData JSON 取等级/Since/认证/成立/评分/主营** + **从 info.html 正文取员工数/地址/认证文本**（同一次请求，正则稳定）。无需再走 PC 端 contact-info.html。
**contact 页**：`/company-<账号>/contact.html` 的 ssrData 与 info 相同（无电话邮箱），HTML 里有联系人姓名/职务/部门 + 城市级 Address；电话/邮箱需登录（手机端匿名不显示）。样例：`mobile-company/contact-page-visible-fields.json`。

> ⚠️ 公司页是**风控相对敏感**的端点：实测 15 次公司页请求出现 2 次 Focus Captcha（≈13%，`captcha.made-in-china.com/verification.html`，与公司/等级无关，随机）。建议：同 host 先拉 info 再拉 contact、串行 1.5s+、遇到验证页跳过并稍后重试，不要并发轰炸。端到端校验样例：`mobile-company/e2e-list-to-detail-validation.json`（列表 csLevel=50 ↔ 详情 memberLevel=diamond 一致）。

### 3.5 公司增强 JSON 接口

**a) SGS 审核报告章节**（哪些章节已审）
```
GET https://www.made-in-china.com/multi-search/sgs/report?comId=<encodeComId>[&lanCode=0]
```
- `comId` 必须用 **encodeComId**（如 `bSrtEKgyYcUf`）；用数字 id 会 **HTTP 500**。
- 匿名、无需特殊头。响应：`{"code":0,"data":[{"content":"General Information","audit":true}, ... 9 个章节]}`
- 样例：`company-json/sgs-audit-report-sections-salienceglass.json`

**b) 平均响应时长/及时回复率（响应率）**
```
GET/POST https://data.made-in-china.com/extend/busiMerge/replyRate
  date=YYYYMMDD   # 参考日（页面 JS 取 today-2d）
  comId=<encodeComId>
  operatorNo=all
```
- 响应：`{"status":1,"data":[{"calNumber":"20261113","comId":"1752301672","l30BusiIntimeReplyRatio":1,"l30BusiReplyDurAvg":1.74,"l30TopIntimeReplyRatio":1,"l30TopReplyDurAvg":0.39,"l30BusiReplyDurAvgRange":"≤1.74h"}]}`
- 匿名可用（带/不带 cookie 均可）。样例：`company-json/reply-rate-salienceglass.json`

**c) 联系人（TradeMessenger 子账号）**
```
GET https://www.made-in-china.com/im.do?xcase=getSubAccount&comIdStr=<encodeComId1,encodeComId2,...>[&callback=cb]
```
- 匿名；返回 `{"<encodeComId>":[{"name":"Lisa","id":"<encodeComId>_00"},{"name":"Kaia",...}]}`（可批量，逗号分隔）
- 样例：`company-json/tm-sub-accounts-salienceglass.json`

**d) TradeMessenger 在线状态**
```
GET https://www.made-in-china.com/ajaxfunction.do?xcase=getTmStatus&user_ids[]=<encodeComId>_00&user_ids[]=<encodeComId2>_00[&callback=cb]
```
- 匿名；返回 `{"<encodeComId>_00":{"online":true,"status":1}}`。样：`company-json/tm-online-status-salienceglass.json`

**e) 公司评分/评价列表**
```
GET https://m.made-in-china.com/user/review/front/next?pageNum=1&sortType=1&foldFlag=false&reviewType=0&receiverComId=<encodeComId>&prodId=
X-Requested-With: XMLHttpRequest
```
- `receiverComId` 用 **encodeComId**（数字 id → `{"code":900004,"err":"invalid param"}`）。
- 响应 `content.reviewSearchItemVOList[]`：`overallReview`(评分)、`reviewContent`、`reviewId`、`sourceType`、`sourceId`(产品)、`receiverComName`、`senderIpCountry`、`senderName`(打码)、`titleText`、`productImgUrl` 等；`content.totalPage` 分页。
- 样例：`company-json/company-reviews-xingchenglass.json`

### 3.6 搜索联想/建议（typeahead）

页面搜索框 `data-suggest="supplier"` 对应 XHR（配置内嵌在搜索页 HTML 的 `searchRegion.formParams.conditionParamsList`）：

```
供应商: GET https://keywordsuggestions.made-in-china.com/suggest/getEnSupplierSuggest.do
  ?param=<关键词>&kind=5&ad=1&id=MICSearchSuggest&count=10&ignoreCase=true&matchAnywhere=true&catflag=1
产品:   GET .../suggest/getEnProdSuggest.do?param=<关键词>&kind=5&ad=1&id=MICSearchSuggest&count=10&ignoreCase=true&matchAnywhere=true&catflag=1&seo=1
```

- 返回**JSONP 文本**：`null({"ads":[],"sug":[{"word","root","count","catCode","catName","enc","history","related":[{"linkWord","word"}],"replaceWord","rUrlMode"}]})`（固定前缀 `null(`，不支持自定义 callback）。
- 供应商 `sug[].count` = 该关键词的供应商结果数（可用于判断关键词热度/是否值得搜）；产品 `sug[]` 带 `catCode/catName/enc`，`related` 是长尾建议。
- **仅英文**：中文 param 返回 `sug:[]`；`lass` 返回空（前缀匹配），`gla` 命中 glass*。匿名、无需特殊头。样例：`suggest/suggest-parsed.json` + 各 raw 文件。

### 3.7 其它可复用 JSON

- `GET head.do?xcase=getHead` → 登录态探针：`{"login":false,"newMailNum":0,"inquiryBasketNum":0,...}`
- `GET head.do?xcase=entrances&lanCode=0` → 导航菜单 JSON（`[{name,link,hoverDesc,children}]`）
- `GET head.do?xcase=getBasketNum` → `{"basketNum":0}`
- `GET ajaxfunction.do?xcase=getKeywordHistory` → `{"type":"2","list":[{"word":"glass"}]}`（读 cookie 的最近搜索）
- `GET multi-search/ajax/youMayLike4Com?code=&buttonAdNum=5&neatWord=glass&page=1&word=glass&pageType=&from=huntc` → `{data:{prodList:[{prodUrl,hundredPicUrl,...}]}}`
- `GET multi-search/ajax/spotlightForCom?...` → 聚光产品数组
- `GET head.do?xcase=getBasketNum` 等头部接口均匿名。

### 3.8 产品搜索 JSON（P1）

```
POST https://m.made-in-china.com/search/product
X-Requested-With: XMLHttpRequest
Content-Type: application/x-www-form-urlencoded
word=glass&page=1[&catCode=1502080000][&province=Hebei]
```
- **每页 36 条**；`total` 不封顶（glass → 897,715，totalPage=834）；`page=2` 正常。
- `catCode` 过滤有效（1502080000=Tempered Glass → 19,050；`province=Hebei` → 52,858）。
- 单条字段：`id,name,url,imgUrl,price_num,price_unit,minOrder,inquiryUrl,auditType,showAuditLogo,memberType` + `company{id,name,province,country,businessType,cooperationYear,rdCapacityList}`。
- ⚠️ 产品搜索的 **GET HTML 会被 Focus Captcha**（`m.made-in-china.com/search/product?word=glass` → 303/验证页），但 **POST JSON 匿名直通**——必须用 POST。
- 过滤器字典：`GET /search/product/refine?word=<kw>&page=1`（catCode、industryProperty[Appearance/Shape/Steel Degree/Technics/Usage，复合编码]、comBusinessType、province、tradeFacet）。
- （`priceRange` 参数实测被忽略，价格区间过滤未找到可用参数。）

### 3.9 地区筛选：JSON 缺口与 SEO 回退通道

**JSON 接口覆盖**：`province`（31 省，英文名）✅；`city` ❌（`city=`/`cityName=`/`comCity=` 均被忽略）；员工数 ❌。

**SEO 公司筛选页（桌面站，HTML）**是唯一的城市级/员工数级入口：

```
https://www.made-in-china.com/company-search/<keyword>/C1[--<filter>...]/<page>.html
过滤器段（可组合，用 `--` 连接）：
  CP_<Province>             省      例 C1--CP_Hebei
  CC_<Prov>_<City>          城市    例 C1--CP_Hebei--CC_Hebei_Langfang   ★
  CD_<Category-Label>-Catalog 类目  例 CD_Construction-Decoration-Catalog
  MC_<id>                   管理认证 例 MC_-5 (ISO9001:2015)
  BT_<n>                    经营模式 例 BT_1 (Manufacturer/Factory)、BT_2 (Trading Company)
  AR_<n>                    年营收   例 AR_5 (10~50M USD)
  NE_<n>                    员工数   例 NE_2 (5-50 People) ★
  SGS_AS                    仅认证供应商
页面总数 = ceil(total/30)；超过末页 → HTTP 301。
```

- 实测：城市页 `C1--CP_Hebei--CC_Hebei_Langfang/1.html` → 30 行全部 `Langfang, Hebei`；`NE_2`/`MC_-5`/`BT_1`/`AR_5`/`SGS_AS` 均可用；省页第 10 页可用；`hebei` 关键词共 1101 条 → 37 页，page=38 → 301。
- 过滤面板自带全量字典 + count（`filters/seo-filter-codes.json`）：**32 省**（比移动 JSON refine 多 `Qinghai`——移动侧无结果项不出现；`province=Qinghai` 实测合法，只是 glass 下 0 条）、glass 下 Hebei 1299 条、河北 10 城（Shijiazhuang 215 / Hengshui 138 / Cangzhou 98 / Xingtai 71 / Baoding 55 / Langfang 45 / Handan 19 / Tangshan 14 / Qinhuangdao 13 / Zhangjiakou 1）、44 种认证、经营模式 4、营收 7、员工数 6 档。
- **风控（重要）**：匿名访问 **不稳定** —— 同样请求有时 200、有时 302（重定向到挑战/会话页）；带 warm 的 `pid/JSESSIONID` cookie 时 200（本次用 probe10 cookie 全部 200）。建议：维护 cookie jar → 首个请求允许 302/验证并重试 2–3 次（间隔 3–5s）→ 仍失败则降级为「按省 JSON 拉取 + 客户端按 `city` 字段过滤」（强烈推荐，见 §5）。
- ⚠️ 数量口径差异：SEO 页 facet 里 `glass+Hebei=1299`，而 m 站 JSON `total=669`。两套搜索的匹配口径不同（SEO 词目录 vs 移动搜索），**混用时以同一来源为准**。

**审计报告页（HTML，非 JSON）**：`https://<host>.en.made-in-china.com/audited-supplier-reports/report.html` → 301 到 `company-<Name>.html?isNewShowroomUrl=1&xcase=auditReport`，内容为审核报告 HTML（样例：`desktop/audited-supplier-report-fanyuan99.html`，匿名 200）；报告详情接口 `auditReport.do?xcase=viewReportDetail&comId=&recId=&org=` 需登录（302）。**结论：审核“哪些章节已审”用 §3.5a 的 JSON；报告正文匿名拿不全。**

### 3.10 已排除/确认不存在的项

- **公司 hover 卡片没有独立 JSON**：`verified_company_homepage` 弹层是**服务端内联在列表 HTML** 里的（`company-name-popup`），无 XHR，也没有可替代 API；其字段（logo、认证、主营、城市）在 §3.1 列表 JSON 里都有 → 客户端不需要它。
- 桌面搜索列表行内 `<script class="J-video-json">` 有 `csLevel/sgsMembership` 等，但字段远少于 §3.1 JSON → 不再需要解析。
- 空关键词搜索无纯地区列举（站点规则）；`word=*`、`word=all`、`word=china` 语义为关键词，不是地区列举。
- 会员中心（membercenter/login）接口（收藏/询盘/订单等）全部需登录，与本客户端目标无关。
- `replyRate` 数字 comId 返回 `data:null`；必须用 encodeComId。

---

## 4. 关键问题回答（任务 7/8）

### 4.1 能否用结构化参数替代关键词？——部分可以
- `province` / `catCode` / `memberLevel` / `managementCertification` / `comBusinessType` / `annualRevenue` / `rdCapacity` 都是结构化参数，可**与 keyword AND 组合**（实测 `province=Hebei&memberLevel=50&managementCertification=-5&catCode=1500000000&comBusinessType=1` → total=45）。
- 但 **`word` 仍必填**：无法只按省市枚举（空 word → 验证页）。客户端若只想按地区浏览，可用一个宽泛词（如 `glass`/`manufacturer`）+ province + 客户端 city 过滤，或直接遍历 SEO 地区页（风险更高）。

### 4.2 有分页/total 的 JSON 版本吗？——有
- 供应商：`total`（>2000 封顶）、`totalPage`（≤100）、`page`（20/页），JSON。
- 产品：`total`（不封顶）、`totalPage`、`page`（36/页），JSON。
- SEO 页：无 JSON total（HTML 分页 1–9 + 末页 301 可判定）。

### 4.3 地区词当关键词的行为矩阵（实测，`keywords/region-keyword-matrix.json`）

| word | JSON total | 桌面 HTML | 说明 |
|---|---|---|---|
| `glass` | 2,000+（封顶） | 有结果 | 对照 |
| `glass` + `province=Hebei` | **669** | 有结果（30/页） | ✅ 严格省过滤 |
| `hebei` | **1101** | 30/页，page≤37 | 关键词命中（多为公司名含 Hebei），**不是地区过滤** |
| `hebei shijiazhuang` | **421** | 30/页 | 双词 AND 匹配，实测全部 Shijiazhuang,Hebei |
| `shijiazhuang` | **1666** | 30/页 | 关键词命中；城市覆盖广 |
| `glass hebei` / `hebei glass` | **1102** | 有结果 | 词序无关，同 `hebei`+glass 词匹配 |
| `langfang` | **278** | - | 关键词命中 |
| `hebei` + `province=Hebei` | 1101 | - | 关键词结果全在河北 |
| `shijiazhuang` + `province=Hebei` | 1438（≠1666） | - | 省过滤会把非河北的“同名/相关”剔除 |
| `langfang` + `province=Hebei` | 245（≠278） | - | 同上 |
| `河北` / `玻璃` / `河北 glass` | **0** | **0 supplier found** | ❌ 中文零结果（英文站），`searchLanguageCode:"1"` 但不索引 |

**人机校验边界**：中文词不触发校验但返回 0；空 word / 部分异常词才触发 Focus Captcha；地区英文词正常。SEO 页本身是最容易被 302/校验的入口。

---

## 5. 推荐客户端架构（把 HTML 依赖降到最低）

```
关键词 + 省 + (会员/认证/类目) 
  → POST m.made-in-china.com/search/supplier  (匿名 JSON, 20/页, total/totalPage)
      ↓ 需要城市：在本地按 item.city 过滤（先按省拉取；省过滤把 2000+ 收敛到几百，成本可控）
      ↓ 需要员工数：JSON 不支持 → 要么接受缺这项，要么把 SEO 页当可选项（高失败率）
  → 公司详情：GET m.made-in-china.com/company-<mainUserAccount>/info.html (mobile UA)
      ssrData JSON → 等级/Since/认证/成立/评分/主营
      HTML 正文 → 员工数/地址/认证文本/公司简介
  → 增强（可选，均为匿名 JSON）：
      sgs/report?comId=<encodeComId>   → 审核章节
      replyRate (date/comId/operatorNo) → 响应率/响应时长
      im.do?xcase=getSubAccount         → 联系人姓名
      ajaxfunction.do?xcase=getTmStatus → 在线状态
      user/review/front/next            → 评分评价
```

- **会员等级判定优先级**（与文档 `docs/membership-tiers.md` 对齐）：公司 ssrData `memberLevel`（diamond/gold） > 列表 JSON `csLevel`（50/30） > `memberType`（10/1） > unknown；`memberSince` 仅详情 ssrData 有；`Audited Supplier` 看 `sgsMember`/`auditType`/`showAuditLogo`，与等级独立。
- **城市过滤建议**：JSON 已有 `city` 字段，先 province 过滤再本地 city 匹配，比 SEO 页稳定一个数量级；注意 SEO 与 JSON 的 total 口径差异（§3.9）。
- **翻页**：`page=1..totalPage`，20/页；超过 totalPage 会夹到末页，客户端应自行停。
- **广告过滤**：列表前几条可能是广告（`ad/showAd=true`、`deliveryType:"ads"`），需要“自然结果”时过滤掉。
- **去重**：广告可能在多页/多次请求重复；用 `id`（数字 comId）去重。

---

## 6. 风控/稳定性实测记录

| 端点/场景 | 观察 | 处理建议 |
|---|---|---|
| `POST /search/supplier`（m JSON） | 绝大多数 200；**高频连发时会短暂 302**（等 5–10s 后重试即 200；302 是边缘会话/限流） | cookie jar + 2s 间隔 + 302 后 backoff 重试 1–2 次 |
| `GET /search/supplier/refine` | 无 XHR 头 → 404（网关不路由）；带头稳定 200 | 必带 `X-Requested-With` |
| m 站公司页 info/contact | 15 次公司页请求 2 次 Focus Captcha（≈13%，随机；contact.html 与 info.html 都会出现）；成功时匿名返回完整 ssrData/HTML | 串行、先 info 后 contact、遇验证页跳过并隔几分钟重试；公司页请求不要并发 |
| `GET m /search/product?word=`（HTML） | 直接 Focus Captcha/303 | 改用 POST JSON |
| 桌面 `companysearch.do`（关键词/省） | 匿名 200 稳定（本次 10+ 次均 200）；页面 HTML 有时是“精简版”（10 行 vs 30 行） | 若保留 HTML 解析：别假设每页 30 行，用 `div.list-node` 计数 |
| 桌面 SEO `company-search/...` | **flaky**：匿名有时 200 有时 302；带 warm cookie 时 200；连续请求会触发 | 仅作回退；重试 2–3 次；失败就放弃（用 city 字段客户端过滤替代） |
| 旧/过期会话 cookie | Lead 更早期实测：SEO 页 cookie 重放拿到 987B JS challenge / 567（`__tst_status`）；本次使用新导出的 probe10 会话 cookie 则 SEO 页全部 200。若 302/验证反复出现，换一个干净会话或让浏览器过一次 challenge 后导出新 cookie | 优先重试干净会话；必要时用新导出的 cookie jar |
| 审核报告页 | 匿名可取（fanyuan99 200），但同名 host 的另一家触发验证页 | 非关键字段，失败可忽略 |
| 登录后接口（auditReport.do viewReportDetail 等） | 302 登录 | 客户端匿名模式下不依赖 |

---

## 7. 证据索引（`recon/artifacts/api/`）

| 路径 | 内容 |
|---|---|
| `endpoints.json` | 22 个端点机器可读清单（方法/参数/鉴权/风控/样例路径） |
| `request-examples.sh` | 全部关键端点可复现 curl 脚本 |
| `mobile-search/supplier-search-glass-p1.full.json` | 供应商搜索完整 20 条 × 全字段（canonical schema） |
| `mobile-search/supplier-search-province-hebei*.json` | 省过滤 669 / 省+钻石 522 |
| `mobile-search/supplier-search-multifilter.json` | 5 条件组合（45 条） |
| `mobile-search/supplier-refine-*.json` | facet 字典（无过滤 / glass+Hebei） |
| `mobile-search/supplier-search-ssr-props-glass.json` | SSR props（refineModels/appliedFilters） |
| `mobile-search/product-search-*.json` / `product-refine-glass.json` | 产品搜索/过滤 |
| `mobile-company/*-info-ssrData.json` | 3 家公司详情 ssrData（钻石/金牌、认证、成立、评分） |
| `mobile-company/salienceglass-home-ssrData.json` | 公司首页 ssrData（含推荐产品） |
| `mobile-company/contact-page-visible-fields.json` | contact 页匿名可见字段（联系人/地址） |
| `company-json/sgs-audit-report-sections-salienceglass.json` | SGS 审核章节 JSON |
| `company-json/reply-rate-salienceglass.json` | 响应率/响应时长 JSON |
| `company-json/tm-sub-accounts-salienceglass.json` | 联系人（TM 子账号） |
| `company-json/tm-online-status-salienceglass.json` | 在线状态 |
| `company-json/company-reviews-xingchenglass.json` | 评分/评价 |
| `suggest/suggest-parsed.json` + `*.raw.txt` | 联想接口响应（含中文为空、前缀匹配证据） |
| `filters/facet-dictionaries.json` | 移动 JSON 过滤器字典（省 31/认证 44/会员 3/营收 7/能力 5/经营模式 4/类目 10） |
| `filters/seo-filter-codes.json` | SEO 全量过滤码 + 32 省 count + 河北 10 城 count + 与 JSON 参数映射 |
| `filters/province-list.json` | 31 个英文省名（province 参数合法值） |
| `keywords/region-keyword-matrix.json` | 地区词×关键词矩阵（total/首 3 条/桌面行为/结论） |
| `desktop/seo-filter-page-matrix.json` / `desktop-search-keyword-matrix.json` | SEO 过滤页/桌面搜索 HTTP 状态、行数、城市抽样 |
| `desktop/audited-supplier-report-fanyuan99.html` | 审核报告页样例（HTML） |
| `headers/*.txt` | 关键响应头（CORS、302 样例、501/404 证据、301 重定向） |

---

## 8. 未解/待确认

1. 城市级过滤是否真的只能靠 SEO 页？（已试：`city`/`cityName`/`comCity`/URL 变体/移动 route 均无效；SSR refine 无城市 facet）。客户端用 `city` 字段本地过滤即可绕过。
2. 员工数过滤无 JSON（只有 SEO `NE_`）；若客户端需要该维度，只能接受 SEO 页的高失败率或放弃。
3. 产品搜索的价格区间过滤参数未找到（`priceRange` 无效）；产品 `industryProperty` 复合编码语义需按类目逐个验证。
4. SEO 页与 JSON 搜索的 total 口径差异（1299 vs 669）原因未深挖，可能为“关键词目录匹配” vs “搜索匹配”。
5. 高页码访问的极限（供应商 JSON 封顶 2000/100 页；更深处需换更细的过滤条件）。
6. 登录态是否解锁更多字段（电话/邮箱/完整审核报告）未验证（本任务只做匿名；task-4 有字段可见性审计）。
