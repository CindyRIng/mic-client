#!/usr/bin/env node
/**
 * Bulk-fetch company details for a large account list (e.g. the output of
 * scripts/e2e/enumerate-province.mjs union.ndjson).
 *
 * Strategy (see README “批量详情性能”):
 * - company info.html is consistently behind EdgeOne for the HTTP channel, so the
 *   browser path is used directly for bulk (no wasted HTTP challenge per account);
 * - one browser session, resource blocking (images/fonts/css/analytics), page reuse,
 *   optional 1-4 tabs; CAPTCHA auto-solve still applies;
 * - each rendered HTML goes through CompanyService.get({ prefetched_html }) so the
 *   normal parsing / membership merge / SQLite cache / availability logic is reused;
 * - cached company_details rows are skipped (resumable); include defaults to none
 *   (SGS/reply/contacts/reviews would add 2+ upstream calls per company).
 *
 * Usage:
 *   node scripts/e2e/fetch-company-details.mjs \
 *     --input /tmp/hebei-enum2/union.ndjson --out /tmp/company-details \
 *     --tabs 2 --limit 100
 *
 * Outputs: <out>/summary.json, results.ndjson, failures.json
 * Env: uses ~/.mic-client profile (browser) and <out>/data for SQLite unless
 *      --data-dir is given; cache makes reruns near-instant.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createContext, closeContext } from '../../dist/core/container.js';
import { fetchCompanyHtmlBatch, closeBrowserSession } from '../../dist/core/session/browser.js';
import { AppError } from '../../dist/core/errors.js';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const flag = (name) => process.argv.includes('--' + name);
const input = arg('input', '');
if (!input) {
  console.error('usage: fetch-company-details.mjs --input union.ndjson [--out dir] [--limit N] [--offset N] [--tabs 1-4] [--data-dir d] [--refresh]');
  process.exit(2);
}
const outDir = arg('out', path.join(process.cwd(), 'company-details-out'));
const dataDir = arg('data-dir', path.join(outDir, 'data'));
const tabs = Math.max(1, Math.min(4, Number(arg('tabs', '1'))));
const timeoutPerUrlMs = Math.max(8000, Number(arg('timeout', '30000')));
const limit = Number(arg('limit', '0'));
const offset = Number(arg('offset', '0'));
const chunkSize = Math.max(10, Math.min(500, Number(arg('chunk', '120'))));
const retries = Math.max(0, Math.min(2, Number(arg('retries', '1'))));
const refresh = flag('refresh');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const rows = fs
  .readFileSync(input, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.trim())
  .map((line) => {
    try {
      const obj = JSON.parse(line);
      return { account: String(obj.account ?? obj), title: obj.company_name ?? null };
    } catch {
      return { account: line, title: null };
    }
  })
  .filter((r) => r.account);
const selected = rows.slice(offset, limit > 0 ? offset + limit : undefined);
console.log(JSON.stringify({ input, rows: rows.length, selected: selected.length, tabs, offset, limit, dataDir }));

const ctx = createContext({
  configOverrides: { data_dir: dataDir, log_level: 'error', upstream: { queue_max_wait_ms: 300000 } },
  jsonLogs: false,
});
const db = ctx.cache.db;
const detailStmt = db.prepare('SELECT expires_at FROM company_details WHERE account = ?');
const nowS = () => Math.floor(Date.now() / 1000);
const isFresh = (account) => {
  try {
    const row = detailStmt.get(account);
    return Boolean(row && row.expires_at > nowS());
  } catch {
    return false;
  }
};

const pending = refresh ? [...selected] : selected.filter((r) => !isFresh(r.account));
const cachedSkipped = selected.length - pending.length;
const startedAll = Date.now();
const results = [];
const failures = [];
let mobile = 0;
let desktop = 0;
let fetched = 0;
let fetchMs = 0;

const resultsPath = path.join(outDir, 'results.ndjson');
fs.writeFileSync(resultsPath, '');

for (let i = 0; i < pending.length; i += chunkSize) {
  const chunk = pending.slice(i, i + chunkSize);
  const urls = chunk.map((r) => `https://m.made-in-china.com/company-${r.account}/info.html`);
  process.stderr.write(`[fetch] chunk ${Math.floor(i / chunkSize) + 1}: ${chunk.length} accounts (tabs=${tabs})\n`);
  const chunkStart = Date.now();
  const htmls = await fetchCompanyHtmlBatch(urls, ctx.cfg, ctx.logger, { tabs, timeoutPerUrlMs: timeoutPerUrlMs });
  fetchMs += Date.now() - chunkStart;
  for (let j = 0; j < chunk.length; j++) {
    const row = chunk[j];
    const got = htmls[j];
    if (!got || !got.ok) {
      failures.push({ account: row.account, stage: 'fetch', error: got?.error ?? 'UNKNOWN', ms: got?.ms ?? null });
      continue;
    }
    fetched++;
    const kind = got.html.includes('ssrData') ? 'mobile' : 'desktop';
    kind === 'mobile' ? mobile++ : desktop++;
    const t = Date.now();
    try {
      const res = await ctx.company.get({
        account: row.account,
        include: 'none',
        prefetched_html: got.html,
        request_id: `bulk_${row.account}`,
      });
      const d = res.data;
      const rec = {
        account: row.account,
        ok: true,
        kind,
        company_name: d.company_name,
        province: d.province,
        city: d.city,
        membership_tier: d.membership.tier,
        since_year: d.membership.since_year,
        established_at: d.established_at,
        employees: d.employees,
        main_products: d.main_products.length,
        audited: d.audited,
        source: res.meta.source,
        fetch_ms: got.ms,
        persist_ms: Date.now() - t,
      };
      results.push(rec);
      fs.appendFileSync(resultsPath, JSON.stringify(rec) + '\n');
      if (results.length % 25 === 0) {
        process.stderr.write(`[progress] ${results.length}/${pending.length} ok=${results.length} fail=${failures.length}\n`);
      }
    } catch (e) {
      failures.push({
        account: row.account,
        stage: 'persist',
        kind,
        error: e instanceof AppError ? e.code : String(e?.message ?? e).slice(0, 120),
        ms: Date.now() - t,
      });
    }
  }
  process.stderr.write(
    `[chunk] done ${Math.min(i + chunkSize, pending.length)}/${pending.length}; ok=${results.length} fail=${failures.length}\n`,
  );
}

// ---- retry failures once (fresh page/tab) ----
let retried = 0;
if (retries > 0 && failures.length > 0) {
  const retryList = failures.splice(0, failures.length);
  process.stderr.write(`[retry] ${retryList.length} failed account(s), retries=${retries}\n`);
  for (let i = 0; i < retryList.length; i += Math.max(1, chunkSize)) {
    const chunk = retryList.slice(i, i + Math.max(1, chunkSize));
    const urls = chunk.map((r) => `https://m.made-in-china.com/company-${r.account}/info.html`);
    const htmls = await fetchCompanyHtmlBatch(urls, ctx.cfg, ctx.logger, { tabs: 1, timeoutPerUrlMs: timeoutPerUrlMs });
    for (let j = 0; j < chunk.length; j++) {
      const old = chunk[j];
      const got = htmls[j];
      retried++;
      if (!got || !got.ok) {
        failures.push({ ...old, retried: true, error: got?.error ?? old.error });
        continue;
      }
      try {
        const res = await ctx.company.get({
          account: old.account,
          include: 'none',
          prefetched_html: got.html,
          request_id: `bulk_retry_${old.account}`,
        });
        const d = res.data;
        const kind = got.html.includes('ssrData') ? 'mobile' : 'desktop';
        kind === 'mobile' ? mobile++ : desktop++;
        fetched++;
        const rec = {
          account: old.account,
          ok: true,
          kind,
          company_name: d.company_name,
          province: d.province,
          city: d.city,
          membership_tier: d.membership.tier,
          since_year: d.membership.since_year,
          established_at: d.established_at,
          employees: d.employees,
          main_products: d.main_products.length,
          audited: d.audited,
          source: res.meta.source,
          fetch_ms: got.ms,
          persist_ms: 0,
          retried: true,
        };
        results.push(rec);
        fs.appendFileSync(resultsPath, JSON.stringify(rec) + '\n');
      } catch (e) {
        failures.push({
          account: old.account,
          stage: 'persist',
          error: e instanceof AppError ? e.code : String(e?.message ?? e).slice(0, 120),
          retried: true,
        });
      }
    }
  }
}

const wallMs = Date.now() - startedAll;
const avgPer = fetched ? Math.round((fetchMs + results.reduce((a, r) => a + (r.persist_ms ?? 0), 0)) / fetched) : null;
const summary = {
  generated_at: new Date().toISOString(),
  input,
  selected: selected.length,
  cached_skipped: cachedSkipped,
  attempted: pending.length,
  fetched_ok: results.length,
  retried,
  failed: failures.length,
  mobile_pages: mobile,
  desktop_pages: desktop,
  tabs,
  wall_ms: wallMs,
  fetch_wall_ms: fetchMs,
  avg_ms_per_company: avgPer,
  throughput_per_s: fetched ? Number((fetched / (wallMs / 1000)).toFixed(2)) : 0,
  eta_5000_minutes: avgPer ? Number(((avgPer * 5000) / 1000 / 60).toFixed(1)) : null,
  membership: results.reduce((acc, r) => {
    acc[r.membership_tier] = (acc[r.membership_tier] ?? 0) + 1;
    return acc;
  }, {}),
  availability: {
    established_at: results.filter((r) => r.established_at).length,
    employees: results.filter((r) => r.employees !== null).length,
    main_products: results.filter((r) => r.main_products > 0).length,
  },
  failures,
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(outDir, 'failures.json'), JSON.stringify(failures, null, 2));
console.log('--- summary ---');
console.log(JSON.stringify({ ...summary, failures: undefined }, null, 2));
console.log(`outputs: ${outDir}/summary.json ${resultsPath} ${outDir}/failures.json`);
closeContext(ctx);
await closeBrowserSession();
