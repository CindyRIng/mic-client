# 匿名（不登录）信息完整度审计 — Made-in-China 供应商页

> 审计人：anon-auditor（独立子任务，task-4）｜审计时间：2026-11-15 22:33–22:50 CST
> 目的：回答「**不登录（匿名）能拿到多少完整信息**」，给出字段 × 页面可见性矩阵 + 对客户端字段设计的影响。
> 关联文档：[`recon/notes.md`](../../recon/notes.md)（请求链路）、[`docs/membership-tiers.md`](membership-tiers.md)（会员体系）、[`design-draft-v0.2.md`](design-draft-v0.2.md)（字段设计草案）、[`docs/upstream-api.md`](upstream-api.md)（匿名 JSON 接口全集）、[`docs/captcha-autosolve.md`](captcha-autosolve.md)（Focus Captcha 自动通过方案）。
> 约束：未启动 cloakbrowser、未使用任何账号登录；仅 HTTP + 匿名浏览器会话（`recon/artifacts/probe10/storage-state.json`，loginStatu=0）+ 已有 `recon/artifacts/` 快照。

---

## 0. 结论（TL;DR）

1. **匿名能拿到公司公开档案的绝大部分字段**，比预期完整得多：列表页全字段、公司站首页/contact-info/About Us 的公司信息、贸易与产能数据、认证清单、审核机构 + 报告编号 + 第三方核验链接、联系人姓名/部门/职位、评分（若有）、产品与工厂展示、响应时间/回复率/在线状态（公开 XHR）。
2. **匿名拿不到的是「联系通道 + 账号私有数据」**：供应商**电话、邮箱、WhatsApp/Skype/微信在 5 家样本 × 4 类页面 × 内嵌 JSON/公开 XHR 中 0 命中**。这不是登录墙，而是平台**不公开**（仅站内询盘 + TradeMessenger 聊天）；营业执照只有 "verified business licenses" 文案；**审核报告全文/PDF 不公开**（report.html 301 到 About Us，仅有报告编号 + 外链核验）。站内信、询盘篮、收藏需登录；聊天入口公开，但会话身份（登录 vs 访客）未完全确认（见 §2.2）。
3. **列表页/深页的门槛是「风控挑战」，不是「登录」**：纯 HTTP 直连列表 → `302 captcha.made-in-china.com/verification.html`；公司站深页偶发 Focus Captcha（"请验证"）或 EdgeOne JS challenge（`__tst_status`）。用匿名会话（人过挑战后导出的 cookie）即可稳定取数。客户端需要的是 **challenge 处理 + 匿名会话**，不是登录态。
4. **登录态差异未验证（限制）**：没有账号，无法 1:1 对照登录后页面；但匿名 HTML 中**找不到任何「登录取公司字段」的占位/门禁**（无 Sign in to view contact 之类），现有证据指向「登录主要解锁买家侧功能（收藏/站内信/聊天/询盘管理），不改变供应商公开档案」。建议后续 `mic auth` 时做一次差分复核（§7 清单）。

---

## 1. 方法与样本

### 1.1 采集方法

- **通道**：HTTP（curl/urllib）+ 匿名浏览器会话 cookie（`R10/storage-state.json`，通篇 `loginStatu=0`，无任何账号）；
- **暖会话**：每个 host 先取首页再取深页（否则易被 EO_Bot JS challenge / Focus Captcha 拦截）；
- **抓取对象**：5 家 minisite × `首页` / `contact-info.html` / `company-*.html`（About Us）/ `audited-supplier-reports/report.html`，共 20 页；report 用 `-L` 跟随 301；
- **对照**：`R8`（浏览器 DOM 快照，含 JS 执行后结果）、`R9`（匿名 contact 快照）、`R7`/`R10`（匿名浏览器列表页）、`R4`（另一家匿名首页，佐证）；
- **匿名证明**（每页可复现）：
  - 公司站 HTML：`<input type="hidden" id="loginStatu" value="0" />`（登录后应为 1）；
  - header：`div.J-top-unlogin` 可见 / `div.J-top-logged` 带 `style="display:none"`；
  - 列表页：`headerHome` props 中 `"username":"","userType":null`；
  - 接口：`GET https://login.made-in-china.com/login/status/check` → `{"code":10010,...,"message":"You are not logged in, please log in first."}`（2026-11-15 实测）。

### 1.2 样本（河北/廊坊，覆盖会员等级、认证、档案丰富度差异）

| minisite host | 公司名称 | 列表 `csLevel` | 徽章 + Since | Audited | 星级(light) | 评分 | Mgmt. Certification | 联系人（公开） | 审核报告（About 公开） | 响应时间（公开 API） |
|---|---|---|---|---|---|---|---|---|---|---|
| `xingchenglass` | Hebei Xingchen Glass Technology Co., Ltd. | 50 → Diamond | Diamond Member, Since 2025 | 是 | 2 | 4.9/5 | 无 | Mrs. cindy | **CTI** `QIP-ASI256473`，8 items verified + Verify Now | ≤8.54h |
| `lvxingmirror` | QINHUANGDAO GREEN STAR MIRROR CO., LTD. | 50 → Diamond | Diamond Member, Since 2018 | 是 | 0（单个 gray） | 4.5/5 | 无 | Mr. Andy（export dept / manager） | **SGS** `QIP-ASR236819`，8 items + Verify Now | ≤6.98h |
| `hnfinsulation` | CenerTech Insulation Engineering Co., Ltd. | 30 → Gold | Gold Member, Since 2025 | 是 | 2 | 无（无评论） | ISO9001:2015, ISO14001, Others | Miss sun（Marketing Department / Overseas Marketing Executive） | **SGS** `QIP-ASI256443`，10 items + Verify Now | ≤2.8h |
| `kaishanda` | Bazhou Kaisanda Furniture Co., Ltd. | 50 → Diamond | Diamond Member, Since 2026 | **否** | 4 | 无 | 无 | Ms. Ranby | 无第三方核验（About 显示 "Information provided by supplier"）；另有内部编号 `MIC20260701001`（无 Verify Now） | ≤0.26h |
| `hsrockwool` | Hebei Huashuo Xingye Thermal Insulation Building Materials Co., Ltd. | 50 → Diamond | Diamond Member, Since 2026 | 是 | 2 | 无（无评论） | ISO9001:2015, ISO45001:2018, ISO14001 | Mrs. She | **SGS** `QIP-ASI266217`，8 items + Verify Now | ≤8.89h |

