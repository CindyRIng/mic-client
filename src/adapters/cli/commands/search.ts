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
    .option('--concurrency <n>', 'NDJSON bulk: fetch N pages in parallel (1-8; request spacing unchanged)', '1')
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

        if (opts.format === 'ndjson') {
          // multi-page requires --pages; single-page NDJSON is also legal (docs/04 §2.5.4)
          const spec = cmdOpts.pages ? String(cmdOpts.pages) : String(input.page ?? '1');
          const concurrency = Number(cmdOpts.concurrency ?? '1');
          if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
            throw new AppError('INVALID_PARAM', 'invalid --concurrency (expected integer 1-8)', {
              param: 'concurrency',
              reason: 'OUT_OF_RANGE',
              min: 1,
              max: 8,
            });
          }
          // Pipelining only overlaps response waits; the RateLimiter still spaces request starts.
          // The queue wait must cover the whole chunk (otherwise later chunks get RATE_LIMITED).
          const overrides =
            concurrency > 1 ? { upstream: { queue_max_wait_ms: 300000 } } : {};
          await withContext(
            opts,
            async (ctx) => {
              await streamPages(ctx, input, spec, concurrency);
            },
            overrides,
          );
          return;
        }
        if (cmdOpts.concurrency && String(cmdOpts.concurrency) !== '1') {
          throw new AppError('INVALID_PARAM', '--concurrency requires --format ndjson', {
            param: 'concurrency',
            reason: 'UNSUPPORTED_FORMAT_COMBO',
          });
        }
        if (cmdOpts.pages) {
          throw new AppError('INVALID_PARAM', '--pages requires --format ndjson', {
            param: 'pages',
            reason: 'UNSUPPORTED_FORMAT_COMBO',
          });
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

function parsePagesSpec(spec: string, startPage: number): number[] {
  const hardMax = 100;
  const s = spec.trim().toLowerCase();
  if (s === 'all') {
    // callers expand `all` after the first response (dynamic total_page); fallback to one page
    return [startPage];
  }
  if (/^\d+$/.test(s)) {
    return [Number(s)];
  }
  if (/^\d+-\d+$/.test(s)) {
    const [a, b] = s.split('-').map(Number) as [number, number];
    if (a > b) throw new AppError('INVALID_PARAM', 'invalid --pages range', { param: 'pages', reason: 'OUT_OF_RANGE' });
    const pages: number[] = [];
    for (let p = a; p <= Math.min(b, hardMax); p++) pages.push(p);
    return pages;
  }
  if (/^\d+(,\d+)+$/.test(s)) {
    return [...new Set(s.split(',').map(Number))].sort((a, b) => a - b).filter((p) => p >= 1 && p <= hardMax);
  }
  throw new AppError('INVALID_PARAM', 'invalid --pages spec (use 1 | 2-5 | 1,3,5 | all)', {
    param: 'pages',
    reason: 'INVALID_ENUM',
  });
}

/**
 * Stream pages as NDJSON (docs/04 §2.5.4).
 *
 * `--concurrency N` pipelines page fetches: the HttpClient rate limiter still spaces
 * request starts by 1.5–2.5s, but response waits overlap, so a full-province sweep
 * (56 pages) drops from ~5.5s/page to ~2.5–3s/page without increasing request rate.
 * Pages are emitted in order even when fetched concurrently.
 */
async function streamPages(ctx: AppContext, input: SearchInput, spec: string, concurrency: number): Promise<void> {
  const requestId = newRequestId();
  const started = Date.now();
  const normalized = ctx.search.normalize(input);
  const write = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + '\n');
  write({ type: 'start', command: 'search', request_id: requestId, query: normalized.query });

  let totalItems = 0;
  let anyStale = false;
  let anyWarnings = false;
  let fetchedPages = 0;

  const emit = (res: SearchResponse, requestedPage: number): boolean => {
    const p = res.data.pagination;
    if (p.page !== requestedPage && fetchedPages > 0) return false; // clamped/duplicate page → stop
    fetchedPages++;
    totalItems += res.data.items.length;
    anyStale = anyStale || res.meta.stale;
    if (res.meta.warnings.length) {
      anyWarnings = true;
      for (const w of res.meta.warnings) write({ type: 'warning', ...w });
    }
    write({ type: 'page', page: p.page, pagination: p, items: res.data.items, meta: res.meta });
    return p.has_more;
  };

  let pages: number[];
  if (spec.trim().toLowerCase() === 'all') {
    const startPage = normalized.query.page;
    const first: SearchResponse = await ctx.search.search({ ...input, page: startPage, request_id: requestId });
    const hasMore = emit(first, startPage);
    if (hasMore) {
      const totalPage = first.data.pagination.total_page;
      pages = [];
      for (let p = startPage + 1; p <= Math.min(totalPage, 100); p++) pages.push(p);
    } else {
      pages = [];
    }
  } else {
    pages = parsePagesSpec(spec, normalized.query.page);
  }

  const size = Math.max(1, concurrency);
  outer: for (let i = 0; i < pages.length; i += size) {
    const chunk = pages.slice(i, i + size);
    const results = await Promise.all(
      chunk.map(async (page) => ({ page, res: await ctx.search.search({ ...input, page, request_id: requestId }) })),
    );
    for (const { page, res } of results) {
      const hasMore = emit(res, page);
      if (!hasMore) break outer;
    }
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
