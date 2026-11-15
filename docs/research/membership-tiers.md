# MIC（中国制造网）会员等级体系与页面识别规则

> 研究任务：搞清 Diamond Member / Gold Member / KA / SKA / Audited Supplier 的定义与页面可识别特征，为本地客户端「自动识别供应商会员等级」提供依据。
> 研究时间：2026-11-15；证据快照见 [`docs/membership-evidence/`](membership-evidence/README.md)（含原始 HTML、官方页面摘录、投资者关系记录）。
> 本文所有结论按 **官方确认 / 高度可信推断 / 待验证** 三级标注，关键结论均附来源链接。

---

## 0. 一句话结论（TL;DR）

1. **MIC 公开（页面可见）的会员等级只有两档：`Diamond Member`（钻石会员，59,800 元/年）与 `Gold Member`（金牌会员/龙会员，31,100 元/年）**；此外还有大量**免费会员**（页面上无任何等级徽章）。→ **官方确认**。
2. **`优享 / 尊享 / MKA` 是“大客户”销售/服务分层，位于钻石会员之上**（MKA = 面向行业龙头供应商的大客户会员，2020 年四季度推出）；官方明确说过“这两部分会员**还未纳入正式会员级别**”，且其差异化权益只体现在 **Virtual Office 后台**（尊享/MKA 标志），公网页面没有独立徽章。→ **官方确认 + 高度可信推断（前台显示为 Diamond Member，见 §3.5）**。
3. **`KA` / `SKA` / `GSKA` 不是 MIC 的会员名，而是阿里巴巴国际站的客户分层**（KA=Key Account 重点商家；SKA=Super Key Account 高级重点商家；GSKA=Group Super Key Account 集团型高级重点商家），按年度方案投入分档。MIC 的对标概念是「大客户（优享/尊享/MKA）」。**页面/API 上没有任何 KA/SKA 标识可抓**。→ **高置信**（见 §2）。
4. **`Audited Supplier`（认证供应商，简称 AS）不是会员等级，而是第三方实地审核认证服务**（2007 年起，联合 SGS / Bureau Veritas / TÜV Rheinland / CCIC / CTI 等），与会员等级**正交**：付费会员基本都会做认证，页面上 AS 图标和 Diamond/Gold 徽章可以同时存在。→ **官方确认**。
5. **自动识别建议**：会员等级枚举用 `diamond | gold | free | unknown`；`audited` 用独立布尔字段；`ka/ska` **不要**作为 MIC 页面识别结果（若业务方坚持要，需单独字段并由销售/CRM 数据回填）。**判定优先级：公司站头部徽章 > 公司站产品组/产品页头部 > 老版列表页徽章图 > 列表页 csLevel JSON > 新版列表页（判不出，落 unknown）**。

---

## 1. MIC 官方会员/套餐体系全貌

### 1.1 公开会员等级（页面有徽章、有官方权益表）

| 中文名 | 英文页面名 | 年费 | 官方定位 | 页面徽章 |
|---|---|---|---|---|
| 免费会员（含“体验/成长体系”） | 无等级徽章（英文站无对应等级名） | 免费 | 可发有限产品、免费展示厅；官方规则里明确列为「免费会员」客户级别 | **无徽章** |
| 金牌会员（图标为龙形） | **Gold Member** | **31,100 元/年** | 2018 年之前的基础付费会员，现为入门付费档 | 金色龙形图标 + `Gold Member` |
| 钻石会员 | **Diamond Member** | **59,800 元/年** | 2018 年推出的最高**公开**会员等级 | 蓝色钻石图标 + `Diamond Member` |

