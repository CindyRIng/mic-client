# MIC Client

把 **Made-in-China（made-in-china.com）** 的一小部分能力封装成本地客户端：**REST API / CLI / MCP** 三入口 + SQLite 缓存。
首期只做三件事：**按省市/关键词搜索工厂 → 结构化列表 → 公司详情（入驻时间、成立时间、主营产品、会员等级、认证等）**。

> 当前阶段：**M0 文档阶段已完成（2026-11-15 评审通过）**，等待确认进入 M1 开发。
> 正式文档基线：[docs/README.md](docs/README.md)（01–08 + 术语 + ADR + 调研）；评审记录：[docs/review-report.md](docs/review-report.md)。

---

## 1. 目录结构

```
mic-client/
├── README.md                 # 本文件：项目总览
├── .gitignore
├── docs/                     # ★ 正式文档（需求 → 架构 → 接口 → 数据 → 测试 → 运维）
│   ├── README.md             # 文档地图、阅读顺序、写作约定、状态
│   ├── 01-requirements.md    # 需求规格说明书
│   ├── 02-architecture.md    # 系统架构与运行时设计
│   ├── 03-rest-api.md        # REST API 详细设计
│   ├── 04-cli-mcp.md         # CLI 与 MCP 接口设计
│   ├── 05-data-and-cache.md  # 数据模型、SQLite schema、缓存与地区字典
│   ├── 06-test-acceptance.md # 测试计划与验收用例
│   ├── 07-operations.md      # 运行、配置、部署、排障、安全合规
│   ├── 08-roadmap.md         # 里程碑、任务拆解、开放问题
│   ├── review-report.md      # ★ M0 文档评审报告（冲突裁决 / 检查结果 / 残余项）
│   ├── glossary.md           # 术语表
│   ├── decisions/            # 架构决策记录（ADR-0001…0007）
│   └── research/             # 调研与证据（上游接口、会员体系、匿名边界、验证码）
├── recon/                    # 侦察脚本与原始证据（非产品代码）
│   ├── README.md
│   ├── notes.md
│   ├── scripts/              # 探针 / 验证码自动通过 / 地区模式 / 解析样例
│   └── artifacts/            # HTML/PNG/JSON 证据快照（含 api/ 接口样例）
└── node_modules -> ~/cloak-env/node_modules   # 仅侦察期使用；正式开发时替换为项目依赖
```

## 2. 文档索引（正式文档）

| 编号 | 文档 | 内容 | 目标读者 |
|---|---|---|---|
| 01 | [需求规格说明书](docs/01-requirements.md) | 背景/目标/范围/功能需求(FR)/非功能需求(NFR)/数据需求/约束/风险/验收标准 | 所有人 |
| 02 | [系统架构设计](docs/02-architecture.md) | 分层组件、请求流程、会话与验证码、并发限速、错误与降级、配置、安全 | 开发/评审 |
| 03 | [REST API 设计](docs/03-rest-api.md) | 端点、参数、响应 Schema、错误码、分页、缓存语义、示例 | 调用方/开发 |
| 04 | [CLI 与 MCP 设计](docs/04-cli-mcp.md) | 命令、参数、输出格式、退出码、MCP tools Schema | 调用方/开发 |
| 05 | [数据与缓存设计](docs/05-data-and-cache.md) | 数据模型、字段映射、SQLite DDL、缓存键/TTL、地区字典、数据质量 | 开发 |
| 06 | [测试与验收方案](docs/06-test-acceptance.md) | 测试策略、回归基线、用例矩阵、验收清单 | 开发/评审 |
| 07 | [运行与运维手册](docs/07-operations.md) | 环境准备、启动、配置、`mic auth`、排障、安全合规 | 使用者/运维 |
| 08 | [路线图与开放问题](docs/08-roadmap.md) | M1–M4 里程碑、任务拆解、开放问题与决策清单 | 所有人 |
| — | [术语表](docs/glossary.md) | MIC/上游字段/本客户端术语 | 所有人 |
| — | [ADR 决策记录](docs/decisions/README.md) | JSON 优先、浏览器兜底、城市本地过滤、会员枚举、地区词模式等 | 开发/评审 |
| — | [调研与证据](docs/research/README.md) | 上游接口、匿名字段矩阵、验证码方案、会员体系（含原始证据） | 所有人 |

## 3. 关键结论（来自侦察，详见 docs/research/）

- **JSON 优先**：上游存在匿名移动站 JSON 接口（`POST m.made-in-china.com/search/supplier`、`company-<account>/info.html` 页内 `ssrData`），可完全替代 HTML 列表/详情；城市筛选用列表 `city` 字段客户端过滤。
- **地区词可当关键词**：`hebei` / `shijiazhuang` / `langfang` 等英文地区词可搜索（中文无效），配合 `province` 过滤实现「纯地区列举」。
- **会员等级**：页面/接口可见等级为 `Diamond Member`（csLevel=50）与 `Gold Member`（csLevel=30），其余为免费/未知；`Audited Supplier` 是独立认证；**KA/SKA/GSKA 是阿里国际站分层，不是 MIC 体系**。
- **验证码可自动通过**：Focus Captcha（AJ-Captcha 风格 blockPuzzle）已实现算法化通过（2/2 次第 1 尝试成功），失败有人工兜底。
- **匿名信息边界**：公开档案几乎全量匿名可得；电话/邮箱等平台不公开（不是登录墙）。

## 4. 环境与运行（开发阶段才会用到）

- NixOS + `~/cloak-env`（cloakbrowser 0.6.5 + stealth Chromium 146 + playwright-core 1.65.0）
- 统一入口：`~/cloak-env/bin/cloak-run node <entry>`
- 浏览器 profile：`~/.mic-client/profiles/`（仓库外，避免污染；侦察期旧 profile 在 `~/.mic-client/recon-profiles/`）
- 数据目录：`~/.mic-client/data/`（SQLite、可选原始快照）

## 5. 状态与下一步

- ✅ **M0 完成（2026-11-15）**：需求对齐、上游侦察（22 接口）、验证码自动通过、匿名边界审计、目录重组、01–08 完整文档与评审（见 [docs/review-report.md](docs/review-report.md)）
- 🔜 **待用户确认后进入 M1**：JSON 搜索 + 列表 + 地区模式 + 城市过滤 + SQLite 缓存 + CLI `--json`
- 详细拆解见 [docs/08-roadmap.md](docs/08-roadmap.md) §3
