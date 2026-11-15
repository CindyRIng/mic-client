import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { envelope, fail, printJson, useJson } from '../output.js';
import { contextFromOptions } from '../output.js';
import { closeContext } from '../../../core/container.js';
import { AppError, makeMeta } from '../../../core/errors.js';
import { newRequestId } from '../../../core/logger.js';
import {
  loadSessionCookies,
  openAuthBrowser,
  resetSession,
  sessionState,
  sessionPaths,
} from '../../../core/session/browser.js';
import { toIsoCst } from '../../rest/shared.js';

const AUTH_MODES = ['verify', 'login', 'check'] as const;
type AuthMode = (typeof AUTH_MODES)[number];

/** Parse `300s` / `5m` / `1h` / raw seconds. */
export function parseDurationSeconds(value: string | undefined, dflt: number): number {
  if (value === undefined || value === '') return dflt;
  const match = value.trim().match(/^(\d+)(s|m|h)?$/i);
  if (!match) {
    throw new AppError('INVALID_PARAM', `invalid duration: ${value}`, {
      param: 'timeout',
      reason: 'INVALID_ENUM',
      hint: 'use seconds (300), or 300s / 5m / 1h',
    });
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multiplier = unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
  return amount * multiplier;
}

function meta(source: 'browser' | 'cache' = 'cache', extra: Record<string, unknown> = {}) {
  return makeMeta({
    request_id: newRequestId(),
    cached: false,
    stale: false,
    fetched_at: toIsoCst(),
    source,
    warnings: [],
    ...extra,
  });
}

export function registerAuthCommand(program: Command): void {
  program
    .command('auth')
    .description('open a visible browser to complete human verification / login and persist the session')
    .option('--mode <mode>', 'verify (captcha only) | login (optional login) | check (no browser)', 'verify')
    .option('--timeout <duration>', 'human wait timeout (default: config auth.timeout_s)', undefined)
    .option('--reset', 'delete local session files only (idempotent), do not open a browser')
    .action(async (cmdOpts) => {
      const opts = program.opts<GlobalOptions>();
      const started = Date.now();
      try {
        const mode = String(cmdOpts.mode ?? 'verify') as AuthMode;
        if (!AUTH_MODES.includes(mode)) {
          throw new AppError('INVALID_PARAM', `invalid auth mode: ${String(cmdOpts.mode)}`, {
            param: 'mode',
            reason: 'INVALID_ENUM',
            allowed: [...AUTH_MODES],
          });
        }
        const ctx = contextFromOptions(opts);
        try {
          const timeoutSec = parseDurationSeconds(cmdOpts.timeout as string | undefined, ctx.cfg.auth.timeout_s);
          if (cmdOpts.reset) {
            const { removed } = resetSession(ctx.cfg);
            const data = { reset: true, removed, storage_state_path: sessionPaths(ctx.cfg).storageState };
            if (useJson(opts)) printJson(envelope(data, meta('cache')));
            else process.stdout.write(`session reset: removed ${removed.length} file(s)\n`);
            return;
          }
          if (mode === 'check') {
            const state = sessionState(ctx.cfg);
            const cookies = loadSessionCookies(ctx.cfg);
            ctx.http.cookies.load(cookies);
            // Local session state: a browser-verified profile persists storageState + the
            // `fbrs` Focus-Captcha cookie. The HTTP fast path may still be edge-challenged even
            // with a valid browser session, so local state is the primary signal; the probe
            // only downgrades when there is no local session at all.
            const hasLocalSession = state.storage_state_present && cookies.some((c) => c.name === 'fbrs');
            let verified = false;
            let challenge = false;
            let reachable = true;
            try {
              const res = await ctx.http.request('https://m.made-in-china.com/', { timeoutMs: 8000, retries: 0 });
              const httpOk = res.status === 200 && !/Focus Captcha|请验证/i.test(res.body.slice(0, 400));
              verified = httpOk || hasLocalSession;
            } catch (e) {
              if (e instanceof AppError && e.code === 'CAPTCHA_REQUIRED') {
                challenge = true;
                verified = hasLocalSession;
              } else if (e instanceof AppError && e.code === 'UPSTREAM_UNAVAILABLE') {
                reachable = false;
              } else {
                throw e;
              }
            }
            const data = {
              profile: ctx.cfg.profile_dir.split('/').pop() ?? 'default',
              profile_dir: ctx.cfg.profile_dir,
              mode,
              verified,
              login: state.login,
              cookie_count: state.cookie_count,
              cookie_names: cookies.map((c) => c.name),
              storage_state_present: state.storage_state_present,
              storage_state_age_seconds: state.storage_state_age_seconds,
              last_auth_at: state.last_verified_at,
              duration_ms: Date.now() - started,
            };
            if (!verified) {
              if (!reachable) {
                throw new AppError('UPSTREAM_UNAVAILABLE', 'upstream is unreachable while checking the session', {
                  ...data,
                });
              }
              throw new AppError('NEED_HUMAN_VERIFICATION', 'session is not verified', {
                ...data,
                action: 'mic auth',
                reason: challenge ? 'challenge_required' : 'not_verified',
              });
            }
            if (useJson(opts)) {
              printJson(envelope(data, meta('cache')));
            } else {
              process.stdout.write(
                `session: verified  cookies=${state.cookie_count} ` +
                  `login=${state.login === null ? 'unknown' : state.login}\n`,
              );
            }
            return;
          }
          // verify / login: open the visible browser
          process.stderr.write(`[auth] launching visible browser (profile: ${ctx.cfg.profile_dir})\n`);
          const result = await openAuthBrowser(ctx.cfg, ctx.logger, {
            mode,
            timeoutSec,
            onProgress: (message) => process.stderr.write(`[auth] ${message}\n`),
          });
          const data = { ...result, duration_ms: Date.now() - started };
          if (useJson(opts)) printJson(envelope(data, meta('browser')));
          else {
            process.stdout.write(`session persisted: ${result.storage_state_path}\n`);
            process.stdout.write(
              `cookies=${result.cookie_count} login=${result.login === null ? 'unknown' : result.login} ` +
                `elapsed=${Math.round(data.duration_ms / 1000)}s\n`,
            );
            process.stdout.write('hint: run `mic doctor` to verify session/upstream connectivity, then retry your command.\n');
          }
        } finally {
          closeContext(ctx);
        }
      } catch (e) {
        fail(e);
      }
    });
}
