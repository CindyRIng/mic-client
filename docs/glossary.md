# 术语表（glossary）

> 版本：0.1 ｜ 状态：Approved（M0 评审通过） ｜ 负责人：lead ｜ 最后更新：2026-11-15 ｜ 关联：[docs/README.md](README.md)
> 约定：上游术语标注「上游」，本客户端术语标注「客户端」，文档/流程术语标注「流程」。

## A. 平台与上游术语

| 术语 | 类型 | 含义 | 备注/出处 |
|---|---|---|---|
| **MIC** | 上游 | Made-in-China.com（中国制造网），本项目的目标站点 | 运营方焦点科技（002315） |
| **m 站** | 上游 | `m.made-in-china.com` 移动站；提供匿名 JSON（搜索、公司 ssrData 等） | 主链路数据源 |
| **PC 站 / www 站** | 上游 | `www.made-in-china.com` 桌面站；HTML 页面为主，风控更重 | 兜底通道 |
| **SSR / ssrData** | 上游 | 服务端渲染页内嵌的结构化数据：`<script type="text/json" id="ssrData">` | 公司详情主数据源 |
| **mainUserAccount** | 上游 | 公司迷你站子域名账号，如 `xingchenglass` | 客户端作为 `account` 主键 |
| **account** | 客户端 | 公司唯一标识 = `mainUserAccount`；用于列表/详情/缓存键 | 05 数据文档定义 |
| **comId** | 上游 | 公司数字 ID（如 `1752301672`） | 仅用于与 encodeComId 互查 |
| **encodeComId** | 上游 | 公司加密 ID（如 `bSrtEKgyYcUf`），审核/响应率/联系人/评价等增强接口必填 | 数字 comId 会 500 |
| **csLevel** | 上游 | 搜索列表 JSON 的会员等级码：`50`=Diamond Member、`30`=Gold Member | 映射为 `membership.tier` |
| **memberLevel** | 上游 | 详情 ssrData 的会员等级：`diamond` / `gold`（无则免费/未知） | 与 csLevel 交叉校验 |
| **memberSince** | 上游 | 详情 ssrData 的会员起始年（≈入驻平台的年份，如 `2025`） | 客户端字段 `member_since_year` |
| **Diamond Member** | 上游 | 钻石会员（官方公开最高等级，年费 59,800 元） | 徽章 `diamond_32.png`/`icon-diamond` |
| **Gold Member** | 上游 | 金牌会员（年费 31,100 元） | 徽章 `gold_32.png`/`icon-gold` |
| **免费会员** | 上游 | 无徽章、无 csLevel 的注册供应商 | tier 枚举 `free`/`unknown` |
| **Audited Supplier (AS)** | 上游 | 第三方实地审核认证服务（SGS/BV/TÜV/CCIC/CTI 等），与会员等级正交 | 客户端字段 `audited: boolean` |
| **sgsMember** | 上游 | 详情 ssrData 中是否认证供应商 | 辅助判定 `audited` |
| **auditType / showAuditLogo / logoText** | 上游 | 列表 JSON 的认证标记字段 | `audited` 判定来源 |
| **LeadingFactory** | 上游 | 标杆工厂标签（审核报告类型为工厂且达标） | 可选字段 |
| **KA / SKA / GSKA** | 上游（阿里） | 阿里巴巴国际站客户分层（Key Account / Super Key Account / Group Super Key Account）；**不是 MIC 术语** | 不进入 MIC tier |
| **优享/尊享/MKA** | 上游（MIC） | MIC 大客户分层（官方承认、未纳入正式会员级别、公网无独立徽章） | 客户端不抓取，预留外部字段 |
| **Focus Captcha** | 上游 | MIC 自有验证码（vemic FCaptcha 3.0.2，blockPuzzle 滑动拼图） | 自动通过方案见 research |
| **blockPuzzle** | 上游 | 滑动拼图型验证码（背景图挖洞 + 拼图块） | 自动解：边缘模板匹配 + 拖拽 |
| **EO_Bot_Ssid / __tst_status** | 上游 | 边缘（TencentEdgeOne）风控 cookie / JS challenge 标记 | 会话有效性判据之一 |
| **refine** | 上游 | 搜索过滤器字典接口（`/search/supplier/refine`），带各选项 count | 客户端字典来源之一 |
| **"2,000+" 封顶** | 上游 | 搜索 JSON `total` 超过 2000 时显示 "2,000+"，仅表示“≥2000” | 分页/覆盖度限制 |
| **page 夹取** | 上游 | 请求页码超过末页时返回末页内容（不报错） | 客户端需去重收敛 |
| **region-keyword 模式** | 上游行为/客户端模式 | 用地区英文词（hebei/shijiazhuang/langfang）作为 keyword 搜索 | 实现纯地区列举 |
| **城市过滤缺口** | 上游 | JSON 搜索接口没有 city 参数（`city/comCity/cityName` 被忽略） | 客户端按 `item.city` 过滤 |
| **SEO 搜索页** | 上游 | `www.../company-search/<kw>/C1--CP_..--CC_../N.html`，带 CP/CC/BT/AR/NE/MC/CD 过滤码 | 浏览器兜底；与 JSON 口径不同 |

