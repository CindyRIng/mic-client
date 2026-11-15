// Probe 4: click-through to Supplier List (hoping no captcha), company site + profile pages.
// Run: ~/cloak-env/bin/cloak-run node recon/scripts/probe4.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/probe4');
const PROFILE = path.join(ROOT, '.profile');
fs.mkdirSync(OUT, { recursive: true });
const HEADLESS = process.env.HEADLESS !== '0';

const PRODUCT_SEARCH = 'https://www.made-in-china.com/productdirectory.do?word=glass&file=&searchType=1&subaction=hunt&style=b&mode=and&code=0&comProvince=nolimit&order=0&isOpenCorrection=1&org=top';

function netAttach(page, bucket) {
  page.on('response', async (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(type)) return;
    const ct = res.headers()['content-type'] || '';
    const rec = { status: res.status(), url: res.url(), type, ct };
    if (/json/i.test(ct) && !/\.js(\?|$)/.test(res.url())) {
      try { rec.bodySample = (await res.text()).slice(0, 6000); } catch {}
    }
    bucket.responses.push(rec);
  });
  page.on('requestfailed', (req) => bucket.failed.push({ url: req.url(), type: req.resourceType() }));
}

async function savePage(page, name, bucket) {
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
  fs.writeFileSync(path.join(OUT, name + '.html'), await page.content());
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  fs.writeFileSync(path.join(OUT, name + '-net.json'), JSON.stringify(bucket, null, 2));
  fs.writeFileSync(path.join(OUT, name + '-info.json'), JSON.stringify(info, null, 2));
  const isCaptcha = /Focus Captcha|not a robot|verification/i.test(info.body) || /captcha\.made-in-china\.com/.test(info.url);
  return { name, ok: true, title: info.title, url: info.url, isCaptcha, h1: info.h1, h2: info.h2, linkCount: info.links.length, bodyHead: info.body.slice(0, 2500) };
}

const results = [];
let ctx;
try {
  ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: HEADLESS,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    humanize: true,
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(45000);

  // Step 1: product search page (known to work)
  const b1 = { responses: [], failed: [] };
  netAttach(page, b1);
  await page.goto(PRODUCT_SEARCH, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(6000);
  results.push(await savePage(page, 'step1-product-search', b1));

  // Step 2: click Supplier List tab (normal user navigation)
  const b2 = { responses: [], failed: [] };
  netAttach(page, b2);
  let clicked = false;
  try {
    const tab = page.locator('a:has-text("Supplier List")').first();
    await tab.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await tab.click({ timeout: 15000 });
    clicked = true;
    await page.waitForLoadState('load').catch(() => {});
    await page.waitForTimeout(7000);
  } catch (e) {
    results.push({ name: 'step2-click-error', error: String(e) });
  }
  if (clicked) results.push(await savePage(page, 'step2-supplier-list', b2));

  // Step 3: company site from a known product-search card
  const b3 = { responses: [], failed: [] };
  netAttach(page, b3);
  try {
    await page.goto('https://relianceindustry.en.made-in-china.com/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(8000);
    results.push(await savePage(page, 'step3-company-home', b3));

    // find company profile-ish links
    const profLinks = await page.evaluate(() => {
      const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ');
      return [...document.querySelectorAll('a[href]')]
        .map((a) => ({ t: txt(a).slice(0, 100), h: a.href }))
        .filter((l) => /company|profile|about|contact|factory/i.test(l.t + ' ' + l.h))
        .slice(0, 80);
    });
    fs.writeFileSync(path.join(OUT, 'step3-profile-links.json'), JSON.stringify(profLinks, null, 2));

    const b4 = { responses: [], failed: [] };
    netAttach(page, b4);
    // try common profile path
    const target = profLinks.find((l) => /\/company-(profile|info)|company_profile|about/i.test(l.h))?.h || 'https://relianceindustry.en.made-in-china.com/company-profile.html';
    await page.goto(target, { waitUntil: 'load', timeout: 60000 }).catch((e) => results.push({ name: 'step4-goto-error', error: String(e) }));
    await page.waitForTimeout(7000);
    results.push(await savePage(page, 'step4-company-profile', b4));
  } catch (e) {
    results.push({ name: 'step3-error', error: String((e && e.stack) || e) });
  }
} catch (e) {
  results.push({ name: 'fatal', error: String((e && e.stack) || e) });
} finally {
  if (ctx) await ctx.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'probe4-result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
