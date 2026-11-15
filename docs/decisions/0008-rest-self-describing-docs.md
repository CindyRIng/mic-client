# ADR-0008：REST 自描述文档端点（`/openapi.json` + `/docs`）

- 状态：Accepted
- 日期：2026-11-16
- 关联：[03 REST API](../03-rest-api.md) §2.3、[07 运维](../07-operations.md) §4、FR-09 / NFR-04

## 背景

- REST 契约目前只在 `docs/03-rest-api.md`（Markdown）中，开发者要对照文档手写 `curl`；
- 本机工具场景下，希望启动 `mic serve` 后能在浏览器里**直接浏览端点、参数、Schema 并试调用**；
- 但不能引入重量级后端依赖、不能依赖外部 CDN（离线/NixOS 环境）、不能改变既有 8 个 API 端点的契约与 envelope；
- 文档与实现必须同源，避免 Swagger 文件与代码长期漂移。

## 决策

1. 新增**两个辅助端点**（不属于 8 个业务 API，不改变其契约）：
   - `GET /openapi.json`：OpenAPI 3.1 文档（`application/json`，无 envelope），路径/参数/Schema 与 `docs/03-rest-api.md` §3–§11 对齐；
   - `GET /docs`：**自包含** HTML 文档页（无外部 CDN/字体/JS 依赖），启动时 `fetch('/openapi.json')` 渲染端点列表，支持参数展示、Schema 查看与浏览器内 Try it；
   - `GET /`：`302` 重定向到 `/docs`（打开服务根地址即可看到文档）。
2. 两者均受现有回环监听 + Host 校验约束，**无鉴权**，不访问上游、不写缓存、不产生副作用；
3. OpenAPI 文档由代码内 `buildOpenApiDocument()` 生成（单一事实来源 = 适配层声明的路径/Schema），版本号随包版本；
4. `/docs` 页脚固定链接到 `docs/03-rest-api.md`（GitHub）与 `/openapi.json`，可导入 Postman/Insomnia/代码生成器；
5. 文档端点不纳入 CLI/MCP 工具面，不新增 FR；若未来增加写操作/鉴权，需先更新 03 与本 ADR 或另立 ADR。

## 后果

**正面**：浏览器可发现/试调用；OpenAPI 可供生态工具消费；零新增依赖、离线可用；无敏感数据暴露（不展示 cookie/profile）。
**负面**：OpenAPI 与 03 Markdown 需同步维护；`/docs` 页 UI 为手写实现，功能少于完整 Swagger UI（但足够本机调试）。
**缓解**：契约测试断言 8 条路径与关键 Schema 存在；03 §2.3 明确「辅助端点、非业务契约」。

## 替代方案

- **引入 Swagger UI / Scalar CDN**：需外网且增加供应链面 → 不采用（改用自包含页面）；
- **后端引入 OpenAPI 生成器（如 fastify-swagger）**：新增依赖与运行时耦合，且与手写 03 契约仍需对照 → 首期不采用；
- **只返回 Markdown 原文**：浏览器体验差、无法 Try it → 不采用。

## 证据

- 实现后：`curl -s http://127.0.0.1:8899/openapi.json | jq '.paths | keys'` 返回 8 条业务路径；
- `curl -s http://127.0.0.1:8899/docs` 返回自包含 HTML（无外部 `<script src>`）；
- 测试：`tests/adapters/openapi.test.ts` 校验路径集合、版本、Host 校验与自包含性。
