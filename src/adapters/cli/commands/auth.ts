import type { Command } from 'commander';
import { fail } from '../output.js';
import { AppError } from '../../../core/errors.js';

export function registerAuthCommand(program: Command): void {
  program
    .command('auth')
    .description('open a visible browser to complete human verification / optional login (implemented in M3)')
    .option('--timeout <s>', 'human wait timeout seconds')
    .option('--reset', 'delete the existing browser profile first')
    .action(async () => {
      try {
        throw new AppError('CONFIG_ERROR', 'mic auth is not wired yet (M3 in progress)');
      } catch (e) {
        fail(e);
      }
    });
}
