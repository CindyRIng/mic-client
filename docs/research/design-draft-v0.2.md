# MIC Client 设计草案 v0.2（JSON 优先架构，待确认后进入 M1）

> 目标：把 Made-in-China 的少量能力封装成本地客户端 —— **REST / CLI / MCP** 三入口 + **SQLite 缓存**；首期只做「按省市/关键词搜索工厂 → 列表 → 公司详情（入驻时间/成立时间/主营产品/会员等级/认证）」。
> 依据：[recon/notes.md](../../recon/notes.md)、[docs/upstream-api.md](upstream-api.md)（22 个上游接口）、[docs/membership-tiers.md](membership-tiers.md)、[docs/anonymous-completeness.md](anonymous-completeness.md)、[docs/captcha-autosolve.md](captcha-autosolve.md)。
> **v0.2 关键变化**：上游存在**匿名移动站 JSON 接口**（搜索/公司详情/增强数据），主链路改为 **JSON 优先**；浏览器 + 自动过验证码只用于「被风控挑战的页面 / JSON 缺口」，HTML 解析降级为兜底。

---

## 1. 范围

**做**
- 工厂搜索：`keyword` 与 `province`/`city` 至少一个；关键词模式/地区模式/组合模式；分页；结构化过滤（省/类目/会员等级/认证/经营模式/营收/R&D）；
- 结果列表：公司名、host、地区、主营、会员等级（csLevel）、认证、星级、员工数/厂房/营收等（JSON 列表已带大部分字段）；
- 公司详情：成立日期、**入驻/会员起始年（memberSince）**、主营、员工数、认证、地址、评分、会员等级、Audited、审核机构/报告号、响应率；
- 会员等级自动识别（diamond / gold / free / unknown + audited + 原始证据）；
- REST/CLI/MCP + 缓存 + 限速 + 验证码自动通过（失败人工兜底）。

**不做**
- 全量/高并发爬取；产品搜索/询盘/交易等写操作；登录后的买家私有数据（登录态只作为可选增强）。

## 2. 技术架构（Node/TS 单仓库）

```
src/
  core/
    http/client.ts       # gzip/重定向/cookie jar/重试退避/限速(1.5–2.5s 抖动)/UA
    api/search.ts        # POST m.made-in-china.com/search/supplier（+ /refine 字典）
    api/company.ts       # GET m.made-in-china.com/company-<acc>/info.html → ssrData JSON + 正文补充字段
    api/enrich.ts        # SGS 审核章节 / 响应率 / TM 联系人+在线 / 评分评价
    api/suggest.ts       # 搜索联想（可选）
    fallback/desktop.ts  # www companysearch.do / contact-info.html（HTML 解析兜底）
    session/browser.ts   # cloakbrowser 持久 profile（仅验证码/JS challenge/兜底时用）
    session/captcha.ts   # Focus Captcha 自动通过（边缘匹配+拖拽），失败→NEED_HUMAN_VERIFICATION
    regions/dict.ts      # 31 省 + 城市字典（中英/MIC 代码）
    membership/tiers.ts  # csLevel / memberLevel / audit 判定
    cache/sqlite.ts      # WAL、TTL、原始快照
  adapters/
    rest/server.ts       # Fastify，127.0.0.1:8787
    cli/index.ts         # commander
    mcp/server.ts        # stdio MCP
  models/                # zod schema + TS types
tests/
data/                    # dev.sqlite、raw/（可选快照）
```

依赖：`cloakbrowser@0.6.5` + `playwright-core@1.65.0`（仅浏览器兜底需要）、`better-sqlite3`、`fastify`、`@modelcontextprotocol/sdk`、`commander`、`zod`（HTTP 用 Node 原生 fetch/undici，无需额外库）。
运行：CLI/REST/MCP 统一经 `~/cloak-env/bin/cloak-run node <entry>` 启动（保证浏览器兜底可用）。

## 3. 对外接口

### REST（默认 `127.0.0.1:8787`，本地无鉴权）
| Method & Path | 说明 |
|---|---|
| `GET /health` | 服务/会话/缓存状态 |
| `GET /api/regions` | 省/市字典（含 MIC 代码） |
| `GET /api/search/factories?keyword=&province=&city=&page=1&page_size=20&refresh=false` | 搜索工厂（keyword 与 province/city 至少一个；含地区模式） |
| `GET /api/companies/:account` | 公司详情（`account` = 迷你站子域名，如 `xingchenglass`；也接受 `comId`/`encodeComId`） |
| `GET /api/membership/levels` | 会员等级说明（含 KA/SKA 澄清，静态） |
| `POST /api/cache/refresh` | 按 scope/key 刷新 |
| `GET /api/cache/stats` | 缓存统计 |

统一返回：`{ ok, data, meta: { cached, fetched_at, source: "json"|"html"|"browser"|"cache", warnings[], stale } }`。

### CLI
```bash
mic search --keyword glass --province 河北 --city 廊坊 --page 1 --json
mic search --province 河北 --city 廊坊 --page 1 --json     # 地区模式（纯地区列举）
mic company xingchenglass --json
mic regions --province 河北
mic cache stats|clear
mic auth      # 需要时弹可见浏览器：人工过验证码/登录；自动 pass 失败时兜底
mic mcp
```

