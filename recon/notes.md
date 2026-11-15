# MIC 侦察笔记（v1, 2026-11-15）

> 目标：为「Made-in-China 本地客户端」摸清 **搜索工厂 → 列表 → 公司详情 → 会员等级** 的请求链路、页面结构与可复用参数。
> 环境：`~/cloak-env`（cloakbrowser 0.6.5 + playwright-core 1.65.0，stealth Chromium 146；通过 `~/cloak-env/bin/cloak-run` 在 FHS 内运行）。浏览器 profile：`/home/songqian/mic-client/.profile-live`（headed 模式，保留 cookie）。
> 原始产物：`recon/artifacts/`；脚本：`recon/scripts/`；清洗示例：`recon/artifacts/sample-normalized.json`。

---

## 1. 请求链路总览

```
关键词+地区 供应商搜索
  GET https://www.made-in-china.com/companysearch.do
      ?subaction=hunt&style=b&mode=and&code=0
      &comProvince=<ProvinceName|nolimit>      # 省过滤（英文省名，如 Hebei）
      &order=0&isOpenCorrection=1
      &word=<keyword>[&page=N]                 # 30 条/页；N 从 1 开始
  -> HTML（服务端渲染，每行一个 div.list-node）

SEO 筛选列表（城市/认证/经营模式/营收/员工数/类目等高级筛选）
  GET https://www.made-in-china.com/company-search/<keyword>/C1--<filters>/<page>.html
      filters 用 -- 连接，逗号段内下划线分隔，例如：
        C1--CP_Hebei                              # 省 = Hebei
        C1--CP_Hebei--CC_Hebei_Langfang           # 省 Hebei + 市 Langfang  ★城市级入口
        C1--CP_Hebei--BT_1                        # 经营模式 Manufacturer/Factory
        C1--CP_Hebei--AR_3                        # 年营收 2.5~5M USD
        C1--CP_Hebei--NE_2                        # 员工 5-50
        C1--CP_Hebei--MC_-5                       # 认证（ISO9001:2015 等）
        C1--CP_Hebei--CD_Construction-Decoration-Catalog   # 类目
  -> HTML；但该路由带 JS cookie challenge（__tst_status / EO_Bot_Ssid），
     纯 HTTP 会拿到 987B challenge 或 567 AccessDeny；必须由浏览器执行 JS 后访问。

公司详情（三个入口）
  A. 公司迷你站首页  https://<host>.en.made-in-china.com/
     -> 会员徽章 + `Since YYYY`（= 入驻/会员起始年）+ COMPANY PROFILE 段（主营/地址/市场）
  B. 联系页          https://<host>.en.made-in-china.com/contact-info.html
     -> Business Type / Main Products / Year of Establishment / Number of Employees /
        Management System Certification / Address / Rating / 会员徽章+Since
     （同一 host 先访问首页暖 cookie 后，HTTP 可直取；否则可能被挑战）
  C. 公司介绍页      https://<host>.en.made-in-china.com/company-<Company-Name-Slug>.html
     -> 更完整 About Us；纯 HTTP 为 5560B「请验证」Focus Captcha，浏览器可过（probe8 实测成功）
```

**列表页每行可取字段**（`div.list-node`，30 行/页）：
- 公司名 `h2.company-name > a`、迷你站 URL（`//<host>.en.made-in-china.com`）
- `Main Products`、`City/Province`
- `Audited Supplier` 图标（`as_32.png` alt）、`Supplier Capability Index` 星级（`star-light/star-gray.png`）
- ODM / OEM / Own Brand 标签
- 行内 `<script class="J-video-json">` JSON：`comUrl`、`comName`、**`csLevel`**（50=Diamond / 30=Gold）、`keyWordSearch`（主营关键词）、`inquiryUrl`、**`aboutUsUrl`**、`sgsMembership`

**分页**：`companysearch.do?...&page=N` 实测可翻页（page=2 正常）；SEO 页 `.../<N>.html`（页面显示 1–9 页链接）。每页 30 条。

---

