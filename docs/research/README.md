# 调研与证据（docs/research/）

> 本目录保存**设计依据**：上游接口逆向、匿名边界审计、验证码方案、会员体系研究，以及原始证据快照索引。
> 规则：正式文档（`docs/01–08`）中的事实若与本目录冲突，**以本目录实测证据为准**，并回改正式文档。

## 1. 文档

| 文档 | 内容 | 状态 | 证据 |
|---|---|---|---|
| [upstream-api.md](upstream-api.md) | 上游 22 个可编程接口（m 站搜索 JSON / 公司 ssrData / 审核 / 响应率 / 联系人 / 评分 / 联想），参数、响应、限制、风控 | ✅ 实测（2026-11-15） | [recon/artifacts/api/](../../recon/artifacts/api/README.md) |
| [anonymous-completeness.md](anonymous-completeness.md) | 不登录（匿名）字段 × 页面可见性矩阵、匿名边界、需登录/不公开区分 | ✅ 审计完成 | `recon/artifacts/probe11-anon/`、probe4/7/8/9/10 |
| [captcha-autosolve.md](captcha-autosolve.md) | Focus Captcha（vemic FCaptcha 3.0.2 blockPuzzle）逆向与自动通过方案、实测、集成建议 | ✅ 实测可用 | `recon/artifacts/captcha/` |
| [membership-tiers.md](membership-tiers.md) | MIC 会员体系：Diamond/Gold/免费、优享/尊享/MKA、KA/SKA 澄清、页面判定规则 | ✅ 官方+实测 | [membership-evidence/](membership-evidence/README.md) |
| [design-draft-v0.2.md](design-draft-v0.2.md) | 文档编写前的设计草案（JSON 优先架构）；仅作背景参考，正式文档为准 | 🟠 历史草案 | — |

## 2. 关键结论速查

1. **JSON 优先**：`POST m.made-in-china.com/search/supplier`（20/页、total/totalPage、过滤参数丰富、匿名）/ `GET m.../company-<account>/info.html`（页内 `ssrData`）→ 替代 HTML 与浏览器。
2. **地区词可当 keyword**：`hebei` / `shijiazhuang` / `langfang` 等英文地区词有效（中文=0）；结合 `province` 过滤 + 客户端 `city` 过滤实现纯地区列举。
3. **会员等级**：`csLevel` 50=Diamond、30=Gold；`memberLevel`/`memberSince` 在详情 ssrData；Audited 独立；**KA/SKA 是阿里口径**，MIC 无对应标识。
4. **验证码**：Focus Captcha 可用「Sobel 边缘模板匹配 + 模拟拖拽」自动通过；失败人工兜底。
5. **匿名边界**：公开档案几乎全量（含联系人姓名/部门/职务、审核机构+报告编号、响应率、评分）；电话/邮箱/WhatsApp 平台不公开；审核报告全文不公开。

## 3. 证据目录索引

| 路径 | 内容 |
|---|---|
| `recon/notes.md` | 侦察总笔记：请求链路、地区词矩阵、分页上限、验证码、JSON 接口 |
| `recon/artifacts/api/` | 上游接口 60 个样例 + `endpoints.json` + `request-examples.sh` |
| `recon/artifacts/probe2..10/` | HTML/PNG/网络记录（首页、供应商列表、SEO 页、公司页、人工验证会话） |
| `recon/artifacts/probe11-anon/` | 匿名完整度审计 5 家样本 × 4 类页面快照 |
| `recon/artifacts/captcha/` | 验证码图片、DOM、自动通过尝试记录、通过后页面截图 |
| `recon/artifacts/region-mode/` | 地区词当 keyword / SEO 城市筛选结果 |
| `recon/artifacts/m-company/` | m 站公司详情 ssrData 样例 |
| `recon/artifacts/sample-normalized.json` | 早期 HTML 清洗示例（JSON 优先前的对照） |

## 4. 复核方式

- 纯 HTTP 接口：`bash recon/artifacts/api/request-examples.sh`（注意风控与限速）；
- 验证码自动通过：`recon/scripts/captcha-autosolve.mjs`（见 captcha-autosolve.md §5）；
- 地区模式：`recon/scripts/region-mode-test.mjs`；
- 校验环境：`~/cloak-env/bin/cloak-run node <script>`，profile 目录已迁至 `~/.mic-client/recon-profiles/`（脚本支持 `PROFILE_DIR`/`OUT_DIR` 覆盖）。
