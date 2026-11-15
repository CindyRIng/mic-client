// Experiment: replicate MIC's `__tst_status` JS cookie challenge in Node, then refetch SEO page.
// Run: ~/cloak-env/bin/cloak-run node recon/scripts/challenge.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import https from 'node:https';

const ROOT = '/home/songqian/mic-client';
const state = JSON.parse(fs.readFileSync(path.join(ROOT, 'recon/artifacts/probe8/storage-state.json'), 'utf8'));
const cookieJar = new Map(state.cookies.map((c) => [c.name, c.value]));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.177.5 Safari/537.36';

function cookieHeader() {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function request(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Cookie: cookieHeader(),
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://www.made-in-china.com/',
        ...extraHeaders,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        for (const sc of res.headers['set-cookie'] || []) {
          const m = sc.match(/^\s*([^=]+)=([^;]*)/);
          if (m) cookieJar.set(m[1].trim(), m[2].trim());
        }
        resolve({ status: res.statusCode, url, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const target = process.argv[2] || 'https://www.made-in-china.com/company-search/glass/C1--CP_Hebei/1.html';
const first = await request(target);
console.log('first:', first.status, 'len', first.body.length, 'challenge?', first.body.includes('__tst_status'));

const m = first.body.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.log('no inline script; first 300:', first.body.slice(0, 300));
  process.exit(0);
}
const script = m[1];
const setCookies = [];
const ctx = vm.createContext({
  document: {
    get cookie() { return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join('; '); },
    set cookie(v) { setCookies.push(v); const mm = v.match(/^\s*([^=]+)=([^;]*)/); if (mm) cookieJar.set(mm[1].trim(), mm[2].trim()); },
  },
  location: { href: target, replace: (u) => { console.log('location.replace', u); } },
  setTimeout: (fn) => { try { fn(); } catch (e) { console.log('timeout cb err', String(e)); } },
  console: console,
  window: {},
});
try {
  vm.runInContext(script, ctx, { timeout: 5000 });
} catch (e) {
  console.log('vm error:', String(e).slice(0, 300));
}
console.log('cookies set by script:', setCookies);
console.log('jar now:', [...cookieJar.entries()].map(([k, v]) => `${k}=${v.slice(0, 40)}`));

const second = await request(target);
console.log('second:', second.status, 'len', second.body.length, 'challenge?', second.body.includes('__tst_status'));
const title = second.body.match(/<title>(.*?)<\/title>/s);
console.log('title:', title ? title[1].trim() : '(none)');
fs.mkdirSync(path.join(ROOT, 'recon/artifacts/probe9'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'recon/artifacts/probe9/seo-after-challenge.html'), second.body);
