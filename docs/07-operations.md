# 07 运行与运维手册

> 版本：0.1 ｜ 状态：Approved（M0 评审通过） ｜ 负责人：lead ｜ 最后更新：2026-11-15
> 关联：[02 架构](02-architecture.md) ｜ [03 REST](03-rest-api.md) ｜ [04 CLI/MCP](04-cli-mcp.md) ｜ [decisions/0007](decisions/0007-local-runtime-and-secrets.md)
> 说明：本手册描述**目标形态**；M0 阶段尚无 `mic` 可执行文件，命令以「实现后可用」标注。

---

## 1. 环境要求

| 项 | 要求 | 校验命令 |
|---|---|---|
| 操作系统 | NixOS（当前开发机）或兼容 Linux/macOS | `uname -a` |
| Node | Node 22（`~/cloak-env` FHS 内为 22.x） | `~/cloak-env/bin/cloak-run node -v` |
| cloakbrowser 环境 | `~/cloak-env`（cloakbrowser 0.6.5 + playwright-core 1.65.0 + stealth Chromium 146 缓存） | `~/cloak-env/bin/cloak-env-info` |
| 磁盘 | ≥500MB（依赖 + SQLite + 可选原始快照） | `df -h ~` |
| 网络 | 可访问 `m.made-in-china.com` / `www.made-in-china.com` / `captcha.made-in-china.com` | `curl -I https://m.made-in-china.com/` |
| 显示（可选） | `mic auth` 人工过验证码需要图形会话（`DISPLAY`） | `echo $DISPLAY` |

> 正式实现后：项目内用 `npm install` 锁定 `cloakbrowser@0.6.5`、`playwright-core@1.65.0`；**不要**依赖 `~/cloak-env/node_modules` 软链（仅侦察期使用）。

## 2. 目录与数据布局

```
/home/<user>/mic-client/            # 仓库（代码 + 文档）
~/.mic-client/
├── profiles/
│   └── default/                    # cloakbrowser 持久 profile（cookie/登录态，敏感）
├── data/
│   ├── mic.sqlite                  # SQLite（WAL），含缓存/公司/详情
│   ├── session/cookies.json        # HTTP cookie jar（敏感，权限 700）
│   └── raw/                        # 可选原始快照（gzip，排障用，按保留期清理）
└── logs/
    └── mic.log                     # 结构化日志（可轮转）
```

- profile/cookie 视为敏感数据：权限 `700`，不写日志、不进仓库、不外发。
- 侦察期旧 profile 已迁至 `~/.mic-client/recon-profiles/`（仅供复核，可整目录删除）。

## 3. 配置

优先级：**命令行参数 > 环境变量 > 配置文件 > 内置默认值**。

配置文件：`~/.mic-client/config.json`（`mic config path` 查看路径，`mic config show` 查看生效值）。

| 配置键 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `profile_dir` | `MIC_PROFILE_DIR` | `~/.mic-client/profiles/default` | 浏览器 profile 目录 |
| `data_dir` | `MIC_DATA_DIR` | `~/.mic-client/data` | SQLite/快照目录 |
| `log_dir` / `log_level` | `MIC_LOG_DIR` / `MIC_LOG_LEVEL` | `~/.mic-client/logs` / `info` | 日志位置与级别（debug/info/warn/error） |
| `rest.host` / `rest.port` | `MIC_REST_HOST` / `MIC_REST_PORT` | `127.0.0.1` / `8899` | REST 监听（仅回环） |
| `upstream.timeout_ms` | `MIC_UPSTREAM_TIMEOUT_MS` | `15000` | 单请求超时 |
| `upstream.rate_min_ms` / `rate_max_ms` | `MIC_RATE_MIN_MS` / `MIC_RATE_MAX_MS` | `1500` / `2500` | 上游请求间隔（抖动） |
| `cache.ttl_list_s` / `cache.ttl_search_index_s` | `MIC_CACHE_TTL_LIST_S` / `MIC_CACHE_TTL_SEARCH_INDEX_S` | `21600` / `21600` | 列表上游页 6h / 派生索引 6h |
| `cache.ttl_detail_s` / `cache.ttl_audit_s` | `MIC_CACHE_TTL_DETAIL_S` / `MIC_CACHE_TTL_AUDIT_S` | `86400` / `604800` | 详情 24h / 审核 7d |
| `cache.ttl_response_s` / `cache.ttl_contacts_s` / `cache.ttl_reviews_s` | `MIC_CACHE_TTL_RESPONSE_S` / `MIC_CACHE_TTL_CONTACTS_S` / `MIC_CACHE_TTL_REVIEWS_S` | `21600` / `86400` / `43200` | 响应率 6h / 联系人 24h / 评价 12h |
| `cache.ttl_regions_s` / `cache.ttl_empty_list_s` | `MIC_CACHE_TTL_REGIONS_S` / `MIC_CACHE_TTL_EMPTY_LIST_S` | `2592000` / `3600` | 地区 30d / 空结果 1h |
| `captcha.autosolve` / `captcha.max_attempts` | `MIC_CAPTCHA_AUTOSOLVE` / `MIC_CAPTCHA_MAX_ATTEMPTS` | `true` / `5` | 自动解验证码开关/重试上限 |
| `auth.timeout_s` | `MIC_AUTH_TIMEOUT_S` | `300` | `mic auth` 人工等待上限 |
| `raw_snapshot.enabled` / `retention_days` | `MIC_RAW_SNAPSHOT` / `MIC_RAW_RETENTION_DAYS` | `false` / `7` | 排障快照开关与保留期 |