## 2. 访问方式与风控（重要）

| 访问方式 | 结果 |
|---|---|
| cloakbrowser **headless** 直接请求搜索 | 常触发 **Focus Captcha**（`captcha.made-in-china.com/verification.html`，「Swipe right」滑块） |
| cloakbrowser **headed**（可见窗口）+ 持久 profile | 大部分请求可通过；连续/异常请求仍偶发 Focus Captcha |
| 用浏览器导出的 **cookie 重放 HTTP** 请求 `companysearch.do` / 公司首页 / `contact-info.html` | 实测 **200 + 完整 HTML**（稳定，推荐作为抓取主通道） |
| 纯 HTTP 直取 SEO `company-search` 页 | 987B JS challenge（`__tst_status`）→ 567 `AccessDeny`；cookie 重放也过不去 |
| 无关键词（`word` 缺省/空/空格） | 返回 Focus Captcha 页（站点不支持空关键词搜索） |
| `word=*` | 空结果页（无效） |
| `word=all` / `word=china` | 有结果，但是关键词语义，不是纯地区列举 |

结论：**浏览器负责「建立会话 + 过 challenge/捕获 cookie + 访问 SEO 城市筛选页」；HTTP（带会话 cookie）负责「批量列表 / 公司首页 / 联系页」**。速率建议 2–4s/请求，缓存优先。

---

## 3. 会员等级（已核验）

- 列表行 `csLevel`：**50 → Diamond Member（钻石会员）**，**30 → Gold Member（金牌会员）**；无徽章/无 csLevel → 免费会员或未知。
- 公司站头部：`Diamond Member` / `Gold Member` 文案 + 图标，tooltip `Since YYYY` = 会员/入驻起始年（例：Hebei Xingchen Glass → Diamond Member, Since 2025）。
- `Audited Supplier`（认证供应商）独立于等级，布尔字段；与工商核验、CTI/SGS/BV 审核报告相关。
- **KA / SKA / GSKA 不是 MIC 术语** → 是阿里国际站客户分层（Key Account / Super Key Account / Group Super Key Account）；MIC 对应概念是「优享/尊享/MKA 大客户」，公网页面无独立标识，无法抓取。详见 [`docs/membership-tiers.md`](../docs/research/membership-tiers.md)（含官方来源、价格、判定优先级、证据快照）。
- 客户端输出枚举建议：`membership_tier: diamond|gold|free|unknown` + `member_since_year` + `audited: boolean|null` + `raw`（csLevel/文案/图标 URL/证据 URL）。**不要把 ka/ska 混进 tier**。

---

## 4. 清洗示例（已跑通）

`recon/scripts/parse_demo.py` → `recon/artifacts/sample-normalized.json`：
- 输入：`keyword=glass&province=Hebei&page=1` → 30 条公司，字段：名称、host、minisite、城市/省、主营、认证、星级、ODM/OEM 标签、csLevel→tier、产品关键词、询盘/介绍页 URL。
- 详情：`<host>/contact-info.html` 解析出 Business Type / Main Products / Year of Establishment / Employees / 认证 / Address / Rating / tier / Since。
  - 已验证：`CenerTech Insulation Engineering`（list csLevel=30 → gold；contact 页 gold + Since 2025 + 全部字段）
  - 已验证：`Hebei Xingchen Glass`（list csLevel=50 → diamond；contact 页 diamond + Since 2025 + 字段，见 probe9/xingchen-contact.html）
  - 注意：同一 host 需「先访问首页暖 cookie，再取 contact-info」，否则可能被挑战。

---

## 5. 人工会话验证结果（2026-11-15，probe10）

用可见浏览器（headed，persistent profile）人工完成一次 Focus Captcha 后，一次会话内连续验证：

