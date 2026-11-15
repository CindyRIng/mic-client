// Probe 8: company About Us (protected by JS challenge) + member-since + SEO region page.
// Run: HUMAN_WAIT=420 ~/cloak-env/bin/cloak-run node recon/scripts/probe8.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/probe8');
const PROFILE = process.env.PROFILE_DIR || path.join(ROOT, '.profile-live');
fs.mkdirSync(OUT, { recursive: true });
const HUMAN_WAIT = parseInt(process.env.HUMAN_WAIT || '0', 10);

const XINGCHEN_ABOUT = 'https://xingchenglass.en.made-in-china.com/company-Hebei-Xingchen-Glass-Technology-Co-Ltd-.html';
const XINGCHEN_HOME = 'https://xingchenglass.en.made-in-china.com/';
const SEO_HEBEI = 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei/1.html';
const SEO_REGION_ONLY = 'https://www.made-in-china.com/company-search/C1--CP_Hebei/1.html';

const log = (...a) => console.log('[probe8]', ...a);

async function isCaptcha(page) {
  try {
    if (/captcha\.made-in-china\.com/.test(page.url())) return true;
    if (/Focus Captcha/i.test(await page.title())) return true;
    const txt = await page.evaluate(() => (document.body?.innerText || '').slice(0, 400));
    return /Swipe right|not a robot/i.test(txt);
  } catch { return false; }
}

async function waitHuman(page) {
  console.log('CAPTCHA_WAITING_FOR_HUMAN');
  const deadline = Date.now() + HUMAN_WAIT * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    if (!(await isCaptcha(page))) {
      log('human passed captcha');
      return true;
    }
  }
  return false;
}

async function bodyText(page) {
  for (let i = 0; i < 5; i++) {
    try {
      return await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' '));
    } catch {
      await page.waitForTimeout(1500);
    }
  }
  return '';
}

async function waitForText(page, needles, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCaptcha(page)) return { captcha: true };
    const t = await bodyText(page);
    if (needles.some((n) => t.includes(n))) return { found: true, text: t };
    await page.waitForTimeout(2000);
  }
  return { found: false };
}

async function save(page, name, net) {
  fs.writeFileSync(path.join(OUT, name + '.html'), await page.content());
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  const info = await page.evaluate(() => {
    const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ');
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({ t: txt(a).slice(0, 120), h: a.href }));
    const seen = new Set();
    const uniq = links.filter((x) => (seen.has(x.h) ? false : (seen.add(x.h), true)));
    const sel = (s) => document.querySelector(s)?.textContent?.trim().replace(/\s+/g, ' ') || null;
    return {
      title: document.title,
      url: location.href,
      h1: [...document.querySelectorAll('h1')].map(txt).slice(0, 10),
      h2: [...document.querySelectorAll('h2')].map(txt).slice(0, 40),
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 30000),
      links: uniq.slice(0, 2000),
      memberSign: {
        text: sel('.shop-sign__text'),
        year: sel('.J-member-since-tooltip .txt-year'),
        tip: sel('.J-member-since-tooltip'),
      },
    };
  });
  fs.writeFileSync(path.join(OUT, name + '-info.json'), JSON.stringify(info, null, 2));
  fs.writeFileSync(path.join(OUT, name + '-net.json'), JSON.stringify(net, null, 2));
  return info;
}

let ctx;
const results = [];
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

  const attachNet = () => {
    const bucket = { responses: [], failed: [] };
    page.on('response', (res) => {
      const type = res.request().resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) return;
      bucket.responses.push({ status: res.status(), url: res.url(), type, ct: res.headers()['content-type'] || '' });
    });
    return bucket;
  };

  // 1) warmup
  await page.goto('https://www.made-in-china.com/', { waitUntil: 'load', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(5000);
  log('warm title:', await page.title().catch(() => '?'));
  if (await isCaptcha(page)) {
    const ok = await waitHuman(page);
    results.push({ step: 'warmup', captcha: true, humanPassed: ok });
  }

  // 2) company About Us (JS challenge expected)
  {
    const net = attachNet();
    await page.goto(XINGCHEN_ABOUT, { waitUntil: 'load', timeout: 90000 }).catch((e) => log('about goto warn', String(e).slice(0, 120)));
    const r = await waitForText(page, ['Year of Establishment', 'Business Type', 'Company Profile', 'Year Established'], 35000);
    if (r.captcha) {
      const ok = await waitHuman(page);
      results.push({ step: 'captcha@about', humanPassed: ok });
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(3000);
    const info = await save(page, 'xingchen-about', net);
    const facts = {};
    for (const kw of ['Year of Establishment', 'Business Type', 'Main Products', 'No. of Employees', 'Address', 'Rating', 'Average Response Time', 'OEM/ODM Service', 'Sample Available', 'Visit My Factory', 'BSCI', 'ISO']) {
      const i = info.body.indexOf(kw);
      if (i >= 0) facts[kw] = info.body.slice(i, i + 260);
    }
    results.push({ step: 'about', ok: true, title: info.title, url: info.url, memberSign: info.memberSign, facts });
  }

  // 3) company home (member since tooltip)
  {
    const net = attachNet();
    await page.goto(XINGCHEN_HOME, { waitUntil: 'load', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(8000);
    const info = await save(page, 'xingchen-home', net);
    results.push({ step: 'home', ok: true, title: info.title, url: info.url, memberSign: info.memberSign });
  }

  // 4) SEO region page
  {
    const net = attachNet();
    await page.goto(SEO_HEBEI, { waitUntil: 'load', timeout: 90000 }).catch(() => {});
    const r = await waitForText(page, ['Supplier List', 'Main Products', 'Province'], 35000);
    if (r.captcha) {
      const ok = await waitHuman(page);
      results.push({ step: 'captcha@seo', humanPassed: ok });
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(4000);
    const info = await save(page, 'seo-hebei', net);
    const cityLinks = info.links.filter((l) => /company-search/.test(l.h) && /CP_/.test(l.h)).slice(0, 80);
    results.push({ step: 'seo-hebei', ok: true, title: info.title, url: info.url, linkCount: info.links.length, cityLinks: cityLinks.slice(0, 40), bodyHead: info.body.slice(0, 800) });
  }

  // 5) SEO region only (no keyword)
  {
    const net = attachNet();
    await page.goto(SEO_REGION_ONLY, { waitUntil: 'load', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(12000);
    const info = await save(page, 'seo-region-only', net);
    results.push({ step: 'seo-region-only', ok: true, title: info.title, url: info.url, bodyHead: info.body.slice(0, 800) });
  }

  fs.writeFileSync(path.join(OUT, 'storage-state.json'), JSON.stringify(await ctx.storageState(), null, 2));
  fs.writeFileSync(path.join(OUT, 'cookies.json'), JSON.stringify(await ctx.cookies(), null, 2));
} catch (e) {
  results.push({ step: 'fatal', error: String((e && e.stack) || e) });
} finally {
  if (ctx) await ctx.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'probe8-result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