### MCP tools（stdio）
- `search_factories({ keyword?, province?, city?, page?, page_size? })`
- `get_company({ account | comId | name })`
- `list_regions({ province? })`
- `explain_membership()`

## 4. 数据模型（清洗后 JSON）

```jsonc
// 列表行（来自 POST m.made-in-china.com/search/supplier 的 dataList item）
{
  "account": "xingchenglass",              // mainUserAccount（迷你站子域名）
  "company_id": "1752301672",              // id
  "encode_com_id": "bSrtEKgyYcUf",         // encodeComId（增强接口用）
  "company_name": "Hebei Xingchen Glass Technology Co., Ltd.",
  "province": "Hebei", "city": "Langfang", "country": "China",
  "main_products": ["Glass Cup", "..."],   // mainProduct / productReduce
  "business_types": ["Manufacturer/Factory & Trading Company"],
  "membership": {"tier": "diamond", "raw_cs_level": 50, "since_year": 2025, "evidence": ["json:csLevel=50"]},
  "audited": true,                          // auditType/showAuditLogo/logoText
  "capability_stars": 2,                   // companySymbol.stars
  "system_certifications": ["ISO9001:2015", "..."],
  "employees": null, "turnover": null, "plant_area": null,
  "company_url": "https://xingchenglass.en.made-in-china.com",
  "detail_source": "json"
}

// 公司详情（ssrData.companyInfo.content + info.html 正文补充）
{
  "member_level": "gold", "member_since": "2025", "sgs_member": true,
  "established_at": "2019-12-20",
  "main_products": ["Foam glass", "..."],
  "business_types": ["Manufacturer/Factory & Trading Company"],
  "rating": "4.9/5", "stars": "2",
  "employees": 80, "address": "…", "management_certifications": ["ISO9001:2015", "..."],
  "audit": {"agency": "SGS", "report_no": "QIP-ASI256443", "verify_url": "...", "sections_verified": 8},
  "response": {"avg_hours": 2.8, "timely_ratio": 1.0},
  "contacts": [{"name": "Miss sun", "dept": "Marketing", "title": "Overseas Marketing Executive"}],
  "reviews": {"rating": "4.9/5", "count": 3},
  "channel_availability": {"phone": null, "email": null, "whatsapp": null, "reason": "not_public_by_platform"}
}
```

缺失原因统一枚举：`not_provided_by_supplier | not_public_by_platform | no_reviews | fetch_blocked | needs_login`。

## 5. 上游接口映射（JSON 优先，HTML/浏览器兜底）

| 能力 | 主通道（匿名 HTTP JSON） | 兜底 |
|---|---|---|
| 搜索列表 | `POST https://m.made-in-china.com/search/supplier`（header `X-Requested-With: XMLHttpRequest`，body `word&page&province&catCode&memberLevel&managementCertification&comBusinessType&annualRevenue&rdCapacity`；20/页，total/totalPage） | `www.../companysearch.do` HTML（30/页） |
| 过滤字典/count | `GET .../search/supplier/refine` | SEO `company-search` 页 |
| 公司详情 | `GET https://m.made-in-china.com/company-<account>/info.html`（移动 UA，页内 `ssrData` JSON + 正文员工数/地址/认证） | PC `contact-info.html` / 公司首页 / About Us（HTML 解析） |
| 城市筛选 | **JSON 列表每条自带 `city`** → 省过滤后客户端按 city 过滤（推荐） | SEO `C1--CP_..--CC_..` 页（浏览器） |
| 审核报告章节 | `GET www.../multi-search/sgs/report?comId=<encodeComId>` | About Us 页文本 |
| 响应率/响应时间 | `GET data.../extend/busiMerge/replyRate?date=YYYYMMDD&comId=<encode>&operatorNo=all` | — |
| 联系人（TM 子账号） | `GET www.../im.do?xcase=getSubAccount&comIdStr=<encode,...>` | contact 页 HTML |
| 在线状态 | `GET www.../ajaxfunction.do?xcase=getTmStatus&user_ids[]=<encode>_00` | — |
| 评分/评价 | `GET m.../user/review/front/next?receiverComId=<encode>&pageNum=1` | 详情页 rating 字段 |
| 搜索联想 | `GET keywordsuggestions.../suggest/getEnSupplierSuggest.do?param=..&count=10` | — |

关键限制（已实测）：
- `word` 必填（空→Focus Captcha；`*` 空结果）；**中文关键词=0**；地区词可用（hebei / shijiazhuang / langfang / "hebei shijiazhuang"）。
- `pageSize` 实际固定 20；`page` 超末页夹到末页；`total` 超过 2000 显示 "2,000+"（glass+Hebei=669 正常显示；大词会封顶）。
- JSON 接口无 city 参数（`city/cityName/comCity` 被忽略）→ 客户端过滤；SEO 页口径与 JSON 不同（glass+Hebei：SEO 1299 vs JSON 669），不要混用。
- m 站公司页有约 13% 概率 Focus Captcha（随机，与公司无关）；带 cookie + 1.5–2.5s 间隔 + 重试可稳定。