> 补充佐证：`R4/step3-company-home.html`（QINGDAO RISING STAR GLASS CO.,LTD，loginStatu=0）为补充的第 6 个匿名首页样本，字段结构与上述一致。

### 1.3 风控/挑战实测记录（说明「匿名 ≠ 登录」）

| 时间 | URL | 现象 | 归类 |
|---|---|---|---|
| 22:35 | `xingchenglass…/` | 200，5.8KB「请验证」Focus Captcha（`captcha.made-in-china.com/verification.html`） | 人机挑战 |
| 22:35 | `xingchenglass…/contact-info.html` | 200，987B EdgeOne JS challenge（`__tst_status` 由 JS 写入后 reload） | JS challenge |
| 22:37 | `lvxingmirror…/contact-info.html` | **302** → `https://captcha.made-in-china.com/verification.html?srcUrl=…` | 挑战重定向 |
| 22:44 | `www…/companysearch.do?…word=glass…`（无 cookie，纯匿名新会话） | **302** → `captcha.made-in-china.com/verification.html?srcUrl=…` | 挑战重定向 |
| 22:38–22:42 | 5 家 minisite 深页（带匿名会话 cookie、间隔 9–11s） | 200 + 完整 HTML（`loginStatu=0`） | 通过 |
| 22:33 | `xingchenglass…/contact-info.html`（curl 无 cookie） | 200，84,069B = 与 `R9/xingchen-contact.html` 完全同尺寸 | 通过 |

结论：挑战与登录无关；同一匿名会话在挑战通过后可稳定访问，连续/突发请求会触发挑战。

---

## 2. 匿名边界：能得到什么 / 得不到什么

### 2.1 匿名可得（含获取方式）

| 类别 | 具体内容 | 获取方式 |
|---|---|---|
| 列表页 | 公司名、host/minisite、Business Type、Main Products、Mgmt. Certification、City/Province、Audited 图标、星级、ODM/OEM/Own Brand 标签、3 个推荐产品、`csLevel`/`inquiryUrl`/`aboutUsUrl`/`keyWordSearch`/视频字段（JSON）、聊天入口 | 匿名浏览器会话过挑战后 HTML（`R10/city-langfang-p1.html`、`R7/hebei-province.html`） |
| 公司站首页 | 公司名、地区、Business Type、Main Products、成立日期、员工数、Mgmt. Certification、Address、徽章+Since、Audited、星级、评分、OEM/ODM/Sample 等服务标签、短简介、产品栏目、部分证书 | 匿名会话 HTTP（`L/<host>/home.html`，`R8/xingchen-home.html`） |
| contact-info | 同上档案 + 联系人姓名/部门/职位 + 聊天/询盘入口 + Showroom/Local Time/Factory Tour + 评分 | 匿名会话 HTTP（`R9/*-contact.html`、`L/*/contact*.html`） |
| About Us | 长简介、General Information（注册资本/Plant Area/产品认证/复购率等）、Trade Capacity（市场/外贸人数/MOQ/Incoterms/付款/交期/港口…）、Production Capacity（产线/验货/QA/追溯）、R&D Capacity、Company Show（证书/产线/包装/新品图片）、评分、审核机构+报告编号+"N items verified"+外链 | 匿名会话 HTTP（`L/*/about.html`、`R8/xingchen-about.html`） |
| 审核报告（report.html） | 301 → About Us；audited 供应商公开审核机构、报告编号、核验外链、被第三方核验的字段清单 | HTTP 跟随 301（`L/*/report.html`、`L/xingchenglass/report-follow.html`） |
| 动态字段 | 平均响应时间+回复率（`replyRate`）、联系人名单（`getSubAccount`）、在线状态（`getTmStatus`）、本地时间（`time.do`）、实时标志（`liveFlag`） | 公开 XHR（§5） |
| 评分/评论 | 评分聚合值（About/首页/contact 有评论时）；评论页路由 `/company-review/` 200（前端 JS 渲染，明细接口未逆向） | HTTP |

### 2.2 匿名不可得（按原因分类）

| 项 | 状态 | 原因 | 证据 |
|---|---|---|---|
| 供应商**电话** | ❌ 不存在任何页面/接口 | 平台不公开（不是登录限制） | 20 页 + 内嵌 JSON 扫描：`mailto:` / `tel:` / `+86…` 电话 0 命中；`L/*/contact*.html` |
| 供应商**邮箱** | ❌ 同上 | 同上 | 同上（仅买家询盘表单的 From 邮箱输入框；`@gmail.com…` 为后缀占位符） |
| **WhatsApp/Skype/微信** | ❌ 0 命中 | 同上 | 同上 |
| 营业执照详情/注册号 | ❌ 买家侧无；🔒 供应商侧仅自己可见 | 平台只显示 "Suppliers with verified business licenses" 文案（徽章 tooltip） | `#member-since` tooltip；`contact_ebccda79.js` 中 `.J-unlogin` / `getComStatusAndBizLicense` 为供应商自检逻辑 |
| 审核报告全文 / PDF / 明细 | ❌ 不公开 | report.html 301 → About Us，无 PDF/download 链接 | `L/*/report.html` 与 `L/*/about.html` 可见文本 **完全一致**（diff 为空） |
| 站内信/收件箱 | 🔒 需登录 | 买家消息中心 | "Sign in to view the new messages"（`R10/city-langfang-p1.html` 等） |
| 询盘篮/收藏/管理 | 🔒 需登录 | membercenter | header `J-supplier` 菜单 `display:none`；`membercenter.made-in-china.com/*` |
| 聊天会话（TradeMessenger） | 🔒/⚠️ 需登录或访客身份（未完全确认） | 入口公开、聊天元数据公开；会话需身份 | `tmRightsCheck` 返回 `{"tm":"true","login":"false","visitorId":""}`；webim 使用 `login.made-in-china.com/sign-in-popup/`；匿名 HTTP 直调 `tm.do?xcase=visitorReg` 返回 404（可能需页面上下文/会话） |
| 登录后额外的公司字段 | ⚠️ 未验证 | 无账号；匿名页面无任何登录取字段占位 | §7 复核清单 |
| 供应商把电话/邮箱写进简介正文 | ⚠️ 理论可能存在 | 非平台字段、供应商自填文本；本 5 家样本 0 命中 | 全页文本扫描 |

