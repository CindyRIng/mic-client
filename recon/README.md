# recon/ — 侦察脚本与原始证据

> 本目录是 **非产品代码**：用于摸清 MIC 上游链路、验证风控/验证码、产出证据。正式客户端代码以后放在 `src/`。
> 目录已整理：浏览器 profile 已移出仓库，放到 `~/.mic-client/recon-profiles/`；脚本支持 `PROFILE_DIR` / `OUT_DIR` / `TRIAL` 环境变量覆盖。

## 1. 结构

```
recon/
├── README.md          # 本文件
├── notes.md           # ★ 侦察总笔记（请求链路/字段/地区词/验证码/分页上限/JSON 接口）
├── scripts/           # 可复现探针
└── artifacts/         # 原始证据（HTML/PNG/JSON），只读留档
```

## 2. 脚本索引

| 脚本 | 用途 | 关键产出 |
|---|---|---|
| `probe-home.mjs` | 首次打开首页，抓表单/链接/网络 | `artifacts/home/` |
| `probe2.mjs` / `probe3.mjs` | 供应商列表 / SEO 页 / 公司页初探 | `artifacts/probe2,3/` |
| `probe4.mjs` | 列表点击流 + 公司迷你站首页 | `artifacts/probe4/` |
| `probe5.mjs` | headed 打开供应商列表（人工过验证码） | `artifacts/probe5/`（含 storage-state） |
| `probe6.mjs` / `probe7`(notes) | 省级 SEO / 城市 SEO / 公司详情探测 | `artifacts/probe6/` 等 |
| `probe8.mjs` | About Us（JS challenge）+ 会员徽章/`Since` | `artifacts/probe8/` |
| `probe9.mjs` | 城市级 SEO / 深分页 / 纯地区路由探测 | `artifacts/probe9/` |
| `probe10-human.mjs` | 人工验证会话（滑块 + 可选登录），导出 storage-state | `artifacts/probe10/` |
| `http_matrix.py` | HTTP 重放矩阵（cookie 测试：搜索/城市/公司页） | `artifacts/probe8/` |
| `parse_demo.py` | 早期 HTML 清洗示例（列表 + 详情） | `artifacts/sample-normalized.json` |
| `captcha_solve.py` | 验证码 PNG 解码 + 偏移求解（离线校验算法） | 控制台输出 |
| `captcha-capture.mjs` | 抓取 Focus Captcha 图片/DOM/一次拖拽记录 | `artifacts/captcha/run1/` |
| `captcha-autosolve.mjs` | **验证码自动通过**（边缘匹配 + 拖拽），真实业务流验证 | `artifacts/captcha/autosolve*/` |
| `region-mode-test.mjs` | 地区词当 keyword + 原生筛选的纯地区列举验证 | `artifacts/region-mode/` |
| `m-company-verify.mjs` | m 站公司详情 ssrData 验证 | `artifacts/m-company/` |
| `challenge.mjs` | 尝试复现 EdgeOne `__tst_status` JS challenge（未成功，留档） | — |

运行方式（在仓库根目录）：
```bash
~/cloak-env/bin/cloak-run node recon/scripts/<script>.mjs
# 需要指定 profile / 输出目录时：
PROFILE_DIR=~/.mic-client/recon-profiles/.profile-captcha-t2 TRIAL=demo \
  ~/cloak-env/bin/cloak-run node recon/scripts/captcha-autosolve.mjs
```

## 3. 证据索引

| 目录 | 内容 |
|---|---|
| `artifacts/api/` | 上游接口样例 + `endpoints.json` + `request-examples.sh`（见其 README） |
| `artifacts/probe2..10/` | 页面 HTML/PNG/网络 JSON（按探针轮次） |
| `artifacts/probe11-anon/` | 匿名完整度审计快照（5 家 × 4 页） |
| `artifacts/captcha/` | 验证码背景/拼图 PNG、DOM、自动通过记录与通过后截图 |
| `artifacts/region-mode/` | 地区词/城市筛选结果 JSON + 截图 |
| `artifacts/m-company/` | m 站 ssrData JSON + storage-state |
| `artifacts/sample-normalized.json` | 早期 HTML 清洗结构示例 |

> 证据文件较大（约 31MB），仅作留档；产品实现不依赖这些原始文件，依赖的是 `docs/research/` 中提炼的规则。