## 6. 缓存策略

- SQLite（WAL）表：`search_queries(params_hash, page, fetched_at, payload_json, source)`、`companies(account PK, list_json, updated_at)`、`company_details(account PK, payload_json, fetched_at)`、`regions`、可选 `raw_snapshots`（gzip 文件）。
- TTL：列表 6h、详情 24h、地区字典 30d；`refresh=true` 强制刷新；过期但请求失败 → 回退旧值并标 `stale: true`。
- 缓存 key：规范化参数（keyword 小写、省/市标准化英文、page/page_size）。
- 请求队列：串行 + 1.5–2.5s 抖动；同参数并发合并（single-flight）。

## 7. 地区 / 城市 / 纯地区列举

- `province`：31 省英文名（Hebei…）+ 中文映射；JSON 参数 `province=Hebei`。
- `city`：省→市字典；JSON 无 city 参数 → **客户端按 item.city 过滤**（带 warnings 记录覆盖率）；可选 SEO 城市页作交叉校验。
- **地区模式（纯地区列举）**：只给 province/city 时，用地区英文词作 keyword（`hebei` / `shijiazhuang` / `langfang`，实测 hebei 30 条全 Hebei、langfang 27/30 Langfang），加 province 过滤并客户端按 city 去噪。
- 分页上限：JSON 每页 20、末页夹取；桌面 HTML 约 50 页封顶 → 客户端用 totalPage/重复页收敛，并标注“非穷尽”。

## 8. 会员等级识别

1. 列表 JSON `csLevel`：`50→diamond`、`30→gold`（高置信，保留 raw）。
2. 详情 ssrData `memberLevel`（diamond/gold）+ `memberSince`（入驻年）确认/补全；`sgsMember`/`auditReportLogo` → audited。
3. PC 公司站徽章文案 + `Since YYYY` 作为兜底证据（注意 A/B 两套模板与 `&nbsp;`）。
4. 都没有 → `unknown` + evidence（不猜）。
5. `audited` 独立布尔；KA/SKA/GSKA 非 MIC 体系（阿里国际站分层），不进入 tier；预留 `external_customer_tier`（默认 null）。详见 [membership-tiers.md](membership-tiers.md)。

## 9. 验证码与风控策略

- **自动通过 Focus Captcha（已实现验证）**：拦截 `/captcha/get` → canvas 解码背景/拼图 → Sobel 梯度 + alpha 边界模板匹配求偏移 → `310*domX/imgWidth` 换算 + humanized 拖拽 → `/captcha/check` 0000 成功；失败自动刷新重试（≤5 次）；实测新 profile 2/2 次第 1 尝试通过；通过后会话连续 12 页 HTTP 无验证码。详见 [captcha-autosolve.md](captcha-autosolve.md)。
- 触发场景：空 word、公司页随机（~13%）、SEO 页、连续高频；JSON 搜索接口风控很轻。
- 客户端策略：JSON 优先（不触发验证码）→ 公司页遇到 captcha 时用浏览器自动解 → 自动解失败 `NEED_HUMAN_VERIFICATION`，`mic auth` 人工兜底。
- 限速 + 缓存 + 302/验证页检测重试；不并发轰炸。

## 10. 里程碑与验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | HTTP JSON 搜索 + 列表 + 地区模式 + 城市本地过滤 + SQLite 缓存 + CLI `--json` | 省市/keyword 搜到列表；二次查询命中缓存 |
| M2 | 公司详情（ssrData + 正文 + 增强 JSON）+ 会员识别 + 缓存 | 详情含成立时间/入驻年/主营/会员等级/audited；unknown 不乱填 |
| M3 | REST + MCP + `mic auth` | REST 接口 + 4 个 MCP tool 可用 |
| M4 | 测试/文档/回归样例 | 单测 + 端到端样例；README |

## 11. 已确认决策 / 默认值

1. **纯地区列举**：已解决 —— 地区英文词当 keyword + province 过滤 + 客户端 city 过滤（见 §7）。
2. **会员枚举**：`diamond|gold|free|unknown` + `audited` 布尔 + 原始证据；KA/SKA 不进 tier（见 §8）。
3. 默认值（可改）：Node/TS + SQLite；REST 127.0.0.1:8787；MCP stdio；英文原文 + 中文展示映射；profile `~/.mic-client/profile`。
4. 电话/邮箱等联系通道：平台不公开，字段恒 `null` + `not_public_by_platform`，不做“登录解锁”假设。

## 12. 证据索引

- [recon/notes.md](../../recon/notes.md)：请求链路、地区词、验证码、分页上限、JSON 接口
- [docs/upstream-api.md](upstream-api.md)：22 个上游接口 + 参数 + 样例（`recon/artifacts/api/`）
- [docs/anonymous-completeness.md](anonymous-completeness.md)：匿名字段矩阵（含 5 家样本）
- [docs/captcha-autosolve.md](captcha-autosolve.md)：Focus Captcha 自动通过方案
- [docs/membership-tiers.md](membership-tiers.md)：会员体系与 KA/SKA 澄清