---

## 3. 字段矩阵

**图例**：✅=HTML 直接可得；◐=需 JS 执行或公开 XHR（静态 HTML 为空/隐藏）；⚠️=依供应商填写/存在性而定（缺失≠登录导致）；—=该页面无此字段；🔒=需登录/账号；❌=平台不公开（任何匿名途径都没有）。

**路径简写**：`R10`=`recon/artifacts/probe10/`，`R9`=`recon/artifacts/probe9/`，`R8`=`recon/artifacts/probe8/`，`R7`=`recon/artifacts/probe7/`，`R4`=`recon/artifacts/probe4/`，`L/`=本次实测临时快照 `/tmp/anon-audit/`（未入库，见 §8）。

### 3.1 公司身份 / 列表字段

| 字段 | 列表页 | 公司首页 | contact-info | About Us | Audit Report(report.html) | 匿名可得性 | 选择器 / 证据 |
|---|---|---|---|---|---|---|---|
| 公司名称 | ✅ | ✅ | ✅ | ✅ | 301→About | ✅ | 列表 `div.list-node h2.company-name > a`；首页 `h1.shop-sign__header-title--text` / `title`；`R10/city-langfang-p1.html` |
| minisite host / Showroom URL | ✅ | ✅ | ✅ | ✅ | 301→About | ✅ | 列表 `h2.company-name > a[href]`；contact `#home-url` |
| 平台公司 ID（comId/cid） | ◐（`J-video-json.inquiryUrl` 内） | ✅ hidden | ✅ hidden | ✅ hidden | ✅ hidden | ✅ | `input[name="comId"]`；`h2` 内 `<script class="J-video-json">` |
| 省/国家 | ✅ | ✅ | ✅ | ✅ | 301→About | ✅ | 列表 `City/Province` 行；detail-address |
| 城市/完整地址 | —（仅 City/Province） | ✅ | ✅ | ✅（更完整） | 301→About | ✅ | `Business Type` 同级的 `Address:` info-item |
| Business Type | ✅ | ✅（折叠详情层，DOM 可读） | ✅ | ✅ | 301→About | ✅ | `td.subject:contains("Business Type")`；`.info-label/.info-fields` |
| Main Products | ✅ | ✅ | ✅ | ✅ | 301→About | ✅ | 同上；contact 中为多个 `a.J-searchProdsByKeyWord` |
| 产品关键词 `keyWordSearch` | ✅（JSON） | — | — | — | — | ✅ | `J-video-json.keyWordSearch` |
| 推荐产品（3 个 + URL/图） | ✅ | —（首页有产品栏目/热销） | — | — | — | ✅ | `ul.rec-product .pro-name a`（DOM 内 pop 层重复，去重后 3 个） |
| 产品视频 `videoUrl/videoCoverPicUrl` | ◐（JSON，样本为空） | — | — | — | — | ⚠️ | `J-video-json` |
| 成立日期 Year of Establishment | — | ✅ | ✅ | ✅ | 301→About | ✅ | `Year of Establishment:` info-item；About 同名字段 |
| 员工数 | — | ✅ | ✅ | ✅ | 301→About | ✅ | `Number of Employees:` |
| 注册资本 Registered Capital | — | — | — | ✅ | 301→About | ✅ | About General Information |
| 厂房面积 Plant Area | — | — | — | ✅ | 301→About | ✅ | About General Information |
| 会员等级（Diamond/Gold） | ✅（仅 `csLevel`：50/30） | ✅ 徽章文案 | ✅ 徽章文案 | ✅ 徽章文案 | 301→About | ✅ | `J-video-json.csLevel`；`#member-since` / `.sign-item-text` / `.shop-sign__text` |
| 会员起始年 Since YYYY | — | ◐（隐藏 tooltip） | ◐（隐藏 tooltip） | ◐（隐藏 tooltip） | 301→About | ✅ | `.J-member-since-tooltip .txt-year`（值可能带 `&nbsp;`，需 trim） |
| Audited Supplier | ✅ 图标 | ✅ | ✅ | ✅ | 301→About | ✅ | 列表 `span.as-logo img[alt="Audited Supplier"]`；站点 `img[alt="Audited Supplier"]` / `.as-logo-new` |
| Supplier Capability Index 星级 | ✅ | ✅ | ✅ | ✅ | 301→About | ✅ | `img[src*="star-light.png"]` 计数；单个 `star-gray.png`=无指数/0（lvxing 实测） |
| ODM / OEM / Own Brand 标签 | ✅ | ⚠️（OEM/ODM Service 徽章，若填） | ⚠️ | ✅（OEM Service Available） | 301→About | ✅ | 列表 `span.auth-icon-item.icon-text`；首页 `.info-item > i.icon-yes2` 旁的文本 |
| Management System Certification | ✅ | ⚠️ | ⚠️（有则显示） | ⚠️（有则显示） | 301→About | ✅ | `Mgmt. Certification` / `Management System Certification:`；xingchen/lvxing/kaishanda 无此字段=供应商未填 |
| 评分 Rating（聚合） | — | ⚠️（有评论时） | ⚠️ | ⚠️ | 301→About | ⚠️ | `.rating-score` / `Rating: 4.9/5`；hnf/kaishanda/hsrockwool 无评论无评分 |
| 评论数/评论明细 | — | — | — | — | — | ⚠️ | `/company-review/` 匿名 200（`L/review.html`），明细由 `reviewDisplay_*.js` 前端渲染，接口未逆向 |
| 公司短简介 | — | ✅ | ✅ | ✅ | 301→About | ✅ | `.detail-intro` / `intro-cnt` |
| 公司长简介（About 正文） | — | ✅（Company Profile 段） | ✅ | ✅ | 301→About | ✅ | About `.sr-comProfile-intro` / "COMPANY PROFILE" 段 |

