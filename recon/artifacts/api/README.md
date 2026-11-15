# recon/artifacts/api — MIC 上游接口证据与样例（api-mapper, 2026-11-15）

配套文档：[`docs/upstream-api.md`](../../../docs/upstream-api.md)
机器可读端点清单：[`endpoints.json`](endpoints.json)
可复现请求脚本：[`request-examples.sh`](request-examples.sh)

采集环境：纯 HTTP（curl），无浏览器。移动端接口用 desktop UA 亦可，公司页用 iPhone UA（桌面 UA 会 302 到 PC 迷你站）。全部为**匿名**请求（不登录）。

## 目录

| 路径 | 内容 |
|---|---|
| `endpoints.json` | 22 个端点：方法/URL/参数/必需头/鉴权/风控/响应格式/样例路径 |
| `request-examples.sh` | 所有关键端点的 curl 复现脚本（含注释） |
| `mobile-search/` | **主接口** `POST m.made-in-china.com/search/supplier` 与 `GET /search/supplier/refine`、`POST /search/product`、`/search/product/refine` 的响应样例；另有 SSR `props` 样例 |
| `mobile-company/` | `m.made-in-china.com/company-<账号>/info.html` 内嵌 `ssrData` JSON（钻石/金牌公司各 1–2 家）+ 首页 ssrData + contact 页匿名可见字段 + `e2e-list-to-detail-validation.json`（列表 csLevel↔详情 memberLevel 一致性校验） |
| `company-json/` | SGS 审核章节、响应率、TM 联系人、TM 在线状态、公司评分/评价 JSON |
| `suggest/` | 搜索联想接口 raw 响应（`null({...})`）与解析后的 `suggest-parsed.json`（含中文=空、英文前缀匹配证据） |
| `filters/` | 移动 JSON 过滤器字典（facet-dictionaries.json / province-list.json）与桌面 SEO 过滤码全集+count（seo-filter-codes.json） |
| `keywords/` | 地区词×关键词 matrix（total/首 3 条/桌面行为） |
| `desktop/` | 桌面搜索/SEO 过滤页的 HTTP 行为矩阵、审核报告页 HTML 样例 |
| `headers/` | 关键响应头证据：CORS、302/301 样例、缺 XHR 头的 404 等 |

## 关键实测结论（详细见 docs）

1. **供应商列表有 JSON API**：`POST https://m.made-in-china.com/search/supplier`，匿名可用；必需头 `X-Requested-With: XMLHttpRequest`；20 条/页；返回 `total/totalPage/dataList[20]`（total>2000 封顶显示 `2,000+`）。
2. **过滤器参数**：`province`（英文省名）、`catCode`、`comBusinessType`、`managementCertification`、`memberLevel`（50=Diamond/30=Gold/`0,1,3`=Audited）、`annualRevenue`、`rdCapacity`；与 word AND 组合有效。**city 参数无效**（城市过滤只能本地按 item.city 过滤或走 SEO 页）。
3. **公司详情有结构化 JSON**：`/company-<账号>/info.html` 页内 `<script type="text/json" id="ssrData">`，含 `memberLevel/memberSince/sgsMember/establishment/businessTypes/mainProducts/reviewStatistics/companySymbol`；HTML 正文另有员工数/地址/认证文本（匿名）。
4. **增强 JSON**：审核章节 `multi-search/sgs/report?comId=<encodeComId>`、响应率 `data.made-in-china.com/extend/busiMerge/replyRate`、联系人 `im.do?xcase=getSubAccount`、在线状态 `ajaxfunction.do?xcase=getTmStatus`、评价 `m.../user/review/front/next` —— 全部匿名。
5. **产品搜索有 JSON**：`POST /search/product`（36/页，total 不封顶）；GET HTML 会触发 Focus Captcha。
6. **中文关键词 0 结果**（英文站）；`hebei`/`shijiazhuang`/`hebei shijiazhuang` 等英文地区词可作关键词命中，但不是严格地区过滤。
7. **风控**：JSON 接口轻；m 站偶发 302（重试恢复）、公司页偶发 Focus Captcha、SEO 页 flaky（匿名 200/302 混合，warm cookie 稳定）；旧 cookie 重放可能反而触发验证。

## 采集口径说明

- 采集时间：2026-11-15 22:32–22:50（Asia/Shanghai）。
- `*.full.json` 为完整响应；普通 `*.json` 样例中 `dataList` 被截断到 2 条并带 `_note` 标记（保持仓库轻量）。`_note`/`_meta` 字段为人工标注，非服务端字段。
- `headers/*.txt` 为 curl `-D` 原始响应头（含 `server: TencentEdgeOne`、`set-cookie` 等；可据此判断 302 为边缘风控）。
- 端点行为可能随站点风控策略变化；复测用 `request-examples.sh`。
