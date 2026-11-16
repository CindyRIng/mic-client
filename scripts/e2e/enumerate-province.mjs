#!/usr/bin/env node
/**
 * Enumerate a province by sweeping the province keyword plus every known
 * prefecture-level city keyword (all with the server-side `province` filter),
 * then union + dedupe the accounts.
 *
 * Why: MIC's JSON search requires a `word`. A single province-keyword query only
 * matches profiles that mention the province name (e.g. Hebei -> 1101), while the
 * eleven city keywords cover ~4.4k Hebei suppliers. This script measures coverage,
 * per-query totals/pages and cold/cached wall time.
 *
 * Usage:
 *   node scripts/e2e/enumerate-province.mjs --province Hebei
 *   node scripts/e2e/enumerate-province.mjs --province 河北 --concurrency 6 --out /tmp/hebei-enum
 *
 * Notes:
 * - Pages are fetched with `--concurrency` pipelining (rate limiter still spaces
 *   request starts; see README “性能实测与调优”).
 * - Re-running with the same MIC_DATA_DIR is cache-first (near-instant).
 * - Outputs: <out>/summary.json and <out>/union.ndjson (account-level records).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createContext, closeContext } from '../../dist/core/container.js';
import { allProvinces, matchProvince } from '../../dist/core/regions/dict.js';

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const provinceInput = arg('province', 'Hebei');
const concurrency = Math.max(1, Math.min(8, Number(arg('concurrency', '6'))));
const outDir = arg('out', path.join(os.tmpdir(), 'mic-enumerate-' + provinceInput.toLowerCase().replace(/\W+/g, '-')));
const dataDir = arg('data-dir', path.join(outDir, 'data'));
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const province = matchProvince(provinceInput);
if (!province) {
  console.error(`unknown province: ${provinceInput}; known: ${allProvinces().map((p) => p.name).join(', ')}`);
  process.exit(2);
}
const kw = (s) => s.toLowerCase();
const cityKeywords = province.cities.map((c) => kw(c.name));
const now = () => Date.now();

const ctx = createContext({
  configOverrides: {
    data_dir: dataDir,
    upstream: { queue_max_wait_ms: 300000 },
    log_level: 'error',
  },
  jsonLogs: false,
});

const accounts = new Map(); // account -> item
const keywordHits = new Map(); // account -> Set(keyword)
const ads = new Set();
const perQuery = [];
const warnings = {};

function absorb(res, keyword) {
  for (const w of res.meta.warnings ?? []) {
    const k = w.code + '|' + (w.details?.reason ?? '');
    warnings[k] = (warnings[k] ?? 0) + 1;
  }
  for (const it of res.data.items) {
    if (it.province !== province.name) continue;
    if (!accounts.has(it.account)) accounts.set(it.account, it);
    if (!keywordHits.has(it.account)) keywordHits.set(it.account, new Set());
    keywordHits.get(it.account).add(keyword);
    if (it.is_ad) ads.add(it.account);
  }
}

async function sweep(label, keyword) {
  const started = now();
  const first = await ctx.search.search({ keyword, province: province.name, page: 1 });
  const p0 = first.data.pagination;
  absorb(first, label);
  const pages = Array.from({ length: Math.max(0, p0.total_page - 1) }, (_, i) => i + 2);
  let fetched = 1;
  for (let i = 0; i < pages.length; i += concurrency) {
    const chunk = pages.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map((page) => ctx.search.search({ keyword, province: province.name, page })),
    );
    for (const r of results) {
      absorb(r, label);
      fetched++;
    }
    if (fetched % 20 === 0 || i + concurrency >= pages.length) {
      process.stderr.write(`  ${label}: ${fetched}/${p0.total_page} pages\n`);
    }
  }
  const entry = {
    keyword,
    label,
    total: p0.total,
    total_page: p0.total_page,
    total_capped: p0.total_capped,
    fetched_pages: fetched,
    fetched_items: p0.total,
    ms: now() - started,
  };
  perQuery.push(entry);
  console.log(JSON.stringify(entry));
  return entry;
}

console.log(`province=${province.name} cities=${province.cities.length} concurrency=${concurrency} data=${dataDir}`);
const startedAll = now();
await sweep('province', kw(province.api_value || province.name));
for (const city of province.cities) await sweep(kw(city.name), kw(city.name));

const all = [...accounts.values()];
const cityDistribution = {};
for (const it of all) cityDistribution[it.city ?? 'null'] = (cityDistribution[it.city ?? 'null'] ?? 0) + 1;
const tiers = {};
for (const it of all) tiers[it.membership?.tier ?? 'unknown'] = (tiers[it.membership?.tier ?? 'unknown'] ?? 0) + 1;
const onlyProvince = all.filter((it) => {
  const s = keywordHits.get(it.account);
  return s && s.size === 1 && s.has('province');
});
const summary = {
  generated_at: new Date().toISOString(),
  province: province.name,
  province_zh: province.name_zh,
  city_keywords: cityKeywords,
  city_dictionary_complete: province.cities_complete,
  concurrency,
  cold_wall_ms: now() - startedAll,
  per_query: perQuery,
  query_totals_sum: perQuery.reduce((a, b) => a + b.total, 0),
  union_unique_accounts: all.length,
  union_non_ad_accounts: all.length - ads.size,
  ad_accounts: ads.size,
  only_in_province_query: onlyProvince.length,
  accounts_matched_by_multiple_keywords: all.filter((it) => (keywordHits.get(it.account)?.size ?? 0) > 1).length,
  city_distribution: cityDistribution,
  membership_tiers: tiers,
  warnings,
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(
  path.join(outDir, 'union.ndjson'),
  all
    .map((it) =>
      JSON.stringify({
        account: it.account,
        company_name: it.company_name,
        province: it.province,
        city: it.city,
        membership: it.membership?.tier ?? 'unknown',
        audited: it.audited,
        is_ad: it.is_ad,
      }),
    )
    .join('\n') + '\n',
);
console.log('--- summary ---');
console.log(JSON.stringify({ ...summary, per_query: undefined }, null, 2));
console.log(`outputs: ${outDir}/summary.json ${outDir}/union.ndjson`);
closeContext(ctx);