| 验证项 | 结果 |
|---|---|
| 城市级原生筛选 `company-search/glass/C1--CP_Hebei--CC_Hebei_Langfang/1.html` | ✅ 30 行，**全部 `City/Province: Langfang, Hebei`** |
| 城市页第 2 页 | ✅ 15 行（Langfang × glass 共 45 家，分页正常） |
| 深分页 `C1--CP_Hebei/10.html` | ✅ 30 行（可翻到第 10 页+） |
| 纯地区列举 `/company-search/CP_Hebei/1.html`、`/company-search/hebei/1.html` | ❌ 均返回 “The information is not available right now” → **站点没有无关键词地区列举** |
| 会话复用 | ✅ 人工过一次验证后，同会话内 city p1/p2、province p10 连续抓取均不再验证 |
| 登录 | ⚠️ 本次未登录（仍是匿名会话；登录是否解锁字段/降低验证频率待后续 `mic auth` 验证） |

**结论（已按用户确认定稿）**：`keyword` 必填，`province`/`city` 作为过滤；城市筛选走 SEO 页（浏览器会话），省级列表可走 HTTP；城市字典可由站点筛选链接自动生成后缓存。

> 仍待补：`companysearch.do` 最大页数/最大结果数（用翻到空页收敛即可）、城市→省份全量字典的自动生成、登录态下的差异。

## 5.4 地区词当 keyword 与「纯地区列举」（2026-11-15 验证，用户提示）

站点搜索框接受**地区词**作为 keyword（不必是产品词），实测（已验证会话、HTTP）：

| keyword | 结果 |
|---|---|
| `hebei` | 30 条，全部 Hebei（Langfang/Shijiazhuang/Hengshui/Cangzhou/Tangshan/Baoding/Handan…） |
| `shijiazhuang` | 30 条，29 条 Shijiazhuang + 1 条 Xingtai（关键词噪声） |
| `langfang` | 30 条，27 条 Langfang + 3 条无关（Tianjin/Zhejiang/Guangdong） |
| `hebei shijiazhuang`（query 参数） | 30 条，全部 Shijiazhuang |
| `河北` / `石家庄`（中文） | 0 条（英文站只认英文） |
| `hebei glass` | 偏 Hebei，但产品词噪声大 |

**纯地区列举方案（已验证）**
- 省：`companysearch.do?...&word=hebei&comProvince=Hebei&page=N`（HTTP 可直取，30 条/页）或 SEO `/company-search/hebei/C1--CP_Hebei/N.html`（浏览器）
- 市：SEO `/company-search/langfang/C1--CP_Hebei--CC_Hebei_Langfang/N.html` → 第 1 页 30 条全部 Langfang；第 2 页 30 条全部 Langfang ✅
- `hebei shijiazhuang` 作为 **SEO path 关键词**会 0 条（路径编码问题）；用单地区词 + 原生筛选即可。
- 仍需按列表行 `City/Province` 做**后置校验**去噪（城市词可能混入 1–3 条外地）。

## 5.5 自动过人机校验（已验证，2026-11-15）

Focus Captcha = vemic **FCaptcha 3.0.2**（AJ-Captcha 风格 `blockPuzzle` 滑动拼图）。

- `POST https://captcha.made-in-china.com/captcha/get`（header `captchaId`）→ `repData.originalImageUrl / jigsawImageUrl / token / secretKey`；图片 310×155（背景 PNG）+ 47×155（拼图 alpha PNG）。
- 自动解法（`recon/scripts/captcha-autosolve.mjs`）：
  1. 拦截 `/captcha/get` 取图片 URL，页内 canvas 解码；
  2. 背景图 Sobel 梯度 + 拼图 alpha 边界模板匹配，搜索 (x,y) 得最佳偏移（实测目标在 y=0，x 任意）；
  3. 拖拽距离 `domDelta = x * imgWidth / 310`（imgWidth=280），Playwright 分 24 步带抖动拖动；
  4. 读 `/captcha/check` 响应：`repCode=0000` 即通过；失败自动重试（上限 5 次）。
