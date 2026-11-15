# ADR-0005：会员等级枚举与 KA/SKA 边界

- 状态：Accepted
- 日期：2026-11-15
- 关联：[01 需求](../01-requirements.md)、[05 数据与缓存](../05-data-and-cache.md)、[research/membership-tiers.md](../research/membership-tiers.md)

## 背景

用户最初提出「钻石会员、金牌会员、KA、SKA」四种套餐。调研结论（官方+实测）：

- MIC 公开可识别等级只有 **Diamond Member**（csLevel=50，59,800 元/年）与 **Gold Member**（csLevel=30，31,100 元/年），其余为**免费会员**（无徽章）；
- `优享/尊享/MKA` 是 MIC 大客户分层，官方明确「未纳入正式会员级别」，公网无独立徽章（后台 VO 有标志，前端推断显示为 Diamond），不可抓取；
- `KA/SKA/GSKA` 是**阿里巴巴国际站**客户分层（Key Account / Super Key Account / Group Super Key Account），MIC 页面/API 无任何标识；
- `Audited Supplier` 是独立第三方认证服务，与会员等级正交；
- 页面判定优先级：列表 JSON `csLevel` → 详情 ssrData `memberLevel/memberSince` → PC 公司站徽章 + `Since YYYY`（兜底）→ 未知。

## 决策

1. 对外 `membership.tier` 枚举固定为 **`diamond | gold | free | unknown`**；
2. `audited` 用独立布尔字段（非等级）；保留 `audit` 对象（机构/报告号/核验链接/已审章节）；
3. `membership.since_year` 对外字段（数据模型内部列 `member_since_year`；入驻/会员起始年，来源 `memberSince` / tooltip `Since YYYY`）；
4. **KA/SKA 不进入 tier**；预留 `external_customer_tier`（默认 null，由外部 CRM 回填），文档明确其阿里口径；
5. 判定必须保留 `evidence`（原始字段/文案/图标 URL），拿不准时返回 `unknown`，不猜。

## 后果

**正面**：字段语义清晰、可验证、不误判；避免把阿里术语混入 MIC 数据。
**负面**：若用户内部把某些客户叫 KA/SKA，客户端无法自动识别（需外部映射）。
**缓解**：`explain_membership()` 与文档解释口径；预留外部字段。

## 替代方案

- **tier 中增加 ka/ska**：与事实不符（MIC 无此标识）→ 不采用。
- **把 audited 合并进 tier**：语义错误（认证与等级正交）→ 不采用。
- **只返回原始徽章文案**：调用方难用 → 不采用（枚举 + raw/evidence 并存）。

## 证据

- `docs/research/membership-tiers.md`（官方链接、价格、判定优先级）
- `docs/research/membership-evidence/`（官方页摘录、IR 记录、样本 HTML）
- E2E 校验：列表 `csLevel=50` ↔ 详情 `memberLevel=diamond`（`recon/artifacts/api/mobile-company/e2e-list-to-detail-validation.json`）
