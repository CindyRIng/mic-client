import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { envelope, fail, formatTable, parseDurationToMs, printJson, useJson, withContext, type AppContext } from '../output.js';
import { newRequestId } from '../../../core/logger.js';
import { AppError, makeMeta } from '../../../core/errors.js';
import { buildCacheStatsData } from '../../rest/shared.js';

type CliScope = 'list' | 'detail' | 'regions' | 'raw' | 'all';
type RestScope = 'search' | 'company' | 'regions' | 'all';

const SCOPE_MAP: Record<CliScope, RestScope> = {
  list: 'search',
  detail: 'company',
  regions: 'regions',
  raw: 'all',
  all: 'all',
};

function parseScope(raw: unknown, required: boolean): CliScope | null {
  if (raw === undefined || raw === null || raw === '') {
    if (!required) return null;
    throw new AppError('INVALID_PARAM', '--scope is required', {
      param: 'scope',
      reason: 'MISSING_REQUIRED',
      allowed: Object.keys(SCOPE_MAP),
    });
  }
  const scope = String(raw) as CliScope;
  if (!(scope in SCOPE_MAP)) {
    throw new AppError('INVALID_PARAM', `invalid --scope: ${scope}`, {
      param: 'scope',
      reason: 'INVALID_ENUM',
      allowed: Object.keys(SCOPE_MAP),
    });
  }
  return scope;
}

interface Snapshot {
  search_pages: number;
  search_indexes: number;
  companies: number;
  company_details: number;
  enrichment: number;
  regions: number;
  total: number;
}

