/** Canonical error codes and HTTP mappings (docs/README §3.5, docs/03 §12). */
export const ERROR_CODES = [
  'INVALID_PARAM',
  'NOT_FOUND',
  'UPSTREAM_CHANGED',
  'UPSTREAM_UNAVAILABLE',
  'RATE_LIMITED',
  'CAPTCHA_REQUIRED',
  'CAPTCHA_SOLVE_FAILED',
  'NEED_HUMAN_VERIFICATION',
  'PARSE_ERROR',
  'CONFIG_ERROR',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_PARAM: 400,
  NOT_FOUND: 404,
  UPSTREAM_CHANGED: 502,
  UPSTREAM_UNAVAILABLE: 503,
  RATE_LIMITED: 429,
  CAPTCHA_REQUIRED: 409,
  CAPTCHA_SOLVE_FAILED: 502,
  NEED_HUMAN_VERIFICATION: 409,
  PARSE_ERROR: 502,
  CONFIG_ERROR: 500,
  INTERNAL_ERROR: 500,
};

/** Canonical warning codes for meta.warnings[].code. */
export const WARNING_CODES = [
  'TOTAL_CAPPED',
  'NON_EXHAUSTIVE',
  'PAGE_CLAMPED',
  'PAGE_SIZE_NOT_NATIVE',
  'PAGE_LIMIT_REACHED',
  'CLIENT_SIDE_FILTER',
  'CITY_FILTERED_LOCALLY',
  'CITY_FILTER_EMPTY',
  'CITY_FILTER_TRUNCATED',
  'CITY_NOT_IN_DICTIONARY',
  'CITY_PROVINCE_MISMATCH',
  'ADDRESS_MISMATCH',
  'REGION_DICTIONARY_INCOMPLETE',
  'STALE_DATA',
  'ENRICHMENT_PARTIAL',
  'DUPLICATES_REMOVED',
  'ADS_FILTERED',
  'HTML_FALLBACK',
  'BROWSER_FALLBACK',
  'CACHE_WRITE_FAILED',
  'MEMBER_EVIDENCE_CONFLICT',
  'UNKNOWN_CERTIFICATION',
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export interface Warning {
  code: WarningCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface Meta {
  request_id: string;
  cached: boolean;
  stale: boolean;
  fetched_at: string | null;
  source: 'json' | 'html' | 'browser' | 'cache';
  warnings: Warning[];
}

export interface Envelope<T> {
  ok: true;
  data: T;
  meta: Meta;
}

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: Meta;
}

/** Typed application error; adapters translate it into REST/MCP/CLI errors. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    const defaultRetryable =
      code === 'UPSTREAM_UNAVAILABLE' || code === 'RATE_LIMITED' || code === 'CAPTCHA_SOLVE_FAILED';
    this.retryable = options.retryable ?? defaultRetryable;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }

  get httpStatus(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  toJSON(): ErrorEnvelope['error'] {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function toAppError(e: unknown, fallbackCode: ErrorCode = 'INTERNAL_ERROR'): AppError {
  if (isAppError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new AppError(fallbackCode, message, undefined, { cause: e });
}

export function makeMeta(partial: Partial<Meta> = {}): Meta {
  return {
    request_id: partial.request_id ?? '',
    cached: partial.cached ?? false,
    stale: partial.stale ?? false,
    fetched_at: partial.fetched_at ?? null,
    source: partial.source ?? 'json',
    warnings: partial.warnings ?? [],
  };
}
