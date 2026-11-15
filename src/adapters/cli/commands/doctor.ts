import type { Command } from 'commander';
import { fail } from '../output.js';
import { AppError } from '../../../core/errors.js';

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('environment self-check — implemented in M3')
    .option('--contract', 'probe upstream JSON contract')
    .action(async () => {
      try {
        throw new AppError('CONFIG_ERROR', 'mic doctor is not wired yet (M3 in progress)');
      } catch (e) {
        fail(e);
      }
    });
}
