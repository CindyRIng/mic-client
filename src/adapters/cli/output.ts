import os from 'node:os';
import path from 'node:path';
import type { Command } from 'commander';
import type { AppContext } from '../../core/container.js';
export type { AppContext } from '../../core/container.js';
import type { ErrorCode, Meta } from '../../core/errors.js';
import { AppError } from '../../core/errors.js';
import { createContext, closeContext } from '../../core/container.js';
import { newRequestId } from '../../core/logger.js';
import { makeMeta } from '../../core/errors.js';
import { VERSION } from '../../version.js';

let outputMode: 'table' | 'json' | 'ndjson' = 'table';

export function setOutputMode(opts: GlobalOptions): void {
  outputMode = opts.json || opts.format === 'json' ? 'json' : opts.format === 'ndjson' ? 'ndjson' : 'table';
}

export function currentOutputMode(): 'table' | 'json' | 'ndjson' {
  return outputMode;
}

export interface GlobalOptions {
  config?: string;
  json?: boolean;
  format?: 'table' | 'json' | 'ndjson';
  timeout?: string;
  cache?: boolean;
  refresh?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  profile?: string;
  no_color?: boolean;
}

export const EXIT_CODES: Record<ErrorCode | 'OK', number> = {
  OK: 0,
  INVALID_PARAM: 2,
  NOT_FOUND: 3,
  UPSTREAM_CHANGED: 4,
  UPSTREAM_UNAVAILABLE: 4,
  RATE_LIMITED: 6,
  CAPTCHA_REQUIRED: 5,
  CAPTCHA_SOLVE_FAILED: 5,
  NEED_HUMAN_VERIFICATION: 5,
  PARSE_ERROR: 4,
  CONFIG_ERROR: 1,
  INTERNAL_ERROR: 1,
};

export function registerGlobalOptions(program: Command): void {
  program
    .option('--config <path>', 'config file path (default: ~/.mic-client/config.json)')
    .option('--json', 'output JSON envelope to stdout')
    .option('--format <format>', 'output format: table|json|ndjson', 'table')
    .option('--timeout <ms>', 'upstream request timeout in ms')
    .option('--no-cache', 'disable cache for this run')
    .option('--refresh', 'skip reading cache (force upstream fetch)')
    .option('--verbose', 'debug logging')
    .option('--quiet', 'only errors')
    .option('--profile <name|path>', 'browser profile name (under ~/.mic-client/profiles) or directory')
    .option('--no-color', 'disable ANSI colors (default: auto)');
}

/** Parse `500ms` / `15s` / `2m` / `1h` (bare number = ms) per docs/04 §2.5.5. */
export function parseDurationToMs(value: string, param = 'timeout'): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i.exec(String(value).trim());
  if (!m) {
    fail(
      new AppError('INVALID_PARAM', `invalid duration: ${value}`, {
        param,
        reason: 'INVALID_DURATION',
        expected: 'e.g. 500ms, 15s, 2m, 1h, 7d',
      }),
    );
  }
  const n = Number(m[1]);
  const unit = (m[2] ?? 'ms').toLowerCase();
  const factor = unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  const ms = Math.round(n * factor);
  if (!Number.isFinite(ms) || ms < 100 || ms > 86_400_000) {
    fail(
      new AppError('INVALID_PARAM', `duration out of range: ${value}`, {
        param,
        reason: 'OUT_OF_RANGE',
        min: '100ms',
        max: '1d',
      }),
    );
  }
  return ms;
}

