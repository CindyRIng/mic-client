// Auto-solve Focus Captcha (blockPuzzle): capture /captcha/get images, edge-match the gap, drag slider.
// Run: ~/cloak-env/bin/cloak-run node recon/scripts/captcha-autosolve.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/captcha/autosolve' + (process.env.TRIAL ? '-' + process.env.TRIAL : ''));
const PROFILE = process.env.PROFILE_DIR || path.join(ROOT, '.profile-captcha2');
fs.mkdirSync(OUT, { recursive: true });

const SRC = process.env.TARGET_SRC || 'https://www.made-in-china.com/companysearch.do?subaction=hunt&style=b&mode=and&code=0&comProvince=nolimit&order=0&isOpenCorrection=1&word=glass';
const CAPTCHA_URL = 'https://captcha.made-in-china.com/verification.html?srcUrl=' + encodeURIComponent(SRC);
const MAX_ATTEMPTS = 5;

const log = (...a) => console.log('[autosolve]', ...a);

async function solveOffset(page, origUrl, jigUrl) {
  return page.evaluate(async ([oUrl, jUrl]) => {
    async function load(url) {
      const res = await fetch(url, { credentials: 'include' });
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      return { img: ctx.getImageData(0, 0, bmp.width, bmp.height), w: bmp.width, h: bmp.height };
    }
    const bg = await load(oUrl);
    const jg = await load(jUrl);
    const BW = bg.w, BH = bg.h, PW = jg.w, PH = jg.h;
    const bd = bg.img.data, jd = jg.img.data;
    const lum = new Float32Array(BW * BH);
    for (let i = 0; i < BW * BH; i++) lum[i] = (bd[i * 4] * 0.299 + bd[i * 4 + 1] * 0.587 + bd[i * 4 + 2] * 0.114);
    const edge = new Float32Array(BW * BH);
    for (let y = 1; y < BH - 1; y++) {
      for (let x = 1; x < BW - 1; x++) {
        const i = y * BW + x;
        const gx = lum[i + 1] - lum[i - 1];
        const gy = lum[i + BW] - lum[i - BW];
        edge[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    // piece mask from alpha
    const mask = new Uint8Array(PW * PH);
    for (let i = 0; i < PW * PH; i++) mask[i] = jd[i * 4 + 3] > 128 ? 1 : 0;
    const er = new Uint8Array(PW * PH);
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        if (!mask[y * PW + x]) continue;
        let all = 1;
        for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= PH || nx < 0 || nx >= PW || !mask[ny * PW + nx]) { all = 0; break; }
        }
        er[y * PW + x] = all;
      }
    }
    const bys = [];
    const bxs = [];
    for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) if (mask[y * PW + x] && !er[y * PW + x]) { bys.push(y); bxs.push(x); }
    let best = { score: -1, x: -1, y: -1 };
    const yMax = BH - PH;
    for (let y = 0; y <= Math.max(0, yMax); y++) {
      for (let x = 0; x <= BW - PW; x++) {
        let s = 0;
        for (let k = 0; k < bys.length; k++) s += edge[(bys[k] + y) * BW + (bxs[k] + x)];
        s /= bys.length;
        if (s > best.score) best = { score: s, x, y };
      }
    }
    return { ...best, bw: BW, bh: BH, pw: PW, ph: PH, boundary: bys.length };
  }, [origUrl, jigUrl]);
}