- 权益差异（官方对比表节选）：产品数量 1000 → 3000 条；产品详情图片 12 → 25 张；主打产品 7 → 10 个；二级目录 15 → 30 个；子账户同为 7 个；多语展示厅金牌版/钻石版；两者都含“客户图标”“认证图标”。完整表见 [中国制造网会员级别](https://service.made-in-china.com/help/marketing/9098.htm)。
- 价格出处：官方帮助页（同上）+ 焦点科技投资者关系新闻稿 [金融界 2023-05-28](https://finance.jrj.com.cn/2023/05/29111937585655.shtml)（“收费客户主要分为金牌会员和钻石会员两种类型，金牌会员 31,100 元/年，钻石会员 59,800 元/年”）。
- 免费会员的存在与权益：官方 [会员积分细则](https://service.made-in-china.com/help/guide/member/12199.htm) 按“免费会员 200 积分 / 金牌会员 400 积分 / 钻石会员 600 积分”给初始积分；官方 [免费会员成长体系](https://service.made-in-china.com/developing/activities/12697.html) 说明免费会员有独立成长体系。
- 历史遗留：2009 年招股书显示曾有 **银牌会员（10,800 元/年）/ 铜牌会员（4,800 元/年）**，分别于 2008-01-01、2006-06-01 停止出售；金牌当年 21,600 元/年。→ 新数据不应再出现，若遇到按 `unknown` + 异常标记处理。

### 1.2 大客户 / 高层级套餐（官方承认，但**不是公开会员级别、无独立徽章**）

| 中文名 | 内部/官方口径 | 年费量级 | 与钻石会员关系 | 页面可见性 |
|---|---|---|---|---|
| **优享（客户/会员）** | 大客户套餐（“优享及以上大客”） | 第三方口径约 15 万/年（**待验证**） | 推断：在钻石权益基础上加深运营服务 | 公网无独立徽章；VO 权益页（推断与尊享同机制） |
| **尊享（客户/会员）** | 大客户套餐（2021 年 IR 提及） | 第三方口径约 30 万/年（**待验证**） | “在钻石会员基础之上”（2021 IR 原话） | 同上；VO 后台有“尊享”标识 |
| **MKA（客户/会员）** | 大客户会员，面向行业龙头供应商（2020Q4 推出） | 定制（按客户方案） | 同上 | 同上；VO 后台有“MKA”标志 |
| （名企） | 招聘信息中与尊享/MKA 并提的“名企”客户群 | —— | 面向知名企业的销售计划，非页面等级 | 无 |

**关键官方原文**（务必以这段为准）：

> 在钻石会员基础之上，我们内部也提出了尊享会员……去年四季度，针对一些行业龙头供应商，我们也推出了 MKA 会员。**目前这两部分会员还未纳入我们的正式会员级别**。
> —— [焦点科技投资者关系活动记录表 2021-06-30](http://static.cninfo.com.cn/finalpage/2021-06-30/1210376231.PDF)

> 为将 MKA 及尊享的**大客户权益**直观化呈现……VO 首页左侧：显示主/子帐户、会员等级名称及 logo、认证供应商 logo、**尊享/MKA 标志**、到期时间
> —— [【新功能说明】大客户权益线上化 2021-09-28](https://service.made-in-china.com/activities/operating-activities/special/10941.html)

> **中国制造网尊享或 MKA 权益**，是指由中国制造网为贵司提供的包括不限于协助产品发布、智能发品、图片处理、图片设计等服务。
> —— [用户协议（尊享/MKA 专项）](https://service.made-in-china.com/help/regulation/announcement/11406.htm)

> MKA/尊享/优享客户 50；钻石会员 30；金牌会员 15；免费会员 15（二级目录数量）
> —— [中国制造网供应商目录发布规范](https://service.made-in-china.com/help/regulation/info/14068.htm)（同口径另有 [目录超量处理说明](https://service.made-in-china.com/help/regulation/info/13868.htm)）

> 不满足交易门槛入驻的**优享及以上大客**可通过大客权益入驻……优享可二选一直接参与；**尊享&MKA 客户可通过绿色通道**
> —— [2026 金秋采洽会活动规则](https://service.made-in-china.com/activities/operating-activities/special/27441.html)

> 主要负责平台的**尊享客户，MKA 客户，名企**的维护与运营
> —— [焦点科技招聘：大客户运营经理](https://hr.focuschina.com/id3259358.html)

价格（优享≈15 万、尊享≈30 万）目前只有第三方媒体口径（[amz123 2025-04](https://www.amz123.com/ask/mNzBIUvX)），**未经官方页面确认**；产品数配额（优享 4000 / 尊享 7000 / MKA 10000）来自第三方文章（[知乎 2026](https://zhuanlan.zhihu.com/p/2026734435572232249) 的搜索摘要，原文被反爬），标记**待验证**。

### 1.3 认证（与会员等级正交，不是等级）

| 名称 | 英文 | 性质 | 页面上怎么出现 |
|---|---|---|---|
| 认证供应商 | **Audited Supplier / AS** | 2007 年起推出的**付费审核认证服务**（第三方实地审核：SGS / BV / TÜV Rheinland / CCIC / CTI），出具唯一编号的**认证报告（Audit Report / AR）** | 独立图标 + `Audited Supplier` 文案 + 报告链接；**不替代会员徽章** |
| 认证报告 | Audit Report / AR | AS 服务的产物，可在线查看/下载；公司成立时间等字段以其为准 | `/audited-supplier-reports/report.html` 页面；报告编号如 `TÜV Rheinland Audit Report No.: MIC-ASR2121460` |
| 认证（服务 PLUS） | 2023-07 起升级 | 原 AS 服务焕新，联合更多机构、增加审核维度（[江苏商报 2023-07-28 报道](http://jssb.njdaily.cn/resfile/2023-07-28/A07/JSSB-2023-07-28-A07.pdf)） | 同上 + 实力标签 |
| 实力标签 | Supplier Strength Tags | 从 AR 报告提取的 40+ 项能力标签，供应商最多外显 4 个（如 OEM/ODM、快速发货、研发能力） | 新版搜索页显示 `ODM · OEM · Own Brand` 等 |
| 供应商星级 | **Supplier Capability Index** | 产品信息品质/服务质量/响应速度的综合评分（2025-01-06 体系升级，2025-04-17 起在**搜索结果页**前台展示） | 5 颗星图标 + tooltip `Supplier Capability Index: out of 5 stars` |
| 标杆工厂 | **LeadingFactory / Audited Factory** | 认证报告中类型为“工厂/工贸一体”且达标的供应商（2025-04 新增 Audited Factory 页签） | `LeadingFactory` 标签 / `leading-factory.png` |
| 工商信息核验 | verified business licenses | 营业执照等工商信息核验，随会员徽章 tooltip 展示 | 会员徽章 tooltip 中的 `Suppliers with verified business licenses` |

官方定义与流程见：[认证供应商常见问题汇总](https://service.made-in-china.com/help/faq/auditedSupplier/1855.htm)、[如何充分展示 Audited Supplier 认证优势](https://service.made-in-china.com/help/promotionskill/company/1675.htm)、[焦点科技商标页](https://www.focuschina.com/about-trademark.html)、英文官方 FAQ [Where can the Audit Report be shown?](https://www.made-in-china.com/faq/detail1u606001844/Audited-Suppliers.html)。
其中 AS FAQ 明确：“**目前我网实行全员审核，所有金牌会员必须进行认证**”——这是“付费会员基本都带 AS 图标”的原因；但 AS 本身仍是**独立服务**（[2019 年报](http://disc.static.szse.cn/disc/disk02/finalpage/2019-08-26/bc7653cc-41b5-406f-ab1e-30b5dadd38f6.PDF)披露“认证供应商服务收入……向注册收费会员收取认证服务费”），**不能反推会员等级**。

### 1.4 交易相关（不影响等级枚举）

- `Secured Trading Service (STS)`、`Global Pay`、在线交易专区等属于**服务能力/准入**，不是会员等级；页面上可能出现 STS 标识，但**不是 diamond/gold 的替代**。
- 官方口径中未发现“交易会员”这一独立会员等级名称。→ 高度可信推断。

---

## 2. KA / SKA 到底是什么（重点）

### 2.1 结论

**KA、SKA 不是中国制造网的会员名或套餐名，而是阿里巴巴国际站（Alibaba.com）的客户分层术语。** MIC 官方帮助中心、活动页、投资者关系记录、年报、招聘页面均未把它们作为等级使用；它们只出现在“MIC 与阿里国际站对比”类行业文章中（用来描述阿里）。

- `KA` = **Key Account**（重点客户/大客户）
- `SKA` = **Super Key Account**（高级重点商家）
- `GSKA` = **Group Super Key Account**（集团型高级重点商家）
- 定位（第三方口径，多来源一致）：GSKA 顶层商家 / SKA 中上级优质商家 / KA 腰部有潜力商家
- 分档方式：按**年度投入规模**（常见口径：品质X商 20 万+、KA 50 万+、SKA 100 万+、GSKA 300 万+；不同年份代理商口径有出入）

来源：
- 阿里官方中文站：[阿里巴巴国际站 SKA 怎么做？](https://supplier.alibaba.com/trade/domestic/PX002DNAI.htm)（“SKA 在阿里巴巴国际站上代表的是**高级重点商家合作体系**”）
- [MBA智库：KA 商家](https://wiki.mbalib.com/wiki/Ka%E5%95%86%E5%AE%B6)（KA=KeyAccount，重要客户）
- [amz123：SKA 是什么](https://www.amz123.com/ask/ErWUwAG8)（SKA=Super Key Account 高级重点商家；GSKA=Group Super Key Account 集团型高级重点商家）
- [搜狐 2025：阿里国际站一年费用](https://www.sohu.com/a/848607250_121804224)（品质X商 20 万+/KA 50 万+/SKA 100 万+/GSKA 300 万+）
- [知乎：MIC 与阿里国际站的区别](https://zhuanlan.zhihu.com/p/581610727)（把“出口通，金品，KA，SKA，GSKA”归为阿里方案分层）

### 2.2 和 MIC 的对应关系（建议这样向用户解释）

| 阿里国际站 | 中国制造网（MIC） | 说明 |
|---|---|---|
| 出口通（基础付费） | 金牌会员 / 钻石会员 | 都是“付年费开店”的基础付费档，但产品/权益不同，不可直接换算 |
| 金品诚企（认证+流量） | 钻石会员 + 认证供应商(AS) + 实力标签 | MIC 没有与“金品诚企”一一对应的命名 |
| 品质X商 / KA / SKA / GSKA | **优享 / 尊享 / MKA**（大客户分层，不公开定价） | MIC 官方叫“大客户”，且**未纳入正式会员级别**；公网页面看不出差异 |
| ——（阿里有明确的 KA/SKA 标签体系） | MIC 页面**没有** KA/SKA 任何标识 | 想抓 KA/SKA 只能接销售/CRM 数据 |

> 提醒：MIC 自己有个 `MKA`（2020Q4 推出、面向行业龙头供应商），与阿里的 `KA` 是两套体系，**不要因为都含 “KA” 就混用**。`MKA` 也**不是**页面可见等级。

---

## 3. 页面可识别特征（实测，2026-11-15）

> 实测样本：公司站 `hkenrich.en.made-in-china.com`（Diamond）、`lansaimu1.en.made-in-china.com`（Gold）、`kenengindustry.en.made-in-china.com`（Gold）；列表页 `products-search/hot-china-products/...`、`suppliers-discovery/`、`companysearch.do`。原始 HTML 见 [`membership-evidence/`](membership-evidence/README.md)。

### 3.1 公司站头部（P0，最可靠）

公司二级域名站（`*.en.made-in-china.com`）首页、产品组页、产品详情页、认证报告页共用同一套头部组件：

```html
<!-- 钻石会员 -->
<div class="sr-comInfo-sign">                <!-- 或 .shop-sign__wrap 内 -->
  <div class="sign-item" id="member-since">
    <i class="item-icon icon-diamond"></i>   <!-- 公司站首页另一套皮肤为 <i class="ob-icon icon-diamond"></i> -->
    <span class="sign-item-text">Diamond Member</span>   <!-- 首页皮肤为 .shop-sign__text -->
    <div class="J-member-since-tooltip" style="display:none">
      <i class="item-icon icon-diamond"></i>Diamond Member
      <span class="txt-year">Since 2011</span>
      <div>Suppliers with verified business licenses</div>
    </div>
  </div>
  <!-- 认证供应商（独立于会员等级） -->
  <div class="sign-item as-logo-new J-tooltip-ele"
       data-title="Audited by an independent third-party inspection agency">
    <img src="https://www.micstatic.com/common/img/icon-new/as_32.png" alt="Audited Supplier">
    <span class="sign-item-text txt-as">Audited Supplier</span>
  </div>
  <!-- 星级：Supplier Capability Index（不是等级） -->
  <span class="sign-item icon-star J-tooltip-ele"
        data-title="Supplier Capability Index: out of 5 stars">
    <img src="https://www.micstatic.com/common/img/icon-new/star-light.png" alt="">×N
  </span>
</div>
```

**判定特征：**

| 目标 | 可靠特征 | 备注 |
|---|---|---|
| Diamond | 文本出现 `Diamond Member`；图标 class 含 `icon-diamond` | 首页皮肤 class 为 `shop-sign__member-since` / `ob-icon icon-diamond`；内页皮肤为 `sr-comInfo-sign` / `item-icon icon-diamond` |
| Gold | 文本出现 `Gold Member`；图标 class 含 `icon-gold` | 实测于产品组页（`sr-comInfo-sign`）与视频频道卡片（`icon-gold` + `item-year`） |
| 入驻年份 | tooltip 内 `Since YYYY`（`.txt-year` / `.item-year`） | **这是会员起始年，不是公司成立年**；公司成立年要看认证报告/公司介绍 |
| Audited | `img[alt="Audited Supplier"]`、`as_32.png` / `as-short.png`、`data-title="Audited by an independent third-party inspection agency"`、链接 `/audited-supplier-reports/report.html` | `as-short.png` 用于列表小徽章，`as_32.png` 用于头部 |
| 星级 | `data-title="Supplier Capability Index: out of 5 stars"` + N 个 `star-light.png` | 星级与会员等级无关，**不要映射成等级** |

> 注意：`icon-*` 的父级 class 存在两套皮肤（`shop-sign__*` 用于公司站首页，`sr-*`/`sign-item` 用于内页），抓取时应同时匹配**文本**，不要只依赖 class。

### 3.2 老版列表页卡片（P1，仍在线）

类目/关键词列表页（如 `products-search/hot-china-products/LED_Light.html`）、`suppliers-discovery/` 仍渲染老版徽章：

```html
<div class="company-sign">
  <div class="sign-item">
    <img class="auth-icon" height="16"
         src="https://www.micstatic.com/common/img/icon-new/diamond_32.png"
         alt="China Supplier - Diamond Member"> Diamond Member
    <!-- Gold 对应 gold_32.png / alt="China Supplier - Gold Member" -->
  </div>
  <div class="sign-item" title="Suppliers reviewed by inspection services.">
    <img class="auth-icon" src="https://www.micstatic.com/common/img/icon-new/as-short.png"
         alt="Audited Suppliers"> Audited Supplier
  </div>
</div>
```

- 弹层里还有：`<li class="cs-level-info">`（等级徽章）、`<li class="as-info as-logo">`（认证）。
- 广告位卡片内嵌 JSON 带 `"csLevel":"50"`、`"showAS":"true"`、`"auditLogoUrl"`。
- **内部等级码（实测于页面 JS 模板与 JSON）：`csLevel=50` → Diamond Member；`csLevel=30` → Gold Member。** 模板只处理 50/30 两种，其他值不渲染。→ 高度可信（未见官方文档，属于页面实现细节）。

### 3.3 新版搜索结果页卡片（P2，判不出等级）

2025-04-17 起 MIC 官方对**关键词搜索结果页**做了改版，官方公告原话：

> 新增供应商星级、研发能力等体现供应商资质、能力的标识，**去除主打产品黄钻标识、TopRank 广告标识、金牌/钻石标识等买家难以理解的标识**。
> —— [【功能通知】搜索结果页标识优化升级（2025-04-16）](https://service.made-in-china.com/help/promotionskill/company/16634.htm)

实测新版公司搜索卡片（`companysearch.do?subaction=hunt&style=b...`，2026-11-15）确实**没有** diamond/gold 徽章，只有：

```html
<li class="auth-icon-list">
  <span class="auth-icon-item"><!-- Audited Supplier：as_32.png + 报告链接 --></span>
  <span class="auth-icon-item icon-star" data-title="Supplier Capability Index: out of 5 stars">
    ×N star-light.png
  </span>
  <span class="auth-icon-item icon-text">ODM · OEM · Own Brand</span>
</li>
<table class="company-intro">
  <tr><td class="subject">Main Products:</td>…</tr>
  <tr><td class="subject">Mgmt. Certification:</td><td>ISO9001:2015、BSCI 等</td></tr>
  <tr><td class="subject">City/Province:</td>…</tr>
</table>
```

→ **新版列表页不能用来判定 diamond/gold**（但可以拿 Audited、星级、认证、地区、主营产品）。
补充：新版页面源码里仍保留含 `csLevel` 的 `<script type="text/html" id="com-block-tmp">` 模板（未渲染），说明后台数据里等级码可能还在，可作为将来找接口的线索（见 §6-3）。

### 3.4 其他出现过会员字样的位置（低优先级/易误判）

| 位置 | 实际含义 | 风险 |
|---|---|---|
| 旧版公司目录页标题 `… - Premium Member`（如 `/company-index/Service-business-4111-1024.html`） | 英文站对**高级会员（付费会员）**的统称，非具体等级 | ⚠️ 不要解析成 tier |
| 英文官方 FAQ “China Suppliers, the premium member of Made-in-China.com” | 同上，统称 | ⚠️ 同上 |
| 视频频道公司卡片 `Gold Member · Since 2024`（`.ltd-2`/`item-menber`） | 等级 + 入会年份 | 可用，但页面类型少 |
| 产品页/公司站页脚 “China Supplier” | 付费中国供应商统称（“China Supplier - Diamond Member” 的 alt 前缀） | 非等级 |
| 旧 `audited-supplier-reports/report.html` 报告编号（`MIC-ASR…`、SGS/BV/TÜV Report No.） | 认证报告标识 | 非等级，但可作为 audited=true 的强证据 |
| 搜索页 `Audited Factory` 页签 / `LeadingFactory` | 认证类型/标杆工厂标签 | 非等级 |

### 3.5 优享 / 尊享 / MKA 在前台到底显示什么？

- 官方证据链：① 三者列在“客户级别”（[14068](https://service.made-in-china.com/help/regulation/info/14068.htm)、[13868](https://service.made-in-china.com/help/regulation/info/13868.htm)）；② 尊享/MKA 是“在钻石会员基础之上”的服务（2021 IR）；③ 官方功能说明只提到 **VO 后台**显示“尊享/MKA 标志”，**没有提到任何前台徽章**（[10941](https://service.made-in-china.com/activities/operating-activities/special/10941.html)）；④ 列表页模板只处理 `csLevel 50/30`。
- 因此：**高度可信推断——优享/尊享/MKA 供应商在公网页面显示的就是 `Diamond Member`（或按其账号实际会员级别显示），无法与普通钻石会员区分。** 置信度：**中高**。
- 若产品必须区分大客户：只能通过销售/CRM/接口数据回填，或在拿到已知客户样本后人工核验其页面。→ 见 §6 未解疑问。

---

## 4. 自动判定规则（建议实现）

### 4.1 判定优先级（从高到低）

```
P0 公司站头部（首页 / 产品组页 / 产品详情页 / AR 报告页）
   ├─ 文本含 "Diamond Member" 或 icon-diamond  → tier = diamond（置信度 high）
   ├─ 文本含 "Gold Member"   或 icon-gold     → tier = gold   （置信度 high）
   ├─ 无会员徽章，但有 Audited Supplier / member-since / 星级  → tier = unknown（可能新版 UI 隐藏/更高层级）
   ├─ 无会员徽章、无 AS、无 member-since，且页面完整加载   → tier = free（置信度 medium）
   └─ 页面被风控/结构异常/只有部分 HTML              → tier = unknown（置信度 low）
P1 老版列表页卡片徽章（diamond_32.png / gold_32.png，alt "China Supplier - Diamond/Gold Member"）
   → diamond / gold（high）；仅有 as-short.png → tier = unknown
P2 列表页卡片内嵌 JSON / JS 模板 csLevel：50→diamond，30→gold
   → 作为 P1 的校验/补充（同一公司多卡片时取多数）
P3 新版搜索结果卡片（2025-04 之后）
   → 不含等级信息：tier = unknown（可记录 audited/星级/认证/地区）
绝不使用：Audited Supplier → 等级；Supplier Capability Index → 等级；LeadingFactory → 等级；
          Premium Member → 等级；China Supplier → 等级；营收/员工数 → 等级
```

### 4.2 多来源冲突处理

- 公司站头部（P0）优先于任何列表页结论。
- 列表页给 gold、公司站给 diamond → 取公司站（列表页可能缓存/广告卡路由错误）。
- 只有 AS、没有任何等级 badge → `unknown`（不要猜 diamond/gold）。
- `free` 的判定必须要求：页面成功加载 + 头部/卡片**确认无**会员徽章 + 无 AS + 无 member-since。建议对 free 的结果抽样人工复核比例，避免新版 UI 误判。

### 4.3 输出枚举与字段建议

```ts
/** 会员等级：只保留 MIC 页面/官方真正存在的三态 + unknown */
type MembershipTier = 'diamond' | 'gold' | 'free' | 'unknown';

/** 认证供应商：与等级正交，独立布尔（三态：已知 true / 已知 false / 没抓到） */
type AuditedFlag = boolean | null;

interface MembershipInfo {
  tier: MembershipTier;
  /** 认证供应商（Audited Supplier / AS） */
  audited: AuditedFlag;
  /** 会员起始年（tooltip "Since YYYY"），不是成立年 */
  member_since: number | null;
  /** 供应商星级 0-5（Supplier Capability Index），与等级无关 */
  capability_stars: number | null;
  /**
   * 大客户分层：公网页面不可识别。
   * 'youxiang' | 'zunxiang' | 'mka' | null；只能由销售/CRM 数据回填，
   * 页面抓取阶段一律置 null。
   */
  big_customer_program: 'youxiang' | 'zunxiang' | 'mka' | null;

  /** 原始证据，便于人工复核/回归 */
  raw: {
    tier_text: string | null;              // "Diamond Member" / "Gold Member" / null
    badge_alts: string[];                  // ["China Supplier - Diamond Member", "Audited Supplier", ...]
    badge_icon_urls: string[];             // [".../diamond_32.png", ".../as_32.png", ...]
    cs_level: number | null;               // 50 / 30 / null（如来自 JSON）
    member_since_text: string | null;      // "Since 2011"
    evidence_url: string;                  // 判定依据所在页面 URL
    evidence_selector: string | null;      // 如 "#member-since .sign-item-text"
    page_type: 'company_site' | 'search_old' | 'search_new' | 'audited_report' | 'unknown';
  };

  confidence: 'high' | 'medium' | 'low';
}
```

**为什么枚举里没有 ka / ska：**

1. MIC 页面/API 没有 KA/SKA 标识（高置信，见 §2）；
2. KA/SKA 是阿里国际站的客户分层，含义依赖“年度投入”，对 MIC 供应商无定义；
3. 如果产品经理坚持保留这两个值，建议做成**独立字段 `alibaba_segment?: 'KA' | 'SKA' | 'GSKA'`**（默认 null，由销售/外部数据回填），**不要混进 `MembershipTier`**，否则会出现“把 MIC 钻石会员标成 KA”这类系统性错误。
4. 如果一定要给一个“大客户”映射：MIC 侧用 `big_customer_program`（优享/尊享/MKA），并把 user 问的“KA/SKA”解释为外部/阿里口径。

### 4.4 抓取实现要点（供 Lead 参考）

- **优先抓公司详情/公司站首页**，而不是搜索结果页——等级徽章在公司站头部长期稳定（实测 2011 年入驻的钻石会员、2022/2024 年入驻的金牌会员均如此）。
- 公司站 URL 形态：`https://{slug}.en.made-in-china.com/`、`/product-group/...`、`/product/{id}/...`、`/audited-supplier-reports/report.html`。
- 列表页可提供“候选+AS+星级+省份/城市+认证”，用于初筛；等级再回源公司站确认。
- 实测可用列表/搜索入口（供参考，未系统验证）：`https://www.made-in-china.com/suppliers-discovery/`（公司列表页，含 `companysearch.do?...&comProvince=nolimit` 表单参数）、`https://www.made-in-china.com/companysearch.do?subaction=hunt&style=b&mode=and&code=0&comProvince=nolimit&order=0&isOpenCorrection=1&word=xxx`（新版公司搜索）、`products-search/hot-china-products/{Keyword}.html`（老版列表）。
- 注意风控：`products-search/find-china-products/...`、`/factory/ldfsearch_...`、公司 Profile 页（`/company-XXX.html`）会跳真人验证/AccessDeny；公司首页、产品页、产品组页、AR 报告页、`suppliers-discovery`、`companysearch.do` 实测可直接 curl 到（带 Cookie/Referer 更稳）。
- 多语言展示厅（15 个多语版本）可能使用不同 URL/模板，建议后续抽样验证等级徽章是否存在同样结构。→ 未验证。

---

## 5. 等级对照总表（可直接给产品/前端）

| 值（建议枚举） | 中文 | 英文页面文案 | 官方价格 | 页面判定特征（强→弱） | 置信度 |
|---|---|---|---|---|---|
| `diamond` | 钻石会员 | `Diamond Member` | 59,800 元/年（官方帮助页） | 公司站头部文本/`icon-diamond` > 老列表 `diamond_32.png` alt > `csLevel=50` | 高 |
| `gold` | 金牌会员 | `Gold Member` | 31,100 元/年（官方帮助页） | 公司站头部文本/`icon-gold` > 老列表 `gold_32.png` alt > `csLevel=30` | 高 |
| `free` | 免费会员 | 无徽章 | 免费 | 页面完整加载且无任何会员徽章/AS/member-since | 中 |
| `unknown` | 无法判定 | —— | —— | 新版列表页 / 无徽章但有 AS / 风控 / 结构变化 | 高（作为兜底） |
| （`audited=true`） | 认证供应商 | `Audited Supplier` | 现含于金牌/钻石套餐（历史上单独收费） | `as_32.png`/`as-short.png` + alt + 报告链接 + 报告编号 | 高 |
| （`big_customer_program`） | 优享/尊享/MKA | 无公开标识 | 第三方：约 15 万/30 万/定制（待验证） | **公网不可识别**，VO 后台才有“尊享/MKA 标志” | 中高（不可识别） |
| （`alibaba_segment`） | KA/SKA/GSKA | 非 MIC 概念 | 阿里国际站分档 | MIC 页面无标识 | 高（不存在） |

---

## 6. 未解疑问 / 待验证

1. **优享/尊享/MKA 在公司站头部是否真的显示 `Diamond Member`？** 需要拿 1-2 个已知尊享/MKA 客户样本核验（官方只说明 VO 后台有标志）。当前结论为中高置信推断。
2. **优享/尊享/MKA 的公开价格与产品配额**（15 万/30 万/4000/7000/10000）只有第三方口径，官方未公开确认。
3. **`csLevel` 是否存在 50/30 之外的值**（例如 60/70 对应大客户）？新版列表页模板只处理 50/30；如拿到后台接口/更多样本可进一步反推。
4. **2025-04-17 “去除金牌/钻石标识”的落地范围**：官方公告说关键词搜索结果页去除，但 2026-11-15 实测 `products-search/hot-china-products/*`、`suppliers-discovery`、`companysearch.do` 仍能看到 diamond/gold 徽章与 csLevel，说明改版可能按页面类型/AB 分批。**不要假设列表页一定有或一定没有**，以公司站头部为准。
5. **多语言展示厅/其他语种公司站**的徽章结构是否一致（未抽样）。
6. **KA/SKA 是否被 MIC 内部销售口头借用**：公开渠道无证据；若 Lead 能从客户方拿到内部资料可补充。
7. **“交易会员/交易专区”**：官方未见独立等级；如客户把它理解为会员档位，需要澄清口径。
8. 页面上 `Premium Member` 在不同页面/语境是否总指高级会员统称——已有多处佐证，但未穷举。

---

## 7. 证据索引

- 官方帮助/活动页（等级、认证、大客户）：见 [`membership-evidence/09-official-mic-help-quotes.md`](membership-evidence/09-official-mic-help-quotes.md)、[`membership-evidence/10-official-mic-big-customer-quotes.md`](membership-evidence/10-official-mic-big-customer-quotes.md)
- KA/SKA 属于阿里国际站：见 [`membership-evidence/11-ka-ska-alibaba.md`](membership-evidence/11-ka-ska-alibaba.md)
- 页面原始快照与选择器样本：见 [`membership-evidence/README.md`](membership-evidence/README.md)（01–08 号文件）
- 原始 HTML：`search-led-light.html`、`suppliers-discovery.html`、`companysearch-led.html`、`company-home-enrich.html`、`product-detail-enrich.html`、`gold-member-lansaimu-productgroup.html`、`gold-member-keneng-videochannel.html`、`ar-report-enrich.html`、`company-index-premium-member.html`
- 投资者关系记录：`investor-qa-2021-06-30.pdf/.txt`、`investor-qa-2024-08-02.pdf/.txt`
- 官方页面链接汇总：
  - [中国制造网会员级别（金牌 vs 钻石）](https://service.made-in-china.com/help/marketing/9098.htm)
  - [中国制造网供应商目录发布规范（客户级别枚举）](https://service.made-in-china.com/help/regulation/info/14068.htm)
  - [供应商账号产品目录超量处理说明](https://service.made-in-china.com/help/regulation/info/13868.htm)
  - [会员积分细则（免费/金牌/钻石）](https://service.made-in-china.com/help/guide/member/12199.htm)
  - [大客户权益线上化（尊享/MKA）](https://service.made-in-china.com/activities/operating-activities/special/10941.html)
  - [尊享权益升级](https://service.made-in-china.com/activities/service/11001.html)
  - [用户协议（尊享/MKA 权益）](https://service.made-in-china.com/help/regulation/announcement/11406.htm)
  - [智能发品（优享/尊享/MKA 大客专享）](https://service.made-in-china.com/activities/operating-activities/special/10974.html)
  - [2026 金秋采洽会（优享/尊享/MKA 分档）](https://service.made-in-china.com/activities/operating-activities/special/27441.html)
  - [搜索结果页标识优化升级（2025-04-17）](https://service.made-in-china.com/help/promotionskill/company/16634.htm)
  - [星级体系升级（2025-01-06）](https://service.made-in-china.com/developing/activities/16287.html)
  - [供应商实力标签](https://service.made-in-china.com/help/show/9084.htm)
  - [认证供应商常见问题汇总](https://service.made-in-china.com/help/faq/auditedSupplier/1855.htm)
  - [如何充分展示 Audited Supplier 认证优势](https://service.made-in-china.com/help/promotionskill/company/1675.htm)
  - [焦点科技商标页（Gold Member / Audited Suppliers / Audit Report）](https://www.focuschina.com/about-trademark.html)
  - [焦点科技 2021-06-30 投资者关系记录表（尊享/MKA“未纳入正式会员级别”）](http://static.cninfo.com.cn/finalpage/2021-06-30/1210376231.PDF)
  - [焦点科技招聘：大客户运营经理（尊享/MKA/名企）](https://hr.focuschina.com/id3259358.html)
  - [阿里国际站官方：SKA 是什么](https://supplier.alibaba.com/trade/domestic/PX002DNAI.htm)
  - [MBA智库：KA 商家](https://wiki.mbalib.com/wiki/Ka%E5%95%86%E5%AE%B6)
  - [焦点科技收费会员价格新闻（金融界，2023-05-28）](https://finance.jrj.com.cn/2023/05/29111937585655.shtml)
  - [amz123：MIC 费用（优享 15 万/尊享 30 万，第三方）](https://www.amz123.com/ask/mNzBIUvX)
