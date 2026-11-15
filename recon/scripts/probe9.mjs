// Probe 9: city-level SEO page verification + deep pagination + region-only route probe.
// Run: ~/cloak-env/bin/cloak-run node recon/scripts/probe9.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/probe9');
const PROFILE = process.env.PROFILE_DIR || path.join(ROOT, '.profile-live');
fs.mkdirSync(OUT, { recursive: true });

const STEPS = [
  { name: 'city-langfang-p1', url: 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei--CC_Hebei_Langfang/1.html', waitFor: ['Main Products', 'Supplier List'] },
  { name: 'city-langfang-p2', url: 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei--CC_Hebei_Langfang/2.html', waitFor: ['Main Products'] },
  { name: 'province-hebei-p10', url: 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei/10.html', waitFor: ['Main Products'] },
  { name: 'region-only-cp', url: 'https://www.made-in-china.com/company-search/CP_Hebei/1.html', waitFor: ['Main Products'] },
  { name: 'region-only-hebei-word', url: 'https://www.made-in-china.com/company-search/hebei/1.html', waitFor: ['Main Products'] },
];

const log = (...a) => console.log('[probe9]', ...a);

async function bodyText(page) {
  for (let i = 0; i < 4; i++) {
    try {
      return await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' '));
    } catch { await page.waitForTimeout(1500); }
  }
  return '';
}
async function isCaptcha(page) {
  try {
    if (/captcha\.made-in-china\.com/.test(page.url())) return true;
    if (/Focus Captcha/i.test(await page.title())) return true;
    const t = await page.evaluate(() => (document.body?.innerText || '').slice(0, 400));
    return /Swipe right|not a robot/i.test(t);
  } catch { return false; }
}
async function waitForText(page, needles, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await isCaptcha(page)) return { captcha: true };
    const t = await bodyText(page);
    if (needles.some((n) => t.includes(n))) return { found: true, text: t };
    await page.waitForTimeout(2000);
  }
  return { found: false };
}

async function snap(page, name) {
  const html = await page.content();
  fs.writeFileSync(path.join(OUT, name + '.html'), html);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  const info = await page.evaluate(() => {
    const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ');
    const rows = [...document.querySelectorAll('.list-node')].map((n) => n.innerText.replace(/\s+/g, ' ').slice(0, 400));
    return {
      title: document.title,
      url: location.href,
      listNodes: rows.length,
      rows: rows.slice(0, 5),
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 4000),
      cityTexts: [...new Set((document.body?.innerText || '').match(/[A-Za-z ]+, (?:Hebei|Guangdong|Zhejiang|Jiangsu|Shandong)/g) || [])].slice(0, 20),
      pageLinks: [...new Set([...document.querySelectorAll('a[href*="company-search"]')].map((a) => a.href))].slice(0, 40),
    };
  });
  fs.writeFileSync(path.join(OUT, name + '-info.json'), JSON.stringify(info, null, 2));
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
  await page.goto('https://www.made-in-china.com/', { waitUntil: 'load', timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(4000);
  log('warm:', await page.title().catch(() => '?'));
  if (await isCaptcha(page)) log('WARMUP_CAPTCHA');

  for (const step of STEPS) {
    const rec = { name: step.name, url: step.url, ok: false };
    try {
      await page.goto(step.url, { waitUntil: 'load', timeout: 90000 }).catch((e) => (rec.gotoWarn = String(e).slice(0, 160)));
      const r = await waitForText(page, step.waitFor, 35000);
      rec.captchaDuring = !!r.captcha;
      if (r.captcha) {
        // do not block here: record and move on (human not available mid-run)
        rec.blockedByCaptcha = true;
      }
      await page.waitForTimeout(3000);
      const info = await snap(page, step.name);
      Object.assign(rec, {
        ok: true,
        title: info.title,
        finalUrl: info.url,
        listNodes: info.listNodes,
        rows: info.rows,
        cityTexts: info.cityTexts,
        pageLinks: info.pageLinks.slice(0, 12),
        bodyHead: info.body.slice(0, 600),
      });
    } catch (e) {
      rec.error = String((e && e.stack) || e);
    } finally {
      results.push(rec);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  fs.writeFileSync(path.join(OUT, 'storage-state.json'), JSON.stringify(await ctx.storageState(), null, 2));
} catch (e) {
  results.push({ fatal: String((e && e.stack) || e) });
} finally {
  if (ctx) await ctx.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'probe9-result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
