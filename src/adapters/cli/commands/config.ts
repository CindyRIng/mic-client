import fs from 'node:fs';
import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { envelope, fail, printJson, useJson, withContext } from '../output.js';
import { configPath } from '../../../core/config.js';
import { newRequestId } from '../../../core/logger.js';
import { makeMeta } from '../../../core/errors.js';

export function registerConfigCommand(program: Command): void {
  const cmd = program.command('config').description('inspect configuration');
  cmd
    .command('show')
    .description('print effective configuration')
    .action(async () => {
      const opts = program.opts<GlobalOptions>();
      try {
        await withContext(opts, async (ctx) => {
          if (useJson(opts)) printJson(envelope(ctx.cfg, makeMeta({ request_id: newRequestId(), source: 'cache' })));
          else process.stdout.write(JSON.stringify(ctx.cfg, null, 2) + '\n');
        });
      } catch (e) {
        fail(e);
      }
    });
  cmd
    .command('path')
    .description('print config file path')
    .action(() => {
      process.stdout.write(configPath() + (fs.existsSync(configPath()) ? ' (exists)\n' : ' (missing, defaults in use)\n'));
    });
}
