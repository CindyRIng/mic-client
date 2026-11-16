# 文档总览（docs/）

> 本目录是 **MIC Client 的正式文档基线**。规则：先文档、后开发；任何实现变更先改文档（或补 ADR）。
> 当前阶段：**v1.0.6 已发布（2026-11-16，M0–M4 全部完成）**。文档状态见 §2；评审记录见 [review-report.md](review-report.md)；发布记录见 [CHANGELOG](../CHANGELOG.md)。

---

## 1. 阅读顺序

| 角色 | 建议阅读顺序 |
|---|---|
| 产品/需求方 | 01 需求 → 08 路线图 → 02 架构（选读） |
| 开发 | 01 需求 → 02 架构 → 03 REST API → 05 数据与缓存 → 04 CLI/MCP → 06 测试 |
| 调用方（脚本/Agent） | 01 需求（§功能范围）→ 03 REST API 或 04 CLI/MCP |
| 评审/运维 | 02 架构 → 07 运维 → 06 测试 → ADR |

## 2. 文档清单与状态

图例：⬜ 待编写 ｜ 🟡 编写中 ｜ 🟠 待审 ｜ ✅ 已确认 ｜ 🔁 需更新

| 编号 | 文档 | 内容摘要 | 状态 |
|---|---|---|---|
| 01 | [01-requirements.md](01-requirements.md) | 背景/目标/范围/功能需求 FR/非功能 NFR/数据需求/约束/风险/验收标准 | ✅ |
| 02 | [02-architecture.md](02-architecture.md) | 分层架构、模块职责、请求流程、会话/验证码、限速、错误与降级、配置、安全 | ✅ |
| 03 | [03-rest-api.md](03-rest-api.md) | REST 端点、参数、响应 Schema、错误码、分页、缓存语义、示例 | ✅ |
| 04 | [04-cli-mcp.md](04-cli-mcp.md) | CLI 命令/参数/输出/退出码；MCP tools 定义与 Schema | ✅ |
| 05 | [05-data-and-cache.md](05-data-and-cache.md) | 数据模型与字段映射、SQLite DDL、缓存键/TTL、地区字典、数据质量 | ✅ |
| 06 | [06-test-acceptance.md](06-test-acceptance.md) | 测试策略、回归基线、用例矩阵、验收清单 | ✅ |
| 07 | [07-operations.md](07-operations.md) | 环境准备、配置、启动、`mic auth`、排障、安全与合规 | ✅ |
| 08 | [08-roadmap.md](08-roadmap.md) | M1–M4 里程碑、任务拆解、开放问题与决策 | ✅ |
| — | [review-report.md](review-report.md) | **M0 文档评审报告**（规模/检查结果/冲突裁决/残余待验证） | ✅ |
| — | [glossary.md](glossary.md) | 术语表（MIC 上游字段 / 本客户端概念） | ✅ |
| — | [decisions/](decisions/README.md) | 架构决策记录（ADR-0001…0007） | ✅ |
| — | [research/](research/README.md) | 调研文档与原始证据（上游接口/会员/匿名边界/验证码） | ✅ |

> 说明：`research/design-draft-v0.2.md` 是正式文档编写前的设计草案，作为背景参考；与 01–08 冲突时以正式文档为准。

## 3. 写作与评审约定

### 3.1 文档头（每份正式文档必须有）
```markdown
# 标题
> 版本：0.1 ｜ 状态：Draft/Review/Approved ｜ 负责人：<name> ｜ 最后更新：2026-11-15 ｜ 关联：<链接>
```

### 3.2 编号规则
- 功能需求：`FR-01`、`FR-02`…；非功能需求：`NFR-01`…；验收用例：`AC-01`…（与 FR 关联，如 `AC-03 (FR-02)`）。
- 接口：REST 路径 + CLI 子命令 + MCP tool 名需与 03/04 文档一致。
- 错误码：统一以 03 文档 §错误码 为准；02/04/06 只引用，不另造。
- 状态枚举：`success | partial | stale`；数据来源：`json | html | browser | cache`。

### 3.3 固定术语（详见 glossary.md）
`account`（迷你站子域名/mainUserAccount）、`encodeComId`、`csLevel`（50=Diamond/30=Gold）、`memberLevel`、`memberSince`、`SSR/ssrData`、`Focus Captcha`、`anonymous`（不登录）、`region-keyword mode`（地区词当关键词）。

### 3.4 事实纪律
- 上游接口/字段必须以 `docs/research/upstream-api.md` 与 `recon/artifacts/` 证据为准；未实测的一律标注 `待验证`。
- 不虚构上游端点、字段、错误码；不确定处写进「开放问题」。
- 图用 Mermaid（`flowchart` / `sequenceDiagram` / `erDiagram`），表格优先。

### 3.5 固定契约（所有文档必须一致）

**功能需求编号（01 定义，03/04/05/06 引用）**

