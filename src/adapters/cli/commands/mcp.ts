import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { fail } from '../output.js';
import { contextFromOptions } from '../output.js';
import { closeContext } from '../../../core/container.js';
import { AppError } from '../../../core/errors.js';
import { mcpClientConfig, runMcpServer } from '../../mcp/server.js';

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('run the stdio MCP server (4 tools + 2 resources, docs/04 §3)')
    .option('--transport <transport>', 'transport: stdio (only stdio is supported)', 'stdio')
    .option('--no-resources', 'do not expose MCP resources (tools only)')
    .option('--print-config', 'print a Claude Code / MCP client config snippet and exit')
    .action(async (cmdOpts) => {
      const opts = program.opts<GlobalOptions>();
      try {
        const transport = String(cmdOpts.transport ?? 'stdio');
        if (transport !== 'stdio') {
          throw new AppError('INVALID_PARAM', `unsupported MCP transport: ${transport}`, {
            param: 'transport',
            reason: 'INVALID_ENUM',
            allowed: ['stdio'],
          });
        }
        if (opts.json || (opts.format && opts.format !== 'table')) {
          throw new AppError('INVALID_PARAM', '--json/--format are not applicable to `mic mcp`', {
            param: 'format',
            reason: 'INVALID_ENUM',
            hint: 'MCP already uses JSON-RPC on stdout',
          });
        }
        if (cmdOpts.printConfig) {
          process.stdout.write(JSON.stringify(mcpClientConfig(), null, 2) + '\n');
          return;
        }
        const ctx = contextFromOptions(opts);
        try {
          await runMcpServer(ctx, { resources: cmdOpts.resources !== false });
        } finally {
          closeContext(ctx);
        }
      } catch (e) {
        fail(e);
      }
    });
}
