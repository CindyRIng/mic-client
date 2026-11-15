# recon/artifacts（精选证据）

本目录在 GitHub 仓库中只保留**精简证据样例**，用于支撑 `docs/research/` 与接口契约：

| 目录 | 内容 |
|---|---|
| `api/` | 上游接口样例（endpoints.json、请求示例、响应样例）——由 api-mapper 采集 |
| `m-company/` | m 站公司详情 ssrData 样例（`*-ssrData.json`、`result.json`） |
| `captcha/run1/` | Focus Captcha 背景/拼图/校验流程样例（验证码算法依据） |
| `region-mode/*.json` | 地区词当 keyword、城市筛选的结果样例 |
| `sample-normalized.json` | 早期 HTML 清洗结构示例 |

**未入库**（保留在开发者本地）：各轮 `probe*/` 的完整 HTML/PNG/网络记录（约 25MB）与所有 `storage-state.json` / `cookies.json` 会话凭据（出于安全与仓库体积考虑）。完整证据可通过 `recon/scripts/` 复现。