| ID | 功能域 |
|---|---|
| FR-01 | 搜索模式（关键词 / 地区 / 组合） |
| FR-02 | 结构化过滤（省/市/类目/会员等级/认证/经营模式/营收/R&D） |
| FR-03 | 分页、总数、非穷尽保护 |
| FR-04 | 结果列表字段与规范化 |
| FR-05 | 公司详情字段与规范化 |
| FR-06 | 会员等级与认证识别（tier/audited/evidence） |
| FR-07 | 地区字典（省/市，中英映射） |
| FR-08 | 缓存（键/TTL/刷新/降级） |
| FR-09 | REST API 入口 |
| FR-10 | CLI 入口 |
| FR-11 | MCP 入口 |
| FR-12 | 会话、风控与验证码（自动通过 + 人工兜底） |
| FR-13 | 错误分类、重试与降级 |
| FR-14 | 日志、指标与可观测 |
| FR-15 | 配置与运行环境 |

**非功能需求编号**：`NFR-01` 性能时延、`NFR-02` 稳定性与风控、`NFR-03` 安全与本地边界、`NFR-04` 可维护性、`NFR-05` 可测试性、`NFR-06` 合规与访问礼仪。

**REST 统一响应包**
```jsonc
{
  "ok": true,
  "data": { /* 见 03/05 的 Schema */ },
  "meta": {
    "request_id": "req_xxx",
    "cached": false,
    "stale": false,
    "fetched_at": "2026-11-15T22:59:00+08:00",
    "source": "json",            // json | html | browser | cache
    "warnings": []                // [{code, message, details}]
  }
}
```
失败时：`{ "ok": false, "error": { "code": "...", "message": "...", "details": {...} }, "meta": {...} }`。

**统一错误码（03 定义细节；其余文档只引用）**

| code | HTTP | 含义 |
|---|---|---|
| `INVALID_PARAM` | 400 | 参数缺失/非法（如 keyword 与 region 都为空、省名非法） |
| `NOT_FOUND` | 404 | 公司/资源不存在（或 301 无法解析） |
| `UPSTREAM_CHANGED` | 502 | 上游返回结构与契约不符（字段缺失/改版） |
| `UPSTREAM_UNAVAILABLE` | 503 | 上游 5xx/超时/连续 302，重试耗尽 |
| `RATE_LIMITED` | 429 | 本地上游请求队列/限速保护触发 |
| `CAPTCHA_REQUIRED` | 409 | 需要验证码（可自动解，内部用） |
| `CAPTCHA_SOLVE_FAILED` | 502 | 自动解验证码失败 |
| `NEED_HUMAN_VERIFICATION` | 409 | 需要人工过验证/登录（`mic auth`） |
| `PARSE_ERROR` | 502 | 页面/JSON 解析失败（附原始快照引用） |
| `CONFIG_ERROR` | 500 | 配置/环境错误（如浏览器 profile 缺失） |
| `INTERNAL_ERROR` | 500 | 未分类内部错误 |

**数据/状态枚举**：`membership_tier = diamond|gold|free|unknown`；`source = json|html|browser|cache`；`availability_reason = not_provided_by_supplier|not_public_by_platform|no_reviews|fetch_blocked|needs_login`。

**警告码（`meta.warnings[].code`；表示“成功但需提示”，不改变 HTTP 状态；各文档只使用下列码）**

| code | 含义 | 典型 details |
|---|---|---|
| `TOTAL_CAPPED` | 上游 `total` 超过 2000 显示 "2,000+"，已封顶 | `total_display` |
| `NON_EXHAUSTIVE` | 结果非穷尽（封顶/本地过滤扫描预算/早停） | `reason`、`scanned_pages`、`matched`、`scan_budget` |
| `PAGE_CLAMPED` | 请求页码超过末页，按末页窗口返回 | `requested_page`、`effective_page` |
| `PAGE_SIZE_NOT_NATIVE` | `page_size` 非上游原生 20，发生拼接/裁剪 | `upstream_page_size` |
| `PAGE_LIMIT_REACHED` | CLI 批量翻页达到上限（`--pages`） | `limit` |
| `CLIENT_SIDE_FILTER` | 客户端本地过滤生效（如 `audited` 等非上游过滤） | `filters`、`matched`、`scanned_pages` |
| `CITY_FILTERED_LOCALLY` | 城市过滤在客户端按 `item.city` 执行 | `city`、`scanned_pages`、`matched` |
| `CITY_FILTER_EMPTY` | 城市过滤后 0 条结果 | `city`、`province_total` |
| `CITY_FILTER_TRUNCATED` | 城市过滤受扫描预算限制而截断 | `city`、`scan_budget` |
| `CITY_NOT_IN_DICTIONARY` | 城市不在字典，降级为精确字符串匹配 | `city` |
| `CITY_PROVINCE_MISMATCH` | 请求/列表中的城市与省份不一致 | `city`、`province` |
| `ADDRESS_MISMATCH` | 详情地址与列表城市不一致（不覆盖列表值） | `address`、`city` |
| `REGION_DICTIONARY_INCOMPLETE` | 该省城市字典覆盖不完整 | `province` |
| `STALE_DATA` | 上游失败回退过期缓存（`meta.stale=true`） | `original_fetched_at`、`reason` |
| `ENRICHMENT_PARTIAL` | 增强数据（审核/响应率/联系人/评分）部分失败 | `failed[]` |
| `DUPLICATES_REMOVED` | 去重清理（跨页重复） | `count` |
| `ADS_FILTERED` | 广告位结果被过滤 | `count` |
| `HTML_FALLBACK` | 本次数据来自 HTML 兜底通道 | `url` |
| `BROWSER_FALLBACK` | 本次数据来自浏览器兜底 | `reason` |
| `CACHE_WRITE_FAILED` | 缓存写入失败（不影响本次返回） | `error` |
| `MEMBER_EVIDENCE_CONFLICT` | 会员等级证据冲突，按优先级取值 | `evidence[]` |
| `UNKNOWN_CERTIFICATION` | 未识别的认证名（保留 raw 值） | `raw` |

