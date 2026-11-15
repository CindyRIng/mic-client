import path from 'node:path';
import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { fail, useJson } from '../output.js';
import { contextFromOptions } from '../output.js';
import { closeContext } from '../../../core/container.js';
import { AppError } from '../../../core/errors.js';
import { startRestServer } from '../../rest/server.js';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('start the local REST server (loopback only, docs/03 endpoints)')
    .option('--host <host>', 'listen host (loopback only: 127.0.0.1/localhost/::1)', '127.0.0.1')
    .option('--port <port>', 'listen port (1-65535; 0 = random free port)', '8899')
    .action(async (cmdOpts) => {
      const opts = program.opts<GlobalOptions>();
      try {
        if (opts.refresh) {
          throw new AppError('INVALID_PARAM', '--refresh cannot be combined with `mic serve`', {
            param: 'refresh',
            reason: 'INVALID_ENUM',
            hint: 'use POST /api/cache/refresh or `mic search --refresh` instead',
          });
        }
        const ctx = contextFromOptions(opts);
        try {
          const running = await startRestServer(ctx, {
            host: String(cmdOpts.host ?? ctx.cfg.rest.host),
            port: Number(cmdOpts.port ?? ctx.cfg.rest.port),
          });
          const info = {
            event: 'listening',
            host: running.host,
            port: running.port,
            pid: process.pid,
            profile: path.basename(ctx.cfg.profile_dir),
            data_dir: ctx.cfg.data_dir,
            health_url: running.healthUrl,
          };
          if (useJson(opts)) {
            process.stdout.write(JSON.stringify(info) + '\n');
          } else {
            process.stderr.write(`[serve] listening on http://${running.host}:${running.port} (pid ${process.pid})\n`);
            process.stderr.write(`[serve] data=${ctx.cfg.data_dir} profile=${path.basename(ctx.cfg.profile_dir)}\n`);
            process.stderr.write(`[serve] health=${running.healthUrl}  log=${ctx.cfg.log_dir}\n`);
            process.stderr.write('[serve] ready. press Ctrl+C to stop\n');
          }
          let closing = false;
          let resolveStop: () => void = () => undefined;
          const stopped = new Promise<void>((resolve) => {
            resolveStop = resolve;
          });
          const shutdown = (signal: string): void => {
            if (closing) return;
            closing = true;
            process.stderr.write(`[serve] ${signal} received, shutting down\n`);
            void running
              .close()
              .catch(() => undefined)
              .finally(() => {
                closeContext(ctx);
                process.exitCode = 0;
                resolveStop();
              });
          };
          process.once('SIGINT', () => shutdown('SIGINT'));
          process.once('SIGTERM', () => shutdown('SIGTERM'));
          await stopped;
        } catch (e) {
          closeContext(ctx);
          throw e;
        }
      } catch (e) {
        fail(e);
      }
    });
}
