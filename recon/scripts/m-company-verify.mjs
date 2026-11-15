// Verify mobile-site (m.made-in-china.com) company detail SSR JSON via the verified browser session.
// Run: PROFILE_DIR=/home/songqian/mic-client/.profile-captcha-t2 ~/cloak-env/bin/cloak-run node recon/scripts/m-company-verify.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/m-company');
const PROFILE = process.env.PROFILE_DIR || path.join(ROOT, '.profile-captcha-t2');
fs.mkdirSync(OUT, { recursive: true });

const ACCOUNTS = ['xingchenglass', 'hnfinsulation'];
const results = [];
let ctx;
try {
  ctx = await launchPersistentContext({
    userDataDir: PROFILE,
    headless: true,
    viewport: { width: 430, height: 900 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(60000);
  await page.goto('https://m.made-in-china.com/', { waitUntil: 'load', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(3000);
  results.push({ step: 'm-home', title: await page.title().catch(() => '?') });

  for (const acc of ACCOUNTS) {
    const url = `https://m.made-in-china.com/company-${acc}/info.html`;
    const rec = { account: acc, url, ok: false };
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 90000 });
      await page.waitForTimeout(4000);
      const data = await page.evaluate(() => {
        const el = document.querySelector('script#ssrData');
        const body = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 3000);
        return {
          title: document.title,
          url: location.href,
          hasSsr: !!el,
          ssr: el ? el.textContent : null,
          body,
          captcha: /not a robot|Swipe right/i.test(document.body?.innerText || '') || /captcha/.test(location.href),
        };
      });
      if (data.captcha) {
        // try auto-solve once via the same technique (imported inline to keep this probe small)
        rec.captcha = true;
      }
      if (data.ssr) {
        const json = JSON.parse(data.ssr);
        fs.writeFileSync(path.join(OUT, acc + '-ssrData.json'), JSON.stringify(json, null, 2));
        const ci = json.companyInfo?.content || {};
        Object.assign(rec, {
          ok: true,
          memberLevel: ci.memberLevel,
          memberSince: ci.memberSince,
          sgsMember: ci.sgsMember,
          establishment: ci.establishment,
          mainProducts: (ci.mainProducts || []).slice(0, 6),
          rating: ci.reviewStatistics?.rating,
          stars: ci.companySymbol?.stars,
          keys: Object.keys(ci).slice(0, 40),
        });
      } else {
        rec.bodyHead = data.body.slice(0, 400);
      }
    } catch (e) {
      rec.error = String((e && e.stack) || e).slice(0, 300);
    }
    results.push(rec);
    await page.waitForTimeout(2500);
  }
  fs.writeFileSync(path.join(OUT, 'storage-state.json'), JSON.stringify(await ctx.storageState(), null, 2));
} finally {
  if (ctx) await ctx.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2).slice(0, 5000));
}