- 实测：3 个新 profile → 2 次出现验证码，**均第 1 次尝试通过**（偏移 219 / 114）；1 次未触发；通过后可直接打开真实搜索列表（见 `recon/artifacts/captcha/autosolve*/verified-page.png`）。
- 会话耐用性：通过后导出 cookie 重放 HTTP，连续 12 页 `companysearch.do`（1.2s 间隔）**0 验证码、30 条/页**；同 profile 浏览器访问 SEO 城市页也直接通过（30 条 Langfang）。
- 说明：验证码是**风控/信任度触发**（IP、行为、session），不是每次都出；自动解是兜底能力，客户端仍保留人工 `mic auth` 兜底，并以限速+缓存降低触发概率。

## 5.6 上游 JSON 接口（移动站，匿名纯 HTTP，api-mapper 实测）

**主链路已可完全脱离 HTML/浏览器**（详见 [`docs/upstream-api.md`](../docs/research/upstream-api.md)）：

| 能力 | 接口 | 说明 |
|---|---|---|
| 供应商列表 | `POST https://m.made-in-china.com/search/supplier` | header `X-Requested-With: XMLHttpRequest`，body `word&page&province&catCode&memberLevel&managementCertification&comBusinessType&annualRevenue&rdCapacity`；20/页 + total/totalPage；匿名可用 |
| 过滤字典 | `GET .../search/supplier/refine?word=` | facet + count JSON |
| 公司详情 | `GET https://m.made-in-china.com/company-<account>/info.html`（移动 UA） | 页内 `<script type="text/json" id="ssrData">`：memberLevel/memberSince/sgsMember/establishment/mainProducts/reviewStatistics；正文另有员工数/地址/认证；约 13% 概率 Focus Captcha |
| 审核报告章节 | `GET www.../multi-search/sgs/report?comId=<encodeComId>` | 9 章节 audit 状态 |
| 响应率 | `GET data.../extend/busiMerge/replyRate?date=YYYYMMDD&comId=<encode>` | 平均响应时长/及时率 |
| 联系人/在线 | `www.../im.do?xcase=getSubAccount&comIdStr=<encode>`、`ajaxfunction.do?xcase=getTmStatus` | 匿名可取 |
| 评分评价 | `GET m.../user/review/front/next?receiverComId=<encode>` | 匿名可取 |

关键限制：word 必填；中文关键词=0；JSON 无 city 参数（用列表 item.city 客户端过滤）；pageSize 实际固定 20；total 超 2000 显示 "2,000+"；SEO 页与 JSON 口径不同（glass+Hebei：SEO 1299 vs JSON 669）。样例/证据：`recon/artifacts/api/`。

## 5.7 不登录信息完整度（anon-auditor 审计）

匿名可拿到供应商**公开档案的绝大部分**：列表全字段、公司信息（Business Type/主营/成立/员工/认证/地址/注册资本/厂房/贸易能力/产能/R&D）、证书与工厂照片、审核机构+报告编号+Verify Now 外链、联系人姓名/部门/职位、评分、响应率、在线状态、产品。

**拿不到**：电话/邮箱/WhatsApp/Skype/微信（平台不公开，不是登录墙；唯一联系通道=站内询盘 + TradeMessenger）；营业执照仅 "verified business licenses" 文案；审核报告全文/PDF 不公开（report.html 301→About Us）。站内信/询盘篮/收藏需登录。详见 [`docs/anonymous-completeness.md`](../docs/research/anonymous-completeness.md)。

## 6. 产物索引

| 路径 | 内容 |
|---|---|
| `recon/scripts/probe-home.mjs` … `probe9.mjs` | 浏览器探针（首页/列表/SEO/公司页/城市页） |
| `recon/scripts/http_matrix.py` | HTTP 矩阵测试（cookie 重放） |
| `recon/scripts/parse_demo.py` | 列表 + 详情清洗示例 |
| `recon/artifacts/home/` | 首页 HTML/PNG/网络记录 |
| `recon/artifacts/probe2/` … `probe9/` | 各轮页面快照（HTML/PNG/net JSON） |
| `recon/artifacts/sample-normalized.json` | 清洗后的示例 JSON |
| `docs/membership-tiers.md` + `docs/membership-evidence/` | 会员体系研究报告与证据 |