## 4. 启动

> 以下命令为**实现后可用**（M1+）。统一用 cloak-run 启动以保证浏览器兜底可用。

**安装后的 `mic` 命令**（推荐）：`npm run build && npm link` 会安装薄启动脚本 `bin/mic`，
它自动通过 `~/cloak-env/bin/cloak-run` 执行；cloak-run 缺失时打印 warning 并退化为 `node`。
若 `mic` 不在 PATH，参考 04 §2.1 或把 `~/.npm-global/bin` 加入 PATH。

```bash
mic search --keyword glass --province Hebei --json
mic serve --host 127.0.0.1 --port 8899
mic mcp

# 启动 serve 后，浏览器打开自描述 API 文档：
# http://127.0.0.1:8899/docs   （OpenAPI: http://127.0.0.1:8899/openapi.json）

# 等价的手工启动方式（避免全局安装时）
~/cloak-env/bin/cloak-run node dist/cli.js search --keyword glass --province Hebei --json

# REST 服务（前台）
~/cloak-env/bin/cloak-run node dist/cli.js serve --host 127.0.0.1 --port 8899

# REST 服务（后台，建议交给 systemd --user 或 nohup；示例）
nohup ~/cloak-env/bin/cloak-run node dist/cli.js serve > ~/.mic-client/logs/serve.out 2>&1 &

# MCP（stdio，由 MCP 客户端拉起；不要手动前台运行）
~/cloak-env/bin/cloak-run node dist/cli.js mcp
```

### 4.1 批量抓取与性能（河北全量实测）

> 关键事实：省关键词 `hebei` 只匹配资料中提及“河北”的供应商（河北 total=1101，**不是全量**）。
> 完整枚举 = **省 + 11 个地级市关键词**（每个带 `--province Hebei` 服务端过滤）并集去重。

```bash
# 一键完整枚举（写入 summary.json + union.ndjson）
node scripts/e2e/enumerate-province.mjs --province Hebei --concurrency 6 --out /tmp/hebei-enum

# 单查询（省关键词）批量导出
mic search --province 河北 --pages all --format ndjson --concurrency 6 > hebei.ndjson
```

实测（2026-11-16，真实上游；数字随上游变动）：

| 指标 | 数值 |
|---|---|
| 省关键词 total / 页数 | 1101 / 56 |
| 11 城查询 total 合计 | 4403 / 227 页 |
| **并集去重账号** | **5008**（非广告 4954；广告账号 54） |
| 省查询独有账号 | 605 |
| 被多个关键词命中的账号 | 496 |
| 城市查询冷启动耗时（并发 6） | ~557s |
| 完整冷启动（省 + 11 城） | 约 12 分钟 |
| 全套缓存复读 | ~0.2s |

城市分布：Shijiazhuang 1526、Cangzhou 723、Xingtai 593、Baoding 536、Hengshui 508、
Tangshan 317、Handan 289、Langfang 270、Qinhuangdao 192、Zhangjiakou 27、Chengde 27。

