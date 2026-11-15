import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { envelope, fail, formatTable, printJson, useJson, withContext } from '../output.js';
import { listRegions } from '../../../core/services/static.js';
import { newRequestId } from '../../../core/logger.js';
import { makeMeta } from '../../../core/errors.js';

export function registerRegionsCommand(program: Command): void {
  program
    .command('regions')
    .description('list province/city dictionary used for region search')
    .option('--province <name>', 'only show one province')
    .action(async (cmdOpts) => {
      const opts = program.opts<GlobalOptions>();
      try {
        await withContext(opts, async () => {
          const data = listRegions(cmdOpts.province);
          if (useJson(opts)) {
            printJson(envelope(data, makeMeta({ request_id: newRequestId(), source: 'cache' })));
            return;
          }
          const rows = data.provinces.map((p) => [
            p.name,
            p.name_zh,
            p.api_value,
            p.cities_complete ? String(p.cities?.length ?? 0) : 'partial',
            (p.cities ?? []).slice(0, 6).map((c) => c?.name).filter(Boolean).join(', ') || '-',
          ]);
          process.stdout.write(formatTable(rows, ['Province', '中文', 'api_value', 'cities', 'sample cities']) + '\n');
          process.stdout.write(`\n${data.provinces.length} province(s). Only Hebei has a verified city dictionary for now.\n`);
        });
      } catch (e) {
        fail(e);
      }
    });
}
