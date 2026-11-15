# Focus Captcha 自动通过方案（recon 验证版）

> 结论：MIC 的 Focus Captcha（vemic FCaptcha 3.0.2，blockPuzzle 滑动拼图）可以**程序化自动通过**，实测 2/2 次第 1 尝试成功；会话通过后可长期复用（连续 12 页 HTTP 请求无验证码）。
> 代码：`recon/scripts/captcha-autosolve.mjs`（可移植到客户端 `core/session/captcha.ts`）；样例产物：`recon/artifacts/captcha/autosolve*/`。

## 1. 验证码结构（已逆向）

1. 风控触发时，业务页 302 到
   `https://captcha.made-in-china.com/verification.html?srcUrl=<urlencoded>`
   （`srcUrl` 有 bug：含 `&` 时会被截断，客户端不要依赖它回跳，自己记住原 URL）。
2. 页面加载 `https://captcha.vemic.com/js/FCaptcha-3.0.2-all.js`，初始化 `FCaptcha({ captchaId: 'c1d06b70-1547-44d1-b9a8-e17fdd8c85cf', apiServer: location.host, ... })`。
3. `POST https://captcha.made-in-china.com/captcha/get`，header `captchaId`，body `{captchaType:"blockPuzzle", clientUid, version, ts}`：
   ```json
   {"repCode":"0000","repData":{
     "secretKey":"F0xuTmWdTpQ8t8xF",
     "originalImageUrl":"/blockPuzzle/pics/<hash>",
     "jigsawImageUrl":"/blockPuzzle/pics/<hash>",
     "token":"f1ec7023fe53404bbe1b1c6063ac6adf","result":false}}
   ```
   图片：背景 310×155，拼图 47×155（RGBA，透明背景，拼图块在 y≈22..66）。
4. 拖动结束后 `POST /captcha/check`：
   - `pointJson` = AES(secretKey, `{"x":moveLeftDistance,"y":5}`)（客户端 JS 内加密）
   - `x = 310 * dom拖拽距离 / 图片显示宽度`；服务端返回 `repCode:"0000"` 为通过，`6111` 为失败。
5. 通过后写入会话 cookie（`__tst_status` / `EO_Bot_Ssid` 等）；业务页即恢复访问。

## 2. 自动解法（已实现）

```
拦截 /captcha/get → 拿 originalImageUrl / jigsawImageUrl
  ↓ 页面内 canvas 解码两张 PNG
背景图求 Sobel 梯度图 edge(x,y)
拼图 alpha>128 → mask；mask 的边界像素集 boundary
for 每个候选偏移 (dx,dy)：
    score(dx,dy) = mean( edge( boundary + (dx,dy) ) )
取 score 最大者 → 目标 x（实测 dx 任意、dy=0）
  ↓
domDelta = x * imgWidth / 310        # imgWidth≈280（FCaptcha setSize.img_width）
Playwright mouse：move→down→分 24 步带抖动→up（约 0.6–1.2s）
  ↓
读 /captcha/check 响应：repCode 0000 → 成功；否则等控件刷新后重试（≤5 次）
```

关键点：
- 拼图块在返回图片里的 alpha 边界与背景“挖洞”边界一致，**边缘匹配**比颜色匹配稳（背景内容可能很暗/很杂）。
- 拖动距离换算用 `window.focusCaptcha.setSize.img_width` 和 310 常数（来自 JS 源码 `moveLeftDistance = 310 * domX / img_width`）。
- 拖动要分步、带轻微纵向抖动，整体 600ms+，不要瞬移。
- `window.focusCaptcha` 可以直接读到 `setSize`、`secretKey`、`backToken`，便于调试（不建议直接伪造 check，保持真实拖动）。

## 3. 实测结果（2026-11-15）

| 试验 | profile | 是否出验证码 | 结果 | 偏移 |
|---|---|---|---|---|
| t1（直接 captcha 页） | 全新 | 是 | 第 1 次通过 | 174 |
| t2（业务页重定向） | 全新 | 是 | 第 1 次通过 | 219 |
| t3（业务页） | 全新 | 否（直接 200 列表） | — | — |
| t4（SEO 城市页） | 全新 | 否（直接 200，30 条 Langfang） | — | — |
| 城市页/续页 | 复用 t2 已验证 profile | 否 | SEO 城市页 30 条、第 2 页 30 条 | — |
| HTTP 重放 | 复用 t2 cookie | 否 | 连续 12 页 `companysearch.do`（1.2s 间隔）全部 30 条、0 验证码 | — |

- 通过后页面截图/HTML：`recon/artifacts/captcha/autosolve*/verified-page.png`、`recon/artifacts/region-mode/*.png`。
- 结论：**验证码是风控信任度触发**（新 profile/IP/高频时出现），自动解可用于首次会话建立；通过后会话可复用做批量抓取。

## 4. 客户端集成建议

- `core/session/browser.ts`：
  - 持久 profile（`~/.mic-client/profile`）；启动后先 `GET /` 探活；
  - 访问任意业务 URL 后被重定向到 `captcha.made-in-china.com` → 调用 `solveFocusCaptcha()`；
  - 成功 → 继续原 URL；失败 3–5 次 → 抛 `NEED_HUMAN_VERIFICATION`，由 `mic auth` 弹可见窗口人工处理；
  - 成功后 `ctx.storageState()` 导出 cookie，供 HTTP 快速通道（`companysearch.do`、公司首页、`contact-info.html`）使用；SEO 城市页仍走浏览器（JS challenge）。
- 限速：2–4s 抖动 + 缓存优先，避免反复触发风控。
- 合规提醒：该能力用于本机个人客户端访问公开页面；保留人工兜底与限速，不做高并发/商业化爬取。

## 5. 复现命令

```bash
# 全新 profile 真实业务流（会触发验证码并自动过）
CLOAKBROWSER_AUTO_UPDATE=false TRIAL=demo PROFILE_DIR=/home/songqian/mic-client/.profile-demo \
  ~/cloak-env/bin/cloak-run node recon/scripts/captcha-autosolve.mjs

# 已验证 profile 测地区模式（纯地区列举）
CLOAKBROWSER_AUTO_UPDATE=false PROFILE_DIR=/home/songqian/mic-client/.profile-captcha-t2 \
  ~/cloak-env/bin/cloak-run node recon/scripts/region-mode-test.mjs

# 离线校验算法（用已保存图片）
python3 recon/scripts/captcha_solve.py recon/artifacts/captcha/run1
```
