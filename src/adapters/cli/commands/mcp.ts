import type { Command } from 'commander';
import { fail } from '../output.js';
import { AppError } from '../../../core/errors.js';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('run MCP server over stdio — implemented in M3')
    .action(async () => {
      try {
        throw new AppError('CONFIG_ERROR', 'MCP server is not wired yet (M3 in progress)');
      } catch (e) {
        fail(e);
      }
    });
}
