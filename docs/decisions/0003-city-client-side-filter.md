# ADR-0003：城市筛选在客户端按 `city` 字段过滤

- 状态：Accepted
- 日期：2026-11-15
- 关联：[05 数据与缓存](../05-data-and-cache.md)、[03 REST API](../03-rest-api.md)、[research/upstream-api.md](../research/upstream-api.md) §3.9

## 背景

- m 站 JSON 搜索接口支持 `province`（英文省名）过滤，但**没有 city 参数**：`city` / `cityName` / `comCity` 均被上游忽略（实测结果与不传一致）；
- 桌面 SEO `company-search` 页支持城市级过滤（`CC_<Province>_<City>`），但匿名访问 flaky（200/302/Focus Captcha 混合），且与 JSON 口径不同（glass+Hebei：SEO 1299 vs JSON 669，不能混用）；
- JSON 列表的每条记录**自带 `city` 与 `province` 字段**，且结果页 20 条，翻页完整（末页夹取）。

## 决策

1. `city` 过滤在**客户端**完成：按 `province` 拉取全部分页（受 total/totalPage 约束）后按 `item.city` 过滤；
2. 在响应 `meta.warnings` 中标注城市过滤方式与覆盖率（例如 `city_filter=client_side`、`scanned_pages=N`、`matched=M`）；
3. SEO 城市页不进入主链路，仅作为可选交叉校验/兜底（浏览器内访问）；
4. 由于 `total` 超过 2000 会显示 "2,000+" 且分页上限存在，城市过滤结果**非穷尽**，需在 API 文档与 CLI 输出中明确说明。

## 后果

**正面**：不依赖 flaky 的 SEO 页；实现简单；数据来源与口径统一（JSON）。
**负面**：城市查询需翻多页（时延↑、请求数↑），并受 2000 条封顶影响；跨城市噪声需后置校验。
**缓解**：缓存（列表按参数+页缓存）、限速、single-flight；对常见城市可缓存“省全量索引”；必要时可选 SEO 城市页交叉校验。

## 替代方案

- **只用 SEO 城市页**：覆盖城市精确，但 flaky、慢、口径不同 → 不作为主链路。
- **要求用户必须传 province**：减少翻页，但破坏“只按城市查”体验 → 保留（城市查询自动推导 province，如 Langfang→Hebei）。

## 证据

- `docs/research/upstream-api.md` §3.9（JSON 缺口与 SEO 回退）
- `recon/notes.md` §5.4（城市词结果与噪声）
- `recon/artifacts/region-mode/`（地区模式验证）