function resolveProfileDir(value: string): string {
  if (value.startsWith('~')) return path.join(os.homedir(), value.slice(1).replace(/^\//, ''));
  if (value.includes('/')) return value;
  return path.join(os.homedir(), '.mic-client', 'profiles', value);
}

/** Global option rules from docs/04 §2.3. */
export function validateGlobalOptions(opts: GlobalOptions, commandName: string): void {
  const fmt = String(opts.format ?? 'table');
  if (!['table', 'json', 'ndjson'].includes(fmt)) {
    fail(
      new AppError('INVALID_PARAM', `invalid --format: ${fmt}`, {
        param: 'format',
        reason: 'INVALID_ENUM',
        allowed: ['table', 'json', 'ndjson'],
      }),
    );
  }
  if (opts.verbose && opts.quiet) {
    fail(new AppError('INVALID_PARAM', '--verbose and --quiet cannot be used together', {
      params: ['verbose', 'quiet'],
      reason: 'CONFLICTING_OPTIONS',
    }));
  }
  if (opts.cache === false && opts.refresh) {
    fail(new AppError('INVALID_PARAM', '--no-cache and --refresh cannot be used together', {
      params: ['cache', 'refresh'],
      reason: 'CONFLICTING_OPTIONS',
    }));
  }
  if (fmt === 'ndjson' && commandName !== 'search') {
    fail(new AppError('INVALID_PARAM', '--format ndjson is only supported by `mic search`', {
      param: 'format',
      reason: 'UNSUPPORTED_FORMAT_COMBO',
      command: commandName,
    }));
  }
}

export function contextFromOptions(opts: GlobalOptions): AppContext {
  setOutputMode(opts);
  if (opts.config) process.env.MIC_CONFIG = opts.config;
  const overrides: Record<string, unknown> = {};
  if (opts.cache === false) overrides.cache = { enabled: false };
  if (opts.timeout) overrides.upstream = { timeout_ms: parseDurationToMs(opts.timeout) };
  if (opts.profile) overrides.profile_dir = resolveProfileDir(opts.profile);
  const level = opts.verbose ? 'debug' : opts.quiet ? 'error' : undefined;
  return createContext({ configOverrides: overrides, logLevel: level, jsonLogs: !opts.quiet });
}

export function useJson(opts: GlobalOptions): boolean {
  setOutputMode(opts);
  return Boolean(opts.json) || opts.format === 'json';
}

export function printJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

export function printNdjson(events: unknown[]): void {
  for (const e of events) process.stdout.write(JSON.stringify(e) + '\n');
}

export function envelope<T>(data: T, meta: Meta) {
  return { ok: true as const, data, meta };
}

export function fail(e: unknown): never {
  const err = e instanceof AppError ? e : new AppError('INTERNAL_ERROR', String((e as Error)?.message ?? e));
  if (outputMode === 'json' || outputMode === 'ndjson') {
    process.stdout.write(
      JSON.stringify(
        {
          ok: false,
          error: err.toJSON(),
          meta: makeMeta({ request_id: newRequestId(), source: 'cache', warnings: [] }),
        },
        null,
        2,
      ) + '\n',
    );
  }
  const exit = EXIT_CODES[err.code] ?? 1;
  if (process.env.MIC_DEBUG_ERRORS) {
    process.stderr.write((err.stack ?? err.message) + '\n');
  } else {
    process.stderr.write(`error[${err.code}]: ${err.message}${err.details ? ' ' + JSON.stringify(err.details) : ''}\n`);
    if (err.code === 'NEED_HUMAN_VERIFICATION') {
      process.stderr.write('hint: run `mic auth` to complete human verification in a visible browser.\n');
    }
  }
  process.exitCode = exit;
  throw err;
}

export async function withContext<T>(
  opts: GlobalOptions,
  fn: (ctx: AppContext) => Promise<T> | T,
): Promise<T> {
  const ctx = contextFromOptions(opts);
  try {
    return await fn(ctx);
  } finally {
    closeContext(ctx);
    // exit cleanly even when a browser session was opened (captcha/auth fallback)
    try {
      const session = await import('../../core/session/browser.js');
      await session.closeBrowserSession();
    } catch {
      /* browser never started or already closed */
    }
  }
}

export function formatTable(rows: string[][], headers: string[]): string {
  const widths = headers.map((h, i) => Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ''))));
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - displayWidth(s)));
  const sep = widths.map((w) => '─'.repeat(w)).join('─┼─');
  return [
    headers.map((h, i) => pad(h, widths[i] ?? 0)).join(' │ '),
    sep,
    ...rows.map((r) => r.map((c, i) => pad(c, widths[i] ?? 0)).join(' │ ')),
  ].join('\n');
}

function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1;
  return w;
}

export { VERSION };