let ctx;
const attempts = [];
try {
  ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: true,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    humanize: true,
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(60000);

  let lastGet = null;
  const checkResults = [];
  page.on('response', async (res) => {
    const u = res.url();
    try {
      if (res.request().method() === 'POST' && /\/captcha\/get$/.test(u)) {
        lastGet = JSON.parse(await res.text());
      } else if (res.request().method() === 'POST' && /\/captcha\/check$/.test(u)) {
        checkResults.push(JSON.parse(await res.text()));
      }
    } catch {}
  });

  // Real flow: request the business page; MIC redirects to Focus Captcha.
  await page.goto(SRC, { waitUntil: 'load', timeout: 90000 }).catch((e) => log('goto warn', String(e).slice(0, 120)));
  await page.waitForTimeout(6000);
  if (/captcha\.made-in-china\.com/.test(page.url()) || (await page.title().catch(() => '')).includes('Focus Captcha')) {
    log('captcha page shown, starting autosolve');
  } else {
    log('NO CAPTCHA — direct access ok:', page.url());
  }

  let solved = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // find current get response
    let tries = 0;
    while (!lastGet && tries++ < 50) await page.waitForTimeout(200);
    const rep = lastGet?.repData;
    if (!rep) { log('no get response, retry'); await page.waitForTimeout(2000); continue; }
    const orig = 'https://captcha.made-in-china.com' + rep.originalImageUrl;
    const jig = 'https://captcha.made-in-china.com' + rep.jigsawImageUrl;
    lastGet = null;

    const off = await solveOffset(page, orig, jig);
    const st = await page.evaluate(() => {
      const fc = window.focusCaptcha;
      const r = document.querySelector('.fcaptcha-verify-move-block')?.getBoundingClientRect();
      return { imgWidth: fc?.setSize?.img_width, rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null };
    });
    if (!st.rect) { log('slider not found, retry'); await page.waitForTimeout(1500); continue; }
    const imgWidth = st.imgWidth || 280;
    const domDelta = off.x * imgWidth / 310;
    log(`attempt ${attempt}: offset(img)=${off.x} score=${off.score.toFixed(1)} -> domDelta=${domDelta.toFixed(1)}`);

    const sx = st.rect.x + st.rect.w / 2;
    const sy = st.rect.y + st.rect.h / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const done = i / steps;
      const jitterY = Math.sin(i * 1.3) * 0.8;
      await page.mouse.move(sx + domDelta * done, sy + jitterY);
      await page.waitForTimeout(10 + Math.random() * 25);
    }
    await page.waitForTimeout(120);
    await page.mouse.up();

    // wait for check response
    const before = checkResults.length;
    for (let i = 0; i < 40 && checkResults.length === before; i++) await page.waitForTimeout(200);
    const result = checkResults[checkResults.length - 1];
    attempts.push({ attempt, off, domDelta, result });
    fs.writeFileSync(path.join(OUT, `attempt-${attempt}.json`), JSON.stringify({ off, domDelta, result }, null, 2));
    fs.writeFileSync(path.join(OUT, `attempt-${attempt}.png`), await page.screenshot());
    if (result && result.repCode === '0000') {
      log('CAPTCHA SOLVED');
      solved = true;
      break;
    }
    log('failed:', JSON.stringify(result));
    await page.waitForTimeout(2500); // widget refreshes itself
  }

  await page.waitForTimeout(5000);
  async function safeEval(fn, tries = 8) {
    for (let i = 0; i < tries; i++) {
      try { return await page.evaluate(fn); } catch (e) { await page.waitForTimeout(1500); }
    }
    return { error: 'evaluate failed' };
  }
  let after = await safeEval(() => ({
    title: document.title,
    url: location.href,
    body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 800),
    listNodes: document.querySelectorAll('.list-node').length,
  }));
  // verify the verified session actually opens the business page
  try {
    await page.goto(SRC, { waitUntil: 'load', timeout: 90000 });
    await page.waitForTimeout(5000);
    const verify = await safeEval(() => ({
      title: document.title,
      url: location.href,
      captcha: /captcha\.made-in-china\.com/.test(location.href) || /not a robot|Swipe right/i.test(document.body?.innerText || ''),
      listNodes: document.querySelectorAll('.list-node').length,
    }));
    after = { ...after, verify };
    await page.screenshot({ path: path.join(OUT, 'verified-page.png') });
  } catch (e) {
    after = { ...after, verifyError: String(e).slice(0, 200) };
  }
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ solved, attempts, after }, null, 2));
  if (ctx) {
    fs.writeFileSync(path.join(OUT, 'storage-state.json'), JSON.stringify(await ctx.storageState(), null, 2));
    fs.writeFileSync(path.join(OUT, 'cookies.json'), JSON.stringify(await ctx.cookies(), null, 2));
  }
  log('after:', JSON.stringify(after).slice(0, 500));
  console.log(JSON.stringify({ solved, attempts, after }, null, 2).slice(0, 4000));
} finally {
  if (ctx) await ctx.close().catch(() => {});
}
