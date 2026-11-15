// Probe 2: static reconnaissance of supplier directory / product search variants / company page.
// Run: ~/cloak-env/bin/cloak-run node recon/scripts/probe2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/probe2');
const PROFILE = path.join(ROOT, '.profile');
fs.mkdirSync(OUT, { recursive: true });
const HEADLESS = process.env.HEADLESS !== '0';

const BASE = 'https://www.made-in-china.com/productdirectory.do?word=glass&file=&searchType=';
const TAIL = '&subaction=hunt&style=b&mode=and&code=0&comProvince=nolimit&order=0&isOpenCorrection=1&org=top';

const TARGETS = [
  { name: 'suppliers-discovery', url: 'https://www.made-in-china.com/suppliers-discovery/' },
  { name: 'prod-search-glass-type0', url: BASE + '0' + TAIL },
  { name: 'prod-search-glass-type1', url: BASE + '1' + TAIL },
  { name: 'company-xingchen', url: 'https://hebei-xingchen.en.made-in-china.com/' },
];

async function summarize(page) {
  return page.evaluate(() => {
    const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ');
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({ t: txt(a).slice(0, 100), h: a.href }));
    const seen = new Set();
    const uniq = links.filter((x) => (seen.has(x.h) ? false : (seen.add(x.h), true)));
    return {
      title: document.title,
      url: location.href,
      h1: [...document.querySelectorAll('h1')].map(txt).slice(0, 10),
      h2: [...document.querySelectorAll('h2')].map(txt).slice(0, 30),
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 6000),
      links: uniq.slice(0, 800),
    };
  });
}

function netAttach(page, bucket) {
  page.on('response', (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(type)) return;
    bucket.responses.push({ status: res.status(), url: res.url(), type, ct: res.headers()['content-type'] || '' });
  });
  page.on('requestfailed', (req) => bucket.failed.push({ url: req.url(), type: req.resourceType() }));
}

let ctx;
const results = [];
try {
  ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: HEADLESS,
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  });

  for (const target of TARGETS) {
    const page = await ctx.newPage();
    page.setDefaultTimeout(45000);
    const bucket = { responses: [], failed: [] };
    netAttach(page, bucket);
    const rec = { name: target.name, url: target.url, ok: false };
    try {
      const resp = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(5000);
      const info = await summarize(page);
      fs.writeFileSync(path.join(OUT, target.name + '.html'), await page.content());
      await page.screenshot({ path: path.join(OUT, target.name + '.png') });
      fs.writeFileSync(path.join(OUT, target.name + '-net.json'), JSON.stringify(bucket, null, 2));
      fs.writeFileSync(path.join(OUT, target.name + '-info.json'), JSON.stringify(info, null, 2));

      const provinceLinks = info.links.filter((l) => /comProvince|province|region/i.test(l.h + ' ' + l.t));
      const companyHosts = [...new Set(info.links.map((l) => { try { return new URL(l.h).hostname; } catch { return ''; } }).filter((h) => /\.en\.made-in-china\.com$/.test(h)))];
      const memberMentions = [...new Set((info.body.match(/(Diamond|Gold)\s*Member|Audited\s*Supplier|Verified\s*Supplier/gi) || []))];

      Object.assign(rec, {
        ok: true,
        status: resp?.status(),
        title: info.title,
        finalUrl: info.url,
        h1: info.h1,
        h2: info.h2,
        linkCount: info.links.length,
        companyHostCount: companyHosts.length,
        companyHostsSample: companyHosts.slice(0, 10),
        provinceLinks: provinceLinks.slice(0, 60),
        memberMentions,
        bodyHead: info.body.slice(0, 1200),
      });
    } catch (e) {
      rec.error = String((e && e.stack) || e);
    } finally {
      results.push(rec);
      await page.close().catch(() => {});
    }
  }
} catch (e) {
  results.push({ fatal: String((e && e.stack) || e) });
} finally {
  if (ctx) await ctx.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'probe2-result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
