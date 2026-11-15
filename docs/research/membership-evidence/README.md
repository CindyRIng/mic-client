# membership-evidence 目录说明

本目录是 `docs/membership-tiers.md` 的原始证据。抓取时间统一为 **2026-11-15（Asia/Shanghai）**，抓取方式为 `curl`（桌面 UA）/ `web_fetch`，未使用浏览器自动化。

## 一、加工后的摘录（建议先读这些）

| 文件 | 内容 |
|---|---|
| `01-search-list-diamond-as-badge.html` | 老版搜索结果卡片中 Diamond Member + Audited Supplier 徽章的原始 HTML（`cs-level-info` / `as-info`） |
| `02-cslevel-json-adcard.txt` | 广告卡内嵌 JSON：`"csLevel":"50"`、`"showAS":"true"`、`"auditLogoUrl"`；以及 JS 模板中 `csLevel==50→Diamond`、`csLevel==30→Gold` 的分支 |
| `03-company-site-header-diamond.html` | 公司站首页头部：`shop-sign__member-since` + `icon-diamond` + `Diamond Member` + `Audited Supplier` + 星级；tooltip「Since 2011 / Suppliers with verified business licenses」 |
| `04-company-site-gold-variants.html` | Gold Member 的两种公司站展示：产品组页 `sr-comInfo-sign` + `icon-gold`；视频频道卡片 `Gold Member Since 2024` + `gold_32.png` |
| `05-suppliers-discovery-old-card.html` | 老版公司列表卡片：`service-icon` 里 `as_32.png`(Audited) + `diamond_32.png`/`gold_32.png` |
| `06-company-search-new-ui-card.html` | 新版公司搜索结果卡片（2025-04 之后）：**没有 diamond/gold 徽章**，只有 Audited、星级、ODM·OEM·Own Brand、Mgmt. Certification、City/Province |
| `07-audited-supplier-report.html` | 认证报告页（AR Report）头部结构 + 第三方报告编号（如 `TÜV Rheinland Audit Report No.: MIC-ASR...`）与 Verify 链接 |
| `08-company-index-premium-member.txt` | 旧版 China Companies 目录页标题后缀 `Premium Member` = 高级会员统称，不是等级徽章 |
| `09-official-mic-help-quotes.md` | 官方帮助中心原文：金牌/钻石权益与价格、免费会员、认证供应商(AS)、2025-04 搜索页去徽章公告、星级体系、实力标签、2009 招股书历史等级 |
| `10-official-mic-big-customer-quotes.md` | 官方原文：尊享/MKA/优享 = 大客户分层（2021 投资者关系、帮助中心、大客户权益页、2026 活动规则、招聘信息） |
| `11-ka-ska-alibaba.md` | KA/SKA/GSKA 属于阿里巴巴国际站的证据；MIC 官方无此口径 |
| `excerpt-ipo-membership-tiers.txt` / `excerpt-ipo-membership-service.txt` | 2009 招股书中历史会员等级与认证供应商服务的摘录 |
| `excerpt-ar2024-membership-lines.txt` | 2024 年报中会员/收入相关行摘录（年报未披露分档明细） |
| `investor-qa-2021-06-30.pdf` / `.txt` | 焦点科技 2021-06-30 投资者关系记录表（尊享/MKA 的原始出处） |
| `investor-qa-2024-08-02.pdf` / `.txt` | 焦点科技 2024-08-02 投资者关系记录表（未见会员分档新口径） |

## 二、原始 HTML 快照（可用于回归验证选择器）

| 文件 | 来源 URL | 关键观察 |
|---|---|---|
| `search-led-light.html` | `https://www.made-in-china.com/products-search/hot-china-products/LED_Light.html` | 老版类目/关键词列表页：Diamond Member(31)/Gold Member(1)/Audited Supplier(62)；ad 卡 JSON 有 csLevel/showAS |
| `suppliers-discovery.html` | `https://www.made-in-china.com/suppliers-discovery/` | 老版公司列表页：40 家公司中 38 Diamond + 2 Gold，40 家均带 Audited Supplier；含 `companysearch.do?...&comProvince=nolimit` 表单 |
| `companysearch-led.html` | `https://www.made-in-china.com/companysearch.do?subaction=hunt&style=b&mode=and&code=0&comProvince=nolimit&order=0&isOpenCorrection=1&word=led` | 新版公司搜索结果：卡片无 diamond/gold，有 Audited/星级/ODM·OEM/认证；但页面内仍保留含 `csLevel` 的 `com-block-tmp` 模板 |
| `company-home-enrich.html` | `https://hkenrich.en.made-in-china.com/` | 公司站首页：Diamond Member 头部徽章 + AS + 星级 + member since 2011 |
| `product-detail-enrich.html` | `https://hkenrich.en.made-in-china.com/product/vFMGUrcOfXTi/...html` | 产品详情页：头部同样有 Diamond Member + Audited Supplier |
| `gold-member-lansaimu-productgroup.html` | `https://lansaimu1.en.made-in-china.com/product-group/gqSfsyibyzWd/Tricycle-catalog-1.html` | Gold Member 公司站产品组页 |
| `gold-member-keneng-videochannel.html` | `https://www.made-in-china.com/video-channel/kenengindustry_PZBfWCrlXYeE_...html` | Gold Member 视频频道页（`gold_32.png` alt="Gold Member"） |
| `ar-report-enrich.html` | `https://hkenrich.en.made-in-china.com/audited-supplier-reports/report.html` | 认证报告页：头部 Diamond Member + AS；报告编号/第三方核验链接 |
| `company-index-premium-member.html` | `https://www.made-in-china.com/company-index/Service-business-4111-1024.html` | 旧目录页：标题 `... - Premium Member`（高级会员统称） |

## 三、未保存/被风控的页面（避免误用）

- `https://www.made-in-china.com/premium-member.html`（英文高级会员介绍页）→ curl 返回 HTTP 500、reader 代理同样 500；`m.made-in-china.com/premium-member.html` → 跳真人验证。仅能引用搜索结果摘要。
- `https://www.made-in-china.com/products-search/find-china-products/...`、`/factory/ldfsearch_...` → 真人验证/AccessDeny；未纳入证据。
- `hkenrich.../company-XXX.html`（公司 Profile 页）→ 真人验证；公司首页与产品页可正常抓取。
