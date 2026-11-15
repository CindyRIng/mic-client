# ADR-0007：本地单进程运行时、数据/profile 目录与密钥边界

- 状态：Accepted
- 日期：2026-11-15
- 关联：[02 架构](../02-architecture.md)、[07 运维](../07-operations.md)

## 背景

- 客户端是**本机个人工具**：REST 供本机脚本、CLI 供人工、MCP 供 Claude Code/Agent；
- 上游会话依赖浏览器 profile（cookie、可能登录态）与验证码通过状态；
- 仓库需要保持干净（侦察 profile 曾达 80MB+，已移出仓库）；
- 无官方 API key；无多用户/多租户需求。

## 决策

1. **单进程运行时**：REST/CLI/MCP 共用 core；MCP 以 stdio 子进程启动；REST 只在 `127.0.0.1:8787` 监听；
2. **本地无鉴权**（仅本机回环），文档明确不可暴露公网/局域网；如未来需要共享，另立 ADR；
3. **运行数据放仓库外**：`~/.mic-client/profiles/`（浏览器 profile）、`~/.mic-client/data/`（SQLite）、`~/.mic-client/logs/`；可通过 `--profile`/`--config`/env 覆盖；
4. **密钥/敏感数据**：不存在上游 API key；cookie/storageState 视为敏感，禁止写日志/禁止提交仓库；.gitignore 覆盖 profile/data；
5. **并发模型**：单实例、请求串行 + single-flight；浏览器上下文单例；SQLite 单写者（WAL + busy_timeout）。

## 后果

**正面**：简单、安全边界清晰、仓库干净、易备份。
**负面**：不能多用户共享；单点进程故障影响三个入口。
**缓解**：文档说明；后续若有共享需求再立 ADR（鉴权/多租户/容器）。

## 替代方案

- **仓库内放 profile/data**：污染仓库、易误提交 → 不采用。
- **REST 0.0.0.0 + Token 鉴权**：当前无需求、增加复杂度 → 不采用（保留扩展点）。
- **每入口独立进程/独立会话**：会话重复、验证码成本翻倍 → 不采用。

## 证据

- 目录重组：profile 已移至 `~/.mic-client/recon-profiles/`；`.gitignore` 已覆盖
- `recon/README.md`（profile 迁移说明）
