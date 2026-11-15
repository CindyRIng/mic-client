import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import {
  envelope,
  fail,
  formatTable,
  printJson,
  useJson,
  withContext,
  type AppContext,
} from '../output.js';
import type { SearchInput, SearchResponse } from '../../../core/search/service.js';
import { AppError } from '../../../core/errors.js';
import { newRequestId } from '../../../core/logger.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('search supplier factories by keyword and/or region (province/city)')
    .option('--keyword <kw>', 'English keyword (region words like hebei/langfang work too)')
    .option('--province <name>', 'province (English or Chinese)')
    .option('--city <name>', 'city (English or Chinese; requires or infers province)')
    .option('--page <n>', 'page number (1-100)', '1')
    .option('--page-size <n>', 'page size (1-100, default 20)', '20')
    .option('--pages <spec>', 'multi-page spec for NDJSON streaming: 1 | 2-5 | 1,3,5 | all')
    .option('--category-code <code>', 'upstream category code, e.g. 1500000000')
    .option('--membership-tier <tier>', 'diamond|gold')
    .option('--audited', 'only audited suppliers (client-side filter)')
    .option('--management-certification <code>', 'upstream certification code, e.g. -5')
    .option('--business-type <type>', 'manufacturer|trading_company|group_corporation|other')
    .option('--annual-revenue <bucket>', 'under_1m_usd|1m_2_5m_usd|2_5m_5m_usd|5m_10m_usd|10m_50m_usd|50m_100m_usd|over_100m_usd')
    .option('--rd-capacity <cap>', 'oem|odm|quick_response|fast_delivery|small_amount_payment')
    .option('--include-ads', 'keep advertisement items in table output', false)
    .option('--exclude-ads', 'filter advertisement items (include_ads=false)')
    .action(async (cmdOpts) => {
      const opts = program.opts<GlobalOptions>();
      try {
        const input: SearchInput = {
          keyword: cmdOpts.keyword,
          province: cmdOpts.province,
          city: cmdOpts.city,
          page: cmdOpts.page,
          page_size: cmdOpts.pageSize,
          category_code: cmdOpts.categoryCode,
          membership_tier: cmdOpts.membershipTier,
          audited: cmdOpts.audited || undefined,
          management_certification: cmdOpts.managementCertification,
          business_type: cmdOpts.businessType,
          annual_revenue: cmdOpts.annualRevenue,
          rd_capacity: cmdOpts.rdCapacity,
          refresh: opts.refresh,
          include_ads: cmdOpts.excludeAds ? false : true,
        };

        if (cmdOpts.pages) {
          if (opts.format !== 'ndjson') {
            throw new AppError('INVALID_PARAM', '--pages requires --format ndjson', {
              param: 'pages',
              reason: 'UNSUPPORTED_FORMAT_COMBO',
            });
          }
          await withContext(opts, async (ctx) => {
            await streamPages(ctx, input, String(cmdOpts.pages), Boolean(cmdOpts.includeAds));
          });
          return;
        }

        const payload = await withContext(opts, async (ctx) => {
          const res = await ctx.search.search(input);
          return envelope(res.data, res.meta);
        });
        if (useJson(opts)) {
          printJson(payload);
          return;
        }
        renderSearchTable(payload, Boolean(cmdOpts.includeAds));
      } catch (e) {
        fail(e);
      }
    });
}

function parsePagesSpec(spec: string, startPage: number): { pages: number[]; limitReached: boolean } {
  const MAX_ALL_PAGES = 10;
  const hardMax = 100;
  const s = spec.trim().toLowerCase();
  if (s === 'all') {
    const pages = Array.from({ length: MAX_ALL_PAGES }, (_, i) => startPage + i).filter((p) => p <= hardMax);
    return { pages, limitReached: true };
  }
  if (/^\d+$/.test(s)) {
    return { pages: [Number(s)], limitReached: false };
  }
  if (/^\d+-\d+$/.test(s)) {
    const [a, b] = s.split('-').map(Number) as [number, number];
    if (a > b) throw new AppError('INVALID_PARAM', 'invalid --pages range', { param: 'pages', reason: 'OUT_OF_RANGE' });
    const pages: number[] = [];
    for (let p = a; p <= Math.min(b, hardMax); p++) pages.push(p);
    return { pages, limitReached: b > hardMax };
  }
  if (/^\d+(,\d+)+$/.test(s)) {
    const pages = [...new Set(s.split(',').map(Number))].sort((a, b) => a - b).filter((p) => p >= 1 && p <= hardMax);
    return { pages, limitReached: false };
  }
  throw new AppError('INVALID_PARAM', 'invalid --pages spec (use 1 | 2-5 | 1,3,5 | all)', {
    param: 'pages',
    reason: 'INVALID_ENUM',
  });
}