### 3.2 贸易 / 产能 / 审核（主要来自 About Us）

| 字段 | 列表页 | 公司首页 | contact-info | About Us | Audit Report | 匿名可得性 | 选择器 / 证据 |
|---|---|---|---|---|---|---|---|
| Main Markets | — | — | — | ✅ | 301→About | ✅ | About `Main Markets:` |
| 外贸人员数 | — | — | — | ✅ | 301→About | ✅ | `Number of Foreign Trading Staff` |
| 供应链伙伴数 | — | — | — | ✅ | 301→About | ✅ | `Supply Chain Partners` |
| MOQ | — | — | — | ✅ | 301→About | ✅ | `Minimum Order Quantity` |
| Incoterms | — | — | — | ✅ | 301→About | ✅ | `International Commercial Terms(Incoterms)` |
| 付款条件 | — | — | — | ✅ | 301→About | ✅ | `Terms of Payment` |
| 平均交期 | — | — | — | ✅ | 301→About | ✅ | `Average Lead Time` |
| 海外代理/分支 | — | — | — | ✅ | 301→About | ✅ | `Overseas Agent/Branch` |
| 出口年份 | — | — | ⚠️（kaishanda 有） | ✅ | 301→About | ✅ | `Export Year` |
| 最近港口 | — | — | — | ✅ | 301→About | ✅ | `Nearest Port` |
| 产线数 | — | — | — | ✅ | 301→About | ✅ | `Production Lines` |
| 验货类型/方法 | — | — | — | ✅ | 301→About | ✅ | `Inspection Type/Method for Finished Products` |
| QA/QC 人数 | — | — | — | ✅ | 301→About | ✅ | `QA/QC Inspectors` |
| 原料可追溯 | — | — | — | ✅ | 301→About | ✅ | `Traceability of Raw Materials` |
| OEM 服务 | — | ⚠️（徽章） | ⚠️ | ✅ | 301→About | ✅ | `OEM Service Available` / `OEM/ODM Service` 徽章 |
| R&D 工程师数 / 新品 / 定制选项 / 生产设备 | — | — | — | ✅ | 301→About | ✅ | About R&D Capacity |
| 证书清单（名称+图片） | ⚠️（仅 Mgmt cert 文本） | ⚠️（部分公司首页显示 Certificates 区块） | — | ✅ Company Show | 301→About | ✅ | About `Certificates N Items`（xingchen 5、hnf 6、hsrockwool 7） |
| 工厂/产线/包装/新品照片 | — | — | — | ✅ Company Show（图片 URL） | 301→About | ✅ | About `Production show / Packing solution / New product` |
| 审核机构（SGS/CTI） | — | — | — | ✅ | 301→About | ✅ | `.about-tip` "Info marked by ✓ is verified by SGS/CTI" |
| 审核报告编号 | — | — | — | ✅ | 301→About | ✅ | `.sgs-serail-wrap`：`SGS Audit Report No.` / `CTI Audit Report No.` |
| 审核核验外链 Verify Now | — | — | — | ⚠️（仅 audited） | 301→About | ✅ | SGS→`auditedsupplier.sgsgroup.com.cn`；CTI→`mycti.cti-cert.com/#/mic` |
| 被第三方核验字段数 | — | — | — | ⚠️ | 301→About | ✅ | `.sr-as-status` "N items verified by SGS/CTI"（xingchen 8/CTI、hnf 10、其余 8） |
| 未审核标记 | — | — | — | ⚠️（非 audited 时 "Information provided by supplier"） | 301→About | ✅ | kaishanda About `sr-as-status` = "Information provided by supplier" |
| 审核报告全文/PDF | — | — | — | — | ❌ | ❌ | report.html 301 → About；两页可见文本完全相同；无 PDF/download |

### 3.3 联系人 & 沟通通道

| 字段 | 列表页 | 公司首页 | contact-info | About Us | Audit Report | 匿名可得性 | 选择器 / 证据 |
|---|---|---|---|---|---|---|---|
| 联系人姓名 | — | ⚠️（有 Contact 区时） | ✅ | ✅ | 301→About | ✅ | `.contact-customer-info .info-name`；About "Contact Supplier" 下一行 |
| 联系人部门 | — | ⚠️ | ⚠️（有则显示） | ⚠️ | 301→About | ✅ | `.info-detail > .info-item`（lvxing: export dept；hnf: Marketing Department） |
| 联系人职位 | — | ⚠️ | ⚠️（有则显示） | ⚠️ | 301→About | ✅ | 同上级 `.info-item`（manager / Overseas Marketing Executive） |
| 联系人完整名单 | — | — | — | — | — | ◐ | `GET www.made-in-china.com/im.do?xcase=getSubAccount&comIdStr=<cid>`（匿名 200，返回 username/id 列表；xingchen 8 人） |
| 供应商电话 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 全量扫描 0 命中（无 `tel:`/`mailto:`/`+86` 电话） |
| 供应商邮箱 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 同上（仅询盘表单买家侧 From 邮箱） |
| WhatsApp/Skype/微信 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 全量扫描 0 命中 |
| 在线聊天入口（Chat Now） | ✅ | ✅ | ✅ | ✅ | 301→About | ✅ | `b.tm3_chat_status[username][domainuserid][cid]` + `a.tm-placeholder` |
| 在线状态 | — | — | — | — | — | ◐ | `GET www…/ajaxfunction.do?xcase=getTmStatus&user_ids[]=<cid>_00`（`{"online":true,"status":1}`） |
| 聊天会话/消息发送 | 🔒/⚠️ | 🔒/⚠️ | 🔒/⚠️ | 🔒/⚠️ | 🔒/⚠️ | 🔒/⚠️ | `tmRightsCheck` → `{"tm":"true","login":"false","visitorId":""}`；webim 用 `login.made-in-china.com/sign-in-popup/`；匿名访客身份流程未完整验证 |
| 发送询盘 / 联系表单 | ✅（Contact Now 链接） | ✅ | ✅ | ✅ | 301→About | ✅ | `sendInquiry/shrom_*.html` 匿名 200（`L/inquiry.html`，loginStatu=0，含 To: 联系人、From 邮箱表） |
| Local Time | — | — | ◐ | — | — | ✅ | `GET <host>/time.do?t=<ms>` → `{"t":"2026/11/15 22:43:52"}`（contact 页 `.J-localtime` 空，JS 填） |
| 360° 虚拟全景 / Book a Factory Tour | — | ✅ | ✅ | ✅ | 301→About | ✅ | 文本/链接 `360° Virtual Tour`、`BookFactoryTour/<cid>` |
| 站内信/询盘篮 | — | — | — | — | — | 🔒 | "Sign in to view the new messages"；`membercenter.made-in-china.com/*` |
| 营业执照详情/注册号 | — | — | — | — | — | ❌/🔒 | 仅 "verified business licenses" 文案；`/businessLicense` 是**平台自己**的营业执照；供应商执照详情在 supplier 侧（`getComStatusAndBizLicense`、`.J-unlogin`） |