## B. 客户端术语

| 术语 | 含义 |
|---|---|
| **core** | 与入口无关的业务内核（搜索/详情/规范化/缓存/会话/地区/会员），被 REST/CLI/MCP 共用 |
| **adapter** | 入口适配层：REST（Fastify）、CLI（commander）、MCP（stdio） |
| **JSON 优先** | 主链优先使用 m 站匿名 JSON；HTML/浏览器仅作兜底 |
| **tier** | 会员等级枚举：`diamond｜gold｜free｜unknown` |
| **evidence** | 判定依据列表（如 `json:csLevel=50`、`badge:Since 2025`），随结果返回 |
| **availability_reason** | 字段缺失原因枚举：`not_provided_by_supplier｜not_public_by_platform｜no_reviews｜fetch_blocked｜needs_login` |
| **source** | 数据来源标签：`json｜html｜browser｜cache` |
| **stale** | 缓存过期但上游失败时的回退标记（附 `fetched_at`） |
| **partial** | 部分字段/增强数据未取到，但主体可用（附 `warnings`） |
| **params_hash** | 搜索参数规范化后的缓存键哈希（排序、小写、英文省名） |
| **single-flight** | 同参数并发请求合并为一次上游请求 |
| **golden fixtures** | 用 recon/artifacts/api 的真实样例做测试基准 |
| **profile** | cloakbrowser 持久化浏览器目录（`~/.mic-client/profiles/`），保存 cookie/登录态 |
| **storageState** | Playwright 导出的 cookie/localStorage 状态，供 HTTP 快速通道复用 |
| **mic auth** | CLI 命令：弹可见浏览器，人工过验证码/登录并固化会话 |
| **NEED_HUMAN_VERIFICATION** | 错误码：自动过验证码失败，需要人工介入 |
| **mic doctor** | CLI 环境自检命令（cloak-env/Node/profile/网络/上游连通性） |

## C. 文档与流程术语

| 术语 | 含义 |
|---|---|
| **FR / NFR** | 功能需求 / 非功能需求编号（见 [docs/README.md](README.md) §3.5） |
| **AC** | 验收标准（Acceptance Criteria），与 FR 映射 |
| **DoD** | Definition of Done，完成定义 |
| **ADR** | Architecture Decision Record，架构决策记录（[decisions/](decisions/README.md)） |
| **M0–M4** | 阶段：M0 侦察/文档 → M1 搜索+列表+缓存 → M2 详情+会员 → M3 REST/MCP → M4 测试/文档收尾 |
| **待验证** | 尚未实测、不能作为实现依据的结论；实现前需补证据 |
