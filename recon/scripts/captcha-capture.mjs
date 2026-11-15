// Captcha research probe: open Focus Captcha widget, capture images/DOM, attempt one drag.
// Run: ~/cloak-env/bin/cloak-run node recon/scripts/captcha-capture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/captcha/run1');
const PROFILE = path.join(ROOT, '.profile-captcha');
fs.mkdirSync(OUT, { recursive: true });

const SRC = 'https://www.made-in-china.com/companysearch.do?subaction=hunt&style=b&mode=and&code=0&comProvince=nolimit&order=0&isOpenCorrection=1&word=glass';
const CAPTCHA_URL = 'https://captcha.made-in-china.com/verification.html?srcUrl=' + encodeURIComponent(SRC);

const gets = [];
const checks = [];
let ctx;
try {
  ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: true,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(60000);

  page.on('response', async (res) => {
    const u = res.url();
    try {
      if (/\/captcha\/get/.test(u) && res.request().method() === 'POST') {
        const j = JSON.parse(await res.text());
        gets.push(j);
      } else if (/\/captcha\/check/.test(u) && res.request().method() === 'POST') {
        const txt = await res.text();
        checks.push({ status: res.status(), body: txt.slice(0, 2000) });
      }
    } catch {}
  });

  await page.goto(CAPTCHA_URL, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(9000);

  // save captured get responses + images
  fs.writeFileSync(path.join(OUT, 'gets.json'), JSON.stringify(gets, null, 2));
  for (let i = 0; i < gets.length; i++) {
    const d = gets[i].repData || {};
    for (const [k, v] of Object.entries(d)) {
      if (typeof v === 'string' && v.startsWith('data:image')) {
        const b = v.split(',')[1] || '';
        fs.writeFileSync(path.join(OUT, `get${i}-${k}.png`), Buffer.from(b, 'base64'));
      }
    }
    // log non-image fields
    const meta = {};
    for (const [k, v] of Object.entries(d)) if (!(typeof v === 'string' && v.startsWith('data:image'))) meta[k] = v;
    fs.writeFileSync(path.join(OUT, `get${i}-meta.json`), JSON.stringify(meta, null, 2));
  }

  const info = await page.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const imgs = [...document.querySelectorAll('.fcaptcha-verifybox img')].map((img) => ({
      srcHead: img.src.slice(0, 60),
      cls: img.className,
      rect: r(img),
      natural: { w: img.naturalWidth, h: img.naturalHeight },
    }));
    const fc = window.focusCaptcha;
    return {
      title: document.title,
      url: location.href,
      doms: {
        verifybox: r(document.querySelector('.fcaptcha-verifybox')),
        bar_area: r(document.querySelector('.fcaptcha-verify-bar-area')),
        move_block: r(document.querySelector('.fcaptcha-verify-move-block')),
        img_panel: r(document.querySelector('.fcaptcha-verify-img-panel')),
        img_out: r(document.querySelector('.fcaptcha-verify-img-out')),
      },
      imgs,
      focusCaptchaKeys: fc ? Object.keys(fc) : null,
      setSize: fc ? fc.setSize : null,
      options: fc ? { captchaType: fc.options?.captchaType, product: fc.options?.product, baseUrl: fc.options?.baseUrl, blockSize: fc.options?.blockSize, barSize: fc.options?.barSize } : null,
      secretKey: fc ? fc.secretKey : null,
      backToken: fc ? fc.backToken : null,
      imgSize: fc ? fc.imgSize : null,
      outer: (document.querySelector('.fcaptcha-verifybox')?.outerHTML || '').slice(0, 4000),
    };
  });
  fs.writeFileSync(path.join(OUT, 'dom-info.json'), JSON.stringify(info, null, 2));
  await page.screenshot({ path: path.join(OUT, 'before-drag.png'), fullPage: false });

  // attempt a drag of 120 px from move block
  const mb = info.doms.move_block;
  if (mb) {
    const startX = mb.x + mb.w / 2;
    const startY = mb.y + mb.h / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(startX + (120 * i) / 12, startY + Math.sin(i) * 1.5, { steps: 2 });
      await page.waitForTimeout(15 + Math.random() * 20);
    }
    await page.mouse.up();
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: path.join(OUT, 'after-drag.png'), fullPage: false });
  fs.writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify(checks, null, 2));
  const after = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
  }));
  fs.writeFileSync(path.join(OUT, 'after.json'), JSON.stringify(after, null, 2));
  console.log(JSON.stringify({ gets: gets.length, checks, after, doms: info.doms, imgs: info.imgs, focusCaptchaKeys: info.focusCaptchaKeys, setSize: info.setSize }, null, 2).slice(0, 6000));
} finally {
  if (ctx) await ctx.close().catch(() => {});
}