async function streamPages(ctx: AppContext, input: SearchInput, spec: string, showAds: boolean): Promise<void> {
  const requestId = newRequestId();
  const started = Date.now();
  const normalized = ctx.search.normalize(input);
  const { pages, limitReached } = parsePagesSpec(spec, normalized.query.page);
  const write = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + '\n');
  write({ type: 'start', command: 'search', request_id: requestId, query: normalized.query });
  let totalItems = 0;
  let anyStale = false;
  let anyWarnings = false;
  const seenPages = new Set<number>();
  let fetchedPages = 0;
  for (const page of pages) {
    if (seenPages.has(page)) break;
    seenPages.add(page);
    const res: SearchResponse = await ctx.search.search({ ...input, page, request_id: requestId });
    const p = res.data.pagination;
    if (p.page !== page && fetchedPages > 0) break; // clamped/duplicate page → stop
    fetchedPages++;
    totalItems += res.data.items.length;
    anyStale = anyStale || res.meta.stale;
    if (res.meta.warnings.length) {
      anyWarnings = true;
      for (const w of res.meta.warnings) write({ type: 'warning', ...w });
    }
    write({
      type: 'page',
      page: p.page,
      pagination: p,
      items: showAds ? res.data.items : res.data.items.filter((i) => !i.is_ad),
      meta: res.meta,
    });
    if (!p.has_more) break;
  }
  if (limitReached) {
    write({
      type: 'warning',
      code: 'PAGE_LIMIT_REACHED',
      message: '--pages all limited to 10 pages',
      details: { limit: 10 },
    });
  }
  write({
    type: 'summary',
    pages: fetchedPages,
    items: totalItems,
    status: anyStale ? 'stale' : anyWarnings ? 'partial' : 'success',
    request_id: requestId,
    duration_ms: Date.now() - started,
  });
}

function renderSearchTable(payload: { data: Record<string, unknown>; meta: { warnings: Array<{ code: string }>; cached: boolean; stale: boolean } }, showAds: boolean): void {
  const data = payload.data as {
    items: Array<{
      company_name: string;
      account: string;
      province: string | null;
      city: string | null;
      main_products: string[];
      membership: { tier: string; since_year: number | null };
      audited: boolean | null;
      capability_stars: number | null;
      is_ad: boolean;
    }>;
    pagination: { page: number; page_size: number; total_display: string; total_page: number; has_more: boolean; total_is_lower_bound: boolean; total_capped: boolean };
    query: { search_mode: string; keyword_effective: string };
  };
  const rows = data.items
    .filter((i) => showAds || !i.is_ad)
    .map((i, idx) => [
      String((data.pagination.page - 1) * data.pagination.page_size + idx + 1),
      i.company_name,
      [i.city, i.province].filter(Boolean).join(', ') || '-',
      i.main_products.slice(0, 3).join(', ') || '-',
      i.membership.tier + (i.membership.since_year ? `(${i.membership.since_year})` : ''),
      i.audited === true ? 'AS' : i.audited === false ? '-' : '?',
      i.capability_stars === null ? '-' : String(i.capability_stars),
      i.is_ad ? 'AD' : '',
    ]);
  const headers = ['#', 'Company', 'Region', 'Main products', 'Tier', 'AS', '★', 'AD'];
  process.stdout.write(formatTable(rows, headers) + '\n');
  const p = data.pagination;
  const hiddenAds = showAds ? 0 : data.items.filter((i) => i.is_ad).length;
  process.stdout.write(
    `\npage ${p.page}/${p.total_page}  total ${p.total_display}${p.total_is_lower_bound ? ' (lower bound)' : ''}` +
      `${p.has_more ? '' : '  (end)'}  mode ${data.query.search_mode}  word=${data.query.keyword_effective}` +
      `${hiddenAds ? `  hidden ads ${hiddenAds} (--include-ads)` : ''}  ` +
      `${payload.meta.cached ? 'cache' : 'live'}${payload.meta.stale ? '/stale' : ''}\n`,
  );
  if (payload.meta.warnings.length) {
    process.stderr.write('warnings: ' + payload.meta.warnings.map((w) => w.code).join(', ') + '\n');
  }
}
