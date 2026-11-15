import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { envelope, printJson, useJson, withContext } from '../output.js';
import { newRequestId } from '../../../core/logger.js';
import { makeMeta } from '../../../core/errors.js';
import { SQLITE_SCHEMA_VERSION, UPSTREAM_CONTRACT_VERSION, VERSION } from '../../../version.js';

export function registerVersionCommand(program: Command): void {
  program
    .command('version')
    .description('print version information')
    .action(async () => {
      const opts = program.opts<GlobalOptions>();
      await withContext(opts, async (ctx) => {
        const data = {
          version: VERSION,
          node: process.version,
          schema_version: ctx.cache.schemaVersion ?? SQLITE_SCHEMA_VERSION,
          upstream_contract: {
            supplier_search: 'm.made-in-china.com/search/supplier',
            company_info: 'm.made-in-china.com/company-<account>/info.html',
            checked_at: UPSTREAM_CONTRACT_VERSION,
          },
        };
        if (useJson(opts)) printJson(envelope(data, makeMeta({ request_id: newRequestId(), source: 'cache' })));
        else process.stdout.write(`mic-client ${data.version}\nnode ${data.node}\nsqlite schema v${data.schema_version}\nupstream contract checked ${UPSTREAM_CONTRACT_VERSION}\n`);
      });
    });
}
