// Probe 10: human-assisted session. Opens a VISIBLE browser; you solve the Focus Captcha (and optionally sign in).
// After the session is usable it verifies: city SEO page, city page 2, deep province page, region-only routes.
// Run: HUMAN_WAIT=900 ~/cloak-env/bin/cloak-run node recon/scripts/probe10-human.mjs
import fs from 'node:fs';
import path from 'node:path';
import { launchPersistentContext } from 'cloakbrowser';

const ROOT = '/home/songqian/mic-client';
const OUT = path.join(ROOT, 'recon/artifacts/probe10');
const PROFILE = process.env.PROFILE_DIR || path.join(ROOT, '.profile-live');
fs.mkdirSync(OUT, { recursive: true });
const HUMAN_WAIT = parseInt(process.env.HUMAN_WAIT || '900', 10);
const LOGIN_GRACE = parseInt(process.env.LOGIN_GRACE || '90', 10);
const LOG = (...a) => console.log('[probe10]', ...a);

async function captchaState(page) {
  try {
    const url = page.url();
    if (/captcha\.made-in-china\.com/.test(url)) return 'captcha';
    const title = await page.title().catch(() => '');
    if (/Focus Captcha/i.test(title)) return 'captcha';
    const txt = await page.evaluate(() => (document.body?.innerText || '').slice(0, 400)).catch(() => '');
    if (/Swipe right|not a robot/i.test(txt)) return 'captcha';
    if (/login\.made-in-china\.com/.test(url)) return 'login';
    return 'ok';
  } catch {
    return 'ok';
  }
}

async function humanWait(page, why) {
  LOG(`HUMAN_ACTION_REQUIRED (${why}) — 请在浏览器窗口中完成滑块验证/登录；等待中…`);
  const deadline = Date.now() + HUMAN_WAIT * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000);
    const st = await captchaState(page);
    if (st === 'ok') {
      LOG('session looks ok');
      return true;
    }
  }
  return false;
}

async function bodyText(page) {
  for (let i = 0; i < 4; i++) {
    try { return await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ')); } catch { await page.waitForTimeout(1500); }
  }
  return '';
}

async function waitForText(page, needles, ms = 40000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const st = await captchaState(page);
    if (st === 'captcha') return { captcha: true };
    const t = await bodyText(page);
    if (needles.some((n) => t.includes(n))) return { found: true, text: t };
    await page.waitForTimeout(2000);
  }
  return { found: false };
}

async function snap(page, name) {
  fs.writeFileSync(path.join(OUT, name + '.html'), await page.content());
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  const info = await page.evaluate(() => {
    const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ');
    const rows = [...document.querySelectorAll('.list-node')].map((n) => n.innerText.replace(/\s+/g, ' ').slice(0, 500));
    const cityProvince = [...document.querySelectorAll('td.subject')].length;
    return {
      title: document.title,
      url: location.href,
      listNodes: rows.length,
      rows: rows.slice(0, 6),
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 6000),
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
  await page.waitForTimeout(5000);
  LOG('home title:', await page.title().catch(() => '?'));
  LOG('WINDOW OPEN — 请看到弹出窗口后：1) 完成滑块验证（如出现）2) 建议顺手登录 MIC 账号 3) 完成后保持窗口即可');

  if ((await captchaState(page)) === 'captcha') {
    const ok = await humanWait(page, 'focus captcha on homepage');
    results.push({ step: 'human-captcha', ok });
    if (!ok) throw new Error('human verification timeout');
  }
  LOG(`SESSION OK — giving ${LOGIN_GRACE}s for optional login (请现在登录；不登录也会继续)`);
  await page.waitForTimeout(LOGIN_GRACE * 1000);
  LOG('continue with verification pages');

  const steps = [
    { name: 'city-langfang-p1', url: 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei--CC_Hebei_Langfang/1.html', waits: ['Main Products', 'Supplier List'] },
    { name: 'city-langfang-p2', url: 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei--CC_Hebei_Langfang/2.html', waits: ['Main Products'] },
    { name: 'province-hebei-p10', url: 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei/10.html', waits: ['Main Products'] },
    { name: 'region-only-cp', url: 'https://www.made-in-china.com/company-search/CP_Hebei/1.html', waits: ['Main Products', 'Supplier List'] },
    { name: 'region-only-hebei', url: 'https://www.made-in-china.com/company-search/hebei/1.html', waits: ['Main Products', 'Supplier List'] },
  ];

  for (const step of steps) {
    const rec = { name: step.name, url: step.url, ok: false };
    try {
      await page.goto(step.url, { waitUntil: 'load', timeout: 90000 }).catch((e) => (rec.gotoWarn = String(e).slice(0, 160)));
      const r = await waitForText(page, step.waits, 45000);
      if (r.captcha) {
        const ok = await humanWait(page, 'captcha on ' + step.name);
        rec.humanPassed = ok;
        if (ok) await waitForText(page, step.waits, 30000);
      }
      await page.waitForTimeout(3000);
      if ((await captchaState(page)) === 'captcha') {
        const ok = await humanWait(page, 'captcha 2 on ' + step.name);
        rec.humanPassed2 = ok;
      }
      const info = await snap(page, step.name);
      Object.assign(rec, {
        ok: true,
        title: info.title,
        finalUrl: info.url,
        listNodes: info.listNodes,
        rows: info.rows,
        bodyHead: info.body.slice(0, 700),
      });
    } catch (e) {
      rec.error = String((e && e.stack) || e);
    } finally {
      results.push(rec);
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  fs.writeFileSync(path.join(OUT, 'storage-state.json'), JSON.stringify(await ctx.storageState(), null, 2));
  fs.writeFileSync(path.join(OUT, 'cookies.json'), JSON.stringify(await ctx.cookies(), null, 2));
  LOG('saved storage state');
} catch (e) {
  results.push({ step: 'fatal', error: String((e && e.stack) || e) });
  console.log('PROBE10_FATAL', String(e).slice(0, 300));
} finally {
  if (ctx) await ctx.close().catch(() => {});
  fs.writeFileSync(path.join(OUT, 'probe10-result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
