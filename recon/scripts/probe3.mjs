// Probe 3: supplier search (companysearch.do), region directory, company detail retry.
// Run: ~/cloak-env/bin/cloak-run node recon/scripts/probe3.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/probe3');
const PROFILE = path.join(ROOT, '.profile');
fs.mkdirSync(OUT, { recursive: true });
const HEADLESS = process.env.HEADLESS !== '0';

const TARGETS = [
  {
    name: 'supplier-search-glass',
    url: 'https://www.made-in-china.com/companysearch.do?subaction=hunt&mode=and&code=0&style=b&isOpenCorrection=1&word=glass&comProvice=nolimit',
  },
  { name: 'region-directory', url: 'https://www.made-in-china.com/region/' },
  { name: 'company-hebei-xingchen', url: 'https://hebei-xingchen.en.made-in-china.com/' },
];

async function robustEvaluate(page, fn, label) {
  for (let i = 0; i < 4; i++) {
    try {
      return await page.evaluate(fn);
    } catch (e) {
      if (!/context was destroyed|navigat/i.test(String(e))) throw e;
      await page.waitForTimeout(2000);
    }
  }
  throw new Error('evaluate failed after retries: ' + label);
}

async function summarize(page) {
  return robustEvaluate(page, () => {
    const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ');
    const links = [...document.querySelectorAll('a[href]')].map((a) => ({ t: txt(a).slice(0, 120), h: a.href }));
    const seen = new Set();
    const uniq = links.filter((x) => (seen.has(x.h) ? false : (seen.add(x.h), true)));
    return {
      title: document.title,
      url: location.href,
      h1: [...document.querySelectorAll('h1')].map(txt).slice(0, 10),
      h2: [...document.querySelectorAll('h2')].map(txt).slice(0, 30),
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 12000),
      links: uniq.slice(0, 1200),
    };
  }, 'summary');
}

function netAttach(page, bucket) {
  page.on('response', async (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (['image', 'font', 'media', 'stylesheet'].includes(type)) return;
    const ct = res.headers()['content-type'] || '';
    const rec = { status: res.status(), url: res.url(), type, ct };
    if (/json/i.test(ct) && !/\.js(\?|$)/.test(res.url())) {
      try {
        const body = await res.text();
        rec.bodySample = body.slice(0, 4000);
      } catch {}
    }
    bucket.responses.push(rec);
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
      const resp = await page.goto(target.url, { waitUntil: 'load', timeout: 60000 }).catch((e) => ({ error: String(e) }));
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(target.name.startsWith('company') ? 9000 : 5000);
      const info = await summarize(page);
      fs.writeFileSync(path.join(OUT, target.name + '.html'), await page.content());
      await page.screenshot({ path: path.join(OUT, target.name + '.png') });
      fs.writeFileSync(path.join(OUT, target.name + '-net.json'), JSON.stringify(bucket, null, 2));
      fs.writeFileSync(path.join(OUT, target.name + '-info.json'), JSON.stringify(info, null, 2));
      const memberMentions = [...new Set(info.body.match(/(Diamond|Gold|Silver|Bronze)\s*Member|Audited\s*Supplier|Leading\s*Factory|Verified\s*Supplier/gi) || [])];
      Object.assign(rec, {
        ok: true,
        status: resp?.status?.(),
        title: info.title,
        finalUrl: info.url,
        h1: info.h1,
        h2: info.h2,
        linkCount: info.links.length,
        memberMentions,
        bodyHead: info.body.slice(0, 2500),
      });
    } catch (e) {
      rec.error = String((e && e.stack) || e);
    } finally {
      results.push(rec);
      await page.close().catch(() => {});
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
} catch (e) {
  results.push({ fatal: String((e && e.stack) || e) });
} finally {
  if (ctx) await ctx.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'probe3-result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