### 3.4 会员 / 审核 / 动态字段（汇总）

| 字段 | 列表页 | 公司首页 | contact-info | About Us | Audit Report | 匿名可得性 | 选择器/说明 |
|---|---|---|---|---|---|---|---|
| `csLevel`（50/30） | ✅ JSON | — | — | — | — | ✅ | `J-video-json.csLevel` |
| 会员徽章（Diamond/Gold Member） | — | ✅ | ✅ | ✅ | 301→About | ✅ | `#member-since`、`.sign-item-text`、`.shop-sign__text` |
| member_since_year | — | ◐ 隐藏 tooltip | ◐ 隐藏 tooltip | ◐ 隐藏 tooltip | 301→About | ✅ | `.J-member-since-tooltip .txt-year`（注意 A/B 模板 + `&nbsp;`） |
| Audited（布尔） | ✅ 图标 | ✅ | ✅ | ✅ | 301→About | ✅ | `as-logo-new` / `img[alt="Audited Supplier"]` |
| 星级 stars | ✅ | ✅ | ✅ | ✅ | 301→About | ✅ | `star-light.png` 计数（gray 单颗=0/无指数） |
| 平均响应时间 | — | ◐ 隐藏 block | ◐ 隐藏 block | ◐ 隐藏 block | 301→About | ✅（API） | `.average-response-time.J-response-time[style*=display: none]` + `replyRate` API（§5） |
| 及时回复率/平均回复时长（原始指标） | — | — | — | — | — | ✅（API） | `replyRate`：`l30BusiIntimeReplyRatio`、`l30BusiReplyDurAvg`、`l30Top*` |
| 供应商实时标志 liveFlag | — | — | — | — | — | ✅ | `GET <host>/liveFlag` → `false` |
| 公司视频/直播 | ◐ JSON/导航 | — | — | — | — | ⚠️ | `J-video-json.videoUrl`；导航 `Live` 入口 |

---

## 4. 「需登录 / 隐藏 / 挑战」标记清单

> 全量扫描 20 页 + 内嵌 JSON/JS：**没有发现任何 blur/掩码/`***` 字段，也没有"Sign in to view 联系方式"类门禁**。以下标记分三类。

### 4.1 登录/账号门禁（买家侧，与公司字段无关）

| 标记 | 位置 | 含义 | 证据 |
|---|---|---|---|
| `input#loginStatu[value="0"]` | 公司站每页 body 顶部 | 登录状态（0=匿名）；**不是** "loginUserName" | `L/*/*.html`、`R8`、`R9` |
| `input#loginUserName[value="<host>"]` | 公司站 | **易误读**：值是 minisite host（如 `xingchenglass`），用于跨域 AJAX，不是登录用户名 | `L/hnfinsulation/home.html` |
| `div.J-top-unlogin` / `div.J-top-logged[style="display:none"]` / `input.J-top-userType[value=""]` | 全站 header | 匿名/登录 UI 切换 | 同上 |
| `"username":"","userType":null` | 列表页 `headerHome` props 内嵌 JSON | 列表页匿名状态 | `R10/city-langfang-p1.html` |
| `login/status/check` | `https://login.made-in-china.com/login/status/check` | 匿名返回 `{"code":10010,"message":"You are not logged in, please log in first."}` | 实测 2026-11-15 |
| "Sign in to view the new messages" | 全站消息 popover（i18n `message.viewNewMsg`） | 站内信需登录；**唯一** "Sign in to view…" 文案 | `R10/city-langfang-p1.html`、`R7/hebei-province.html` |
| `li.J-supplier[style="display:none"]` | header 菜单 | 供应商账号专属功能（管理产品等） | 全站 header |
| `membercenter.made-in-china.com/*` | 消息/收藏/询盘篮/管理 | 需登录 | header 链接 |

### 4.2 隐藏但**不需要登录**的数据（客户端要按"需 JS/XHR"处理，而非"需登录"）

