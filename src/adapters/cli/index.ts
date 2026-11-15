import { Command } from 'commander';
import { VERSION } from '../../version.js';
import { registerGlobalOptions } from './output.js';
import { registerSearchCommand } from './commands/search.js';
import { registerRegionsCommand } from './commands/regions.js';
import { registerCacheCommand } from './commands/cache.js';
import { registerVersionCommand } from './commands/version.js';
import { registerCompanyCommand } from './commands/company.js';
import { registerAuthCommand } from './commands/auth.js';
import { registerServeCommand } from './commands/serve.js';
import { registerMcpCommand } from './commands/mcp.js';
import { registerConfigCommand } from './commands/config.js';
import { registerDoctorCommand } from './commands/doctor.js';

export function buildCli(): Command {
  const program = new Command();
  program
    .name('mic')
    .description('Made-in-China local client: search factories, inspect companies, REST/CLI/MCP')
    .version(VERSION, '-V, --version', 'print version');
  registerGlobalOptions(program);
  registerSearchCommand(program);
  registerCompanyCommand(program);
  registerRegionsCommand(program);
  registerCacheCommand(program);
  registerAuthCommand(program);
  registerServeCommand(program);
  registerMcpCommand(program);
  registerConfigCommand(program);
  registerDoctorCommand(program);
  registerVersionCommand(program);
  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = buildCli();
  await program.parseAsync(argv);
}
