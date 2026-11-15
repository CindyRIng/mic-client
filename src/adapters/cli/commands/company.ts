import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { fail } from '../output.js';
import { AppError } from '../../../core/errors.js';

export function registerCompanyCommand(program: Command): void {
  program
    .command('company <account>')
    .description('get company detail (implemented in M2)')
    .option('--include <items>', 'comma list: audit,response,contacts,reviews')
    .action(async () => {
      const opts = program.opts<GlobalOptions>();
      try {
        void opts;
        throw new AppError('CONFIG_ERROR', 'company detail is not wired yet (M2 in progress); use `mic search` meanwhile');
      } catch (e) {
        fail(e);
      }
    });
}
