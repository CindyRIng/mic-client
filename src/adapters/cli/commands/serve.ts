import type { Command } from 'commander';
import { fail } from '../output.js';
import { AppError } from '../../../core/errors.js';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('start local REST server (127.0.0.1:8787) — implemented in M3')
    .option('--host <host>', 'listen host (loopback only)', '127.0.0.1')
    .option('--port <port>', 'listen port', '8787')
    .action(async () => {
      try {
        throw new AppError('CONFIG_ERROR', 'REST server is not wired yet (M3 in progress)');
      } catch (e) {
        fail(e);
      }
    });
}
