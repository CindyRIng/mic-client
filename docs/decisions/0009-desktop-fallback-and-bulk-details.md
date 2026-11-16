# ADR-0009：免费会员桌面 showroom 兜底 + 批量详情流水线

- 状态：Accepted
- 日期：2026-11-16
- 关联：[03 REST API](../03-rest-api.md) §8、[05 数据与缓存](../05-data-and-cache.md) §4.7、[07 运维](../07-operations.md) §4.1、FR-05/06/12、NFR-01

## 背景

- 河北全量枚举出的 5008 家供应商里，约 **40% 是付费会员（diamond/gold）**，其 `company-<account>/info.html` 返回移动站 `ssrData`；
- 其余 **60% 是免费/未知会员**，`info.html` 会 301 到桌面 showroom（`www.made-in-china.com/showroom/<account>`）或子域名页，**没有 ssrData**，原实现直接 `UPSTREAM_CHANGED` 失败；
- 公司详情 HTTP 通道被 EdgeOne 稳定挑战（984B 挑战页，cookie 复用无效），批量只能走浏览器；
- 浏览器页面 `domcontentloaded` 对桌面页会卡 15–20s；`page.content()` 在验证码成功后的重定向瞬间会抛错；`ssrData.companyInfo.content` 也可能缺 `comName/mainProducts`（实测 transoceanmetal），导致整条详情失败；
- 5008 家串行浏览器抓取不可接受（十几小时），需要安全、可缓存的批量方案。

## 决策

1. **解析器分层**：`parseAnyCompanyHtml()` = 移动站 `ssrData` 优先 → 桌面 showroom 解析兜底；移动页 `content.comName/mainProducts/businessTypes` 为空时回退 `<title>` 与正文标签（Business Type / Main Products / Year of Establishment / Number of Employees / Address）。
2. **桌面 showroom 字段映射**（免费会员）：公司名（h1）、Address、`Account Registered in` → `since_year`、Business Type、Main Products、Management System Certification、会员/AS 徽章、`encodeComId`；**员工数/成立日期桌面页不公开**，保持 `null` 并进入 `availability.reason=not_provided_by_supplier`，不伪造。
3. **批量详情使用浏览器直取**：`fetchCompanyHtmlBatch()` 复用已验证浏览器 context，安装资源拦截（图片/媒体/字体/CSS/统计脚本，Captcha 资源放行），每标签页顺序复用，支持 1–4 tabs；`waitUntil:'commit'` + 轮询内容，避免桌面页 DOMContentLoaded 卡顿。
4. **内部 `prefetched_html` 入口**：批量脚本把已渲染 HTML 交给 `CompanyService.get({ prefetched_html })`，复用现有解析、会员合并、SQLite 缓存与 availability 逻辑；不再为每家先撞一次 HTTP 挑战。
5. **缓存优先 + 断点续跑**：跳过未过期 `company_details`（24h）；失败重试一次；HTML 批量分块（默认 120/块）落 `results.ndjson`、`summary.json`、`failures.json`。
6. **默认礼貌**：脚本默认 `tabs=1`；实测 `tabs=2` 约 1.0s/家、`tabs=3` 约 0.83s/家，但并发页面会提高上游风控风险，长跑建议 ≤2。

## 后果

**正面**：免费会员详情不再失败；批量 5008 家从 >14h（串行、每条先 HTTP 挑战）降到约 **1.5–2.5h（tabs=2）**；缓存复跑近零成本；字段缺失显式标注。
**负面**：桌面页字段少于移动站（无员工数/成立年）；浏览器批量资源占用高、仍受验证码与上游风控影响；`prefetched_html` 是内部扩展（不进 REST/CLI/MCP 公开契约）。
**缓解**：availability 标注缺失；限并发 + 资源拦截 + 缓存；失败重试与断点续跑。

## 替代方案

- **只抓移动站/跳过免费会员**：会丢掉 60% 企业 → 不采用。
- **纯 HTTP + cookie**：EdgeOne 稳定挑战，无法复用 → 不采用。
- **Selenium/网格并发**：资源开销与风控风险更高，收益有限 → 不采用。
- **伪造缺失字段**：违反数据真实性 → 不采用。

## 证据

- 40 家样本分类：mobile_ssr 16、desktop_showroom 22、desktop_subdomain 2；优化后 40/40 成功，`tabs=1` 1.82s/家、`tabs=2` 0.99s/家、`tabs=3` 0.83s/家；缓存复跑 0s。
- 200 家随机样本（tabs=2）成功 199/200（1 家 partial ssrData，已修复后重试成功），平均约 1.3s/家。
- 修复项：`page.content` 导航竞态、桌面解析、`company_id=''` 唯一键、`domcontentloaded` 卡顿、partial ssrData。
- 测试：`tests/company/desktop-fallback.test.ts`。
