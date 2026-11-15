// Probe 6: SEO supplier-search pages (province), company profile page, region-only variants.
// Run: HUMAN_WAIT=300 ~/cloak-env/bin/cloak-run node recon/scripts/probe6.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/probe6');
const PROFILE = process.env.PROFILE_DIR || path.join(ROOT, '.profile-live');
fs.mkdirSync(OUT, { recursive: true });
const HUMAN_WAIT = parseInt(process.env.HUMAN_WAIT || '0', 10);

const STEPS = [
  { name: 'hebei-province-p1', url: 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei/1.html' },
  { name: 'hebei-province-p2', url: 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei/2.html' },
  { name: 'region-no-keyword', url: 'https://www.made-in-china.com/company-search/C1--CP_Hebei/1.html' },
  { name: 'reliance-profile', url: 'https://relianceindustry.en.made-in-china.com/company-QINGDAO-RISING-STAR-GLASS-CO-LTD.html' },
  { name: 'reliance-contact', url: 'https://relianceindustry.en.made-in-china.com/contact-info.html' },
];

const log = (...a) => console.log('[probe6]', ...a);

async function isCaptcha(page) {
  try {
    if (/captcha\.made-in-china\.com/.test(page.url())) return true;
    if (/Focus Captcha/i.test(await page.title())) return true;
    const txt = await page.evaluate(() => (document.body?.innerText || '').slice(0, 500));
    return /not a robot|Swipe right/i.test(txt);
  } catch { return false; }
}

async function waitHuman(page) {
  console.log('CAPTCHA_WAITING_FOR_HUMAN');
  const deadline = Date.now() + HUMAN_WAIT * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    if (!(await isCaptcha(page))) return true;
  }
  return false;
}

async function summarize(page) {
  return page.evaluate(() => {
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
      links: uniq.slice(0, 2000),
    };
  });
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

  for (const step of STEPS) {
    const bucket = { responses: [], failed: [] };
    page.on('response', (res) => {
      const type = res.request().resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) return;
      bucket.responses.push({ status: res.status(), url: res.url(), type, ct: res.headers()['content-type'] || '' });
    });
    const rec = { name: step.name, url: step.url, ok: false };
    try {
      await page.goto(step.url, { waitUntil: 'load', timeout: 90000 }).catch((e) => (rec.gotoWarn = String(e).slice(0, 200)));
      await page.waitForTimeout(6000);
      if (await isCaptcha(page)) {
        rec.captcha = true;
        const ok = HUMAN_WAIT > 0 ? await waitHuman(page) : false;
        rec.humanPassed = ok;
        if (ok) await page.waitForTimeout(4000);
      }
      const info = await summarize(page);
      fs.writeFileSync(path.join(OUT, step.name + '.html'), await page.content());
      await page.screenshot({ path: path.join(OUT, step.name + '.png') });
      fs.writeFileSync(path.join(OUT, step.name + '-info.json'), JSON.stringify(info, null, 2));
      fs.writeFileSync(path.join(OUT, step.name + '-net.json'), JSON.stringify(bucket, null, 2));
      Object.assign(rec, {
        ok: true,
        title: info.title,
        finalUrl: info.url,
        h1: info.h1,
        h2: info.h2.slice(0, 12),
        bodyHead: info.body.slice(0, 1200),
        filterLinks: info.links.filter((l) => /company-search\//.test(l.h) && /CP_|City|city/.test(l.h + l.t)).slice(0, 60),
        pageLinks: info.links.filter((l) => /company-search\/glass\/C1--CP_Hebei\/\d+\.html/.test(l.h)).slice(0, 10),
        companyHosts: [...new Set(info.links.map((l) => { try { return new URL(l.h).hostname; } catch { return ''; } }).filter((h) => /\.en\.made-in-china\.com$/.test(h)))].slice(0, 15),
      });
    } catch (e) {
      rec.error = String((e && e.stack) || e);
    } finally {
      results.push(rec);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
} catch (e) {
  results.push({ fatal: String((e && e.stack) || e) });
} finally {
  if (ctx) await ctx.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'probe6-result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
