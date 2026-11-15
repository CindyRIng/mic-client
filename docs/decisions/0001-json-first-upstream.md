# ADR-0001：上游数据获取采用 JSON 优先、HTML/浏览器兜底

- 状态：Accepted
- 日期：2026-11-15
- 关联：[02 架构](../02-architecture.md)、[05 数据与缓存](../05-data-and-cache.md)、[research/upstream-api.md](../research/upstream-api.md)

## 背景

调查发现 MIC 存在**匿名移动站 JSON 接口**：

- 供应商列表：`POST https://m.made-in-china.com/search/supplier`（20/页、total/totalPage、丰富的结构化过滤参数、CORS 开启、仅需 `X-Requested-With: XMLHttpRequest` 头）；
- 公司详情：`GET https://m.made-in-china.com/company-<mainUserAccount>/info.html`，页内 `<script type="text/json" id="ssrData">` 含 `memberLevel/memberSince/sgsMember/establishment/mainProducts/…`；
- 增强数据：SGS 审核章节、响应率、联系人、在线状态、评分评价均有匿名 JSON。

相比之下，桌面站 HTML 需要解析、分页 30、风控更重（302→Focus Captcha / EdgeOne challenge），且 SEO 页与 JSON 口径不一致（glass+Hebei：SEO 1299 vs JSON 669）。

## 决策

1. **主链路全部使用 m 站 JSON**（搜索/详情/增强），纯 HTTP、无浏览器依赖；
2. HTML 解析保留为**兜底通道**（JSON 结构变更、接口不可用、需要 SEO 城市页交叉校验时）；
3. 浏览器（cloakbrowser）只用于验证码/JS challenge/兜底，不进入主链路。

## 后果

**正面**：实现简单（无 DOM 解析）、速度快、风控触发少、字段结构化且更全、测试可用 golden JSON。
**负面**：依赖未公开接口（可能无通知变更）；m 站字段命名不规范（需映射层）；JSON 无 city 参数、`pageSize` 固定 20、`total` 封顶 "2,000+"。
**缓解**：契约测试 + `UPSTREAM_CHANGED` 错误码 + 原始快照留档 + HTML 兜底；文档记录字段映射。

## 替代方案

- **只抓 HTML**：稳定但慢、风控重、解析维护成本高 → 不采用为主链路。
- **只抓 m 站 JSON**：拒绝 HTML 兜底 → 上游改版时无退路 → 不采用。
- **浏览器全链路**：最抗风控但慢且重 → 不采用。

## 证据

- `recon/artifacts/api/`（60 个样例、`endpoints.json`）
- `docs/research/upstream-api.md` §0–§3
- `recon/notes.md` §1、§5.6