function count(ctx: AppContext, table: string): number {
  try {
    return (ctx.cache.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } catch {
    return 0;
  }
}

function snapshot(ctx: AppContext): Snapshot {
  const s = {
    search_pages: count(ctx, 'search_page_cache'),
    search_indexes: count(ctx, 'search_indexes'),
    companies: count(ctx, 'companies'),
    company_details: count(ctx, 'company_details') + count(ctx, 'membership_info'),
    enrichment: ['audit_info', 'response_info', 'contact_info', 'review_summary'].reduce((a, t) => a + count(ctx, t), 0),
    regions: count(ctx, 'regions_cities') + count(ctx, 'regions_provinces'),
  };
  return { ...s, total: Object.values(s).reduce((a, b) => a + b, 0) };
}

function diff(before: Snapshot, after: Snapshot): Snapshot {
  const d = {
    search_pages: before.search_pages - after.search_pages,
    search_indexes: before.search_indexes - after.search_indexes,
    companies: before.companies - after.companies,
    company_details: before.company_details - after.company_details,
    enrichment: before.enrichment - after.enrichment,
    regions: before.regions - after.regions,
  };
  return { ...d, total: Object.values(d).reduce((a, b) => a + b, 0) };
}

/** Invalidate rows for a scope; supports --key / --older-than / --dry-run. */
function invalidate(
  ctx: AppContext,
  scope: CliScope,
  opts: { key?: string; olderThanS?: number | null; dryRun?: boolean },
): Snapshot {
  const db = ctx.cache.db;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = opts.olderThanS ? now - opts.olderThanS : null;
  const before = snapshot(ctx);
  const del = (table: string, where = '', args: unknown[] = []) => {
    if (opts.dryRun) return;
    try {
      db.prepare(`DELETE FROM ${table}${where}`).run(...args);
    } catch {
      /* table/column may not exist in older schema */
    }
  };
  const tablesForScope = (): string[] => {
    switch (scope) {
      case 'list':
        return ['search_page_cache', 'search_indexes'];
      case 'detail':
        return [
          'company_details',
          'membership_info',
          'audit_info',
          'response_info',
          'contact_info',
          'review_summary',
        ];
      case 'regions':
        return ['regions_cities', 'regions_provinces'];
      case 'raw':
        return ['raw_snapshots'];
      case 'all':
        return [
          'search_page_cache',
          'search_indexes',
          'company_details',
          'membership_info',
          'audit_info',
          'response_info',
          'contact_info',
          'review_summary',
          'regions_cities',
          'regions_provinces',
          'raw_snapshots',
        ];
    }
  };
  for (const table of tablesForScope()) {
    if (opts.key) {
      // exact-key deletion: search pages use cache_key; company tables use account; cache_entries by cache_key
      if (table === 'search_page_cache' || table === 'cache_entries') {
        del(table, ' WHERE cache_key = ?', [opts.key]);
        continue;
      }
      if (table.startsWith('company') || table === 'membership_info' || table.endsWith('_info') || table === 'review_summary') {
        del(table, ' WHERE account = ?', [opts.key]);
        continue;
      }
      del(table, ' WHERE rowid IN (SELECT rowid FROM ' + table + ' WHERE fetched_at <= ?)', [cutoff ?? now]);
      continue;
    }
    if (cutoff !== null) {
      // older-than: only tables with fetched_at support it; otherwise fallback to full scope
      const hasFetchedAt = (() => {
        try {
          db.prepare(`SELECT fetched_at FROM ${table} LIMIT 1`).get();
          return true;
        } catch {
          return false;
        }
      })();
      if (hasFetchedAt) del(table, ' WHERE fetched_at <= ?', [cutoff]);
      else del(table);
    } else {
      del(table);
    }
  }
  if (scope === 'regions' || scope === 'all') del('cache_entries', " WHERE scope = 'regions'");
  const after = opts.dryRun ? before : snapshot(ctx);
  const d = diff(before, after);
  if (opts.dryRun) {
    // dry-run: report would-be counts by counting matching rows
    const counts: Snapshot = {
      search_pages: 0,
      search_indexes: 0,
      companies: 0,
      company_details: 0,
      enrichment: 0,
      regions: 0,
      total: 0,
    };
    for (const table of tablesForScope()) {
      counts[table === 'search_page_cache' ? 'search_pages' : table === 'search_indexes' ? 'search_indexes' : table === 'company_details' || table === 'membership_info' ? 'company_details' : ['audit_info', 'response_info', 'contact_info', 'review_summary'].includes(table) ? 'enrichment' : table.startsWith('regions') ? 'regions' : 'companies'] += count(ctx, table);
    }
    counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
    return counts;
  }
  return d;
}

function refreshResult(
  scope: RestScope,
  wait: boolean,
  enabled: boolean,
  target: Record<string, unknown> | null,
  invalidated: Snapshot,
  result: unknown,
) {
  return { scope, wait, enabled, target, invalidated, result };
}

function registerStats(parent: Command): void {
  parent
    .command('stats')
    .description('show cache statistics (same data as GET /api/cache/stats)')
    .option('--scope <scope>', 'list|detail|regions|raw|all', undefined)
    .action(async (cmdOpts) => {
      const opts = parent.parent?.opts<GlobalOptions>() ?? ({} as GlobalOptions);
      try {
        const scope = parseScope(cmdOpts.scope, false);
        await withContext(opts, async (ctx) => {
          const data = buildCacheStatsData(ctx) as Record<string, unknown>;
          if (useJson(opts)) {
            printJson(envelope(data, makeMeta({ request_id: newRequestId(), source: 'cache' })));
            return;
          }
          const entries = (data['entries'] ?? {}) as Record<string, number>;
          const rows = Object.entries(entries).map(([k, v]) => [k, String(v)]);
          const dbInfo = (data['db'] ?? {}) as Record<string, unknown>;
          rows.push(['db_path', String(dbInfo['path'] ?? '-')]);
          rows.push(['schema_version', String(dbInfo['schema_version'] ?? '-')]);
          rows.push(['size_bytes', String(dbInfo['size_bytes'] ?? 0)]);
          rows.push(['wal_size_bytes', String(dbInfo['wal_size_bytes'] ?? 0)]);
          rows.push(['stale_entries', String(data['stale_entries'] ?? 0)]);
          rows.push(['ttl_seconds', JSON.stringify(data['ttl_seconds'] ?? {})]);
          process.stdout.write(formatTable(rows, ['key', 'value']) + '\n');
          if (scope) process.stdout.write(`\n(scope=${scope}; JSON data 始终返回完整 CacheStats，与 REST 一致)\n`);
        });
      } catch (e) {
        fail(e);
      }
    });
}

function registerClear(parent: Command): void {
  parent
    .command('clear')
    .description('invalidate cache entries without touching upstream (list|detail|regions|raw|all)')
    .option('--scope <scope>', 'list|detail|regions|raw|all (required)')
    .option('--older-than <duration>', 'only invalidate entries fetched before this age, e.g. 7d')
    .option('--key <cache_key>', 'invalidate one exact cache key')
    .option('--dry-run', 'only report what would be invalidated', false)
    .action(async (cmdOpts) => {
      const opts = parent.parent?.opts<GlobalOptions>() ?? ({} as GlobalOptions);
      try {
        const scope = parseScope(cmdOpts.scope, true)!;
        const olderThanS = cmdOpts.olderThan ? Math.floor(parseDurationToMs(String(cmdOpts.olderThan), 'older-than') / 1000) : null;
        await withContext(opts, async (ctx) => {
          const invalidated = invalidate(ctx, scope, {
            key: cmdOpts.key ? String(cmdOpts.key) : undefined,
            olderThanS,
            dryRun: Boolean(cmdOpts.dryRun),
          });
          const data = refreshResult(SCOPE_MAP[scope], false, Boolean(ctx.cfg.cache.enabled), {
            ...(cmdOpts.key ? { key: String(cmdOpts.key) } : {}),
            ...(olderThanS ? { older_than_seconds: olderThanS } : {}),
            ...(cmdOpts.dryRun ? { dry_run: true } : {}),
          }, invalidated, null);
          if (useJson(opts)) printJson(envelope(data, makeMeta({ request_id: newRequestId(), source: 'cache' })));
          else
            process.stdout.write(
              `${cmdOpts.dryRun ? 'would invalidate' : 'invalidated'} ${invalidated.total} row(s) ` +
                `(scope=${scope}, rest_scope=${SCOPE_MAP[scope]})${cmdOpts.dryRun ? ' [dry-run]' : ''}\n`,
            );
        });
      } catch (e) {
        fail(e);
      }
    });
}

function registerRefresh(parent: Command): void {
  parent
    .command('refresh')
    .description('invalidate then synchronously refetch cache entries (list|detail|regions)')
    .option('--scope <scope>', 'list|detail|regions (required)')
    .option('--keyword <kw>', 'list scope: keyword')
    .option('--province <name>', 'list scope: province')
    .option('--city <name>', 'list scope: city')
    .option('--page <n>', 'list scope: page', '1')
    .option('--page-size <n>', 'list scope: page size', '20')
    .option('--membership-tier <tier>', 'list scope: diamond|gold')
    .option('--audited', 'list scope: audited only')
    .option('--account <account>', 'detail scope: account')
    .option('--com-id <id>', 'detail scope: numeric comId')
    .option('--encode-com-id <id>', 'detail scope: encodeComId')
    .option('--include <list>', 'detail scope: audit,response,contacts,reviews|all')
    .option('--key <cache_key>', 'exact cache key (optional)')
    .option('--stale-only', 'only refresh stale entries', false)
    .option('--all', 'refresh all known entries in scope', false)
    .action(async (cmdOpts) => {
      const opts = parent.parent?.opts<GlobalOptions>() ?? ({} as GlobalOptions);
      try {
        const scope = parseScope(cmdOpts.scope, true)!;
        if (scope !== 'list' && scope !== 'detail' && scope !== 'regions') {
          throw new AppError('INVALID_PARAM', 'cache refresh supports list|detail|regions only', {
            param: 'scope',
            reason: 'INVALID_ENUM',
            allowed: ['list', 'detail', 'regions'],
          });
        }
        await withContext(opts, async (ctx) => {
          const enabled = Boolean(ctx.cfg.cache.enabled);
          if (scope === 'regions') {
            const invalidated = invalidate(ctx, 'regions', { key: cmdOpts.key ? String(cmdOpts.key) : undefined });
            const data = refreshResult('regions', true, enabled, cmdOpts.key ? { key: String(cmdOpts.key) } : null, invalidated, null);
            if (useJson(opts)) printJson(envelope(data, makeMeta({ request_id: newRequestId(), source: 'cache' })));
            else process.stdout.write(`refreshed regions dictionary (invalidated ${invalidated.total} row(s); local materialized dictionary, no upstream)\n`);
            return;
          }
          const before = snapshot(ctx);
          if (cmdOpts.key) {
            throw new AppError('INVALID_PARAM', '--key is only supported by cache clear / regions refresh', {
              param: 'key',
              reason: 'UNSUPPORTED_OPTION',
            });
          }
          let resultData: unknown = null;
          let target: Record<string, unknown>;
          let invalidated: Snapshot;
          if (scope === 'list') {
            if (!cmdOpts.keyword && !cmdOpts.province && !cmdOpts.city) {
              throw new AppError('INVALID_PARAM', 'refresh --scope list requires --keyword/--province/--city', {
                params: ['keyword', 'province', 'city'],
                reason: 'MISSING_REQUIRED_COMBO',
                hint: 'for bulk refresh use --all (bounded by cache keys)',
              });
            }
            target = {
              keyword: cmdOpts.keyword ?? null,
              province: cmdOpts.province ?? null,
              city: cmdOpts.city ?? null,
              page: Number(cmdOpts.page),
              page_size: Number(cmdOpts.pageSize),
            };
            invalidated = invalidate(ctx, 'list', {});
            const res = await ctx.search.search({
              keyword: cmdOpts.keyword,
              province: cmdOpts.province,
              city: cmdOpts.city,
              page: cmdOpts.page,
              page_size: cmdOpts.pageSize,
              membership_tier: cmdOpts.membershipTier,
              audited: cmdOpts.audited || undefined,
              refresh: true,
              request_id: newRequestId(),
            });
            resultData = res.data;
          } else {
            if (!cmdOpts.account && !cmdOpts.comId && !cmdOpts.encodeComId) {
              throw new AppError('INVALID_PARAM', 'refresh --scope detail requires --account/--com-id/--encode-com-id', {
                params: ['account', 'com_id', 'encode_com_id'],
                reason: 'MISSING_REQUIRED_COMBO',
              });
            }
            target = {
              account: cmdOpts.account ?? null,
              com_id: cmdOpts.comId ?? null,
              encode_com_id: cmdOpts.encodeComId ?? null,
              include: cmdOpts.include ?? null,
            };
            invalidated = invalidate(ctx, 'detail', { key: cmdOpts.account ? String(cmdOpts.account) : undefined });
            const res = await ctx.company.get({
              account: cmdOpts.account,
              com_id: cmdOpts.comId,
              encode_com_id: cmdOpts.encodeComId,
              include: cmdOpts.include,
              refresh: true,
              request_id: newRequestId(),
              onCaptcha: async (srcUrl: string) => {
                const session = await import('../../../core/session/browser.js');
                await session.ensureVerifiedSession(srcUrl, ctx.cfg, ctx.logger);
                ctx.http.cookies.load(session.loadSessionCookies(ctx.cfg));
              },
              onBrowserFetch: async (url: string) => {
                const session = await import('../../../core/session/browser.js');
                const html = await session.fetchHtmlViaBrowser(url, ctx.cfg, ctx.logger);
                ctx.http.cookies.load(session.loadSessionCookies(ctx.cfg));
                return html;
              },
            });
            resultData = res.data;
          }
          const data = refreshResult(SCOPE_MAP[scope], true, enabled, target, invalidated, resultData);
          if (useJson(opts)) printJson(envelope(data, makeMeta({ request_id: newRequestId(), source: 'cache' })));
          else
            process.stdout.write(
              `refreshed ${scope} (rest_scope=${SCOPE_MAP[scope]}); invalidated ${invalidated.total} row(s)\n`,
            );
        });
      } catch (e) {
        fail(e);
      }
    });
}

export function registerCacheCommand(program: Command): void {
  const cache = program.command('cache').description('cache statistics and maintenance (docs/04 §2.7.4)');
  registerStats(cache);
  registerClear(cache);
  registerRefresh(cache);
}