| 标记 | 位置 | 内容 | 匿名获取方式 |
|---|---|---|---|
| `.J-member-since-tooltip[style="display: none"]` | 首页/contact/About 徽章内 | `Diamond Member <span class="txt-year">Since 2025</span>` + "Suppliers with verified business licenses" | 直接在 HTML DOM 中可读（hover tooltip 隐藏） |
| `.average-response-time.J-response-time[style="display: none"][data-tradeGmvEtcShowFlag="true"]` + `.J-response-time-data`（空） | 首页/contact/About | 平均响应时间 | `replyRate` XHR（§5） |
| `.J-localtime`（空） | contact-info | Local Time | `GET <host>/time.do?t=<ms>` |
| `b.tm3_chat_status[style="display:none"]` + `accountonlinedisplayflag="0"` | 列表/首页/contact/About | 聊天会话元数据（cid/username/domainuserid）；**在线状态不在静态 HTML**，需 `getTmStatus` | `getTmStatus` XHR |
| `input#J-is-showroom[value="1"]` | 公司站 | showroom 页标识 | 直接读 |
| `input#webpush-lang`、`sensor_pg_v` 等 | 主页 | 埋点/语言配置 | 忽略 |

### 4.3 仅供应商自己 / 平台侧（与买家匿名无关）

| 标记 | 含义 |
|---|---|
| `contact_ebccda79.js` 中 `.J-unlogin` → `showPoploginArtdialog(...)` | 供应商侧提示（需登录供应商账号） |
| `getComStatusAndBizLicense` + 对话框「您公司的信息与营业执照审核通过后，方可查看。」 | 供应商自查执照审核状态 |
| `getBusinessCardQrUrl` / `sendBusinessCardEmail` / `.J-show-card` | 供应商名片功能（页面未挂载 `.J-show-card`，匿名不可触发） |
| `/businessLicense` | 平台（焦点科技）自己的营业执照，**不是**供应商执照 |

### 4.4 挑战类（非登录，但会伪装成 200/302）

| 机制 | 表现 | 识别 | 处理建议 |
|---|---|---|---|
| EdgeOne JS challenge | 200 + 约 987B `<script>…document.cookie="__tst_status=…"` | `len<3000 && "__tst_status" in body` | 执行脚本或丢弃会话重试；优先用已通过挑战的浏览器 cookie |
| Focus Captcha | 302 → `captcha.made-in-china.com/verification.html?srcUrl=…`；或 200 + 5.6–5.9KB 「请验证 / Focus Captcha」页 | `302 location contains captcha.made-in-china.com`；`"请验证"/"Focus Captcha"` | 返回 `NEED_HUMAN_VERIFICATION`；已有人工/自动方案（见 [`docs/captcha-autosolve.md`](captcha-autosolve.md)：滑块可程序化通过并固化会话） |
| 列表/SEO 页挑战 | 纯 HTTP 直连列表 → 302 captcha | 同上 | 列表走浏览器会话；公司页可 HTTP + 匿名会话 |

---

## 5. 匿名可用的公开 JSON/接口（隐藏字段的真相）

| 接口 | 方法/参数 | 匿名实测 | 返回/用途 |
|---|---|---|---|
| `https://data.made-in-china.com/extend/busiMerge/replyRate` | `POST date=YYYYMMDD&comId=<cid>&operatorNo=all` | 200，5/5 家均有数据 | `l30BusiReplyDurAvgRange`（如 `≤8.54h`）、`l30BusiIntimeReplyRatio`、`l30BusiReplyDurAvg` 等；**平均响应时间字段的匿名来源** |
| `https://www.made-in-china.com/im.do?xcase=getSubAccount&comIdStr=<cid>` | GET | 200（xingchen 8 人、hnf 3、kaishanda 4、lvxing 1、hsrockwool 8） | 全部联系人 username/domainuserid 名单（无职称/邮箱） |
| `https://www.made-in-china.com/ajaxfunction.do?xcase=getTmStatus&user_ids[]=<domainUserId>` | GET | 200 | `{"online":true,"status":1}` 在线状态 |
| `https://membercenter.made-in-china.com/tm.do?xcase=tmRightsCheck` | GET | 200 | `{"tm":"true","login":"false","visitorId":""}`（聊天权限/登录态证据） |
| `https://<host>.en.made-in-china.com/time.do?t=<ms>` | GET | 200 | `{"t":"2026/11/15 22:43:52"}` Local Time |
| `https://<host>.en.made-in-china.com/liveFlag` | GET | 200 | `false` |
| `https://login.made-in-china.com/login/status/check?_t=<ms>` | GET | 200（匿名） | "You are not logged in, please log in first." |
| 列表行 `<script class="J-video-json">` | 内嵌 JSON | — | `comName/comUrl/csLevel/sgsMembership/keyWordSearch/inquiryUrl/aboutUsUrl/videoUrl/videoCoverPicUrl` |
| 公司站 `<script class="J-mlan-config">`、header props | 内嵌 JSON | — | 语言/账号/埋点配置（含 `userType:null`） |
| `/company-review/` | GET | 200（xingchen，loginStatu=0） | 评分/评论页路由；明细前端渲染，接口未逆向 |

> 说明：以上接口均**不需要登录**即可返回数据；它们与列表页的内嵌 JSON 一样，是客户端可用的匿名数据源（但请遵守限速）。更完整的 JSON 替代方案（m 站 `search/supplier`、`company-<账号>/info.html` SSR JSON、SSR 审核章节等）见 [`docs/upstream-api.md`](upstream-api.md)，两者可互补：JSON 接口负责"全量结构化抓取"，本页矩阵负责"哪些字段在公开页面确实存在/不存在、如何判定 null"。

---

## 6. 对客户端字段设计的影响

### 6.1 字段级建议（对应 `docs/design.md` 第 4 节 schema）