**性能开关**：
- `--concurrency 4-6`：流水线重叠响应等待，请求发起间隔仍为 1.5–2.5s（默认；不建议 >6，收益递减）。
- `MIC_RATE_MIN_MS=800 MIC_RATE_MAX_MS=1200`：可把全量压到约 9–10 分钟，但降低间隔会增加风控风险，默认不改。
- 缓存优先：同 `MIC_DATA_DIR` 复跑近零成本；长期增量用 TTL（6h）而不是反复全量。

MCP 客户端（如 Claude Code）配置示例：

```jsonc
{
  "mcpServers": {
    "mic": {
      "command": "/home/<user>/cloak-env/bin/cloak-run",
      "args": ["node", "/home/<user>/mic-client/dist/cli.js", "mcp"],
      "env": { "MIC_PROFILE_DIR": "/home/<user>/.mic-client/profiles/default" }
    }
  }
}
```

## 5. `mic auth`（人工兜底流程）

触发条件（任一）：
- 首次使用且自动解验证码失败/连续触发；
- REST/CLI 返回 `NEED_HUMAN_VERIFICATION`；
- 需要登录态（可选增强，如对比登录前后差异）。

流程：
1. 执行 `mic auth`（需要图形会话；会打开可见 Chromium 窗口）；
2. 完成 Focus Captcha 滑块；如提示登录可顺手登录（可选）；
3. 命令检测到会话可用后自动保存 `storageState` 并退出；
4. 用 `mic doctor` 复核会话/上游连通；
5. 备份 profile：`tar -czf ~/.mic-client/profiles-backup-$(date +%F).tgz -C ~/.mic-client/profiles .`

失败处理：关闭窗口重试；检查 `DISPLAY`；删除损坏 profile（`~/.mic-client/profiles/default`）后重新 `mic auth`（会丢失登录态）。

## 6. 日常运维

| 任务 | 命令/方法 | 说明 |
|---|---|---|
| 查看缓存 | `mic cache stats` / `GET /api/cache/stats` | 命中率、条目数、大小、各表 TTL |
| 清理缓存 | `mic cache clear --scope all|list|detail` | 建议先确认无长任务 |
| 强制刷新 | `mic search ... --refresh` / `POST /api/cache/refresh` | 跳过缓存 |
| 日志 | `~/.mic-client/logs/mic.log`；`--verbose` 提高级别 | JSON Lines，字段见 §8 |
| 环境自检 | `mic doctor` | Node/cloak-env/profile/data/网络/上游连通/契约探针 |
| 上游改版检测 | `mic doctor --contract` | 检查 JSON 关键字段是否缺失，异常报 `UPSTREAM_CHANGED` |
| 清理原始快照 | `mic cache clear --scope raw --older-than 7d` | 按保留期 |
| 升级依赖 | 修改 `package.json` 锁定版本 → `npm install` → `mic doctor` | cloakbrowser 升级需验证验证码算法 |
| 备份 | 备份 `~/.mic-client/data` 与 `profiles` | cookie 敏感，加密存储 |

## 7. 排障手册

