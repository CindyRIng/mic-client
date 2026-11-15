import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { envelope, fail, formatTable, printJson, useJson, withContext } from '../output.js';
import { newRequestId } from '../../../core/logger.js';
import { makeMeta } from '../../../core/errors.js';

export function registerCacheCommand(program: Command): void {
  const cache = program.command('cache').description('cache statistics and maintenance');

  cache
    .command('stats')
    .description('show cache statistics')
    .action(async () => {
      const opts = program.opts<GlobalOptions>();
      try {
        await withContext(opts, async (ctx) => {
          const stats = ctx.cache.stats();
          if (useJson(opts)) {
            printJson(envelope(stats, makeMeta({ request_id: newRequestId(), source: 'cache' })));
            return;
          }
          const rows = Object.entries(stats.entries).map(([k, v]) => [k, String(v)]);
          rows.push(['db_path', stats.db_path]);
          rows.push(['schema_version', String(stats.schema_version)]);
          rows.push(['stale_entries', String(stats.stale_entries)]);
          rows.push(['db_size_bytes', String(stats.db_size_bytes)]);
          rows.push(['ttl_seconds', JSON.stringify(stats.ttl_seconds)]);
          process.stdout.write(formatTable(rows, ['key', 'value']) + '\n');
        });
      } catch (e) {
        fail(e);
      }
    });

  cache
    .command('clear')
    .description('clear cache (all|search|detail|enrich|regions|raw)')
    .option('--scope <scope>', 'all|search|detail|enrich|regions|raw', 'all')
    .action(async (cmdOpts) => {
      const opts = program.opts<GlobalOptions>();
      try {
        await withContext(opts, async (ctx) => {
          const removed = ctx.cache.clear(cmdOpts.scope);
          const data = { scope: cmdOpts.scope, removed };
          if (useJson(opts)) printJson(envelope(data, makeMeta({ request_id: newRequestId(), source: 'cache' })));
          else process.stdout.write(`cleared ${removed} cache row(s) (scope=${cmdOpts.scope})\n`);
        });
      } catch (e) {
        fail(e);
      }
    });

  cache
    .command('refresh')
    .description('show how to force refresh (use --refresh on search/company)')
    .action(async () => {
      process.stdout.write('Use `mic search ... --refresh` or `mic company <account> --refresh` to bypass cache.\n');
    });
}
