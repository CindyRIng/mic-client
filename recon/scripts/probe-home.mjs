// Probe 1: load made-in-china homepage with cloakbrowser, dump HTML/screenshot/network/forms.
// Run: ~/cloak-env/bin/cloak-run node recon/scripts/probe-home.mjs
// Env: HEADLESS=0 for headed mode; OUT_DIR / PROFILE_DIR overrides.
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = process.env.OUT_DIR || path.join(ROOT, 'recon/artifacts/home');
const PROFILE = process.env.PROFILE_DIR || path.join(ROOT, '.profile');
fs.mkdirSync(OUT, { recursive: true });

const HEADLESS = process.env.HEADLESS !== '0';
const START_URL = process.env.START_URL || 'https://www.made-in-china.com/';

function attach(page, bucket) {
  page.on('response', (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (type === 'image' || type === 'font' || type === 'media') return;
    bucket.responses.push({
      status: res.status(),
      url: res.url(),
      type,
      ct: res.headers()['content-type'] || '',
    });
  });
  page.on('requestfailed', (req) => {
    bucket.failed.push({ url: req.url(), type: req.resourceType(), err: req.failure()?.errorText || '' });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.consoleErrors.push(msg.text().slice(0, 300));
  });
}

let ctx;
const result = { ok: false, headless: HEADLESS, startUrl: START_URL };
try {
  ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: HEADLESS,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(45000);

  const bucket = { responses: [], failed: [], consoleErrors: [] };
  attach(page, bucket);

  const resp = await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  const info = await page.evaluate(() => {
    const forms = [...document.querySelectorAll('form')].map((f) => ({
      action: f.getAttribute('action'),
      method: f.getAttribute('method'),
      inputs: [...f.querySelectorAll('input,select,button')].map((i) => ({
        tag: i.tagName,
        name: i.getAttribute('name'),
        type: i.getAttribute('type'),
        value: i.getAttribute('value'),
        placeholder: i.getAttribute('placeholder'),
      })),
      outer: f.outerHTML.slice(0, 1500),
    }));
    const links = [...document.querySelectorAll('a[href]')]
      .map((a) => ({
        text: (a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        href: a.href,
      }))
      .filter((l) => l.href && /supplier|companysearch|search|region|province|city|company|directory/i.test(l.href + ' ' + l.text));
    const seen = new Set();
    const uniq = links.filter((x) => (seen.has(x.href) ? false : (seen.add(x.href), true)));
    return {
      title: document.title,
      url: location.href,
      forms,
      links: uniq.slice(0, 300),
      bodyText: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 4000),
    };
  });

  await page.screenshot({ path: path.join(OUT, 'home.png'), fullPage: false });
  fs.writeFileSync(path.join(OUT, 'home.html'), await page.content());
  fs.writeFileSync(path.join(OUT, 'home-info.json'), JSON.stringify(info, null, 2));
  fs.writeFileSync(path.join(OUT, 'home-net.json'), JSON.stringify(bucket, null, 2));

  try {
    fs.writeFileSync(path.join(OUT, 'cookies.json'), JSON.stringify(await ctx.cookies(), null, 2));
  } catch (e) {
    result.cookieError = String(e);
  }

  result.ok = true;
  result.status = resp?.status();
  result.title = info.title;
  result.finalUrl = info.url;
  result.forms = info.forms.map((f) => ({ action: f.action, method: f.method, inputs: f.inputs }));
  result.linkCount = info.links.length;
  result.linkSamples = info.links.slice(0, 80);
  result.netCount = bucket.responses.length;
  result.apiLikeRequests = bucket.responses
    .filter((r) => /json|xhr|api|ajax/i.test(r.ct + ' ' + r.type))
    .slice(0, 40);
  result.consoleErrors = bucket.consoleErrors.slice(0, 10);
} catch (e) {
  result.ok = false;
  result.error = String((e && e.stack) || e);
} finally {
  if (ctx) {
    try {
      await ctx.close();
    } catch (e) {
      result.closeError = String(e);
    }
  }
  fs.writeFileSync(path.join(OUT, 'probe-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