| 字段 | 建议类型/来源 | 匿名可得性 | 处理建议 |
|---|---|---|---|
| `company_name` / `minisite_url` / `province` / `city` | string | ✅ | 正常填；列表页 → 详情可复用 |
| `business_type` / `main_products[]` / `established_at` / `employee_count` | string/date/int | ✅（列表无，详情有） | 列表行可能缺（kaishanda 无 Business Type/Year/Employees），详情补全；仍 null 时标 `not_provided_by_supplier` |
| `management_certifications[]` | string[] | ✅ 或缺失 | 列表 `Mgmt. Certification`、contact/About 同名字段三处一致；无则 `[]`（不是登录问题） |
| `audited` | boolean | ✅ | 列表图标 + 站点 `as-logo-new` 双源交叉验证；**不要**用 `csLevel` 推断 |
| `membership_tier` / `raw_cs_level` / `member_since_year` | enum/string/int | ✅ | 列表 `csLevel`（50/30）为主；详情徽章文案 + `.J-member-since-tooltip .txt-year` 补全；Since 可能带 `&nbsp;`，注意 trim；**不要**从简介正文的 "Since 20xx" 取 |
| `capability_stars` | int 0–5 | ✅ | 数 `star-light.png`；单颗 gray = 0/无指数（lvxing 实例） |
| `rating` / `review_count` | float/int/null | ⚠️ 有评论才有 | 无评论 → `null`，不要标记为登录可见；`review_count` 需另逆向评论接口 |
| **`audit_agency` / `audit_report_no` / `audit_verify_url` / `audit_verified_items`** | string/int | ✅（audited 时） | **建议新增到 schema**（design.md 目前没有）。来源：About `.sgs-serail-wrap`、`.about-tip`、`.sr-as-status`；audited=false 时可能仍有内部编号（kaishanda `MIC20260701001`，无 Verify Now，不应视为第三方审核通过）；`audit_agency ∈ {SGS, CTI, null}` |
| `avg_response_time` / `reply_metrics` | string/object | ◐ 需 XHR | 静态 HTML 只有空 label（`display:none`）。**建议客户端懒加载** `replyRate`（`cid` 用 `input[name=comId]` 或 `inquiryUrl` 解析）；无数据/无 `l30BusiReplyDurAvgRange` → `null` |
| `contact_person`（name / department / title） | object | ✅（可能缺） | 从 `contact-info` 的 `.contact-customer-info .info-name` + `.info-item` 解析；About/首页也可能有（模板相关）；缺字段各自 null |
| `contact_roster` | string[]（username） | ◐ 公开 XHR | 可选字段；`getSubAccount` 只给名（first name 为主），不含职称/邮箱 |
| `supplier_online_status` | bool/null | ◐ | `getTmStatus`（需 domainUserId，列表/contact 的 `b.tm3_chat_status` 属性里有）；仅在有聊天时使用 |
| **`phone` / `email` / `whatsapp` / `skype` / `wechat`** | **不建模 / 恒 null** | ❌ | **不要设计"登录后可见"**（平台无此字段，不是门禁）；如 client 需要，输出 `null` + `unavailable_reason="not_public_by_platform"`，UI 提示"通过站内询盘/聊天联系" |
| `business_license_*` | 不建模 | ❌/🔒 | 仅保留 `verified_business_license=true`（来自徽章文案）；不提供注册号/执照图 |
| `inquiry_url` / `chat_available` / `chat_username_domainuserid` | string/bool/object | ✅ | 列表 `inquiryUrl` + `b.tm3_chat_status` 属性；`sendInquiry` 表单匿名可访问（loginStatu=0） |
| `showroom_url` / `factory_tour_url` / `virtual_tour_available` | string/bool | ✅ | `#home-url`、`BookFactoryTour/<cid>`、文本 "360° Virtual Tour" |
| `local_time` | string | ◐ | `time.do`（如需展示；非核心字段可缓存在详情缓存里） |
| `audit_report_page` | — | ❌ | 不要依赖 `/audited-supplier-reports/report.html`：**301 → About Us**，应直接把该 URL 当 About Us 别名处理（否则客户端会多抓一次） |

### 6.2 解析/工程要点

1. **「not_public_by_platform」vs「not_provided_by_supplier」vs「fetch_blocked」**：设计枚举 `unavailable_reason`：
   - `not_public_by_platform`：电话/邮箱/WhatsApp/职位等平台不提供（即使登录也没有）；
   - `not_provided_by_supplier`：Business Type/Year/Employees/Mgmt cert 等字段供应商未填（kaishanda 实例）；
   - `no_reviews`：rating 缺失（无评论）；
   - `fetch_blocked`：挑战/超时，缓存层应标 `stale:true`。
2. **A/B 两套主页模板**（实测 body `probe-AB-Test="A"/"B"`）：
   - A：`.sr-comInfo-sign .sign-item#member-since`；
   - B：`.shop-sign__wrap .shop-sign__icon.shop-sign__member-since#member-since`；
   - 通用兜底：`#member-since`、`.J-member-since-tooltip`、`as-logo-new`、`img[alt="Audited Supplier"]`、`img[src*="star-light.png"]`，**不要**绑定单一模板 class。
3. **contact-info 的字段块是"有则显示"**：Business Type/Year/Employees/Mgmt cert/地址在 `.detail-infos .info-item`，没有的字段整块缺失；不要因缺字段误判"被隐藏/需登录"。
4. **列表页 `csLevel` 只在 `J-video-json`**（HTML 无会员文案）；`sgsMembership` 字段含义未明（样本均为 0/"0"，不要用于 audit 判断）。免费/未知会员判定：无徽章 + 列表无 `csLevel` → `unknown`（**不猜** `free`；`free` 仅在确认无任何付费标识时使用）。
5. **挑战检测先于解析**：`< 3000B` + `__tst_status` / `captcha.made-in-china.com` / `请验证` 三种特征；公司页 challenge 时可用缓存回退，列表页则走挑战会话（自动过码方案见 [`docs/captcha-autosolve.md`](captcha-autosolve.md)），失败再返回 `NEED_HUMAN_VERIFICATION`。
6. **登录提示只用于买家侧动作**（聊天/收藏/站内信等），不要把公司字段标成 "需登录"。

---

## 7. 限制与后续

