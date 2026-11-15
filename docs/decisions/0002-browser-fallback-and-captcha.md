# ADR-0002：浏览器仅用于兜底；Focus Captcha 自动通过 + 人工 `mic auth` 兜底

- 状态：Accepted
- 日期：2026-11-15
- 关联：[02 架构](../02-architecture.md)、[research/captcha-autosolve.md](../research/captcha-autosolve.md)、[07 运维](../07-operations.md)

## 背景

MIC 存在多层风控：

- 空关键词搜索 → Focus Captcha（302 到 `captcha.made-in-china.com/verification.html`）；
- 公司 m 站详情/contact 页约 13% 概率随机 Focus Captcha；
- SEO 桌面页与部分深页有 EdgeOne `__tst_status` JS challenge；
- 高频/并发请求会显著提高触发率。

已逆向 Focus Captcha（vemic FCaptcha 3.0.2，blockPuzzle）：`POST /captcha/get` 返回背景/拼图（310×155、47×155），`POST /captcha/check` 校验拖动距离（y=5，x 为 310 制移动距离）。已实现「Sobel 边缘 + alpha 边界模板匹配求偏移 → humanized 拖拽 → 读取 check 结果」的自动通过；实测新 profile 2/2 次第 1 尝试成功，通过后会话 cookie 连续 12 页 HTTP 请求 0 验证码。

## 决策

1. **浏览器（cloakbrowser 持久 profile）只承担兜底职责**：验证码、JS challenge、HTML 兜底解析、可选登录；
2. **Focus Captcha 优先自动通过**（`core/session/captcha.ts`，移植 recon 脚本算法），失败自动重试（≤5 次）；
3. 自动通过仍失败或连续触发 → 返回结构化错误 `NEED_HUMAN_VERIFICATION`，调用方用 `mic auth` 弹可见浏览器人工处理；
4. 会话通过后导出 `storageState` 给 HTTP 通道复用；SEO 城市页等只在浏览器内访问；
5. 以限速（1.5–2.5s 抖动）、single-flight、缓存优先降低触发概率，禁止并发轰炸。

## 后果

**正面**：绝大多数请求无需人工；自动化程度高；失败有明确人工路径。
**负面**：自动通过依赖验证码实现细节（上游升级会失效）；人工兜底需要可见桌面环境；仍受风控节奏约束。
**缓解**：验证码算法可替换（失败即降级人工）；`mic doctor` 检测环境；限速与缓存优先。

## 替代方案

- **纯人工过验证码**：可用但打断自动化 → 不采用为主。
- **纯浏览器全链路（人工/半自动混合）**：速度慢、资源重 → 不采用。
- **第三方打码平台**：引入外部依赖/隐私风险/成本 → 不采用。

## 证据

- `docs/research/captcha-autosolve.md`（算法 + 实测）
- `recon/scripts/captcha-autosolve.mjs`、`recon/artifacts/captcha/`
- `recon/artifacts/probe10/`（人工验证会话）