**`error.details.reason`（参数/查找类细分原因，03 定义）**：`MISSING_REQUIRED_COMBO`、`UNKNOWN_PROVINCE`、`UNKNOWN_CITY`、`INVALID_ENUM`、`OUT_OF_RANGE`、`UNKNOWN_QUERY_PARAM`、`NON_ENGLISH_KEYWORD`、`UNSUPPORTED_MEMBERSHIP_FILTER`、`UNSUPPORTED_FILTER_COMBINATION`、`INVALID_ACCOUNT`、`ACCOUNT_NOT_FOUND`、`COM_ID_UNRESOLVED`、`ENCODE_COM_ID_NOT_INDEXED`、`CATEGORY_CODE_UNVERIFIED`、`UNSUPPORTED_MEDIA_TYPE`。新增细分原因必须先在 03 登记。

**中文关键词规则（canonical）**：能解析为地区名 → 自动转地区模式；不能解析（如 `玻璃`、`河北玻璃`）→ `400 INVALID_PARAM` + `details.reason=NON_ENGLISH_KEYWORD` + `details.hint`；**不得静默返回空结果**（上游英文站中文=0，静默会误导）。

**分页契约（canonical）**：`page` 合法范围 `1..100`（`page>100` → `INVALID_PARAM`/`OUT_OF_RANGE`）；`page_size` 默认 20、合法 `1..100`，上游固定 20/页，非 20 时拼接/裁剪并带 `PAGE_SIZE_NOT_NATIVE`；`total>2000` → `total=2000`、`total_capped=true`、`total_display="2,000+"`；本地过滤扫描预算 `scan_max_pages` 默认 10、硬上限 100（可用配置覆盖），用尽时 `total_is_lower_bound=true` 并带 `NON_EXHAUSTIVE`。

**缓存 TTL（canonical，可配置；03 §1.8 = 05 §7.3）**：搜索上游页 6h、搜索派生索引 6h、公司详情 24h、审核章节 7d、响应率 6h、联系人 24h、评价 12h、地区字典 30d、空结果 1h；`refresh=true` 跳过读缓存；stale-while-error 回退带 `STALE_DATA`。

**广告策略（canonical）**：REST/MCP 默认 `include_ads=true`，上游广告条目**保留并标 `is_ad=true`**（与上游分页 1:1）；`include_ads=false`/CLI `--exclude-ads` 时在响应层过滤并带 `ADS_FILTERED`；CLI **表格**默认隐藏广告（`--include-ads` 显示），JSON/NDJSON 如实返回。

**JSON 字段命名**：REST 与内部模型统一 `snake_case`；上游原字段名（如 `csLevel`/`mainUserAccount`）只在「字段映射表」出现。

### 3.6 评审流程
1. 编写者提交（状态 🟠 待审）；
2. 评审者按 §4 检查清单核对；
3. Lead 批准后状态改 ✅；有变更时先改文档再实现，并在文档头更新版本。

## 4. 评审检查清单

- [ ] 与 `docs/research/` 的事实一致（端点数、参数名、限制、匿名边界）
- [ ] 与 01 需求的 FR/NFR 编号双向可追溯（03/04/05/06 引用 FR）
- [ ] 错误码/状态枚举/字段名全库一致（无同义不同名）
- [ ] 每个接口有请求/响应示例与错误场景
- [ ] 每条例外路径有定义（缓存过期、验证码、302、上游改版、字段缺失）
- [ ] 安全与合规：本地监听、无鉴权说明、限速、不公开字段不建模为「登录可得」
- [ ] 链接有效、无悬空引用、无 TODO 残留（或 TODO 必须进开放问题）

## 5. 变更记录

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-11-15 | 建立文档基线（目录重组：research 子目录、ADR、编号文档） | lead |
| 2026-11-15 | **M0 文档评审通过**：补齐 canonical warning/TTL/广告/分页契约；跨文档冲突全部收敛（见 [review-report.md](review-report.md)）；01–08 置 ✅ | lead |
