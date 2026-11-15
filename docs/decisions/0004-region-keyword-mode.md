# ADR-0004：地区词当 keyword 实现纯地区列举

- 状态：Accepted
- 日期：2026-11-15
- 关联：[01 需求](../01-requirements.md)、[03 REST API](../03-rest-api.md)、[recon/notes.md](../../recon/notes.md) §5.4

## 背景

用户需求包含「按省市搜索工厂，支持纯地区列举（不带产品关键词）」。站点约束：

- `word` **必填**，空关键词会触发 Focus Captcha；`word=*` 返回空结果；
- 中文关键词（河北/石家庄）返回 0 条（英文站）；
- 但**地区英文词可作为 keyword**：实测 `hebei`=1101、`shijiazhuang`=1666、`langfang`=278、`hebei shijiazhuang`=421（关键词命中）；
- 关键词命中 ≠ 地区过滤：`langfang` 首页 27/30 为 Langfang，其余为噪声；需按列表 `province/city` 字段后置校验。

## 决策

1. 客户端提供**地区模式**：仅给 `province`/`city` 时，内部构造地区词 keyword：
   - 省：`word=<Province英文名>`；
   - 市：`word=<City英文名>`（并自动推导 province 过滤）；
2. 同时传 `province` 结构化过滤收窄，并在客户端按 `city` 后置校验去噪；
3. 响应中标注 `search_mode = region|keyword|mixed` 与 `region_validated = true/false`；
4. 中文地区输入由地区字典映射为英文后再请求；无法映射时报 `INVALID_PARAM`（附可用值）。

## 后果

**正面**：满足纯地区列举需求且不依赖 flaky SEO 页；与关键词模式统一走 JSON 主链路。
**负面**：地区词是关键词匹配，结果可能有噪声/遗漏；覆盖度受 total 2000+ 封顶影响；并非真正“地区筛选”。
**缓解**：后置校验 + warnings；城市字典预校验；文档明确“样本非穷尽”。

## 替代方案

- **空关键词 + 地区筛选**：上游不支持（触发验证码）→ 不可行。
- **只用 SEO 地区页**：flaky 且口径不同 → 仅作可选校验。
- **暂不支持纯地区**：与用户需求冲突 → 不采用。

## 证据

- `recon/notes.md` §5.4（地区词矩阵）、§5.6
- `recon/artifacts/region-mode/`（langfang/shijiazhuang 结果与分页）
- `docs/research/upstream-api.md` §4.3（地区词矩阵）
