# tests/ — 测试套件（离线优先）

> 归属：task-13（req-writer）维护 `tests/core/**`、`tests/helpers/**`、`tests/integration/**`、`tests/fixtures/**` 与 `scripts/e2e/**`。
> `tests/company/**`（task-11）与 `tests/adapters/**`（task-12）由对应实现者维护，互不改写。
> 契约来源：[docs/06-test-acceptance.md](../docs/06-test-acceptance.md)（TC-01…64、B-01…B-17）、[docs/03-rest-api.md](../docs/03-rest-api.md)、[docs/05-data-and-cache.md](../docs/05-data-and-cache.md)。

## 1. 运行

```bash
# 全部测试（含其他 teammate 的 tests/company、tests/adapters）
npm test                 # = vitest run

# 本套件（M1 core/integration，离线，~4s）
npx vitest run tests/core tests/integration

# 单文件 / 单用例
npx vitest run tests/core/pagination.test.ts
npx vitest run -t "page beyond total_page"

# 类型检查（仅本套件；src 用 npm run typecheck）
npx tsc -p tests/tsconfig.json --noEmit

# 真实上游冒烟（手动、限速；默认 dist/cli.js，--src 强制源码）
node scripts/e2e/live-smoke.mjs --src --no-company --scan-pages=1
node scripts/e2e/live-smoke.mjs --json
```

约定：

- **不依赖网络/浏览器**：所有 `tests/core`、`tests/integration` 用例通过 `tests/helpers/mock-fetch.ts` 替换全局 `fetch`，使用 `tests/fixtures/` golden 数据；限速在测试环境置 0。
- **临时数据目录**：`tests/helpers/env.ts` 为每个用例创建独立 `MIC_DATA_DIR`（SQLite WAL），用例结束删除；不写 `~/.mic-client`。
- **不修改 src**：发现契约偏差 → 报告 Lead 的最小复现；不要在测试提交里改实现。
- **不修改 golden**：fixtures 只读；派生数据（多页/夹取/构造异常）在用例内存中生成（见 `tests/helpers/fixtures.ts`）。

## 2. 目录

| 路径 | 内容 |
|---|---|
| `fixtures/` | golden JSON（来源 `recon/artifacts/api/`）+ `README`（来源/脱敏/口径） |
| `helpers/mock-fetch.ts` | 可编程 fetch mock：200 JSON、302→captcha、429、5xx、挑战页；`searchResponder` 支持 page 夹取 |
| `helpers/fixtures.ts` | fixture 加载、多页切分、条目合成（确定性）、`"2,000+"` 构造 |
| `helpers/env.ts` | 临时目录 + SQLite Cache + `SearchService`（真实装配、无网络）；`createNormalizerService` 纯参数单测 |
| `core/normalize.test.ts` | FR-01/02/07 参数与地区规范化（模式/中文映射/非法枚举/越界） |
| `core/regions.test.ts` | FR-07 32 省字典、Hebei 10 城、会员等级说明 |
| `core/list-normalization.test.ts` | FR-04 列表行映射（字段/类型/广告/空值/缺失） |
| `core/membership.test.ts` | FR-06 tier/audited/since_year/evidence 合并规则 |
| `core/pagination.test.ts` | FR-03 20/30/40/100 拼接、TOTAL_CAPPED、PAGE_CLAMPED、去重、缓存命中 |
| `core/search-modes.test.ts` | FR-01/02 region/mixed、城市与 audited 客户端过滤、广告、上游参数映射 |
| `core/cache.test.ts` | FR-08 命中/refresh/TTL/stale/持久化/companies/stats/single-flight |
| `core/http-errors.test.ts` | FR-12/13 挑战、契约错误、5xx/429 重试（fake timers） |
| `core/cli.test.ts` | FR-10 CLI version/regions/cache + 校验错误退出码（真实子进程） |
| `core/contract-gaps.test.ts` | **KNOWN-GAP**：文档契约与当前 src 的已知偏差（`it.fails` 计数为通过） |
| `integration/search-service.test.ts` | L3 端到端（mock 上游 + 真 SQLite）：Schema/缓存/降级/失败不落库 |
| `../scripts/e2e/live-smoke.mjs` | L5 真实匿名上游冒烟（PASS/WARN/SKIP/FAIL，默认小请求预算） |

## 3. KNOWN-GAP 约定（重要）

`tests/core/contract-gaps.test.ts` 中的用例用 `it.fails()` 记录**已确认的文档 vs 实现偏差**：

- 它们当前“预期失败”，因此 `npm test` 仍为绿；每个用例名以 `KNOWN-GAP:` 开头，并引用 docs/03 条款。
- 修复对应实现后，该用例会变成“意外通过”而失败 → 把它改成普通 `it()` 并从本清单删除，即完成闭环。
- 当前已知缺口（2026-11-15 基线，详见用例与发送给 Lead 的报告）：
  1. 缺 `REGION_KEYWORD_MODE` / `PROVINCE_INFERRED` / `CITY_NOT_IN_DICTIONARY` / `CITY_PROVINCE_MISMATCH` warnings；
  2. stale 回退 warning 码为 `STALE_DATA`（docs/03 为 `CACHE_STALE`）；
  3. `meta.fetched_at` 为 UTC `Z`（docs 要求 `+08:00` 偏移）；
  4. 缓存键未对 keyword 大小写归一（`Glass` 与 `glass` 不命中同一缓存）。
- 已闭环（2026-11-15，Lead 修复分页窗口 bug 后从 KNOWN-GAP 转为正式用例）：
  - `page=2&page_size=20` → 20 条（全局 20..39）；
  - `page=2&page_size=30` → 全局 30..59 窗口；`page=3&page_size=40` → 全局 80..119 窗口；
  - 页码夹取 → 返回末页内容（20 条）。
  见 `core/pagination.test.ts`「pagination: window offsets for page > 1」。