| 症状 | 可能原因 | 处理 |
|---|---|---|
| CLI 报 `NEED_HUMAN_VERIFICATION` | 自动解验证码失败/连续触发 | 执行 `mic auth`；确认 `DISPLAY`；降低请求频率 |
| `CAPTCHA_SOLVE_FAILED` | 验证码改版/图片匹配失败 | 升级 `captcha.ts` 算法或临时改人工模式（`MIC_CAPTCHA_AUTOSOLVE=false`） |
| `UPSTREAM_UNAVAILABLE` / 连续 302 | 风控、网络、上游抖动 | 降低频率、重试；`mic doctor` 检查网络；必要时 `mic auth` |
| `UPSTREAM_CHANGED` | 上游字段/结构变更 | 保存的原始快照定位差异；更新映射层与契约测试；临时走 HTML 兜底 |
| `PARSE_ERROR` | DOM/JSON 改版、页面异常 | 打开 `raw_snapshots` 留档；对照 `docs/research` 更新解析规则 |
| `RATE_LIMITED` (429) | 本地上游队列限速 | 等待 `Retry-After`；降低并发；增大 `rate_min/max_ms` |
| REST 端口占用 | 8899 被占用 | `ss -lntp | grep 8899`；改 `--port` 或 `MIC_REST_PORT` |
| 浏览器打不开 `http://127.0.0.1:8899` | ① `mic serve` 是**前台进程**，必须先启动并保持运行；② 确认监听：`ss -lntp | grep 8899`；③ 用 `127.0.0.1` 而非 `localhost`（后者可能先解析到 IPv6 `::1`，而服务只监听 IPv4）；④ 根路径 `/` 会 302 到 `/docs`；⑤ 后台运行：`nohup mic serve > ~/.mic-client/logs/serve.out 2>&1 &` |
| SQLite `database is locked` | 多进程写/长事务 | 确保单写进程；`busy_timeout` 已设；必要时重启服务 |
| MCP 客户端无响应 | stdio 启动失败/路径错误 | 检查客户端配置 command/args；手动执行 `mic doctor`；看 stderr |
| 中文输出乱码 | 终端编码 | `export LANG=zh_CN.UTF-8`；CLI 默认输出 UTF-8 |
| profile 损坏 | 异常退出/升级 | 备份后删除 profile，`mic auth` 重建（丢登录态） |
| 搜索结果总数显示 "2,000+" | 上游封顶 | 正常现象；文档已标注非穷尽，可用地区词/城市拆分查询 |

## 8. 日志与指标

结构化日志（JSON Lines）关键字段：
`ts, level, request_id, module, event, source(json|html|browser|cache), upstream_url(脱敏), status, duration_ms, cache_hit, captcha_triggered, error_code, warnings[]`

关键指标（建议）：
- 请求成功率、`NEED_HUMAN_VERIFICATION` 频率、验证码触发率；
- 缓存命中率（列表/详情）、上游 P50/P95 时延；
- 302/重试次数、429 次数、解析失败次数；
- REST 请求量/时延、MCP tool 调用次数。

健康检查：`GET /health` 返回服务状态、profile 可用性、SQLite 可写、上游探针（可选缓存）。

## 9. 安全与合规

- **仅本地回环**：REST 默认 `127.0.0.1`，无鉴权；**禁止**绑定 `0.0.0.0` 或暴露公网/局域网。
- cookie/storageState 属敏感凭据：不写日志、不进仓库、不外发；profile 权限 `700`。
- 访问礼仪：串行 + 1.5–2.5s 抖动 + 缓存优先 + single-flight；禁止高并发/批量轰炸。
- 数据边界：只使用匿名公开数据；**不建模**电话/邮箱等平台不公开字段为「登录可得」；不抓取站内信/账号私有数据。
- 合规：本工具用于本机个人检索辅助；使用者需自行遵守目标站点服务条款与当地法律；不得转售数据或用于批量商业采集。
- 删除权：`mic cache clear` + 删除 `~/.mic-client` 可清除全部本地数据。

## 10. 附录

### 10.1 常用命令速查

```bash
mic version
mic doctor
mic auth
mic regions --province Hebei
mic search --keyword glass --province Hebei --page 1 --json
mic search --province Hebei --city Langfang --json          # 地区模式
mic company xingchenglass --json
mic cache stats
mic serve --port 8899
mic mcp
```

### 10.2 错误码 → 运维动作

| 错误码 | 建议动作 |
|---|---|
| `INVALID_PARAM` | 修正参数；`mic regions` 查合法省/市 |
| `NOT_FOUND` | 校验 account/comId；`mic search` 先取 account |
| `NEED_HUMAN_VERIFICATION` | `mic auth` |
| `CAPTCHA_SOLVE_FAILED` | 重试 / `mic auth` / 临时关闭自动解 |
| `RATE_LIMITED` | 等待 Retry-After；降低频率 |
| `UPSTREAM_UNAVAILABLE` | 重试；检查网络；稍后再试 |
| `UPSTREAM_CHANGED` | 运行契约测试；更新映射；临时 HTML 兜底 |
| `PARSE_ERROR` | 查 raw snapshot；更新解析规则 |
| `CONFIG_ERROR` | `mic doctor`；检查 profile/data 目录权限 |
| `INTERNAL_ERROR` | 收集日志与 request_id 报 bug |
