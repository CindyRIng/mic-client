import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { envelope, fail, formatTable, printJson, useJson, withContext } from '../output.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('search supplier factories by keyword and/or region (province/city)')
    .option('--keyword <kw>', 'English keyword (region words like hebei/langfang work too)')
    .option('--province <name>', 'province (English or Chinese)')
    .option('--city <name>', 'city (English or Chinese; requires or infers province)')
    .option('--page <n>', 'page number (1-100)', '1')
    .option('--page-size <n>', 'page size (1-100, default 20)', '20')
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
        const result = await withContext(opts, async (ctx) => {
          const res = await ctx.search.search({
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
          });
          return envelope(res.data, res.meta);
        });
        const payload = result;
        if (useJson(opts)) {
          printJson(payload);
          return;
        }
        renderSearchTable(payload as never, Boolean(cmdOpts.includeAds));
      } catch (e) {
        fail(e);
      }
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
