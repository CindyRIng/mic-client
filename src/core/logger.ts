export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
  context?: Record<string, unknown>;
}

/**
 * Structured logger. Writes JSON lines (or pretty lines) to stderr so that
 * CLI stdout / MCP stdio stay clean.
 */
export class Logger {
  level: LogLevel;
  readonly json: boolean;
  private readonly base: Record<string, unknown>;

  constructor(opts: LoggerOptions = {}) {
    this.level = opts.level ?? 'info';
    this.json = opts.json ?? true;
    this.base = opts.context ?? {};
  }

  child(context: Record<string, unknown>): Logger {
    return new Logger({ level: this.level, json: this.json, context: { ...this.base, ...context } });
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const ts = new Date().toISOString();
    if (this.json) {
      const line = JSON.stringify({ ts, level, msg, ...this.base, ...(extra ?? {}) });
      process.stderr.write(line + '\n');
    } else {
      const ctx = { ...this.base, ...(extra ?? {}) };
      const suffix = Object.keys(ctx).length ? ' ' + JSON.stringify(ctx) : '';
      process.stderr.write(`[${ts}] ${level.toUpperCase()} ${msg}${suffix}\n`);
    }
  }

  debug(msg: string, extra?: Record<string, unknown>): void {
    this.write('debug', msg, extra);
  }
  info(msg: string, extra?: Record<string, unknown>): void {
    this.write('info', msg, extra);
  }
  warn(msg: string, extra?: Record<string, unknown>): void {
    this.write('warn', msg, extra);
  }
  error(msg: string, extra?: Record<string, unknown>): void {
    this.write('error', msg, extra);
  }
}

export function newRequestId(): string {
  return 'req_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
