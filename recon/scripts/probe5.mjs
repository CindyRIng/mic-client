// Probe 5: HEADED session -> companysearch (supplier list). If Focus Captcha appears, wait for human to solve.
// Run: HUMAN_WAIT=600 ~/cloak-env/bin/cloak-run node recon/scripts/probe5.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/probe5');
const PROFILE = process.env.PROFILE_DIR || path.join(ROOT, '.profile-live');
fs.mkdirSync(OUT, { recursive: true });

const HUMAN_WAIT = parseInt(process.env.HUMAN_WAIT || '0', 10);
const TARGET = process.env.TARGET_URL || 'https://www.made-in-china.com/companysearch.do?subaction=hunt&style=b&mode=and&code=0&comProvince=nolimit&order=0&isOpenCorrection=1&word=glass';

const log = (...a) => console.log('[probe5]', ...a);

async function isCaptcha(page) {
  try {
    if (/captcha\.made-in-china\.com/.test(page.url())) return true;
    const title = await page.title();
    if (/Focus Captcha/i.test(title)) return true;
    const txt = await page.evaluate(() => (document.body?.innerText || '').slice(0, 600));
    return /not a robot|Swipe right/i.test(txt);
  } catch {
    return false;
  }
}

let ctx;
const result = { ok: false };
try {
  ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: false,
    viewport: { width: 1600, height: 950 },
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    humanize: true,
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(60000);

  await page.goto('https://www.made-in-china.com/', { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(4000);
  log('home loaded:', await page.title());

  const net = { responses: [], failed: [] };
  page.on('response', (res) => {
    const type = res.request().resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(type)) return;
    net.responses.push({ status: res.status(), url: res.url(), type, ct: res.headers()['content-type'] || '' });
  });

  await page.goto(TARGET, { waitUntil: 'load', timeout: 90000 }).catch((e) => log('goto warn:', String(e).slice(0, 200)));
  await page.waitForTimeout(6000);

  let captcha = await isCaptcha(page);
  log('captcha?', captcha, 'url:', page.url());

  if (captcha) {
    console.log('CAPTCHA_WAITING_FOR_HUMAN');
    const deadline = Date.now() + HUMAN_WAIT * 1000;
    let passed = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(4000);
      try {
        const still = await isCaptcha(page);
        const url = page.url();
        if (!still && /companysearch\.do/.test(url)) {
          passed = true;
          break;
        }
      } catch {}
    }
    result.humanPassed = passed;
    log('human pass:', passed);
    if (passed) {
      await page.waitForTimeout(5000);
    }
  }

  const info = await page.evaluate(() => {
    const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ');
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({ t: txt(a).slice(0, 120), h: a.href }));
    const seen = new Set();
    const uniq = links.filter((x) => (seen.has(x.h) ? false : (seen.add(x.h), true)));
    return {
      title: document.title,
      url: location.href,
      h1: [...document.querySelectorAll('h1')].map(txt).slice(0, 10),
      h2: [...document.querySelectorAll('h2')].map(txt).slice(0, 40),
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 20000),
      links: uniq.slice(0, 1500),
    };
  });
  fs.writeFileSync(path.join(OUT, 'supplier-search.html'), await page.content());
  await page.screenshot({ path: path.join(OUT, 'supplier-search.png') });
  fs.writeFileSync(path.join(OUT, 'supplier-search-net.json'), JSON.stringify(net, null, 2));
  fs.writeFileSync(path.join(OUT, 'supplier-search-info.json'), JSON.stringify(info, null, 2));
  try {
    fs.writeFileSync(path.join(OUT, 'storage-state.json'), JSON.stringify(await ctx.storageState(), null, 2));
    fs.writeFileSync(path.join(OUT, 'cookies.json'), JSON.stringify(await ctx.cookies(), null, 2));
  } catch (e) {
    result.storageError = String(e);
  }

  result.ok = true;
  result.title = info.title;
  result.url = info.url;
  result.isCaptcha = /not a robot|Swipe right/i.test(info.body) || /captcha\.made-in-china\.com/.test(info.url);
  result.bodyHead = info.body.slice(0, 1500);
  log('saved artifacts, captcha?', result.isCaptcha, 'url:', info.url);
} catch (e) {
  result.error = String((e && e.stack) || e);
  log('ERROR', result.error);
} finally {
  fs.writeFileSync(path.join(OUT, 'probe5-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (ctx) await ctx.close().catch(() => {});
}
