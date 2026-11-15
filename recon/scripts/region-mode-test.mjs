// Region-mode test: can we do "pure region listing" by using region words as keyword + native filters?
// Uses the verified persistent profile (captcha session already solved).
// Run: PROFILE_DIR=/home/songqian/mic-client/.profile-captcha-t2 ~/cloak-env/bin/cloak-run node recon/scripts/region-mode-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/region-mode');
const PROFILE = process.env.PROFILE_DIR || path.join(ROOT, '.profile-captcha-t2');
fs.mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { name: 'kw-hebei-prov-filter', url: 'https://www.made-in-china.com/company-search/hebei/C1--CP_Hebei/1.html' },
  { name: 'kw-shijiazhuang-prov-filter', url: 'https://www.made-in-china.com/company-search/shijiazhuang/C1--CP_Hebei/1.html' },
  { name: 'kw-langfang-city-filter', url: 'https://www.made-in-china.com/company-search/langfang/C1--CP_Hebei--CC_Hebei_Langfang/1.html' },
  { name: 'kw-hebei-shijiazhuang-city-filter', url: 'https://www.made-in-china.com/company-search/hebei%20shijiazhuang/C1--CP_Hebei--CC_Hebei_Langfang/1.html' },
  { name: 'kw-langfang-city-p2', url: 'https://www.made-in-china.com/company-search/langfang/C1--CP_Hebei--CC_Hebei_Langfang/2.html' },
  { name: 'old-url-companysearch-hebei', url: 'https://www.made-in-china.com/companysearch.do?subaction=hunt&style=b&mode=and&code=0&comProvince=Hebei&order=0&isOpenCorrection=1&word=hebei' },
];

const results = [];
let ctx;
try {
  ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: true,
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(60000);
  await page.goto('https://www.made-in-china.com/', { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(3500);

  for (const t of TARGETS) {
    const rec = { name: t.name, url: t.url, ok: false };
    try {
      await page.goto(t.url, { waitUntil: 'load', timeout: 90000 }).catch((e) => (rec.warn = String(e).slice(0, 120)));
      await page.waitForTimeout(5000);
      const info = await page.evaluate(() => {
        const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ');
        const nodes = [...document.querySelectorAll('.list-node')];
        const cities = [...new Set((document.body?.innerText || '').match(/[A-Za-z' ]+, (?:Hebei|Tianjin|Beijing|Shandong|Guangdong|Zhejiang|Jiangsu|Henan|Shanxi|Shaanxi)/g) || [])];
        return {
          title: document.title,
          url: location.href,
          captcha: /not a robot|Swipe right/i.test(document.body?.innerText || ''),
          listNodes: nodes.length,
          firstRows: nodes.slice(0, 3).map((n) => n.innerText.replace(/\s+/g, ' ').slice(0, 300)),
          cities: cities.slice(0, 12),
          bodyHead: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 500),
          pagination: [...new Set([...document.querySelectorAll('a[href*="company-search"]')].map((a) => a.href).filter((h) => /\/\d+\.html$/.test(h)))].slice(0, 15),
        };
      });
      fs.writeFileSync(path.join(OUT, t.name + '-info.json'), JSON.stringify(info, null, 2));
      await page.screenshot({ path: path.join(OUT, t.name + '.png') });
      Object.assign(rec, { ok: true, ...info, firstRows: info.firstRows });
    } catch (e) {
      rec.error = String((e && e.stack) || e).slice(0, 300);
    }
    results.push(rec);
    console.log(JSON.stringify({ name: rec.name, ok: rec.ok, title: rec.title, listNodes: rec.listNodes, cities: rec.cities, captcha: rec.captcha, error: rec.error }, null, 1));
    await new Promise((r) => setTimeout(r, 2500));
  }
} finally {
  if (ctx) await ctx.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(results, null, 2));
}