- **样本量**：5 家（河北/廊坊，玻璃/保温材料/家具），结论对"公司公开档案"较稳；尚未覆盖：SGS/CTI 之外机构、免费会员（本批列表全部为 30/50 付费会员，未遇到 free tier）、多语言站点、产品详情页。
- **登录态差异未验证**：无账号；建议 `mic auth` 后用同一 URL 对照一次（重点检查：contact-info 是否新增电话/邮箱/`View Contact Details`、About 是否多出报告 PDF、header 是否出现 `Sign in to view` 类文案）。当前证据只能说明"匿名页面没有这类占位"。
- **评论明细接口未逆向**（`/company-review/` 为前端渲染），如需 `review_count/评论内容` 另开子任务。
- **供应商自填联系方式**：5 家 0 命中，但理论上供应商可在简介正文/图片里写电话/邮箱；如果后续做全量，建议对 `about` 正文跑手机号/邮箱/微信正则，命中时作为 `raw_contact_mentions`（不保证结构化）。
- **临时快照**：本次 5 家 × 4 页的实测 HTML 在 `/tmp/anon-audit/`（机器重启会丢）；如需入库，建议 Lead 复制到 `recon/artifacts/probe11-anon/`（本次任务写范围仅允许 `docs/anonymous-completeness.md`，未擅自写入）。

---

## 8. 证据索引

### 8.1 已有仓库快照（匿名，可直接复核）

| 路径 | 内容 | 匿名证据 |
|---|---|---|
| `recon/artifacts/probe10/storage-state.json` | 匿名浏览器会话 cookie（xingchenglass host 的 `__tst_status`/`EO_Bot_Ssid` + 公共 cookie），用于 HTTP 暖会话 | 会话本身未登录（loginStatu=0） |
| `recon/artifacts/probe10/city-langfang-p1.html` | 城市列表页（30 行）；含 xingchenglass/kaishanda/hsrockwool 行；含 `Sign in to view the new messages` 文案 | `headerHome` props `"userType":null` |
| `recon/artifacts/probe10/province-hebei-p10.html`、`probe8/seo-hebei.html`、`probe5/supplier-search.html` | 其他列表页（字段结构一致） | 匿名浏览器会话 |
| `recon/artifacts/probe7/hebei-province.html` | 省级列表页（30 行）；含 hnfinsulation/lvxingmirror 行 | 匿名浏览器会话 |
| `recon/artifacts/probe8/xingchen-home.html` · `xingchen-about.html` | xingchen 首页/About（**浏览器 DOM，JS 执行后**，含 `≤8.54h`/8 items verified 等动态值） | `loginStatu=0`，各 1–2 处 |
| `recon/artifacts/probe9/xingchen-contact.html` · `lvxingmirror-contact.html` | 两家 contact-info 匿名快照 | `loginStatu=0` |
| `recon/artifacts/probe10/city-langfang-p1-info.json`、`recon/artifacts/sample-normalized.json` | 列表清洗样例（可对照字段/选择器） | — |
| `recon/artifacts/probe4/step3-company-home.html` | 补充匿名首页样本（QINGDAO RISING STAR GLASS） | `loginStatu=0` |

### 8.2 本次实测临时快照（`/tmp/anon-audit/`，未入库）

每个 host 目录含 `home.html` / `contact`（`contact-live.html` 或 `contact.html`）/ `about.html` / `report.html`（301 跟随后的 About）：

| 目录 | 说明 |
|---|---|
| `/tmp/anon-audit/xingchenglass/` | `home-archived.html`、`about-archived.html`（复制自 probe8）、`contact-archived.html`（复制自 probe9）、`report-follow.html`（report 301 后 About） |
| `/tmp/anon-audit/lvxingmirror/` | 4 页（live） |
| `/tmp/anon-audit/hnfinsulation/` | 4 页（live；`contact-live.html` 为通过会话抓取的完整页） |
| `/tmp/anon-audit/kaishanda/` | 4 页（live，含非 audited 对照） |
| `/tmp/anon-audit/hsrockwool/` | 4 页（live，含 Mgmt cert 对照） |
| `/tmp/anon-audit/contact-parsed.json`、`company-parsed.json`、`summary-contact.json` | 字段提取中间结果（选择器/值对照） |

### 8.3 关键 URL / 状态码复核命令（可随时重跑）

```bash
# 匿名状态证据（无需账号）
curl -s 'https://login.made-in-china.com/login/status/check'
# → {"code":10010,...,"message":"You are not logged in, please log in first."}

# 平均响应时间（匿名公开 XHR；date 取 2 天前）
curl -s -X POST 'https://data.made-in-china.com/extend/busiMerge/replyRate' \
  -d 'date=20261113&comId=UCJfyzwThnqK&operatorNo=all'
# → {"data":[{"l30BusiReplyDurAvgRange":"≤8.54h","l30BusiIntimeReplyRatio":0.7949,...}]}

# 联系人名单（匿名公开 XHR）
curl -s 'https://www.made-in-china.com/im.do?xcase=getSubAccount&comIdStr=UCJfyzwThnqK'
# → {"UCJfyzwThnqK":[{"name":"cindy","id":"UCJfyzwThnqK_00"}, ... 共 8 人]}

# 审核报告页 = About Us 别名（301）
curl -s -o /dev/null -D - 'https://hnfinsulation.en.made-in-china.com/audited-supplier-reports/report.html'
# → HTTP/2 301; location: .../company-CenerTech-Insulation-Engineering-Co-Ltd-.html?isNewShowroomUrl=1&xcase=auditReport

# 纯匿名直连列表会吃挑战（302 到 Focus Captcha）
curl -s -o /dev/null -D - 'https://www.made-in-china.com/companysearch.do?subaction=hunt&style=b&mode=and&code=0&comProvince=Hebei&order=0&isOpenCorrection=1&word=glass&page=1'
# → HTTP/2 302; location: https://captcha.made-in-china.com/verification.html?srcUrl=...
```

---

## 9. 一句话给 Lead

> 匿名（不登录）能拿到供应商**公开档案接近全量**（含审核机构/报告编号/响应时间/联系人姓名职称）；唯一系统性缺失是**电话/邮箱/WhatsApp 等直接联系方式——平台根本不公开**（不是登录墙），审核报告只有编号+外链核验；客户端应把这些字段设为 `null + not_public_by_platform`，不设计"登录解锁"，把登录只用于聊天/站内信等买家侧动作，并重点处理 Focus Captcha/EdgeOne 挑战会话。
