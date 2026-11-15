/**
 * REST adapter (M3, docs/03): Fastify v5 server on a loopback address only.
 *
 * Endpoints: /health, /api/version, /api/regions, /api/search/factories,
 * /api/companies/:account, /api/membership/levels, POST /api/cache/refresh,
 * GET /api/cache/stats.
 *
 * The adapter is a thin, testable layer: `buildRestServer()` accepts an injected
 * company-detail function (tests); `startRestServer()` owns listen/close lifecycle.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AppContext } from '../../core/container.js';
import { AppError, isAppError, toAppError, type ErrorCode, type Meta } from '../../core/errors.js';
import { newRequestId } from '../../core/logger.js';
import { sessionState } from '../../core/session/browser.js';
import { VERSION } from '../../version.js';
import { buildOpenApiDocument } from './openapi.js';
import { renderDocsHtml } from './docs.js';
import {
  API_VERSION,
  ALL_INCLUDES,
  buildCacheStatsData,
  buildMembershipLevelsData,
  buildRegionsData,
  buildVersionData,
  cacheClearScope,
  countTables,
  errorMeta,
  findAccountByEncodeComId,
  fitMeta,
  firstString,
  getCompanyDetail,
  nowIso,
  parseIncludeTokens,
  parseIntInRange,
  parseStrictBoolean,
  resolveCompanyPathInput,
  solveCaptchaForHttp,
  tableCount,
  toIsoCst,
  withTimeout,
  type CompanyDetailResponse,
  type CompanyLookupInput,
} from './shared.js';

export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]', '::ffff:127.0.0.1'] as const;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_BODY_BYTES = 64 * 1024;

export interface RestServerOptions {
  /** Injected company-detail implementation (tests / future DI); defaults to the M2 bridge. */
  companyDetail?: (input: CompanyLookupInput, requestId: string) => Promise<CompanyDetailResponse>;
}

export interface StartRestServerOptions extends RestServerOptions {
  host?: string;
  port?: number;
}

export interface RunningRestServer {
  app: FastifyInstance;
  host: string;
  port: number;
  healthUrl: string;
  close: () => Promise<void>;
}

interface Envelope<T> {
  ok: true;
  data: T;
  meta: Meta;
}

const requestIds = new WeakMap<object, string>();

function requestIdOf(request: FastifyRequest): string {
  return requestIds.get(request) ?? newRequestId();
}

function makeOk<T>(data: T, meta: Meta): Envelope<T> {
  return { ok: true, data, meta };
}

function makeErrorEnvelope(error: AppError, requestId: string): Record<string, unknown> {
  const details = error.details ? { ...error.details } : {};
  if (details['request_id'] === undefined) details['request_id'] = requestId;
  return {
    ok: false,
    error: { code: error.code, message: error.message, details },
    meta: errorMeta(error.code, requestId),
  };
}

/** Map third-party/Fastify errors to canonical AppError codes (docs/README §3.5). */
function mapUnknownError(error: unknown): AppError {
  if (isAppError(error)) return error;
  const code = (error as { code?: string }).code ?? '';
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
    return new AppError('INVALID_PARAM', 'unsupported Content-Type', {
      reason: 'UNSUPPORTED_MEDIA_TYPE',
      expected: 'application/json',
    });
  }
  if (code === 'FST_ERR_CTP_INVALID_JSON_BODY' || code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
    return new AppError('INVALID_PARAM', 'request body is not valid JSON', { reason: 'INVALID_JSON' });
  }
  if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return new AppError('INVALID_PARAM', 'request body too large', { reason: 'PAYLOAD_TOO_LARGE', limit: MAX_BODY_BYTES });
  }
  if (code === 'FST_ERR_NOT_FOUND') {
    return new AppError('NOT_FOUND', 'route not found', { reason: 'ROUTE_NOT_FOUND' });
  }
  return new AppError('INTERNAL_ERROR', message, undefined, { cause: error });
}

/** CAPTCHA_REQUIRED is internal (docs/03 §1.12): REST exposes NEED_HUMAN_VERIFICATION. */
function toPublicError(error: AppError): AppError {
  if (error.code === 'CAPTCHA_REQUIRED') {
    return new AppError('NEED_HUMAN_VERIFICATION', 'upstream requires a captcha; complete it with `mic auth`', {
      stage: 'captcha',
      action: 'mic auth',
      reason: 'captcha_required',
    });
  }
  return error;
}

function hostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true; // HTTP/1.0 clients without Host header
  const host = hostHeader.trim().toLowerCase();
  const hostname = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : (host.split(':')[0] ?? '');
  return (LOOPBACK_HOSTS as readonly string[]).includes(hostname);
}

export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  return (LOOPBACK_HOSTS as readonly string[]).includes(value) || value === '::ffff:127.0.0.1';
}

function assertLoopback(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new AppError('INVALID_PARAM', 'REST server may only listen on a loopback address', {
      param: 'host',
      reason: 'HOST_NOT_ALLOWED',
      allowed: ['127.0.0.1', 'localhost', '::1'],
    });
  }
}

function unknownQueryParams(query: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(query).filter((key) => !allowed.includes(key));
}

/** Default: silently ignore unknown query params; strict_params rejects them (docs/03 §1.3). */
function assertNoUnknownQuery(ctx: AppContext, query: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = unknownQueryParams(query, allowed);
  if (unknown.length > 0 && ctx.cfg.rest.strict_params) {
    throw new AppError('INVALID_PARAM', 'unknown query parameters', { reason: 'UNKNOWN_QUERY_PARAM', params: unknown });
  }
}

function query(ctx: FastifyRequest): Record<string, unknown> {
  return (ctx.query ?? {}) as Record<string, unknown>;
}

function sumEntries(stats: ReturnType<AppContext['cache']['stats']>): number {
  return Object.values(stats.entries as Record<string, number>).reduce((a, b) => a + b, 0);
}

async function buildHealthData(ctx: AppContext, deep: boolean): Promise<Record<string, unknown>> {
  const stats = ctx.cache.stats();
  const session = sessionState(ctx.cfg);
  let cacheWritable = true;
  if (deep) {
    try {
      ctx.cache.setRuntime('health.probe', String(Date.now()));
    } catch {
      cacheWritable = false;
    }
  }
  let reachable: boolean | null = null;
  let latencyMs: number | null = null;
  const lastOkAt = ctx.cache.getRuntime('upstream.last_ok_at');
  if (deep) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://m.made-in-china.com/', {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'mic-client-health-probe/1.0' },
      });
      clearTimeout(timer);
      reachable = res.status < 500;
      latencyMs = Date.now() - started;
      if (reachable) ctx.cache.setRuntime('upstream.last_ok_at', nowIso());
    } catch {
      reachable = false;
    }
  }
  const status = deep && (reachable === false || !cacheWritable) ? 'degraded' : 'ok';
  const mode = session.login === true ? 'logged_in' : session.storage_state_present ? 'anonymous' : 'unknown';
  return {
    status,
    version: VERSION,
    api_version: API_VERSION,
    uptime_seconds: Math.max(0, Math.floor((Date.now() - ctx.startedAt) / 1000)),
    started_at: toIsoCst(ctx.startedAt),
    session: {
      mode,
      storage_state_present: session.storage_state_present,
      storage_state_age_seconds: session.storage_state_age_seconds,
      last_verified_at: session.last_verified_at,
      challenge_suspected: false,
    },
    cache: {
      enabled: ctx.cfg.cache.enabled,
      ok: cacheWritable,
      path: stats.db_path,
      entries: sumEntries(stats),
      size_bytes: stats.db_size_bytes,
      stale_entries: stats.stale_entries,
    },
    upstream: {
      probed: deep,
      reachable,
      latency_ms: latencyMs,
      last_ok_at: ctx.cache.getRuntime('upstream.last_ok_at') ?? lastOkAt ?? null,
    },
  };
}

interface InvalidationSnapshot {
  search_pages: number;
  search_indexes: number;
  companies: number;
  company_details: number;
  enrichment: number;
  regions: number;
  total: number;
}

function invalidationSnapshot(ctx: AppContext): InvalidationSnapshot {
  const enrichment = countTables(ctx, ['audit_info', 'response_info', 'contact_info', 'review_summary']);
  const regions = tableCount(ctx, 'regions_cities') + tableCount(ctx, 'regions_provinces');
  const snapshot = {
    search_pages: tableCount(ctx, 'search_page_cache'),
    search_indexes: tableCount(ctx, 'search_indexes'),
    companies: tableCount(ctx, 'companies'),
    company_details: tableCount(ctx, 'company_details') + tableCount(ctx, 'membership_info'),
    enrichment,
    regions,
  };
  return { ...snapshot, total: Object.values(snapshot).reduce((a, b) => a + b, 0) };
}

function diffSnapshot(before: InvalidationSnapshot, after: InvalidationSnapshot): InvalidationSnapshot {
  const diff = {
    search_pages: before.search_pages - after.search_pages,
    search_indexes: before.search_indexes - after.search_indexes,
    companies: before.companies - after.companies,
    company_details: before.company_details - after.company_details,
    enrichment: before.enrichment - after.enrichment,
    regions: before.regions - after.regions,
  };
  return { ...diff, total: Object.values(diff).reduce((a, b) => a + b, 0) };
}

function resolveAccountForCompanyTarget(ctx: AppContext, target: Record<string, unknown>): string {
  const accountRaw = firstString(target['account']);
  if (accountRaw) return resolveCompanyPathInput(accountRaw).account ?? accountRaw;
  const comId = firstString(target['com_id']);
  if (comId) {
    try {
      const row = ctx.cache.db
        .prepare('SELECT account FROM companies WHERE company_id = ? LIMIT 1')
        .get(Number(comId)) as { account?: string } | undefined;
      if (row?.account) return row.account;
    } catch {
      /* fall through */
    }
    throw new AppError('NOT_FOUND', 'company not found by com_id (not indexed locally)', {
      input: comId,
      reason: 'COM_ID_UNRESOLVED',
      hint: 'search the company first, or use account',
    });
  }
  const encode = firstString(target['encode_com_id']);
  if (encode) {
    const account = findAccountByEncodeComId(ctx, encode);
    if (account) return account;
    throw new AppError('NOT_FOUND', 'company not found by encode com id (not indexed locally)', {
      input: encode,
      reason: 'ENCODE_COM_ID_NOT_INDEXED',
      hint: 'search the company first, or use mainUserAccount / numeric com id',
    });
  }
  throw new AppError('INVALID_PARAM', 'company target requires account, com_id or encode_com_id', {
    param: 'target',
    reason: 'INVALID_TARGET',
  });
}

async function runCompanyDetail(
  ctx: AppContext,
  options: RestServerOptions,
  input: CompanyLookupInput,
  requestId: string,
): Promise<CompanyDetailResponse> {
  if (options.companyDetail) return options.companyDetail(input, requestId);
  return getCompanyDetail(ctx, input, requestId);
}

export function buildRestServer(ctx: AppContext, options: RestServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: MAX_BODY_BYTES,
  });

  // Request id + Host validation (DNS rebinding guard, docs/03 §1.2).
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const raw = request.headers['x-request-id'];
    const headerValue = typeof raw === 'string' ? raw : undefined;
    const requestId = headerValue && REQUEST_ID_PATTERN.test(headerValue) ? headerValue : newRequestId();
    requestIds.set(request, requestId);
    void reply.header('X-Request-Id', requestId);
    if (!hostAllowed(request.headers.host)) {
      throw new AppError('INVALID_PARAM', 'Host header is not allowed', {
        reason: 'HOST_NOT_ALLOWED',
        allowed: ['127.0.0.1', 'localhost', '::1'],
      });
    }
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const requestId = requestIdOf(request);
    void reply.header('X-Request-Id', requestId);
    const error = new AppError('NOT_FOUND', `route not found: ${request.method} ${request.url.split('?')[0] ?? ''}`, {
      reason: 'ROUTE_NOT_FOUND',
      path: request.url.split('?')[0] ?? '',
    });
    void reply.code(404).send(makeErrorEnvelope(error, requestId));
  });

  app.setErrorHandler((rawError: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const requestId = requestIdOf(request);
    const error = toPublicError(mapUnknownError(rawError));
    void reply.header('X-Request-Id', requestId);
    if (error.code === 'RATE_LIMITED') {
      const retryAfter = Number(error.details?.['retry_after_seconds'] ?? 2);
      void reply.header('Retry-After', String(Number.isFinite(retryAfter) && retryAfter >= 1 ? Math.ceil(retryAfter) : 2));
    }
    void reply.code(error.httpStatus).send(makeErrorEnvelope(error, requestId));
  });

  // -------------------------------------------------------------------------
  // Auxiliary: self-describing docs (docs/03 §2.3, ADR-0008) — not business API
  // -------------------------------------------------------------------------
  app.get('/openapi.json', async (request: FastifyRequest, reply: FastifyReply) => {
    void reply.header('X-Request-Id', requestIdOf(request));
    void reply.header('Cache-Control', 'no-store');
    void reply.type('application/json; charset=utf-8');
    return buildOpenApiDocument();
  });

  app.get('/docs', async (request: FastifyRequest, reply: FastifyReply) => {
    void reply.header('X-Request-Id', requestIdOf(request));
    void reply.header('Cache-Control', 'no-store');
    void reply.type('text/html; charset=utf-8');
    return renderDocsHtml('/openapi.json');
  });

  // -------------------------------------------------------------------------
  // GET /health
  // -------------------------------------------------------------------------
  app.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = requestIdOf(request);
    const queryObj = query(request);
    assertNoUnknownQuery(ctx, queryObj, ['deep']);
    const deep = parseStrictBoolean(queryObj['deep'], 'deep') ?? false;
    const data = await buildHealthData(ctx, deep);
    const meta: Meta = {
      request_id: requestId,
      cached: false,
      stale: false,
      fetched_at: nowIso(),
      source: 'cache',
      warnings: [],
    };
    void reply.header('X-Request-Id', requestId);
    return makeOk(data, meta);
  });

  // -------------------------------------------------------------------------
  // GET /api/version
  // -------------------------------------------------------------------------
  app.get('/api/version', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = requestIdOf(request);
    assertNoUnknownQuery(ctx, query(request), []);
    const meta: Meta = { request_id: requestId, cached: true, stale: false, fetched_at: nowIso(), source: 'cache', warnings: [] };
    void reply.header('X-Request-Id', requestId);
    return makeOk(buildVersionData(), meta);
  });

  // -------------------------------------------------------------------------
  // GET /api/regions
  // -------------------------------------------------------------------------
  app.get('/api/regions', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = requestIdOf(request);
    const queryObj = query(request);
    assertNoUnknownQuery(ctx, queryObj, ['province', 'refresh']);
    const province = firstString(queryObj['province']);
    const refresh = parseStrictBoolean(queryObj['refresh'], 'refresh') ?? false;
    if (refresh) ctx.cache.clear('regions');
    const data = buildRegionsData(province);
    const meta: Meta = { request_id: requestId, cached: true, stale: false, fetched_at: nowIso(), source: 'cache', warnings: [] };
    void reply.header('X-Request-Id', requestId);
    return makeOk(data, meta);
  });

  // -------------------------------------------------------------------------
  // GET /api/membership/levels
  // -------------------------------------------------------------------------
  app.get('/api/membership/levels', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = requestIdOf(request);
    assertNoUnknownQuery(ctx, query(request), []);
    const meta: Meta = { request_id: requestId, cached: true, stale: false, fetched_at: nowIso(), source: 'cache', warnings: [] };
    void reply.header('X-Request-Id', requestId);
    return makeOk(buildMembershipLevelsData(), meta);
  });

  // -------------------------------------------------------------------------
  // GET /api/cache/stats
  // -------------------------------------------------------------------------
  app.get('/api/cache/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = requestIdOf(request);
    assertNoUnknownQuery(ctx, query(request), []);
    const meta: Meta = { request_id: requestId, cached: false, stale: false, fetched_at: nowIso(), source: 'cache', warnings: [] };
    void reply.header('X-Request-Id', requestId);
    return makeOk(buildCacheStatsData(ctx), meta);
  });

  // -------------------------------------------------------------------------
  // GET /api/search/factories
  // -------------------------------------------------------------------------
  const SEARCH_QUERY_KEYS = [
    'keyword',
    'province',
    'city',
    'category_code',
    'membership_tier',
    'audited',
    'management_certification',
    'business_type',
    'annual_revenue',
    'rd_capacity',
    'page',
    'page_size',
    'refresh',
    'include_ads',
  ] as const;

  app.get('/api/search/factories', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = requestIdOf(request);
    const queryObj = query(request);
    assertNoUnknownQuery(ctx, queryObj, SEARCH_QUERY_KEYS);
    const page = parseIntInRange(queryObj['page'], 'page', 1, 100);
    const pageSize = parseIntInRange(queryObj['page_size'], 'page_size', 1, 100);
    const refresh = parseStrictBoolean(queryObj['refresh'], 'refresh');
    const audited = parseStrictBoolean(queryObj['audited'], 'audited');
    const includeAds = parseStrictBoolean(queryObj['include_ads'], 'include_ads');
    const input = {
      keyword: firstString(queryObj['keyword']),
      province: firstString(queryObj['province']),
      city: firstString(queryObj['city']),
      category_code: firstString(queryObj['category_code']),
      membership_tier: firstString(queryObj['membership_tier']),
      audited,
      management_certification: firstString(queryObj['management_certification']),
      business_type: firstString(queryObj['business_type']),
      annual_revenue: firstString(queryObj['annual_revenue']),
      rd_capacity: firstString(queryObj['rd_capacity']),
      page,
      page_size: pageSize,
      refresh,
      include_ads: includeAds,
      request_id: requestId,
    };
    let result;
    try {
      result = await ctx.search.search(input);
    } catch (e) {
      if (isAppError(e) && e.code === 'CAPTCHA_REQUIRED' && ctx.cfg.upstream.browser_enabled && ctx.cfg.captcha.autosolve) {
        const srcUrl = typeof e.details?.['src_url'] === 'string' ? e.details['src_url'] : undefined;
        await solveCaptchaForHttp(ctx, srcUrl);
        result = await ctx.search.search(input);
      } else {
        throw e;
      }
    }
    void reply.header('X-Request-Id', requestId);
    return makeOk(result.data, fitMeta(result.meta, requestId));
  });

  // -------------------------------------------------------------------------
  // GET /api/companies/:account
  // -------------------------------------------------------------------------
  app.get('/api/companies/:account', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = requestIdOf(request);
    const queryObj = query(request);
    assertNoUnknownQuery(ctx, queryObj, ['include', 'refresh']);
    const rawAccount = (request.params as { account?: string }).account ?? '';
    let input = resolveCompanyPathInput(decodeURIComponent(rawAccount));
    if (input.account && !input.encode_com_id) {
      const indexed = findAccountByEncodeComId(ctx, input.account);
      if (indexed) input = { account: indexed, encode_com_id: input.account };
    }
    input.include = parseIncludeTokens(firstString(queryObj['include']));
    const refresh = parseStrictBoolean(queryObj['refresh'], 'refresh');
    if (refresh !== undefined) input.refresh = refresh;
    const result = await runCompanyDetail(ctx, options, input, requestId);
    void reply.header('X-Request-Id', requestId);
    return makeOk(result.data, fitMeta(result.meta, requestId, { cached: false, source: 'json' }));
  });

  // -------------------------------------------------------------------------
  // POST /api/cache/refresh
  // -------------------------------------------------------------------------
  app.post('/api/cache/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = requestIdOf(request);
    assertNoUnknownQuery(ctx, query(request), []);
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body !== 'object' || Array.isArray(body)) {
      throw new AppError('INVALID_PARAM', 'request body must be a JSON object', { reason: 'INVALID_JSON' });
    }
    const scopeRaw = body['scope'];
    if (typeof scopeRaw !== 'string' || !scopeRaw) {
      throw new AppError('INVALID_PARAM', 'scope is required', {
        param: 'scope',
        reason: 'INVALID_SCOPE',
        allowed: ['search', 'company', 'regions', 'all'],
      });
    }
    const scope = scopeRaw as 'search' | 'company' | 'regions' | 'all';
    cacheClearScope(scope); // validates the enum
    const waitRaw = body['wait'];
    if (waitRaw !== undefined && typeof waitRaw !== 'boolean') {
      throw new AppError('INVALID_PARAM', 'wait must be a boolean', { param: 'wait', reason: 'INVALID_ENUM' });
    }
    const wait = waitRaw === true;
    const target = body['target'];
    if (scope === 'all' && target !== undefined && target !== null) {
      throw new AppError('INVALID_PARAM', 'scope=all does not accept a target', { param: 'target', reason: 'INVALID_TARGET' });
    }
    if ((scope === 'search' || scope === 'company') && (!target || typeof target !== 'object' || Array.isArray(target))) {
      throw new AppError('INVALID_PARAM', `scope=${scope} requires a target object`, { param: 'target', reason: 'INVALID_TARGET' });
    }

    const before = invalidationSnapshot(ctx);
    let normalizedTarget: Record<string, unknown> | null = null;
    let resultData: unknown = null;

    if (scope === 'search') {
      const searchTarget = target as Record<string, unknown>;
      normalizedTarget = { ...searchTarget };
      ctx.cache.clear('search');
      if (wait) {
        const searchResult = await ctx.search.search({
          keyword: firstString(searchTarget['keyword']),
          province: firstString(searchTarget['province']),
          city: firstString(searchTarget['city']),
          category_code: firstString(searchTarget['category_code']),
          membership_tier: firstString(searchTarget['membership_tier']),
          audited: parseStrictBoolean(searchTarget['audited'], 'audited'),
          management_certification: firstString(searchTarget['management_certification']),
          business_type: firstString(searchTarget['business_type']),
          annual_revenue: firstString(searchTarget['annual_revenue']),
          rd_capacity: firstString(searchTarget['rd_capacity']),
          page: parseIntInRange(searchTarget['page'], 'page', 1, 100, 1),
          page_size: parseIntInRange(searchTarget['page_size'], 'page_size', 1, 100),
          refresh: true,
          include_ads: parseStrictBoolean(searchTarget['include_ads'], 'include_ads'),
          request_id: requestId,
        });
        resultData = searchResult.data;
      }
    } else if (scope === 'company') {
      const companyTarget = target as Record<string, unknown>;
      const account = resolveAccountForCompanyTarget(ctx, companyTarget);
      const includeRaw = companyTarget['include'];
      const include = parseIncludeTokens(
        Array.isArray(includeRaw) ? includeRaw.map(String).join(',') : firstString(includeRaw),
      );
      normalizedTarget = { ...companyTarget, account, include };
      const db = ctx.cache.db;
      db.prepare('DELETE FROM company_details WHERE account = ?').run(account);
      db.prepare('DELETE FROM membership_info WHERE account = ?').run(account);
      const includeTables: Record<string, string> = {
        audit: 'audit_info',
        response: 'response_info',
        contacts: 'contact_info',
        reviews: 'review_summary',
      };
      for (const key of include) {
        const table = includeTables[key];
        if (!table) continue;
        try {
          db.prepare(`DELETE FROM ${table} WHERE account = ?`).run(account);
        } catch {
          /* optional table */
        }
      }
      if (wait) {
        const company = await runCompanyDetail(
          ctx,
          options,
          { account, include, refresh: true, request_id: requestId },
          requestId,
        );
        resultData = company.data;
      }
    } else if (scope === 'regions') {
      normalizedTarget = target && typeof target === 'object' ? { ...(target as Record<string, unknown>) } : null;
      ctx.cache.clear('regions');
      if (wait) {
        const province = normalizedTarget ? firstString(normalizedTarget['province']) : undefined;
        resultData = buildRegionsData(province);
      }
    } else {
      ctx.cache.clear('all');
    }

    const after = invalidationSnapshot(ctx);
    const invalidated = diffSnapshot(before, after);
    const now = nowIso();
    ctx.cache.setRuntime('cache.last_refresh_at', now);
    const data = {
      scope,
      wait,
      enabled: ctx.cfg.cache.enabled,
      target: normalizedTarget,
      invalidated,
      result: resultData,
    };
    const meta: Meta = {
      request_id: requestId,
      cached: false,
      stale: false,
      fetched_at: now,
      source: wait ? 'json' : 'cache',
      warnings: [],
    };
    void reply.header('X-Request-Id', requestId);
    return makeOk(data, meta);
  });

  return app;
}

/**
 * Validate the listen address, start the server and return a handle with a graceful close.
 * Non-loopback hosts are rejected before binding (docs/03 §1.1 / ADR-0007).
 */
export async function startRestServer(
  ctx: AppContext,
  options: StartRestServerOptions = {},
): Promise<RunningRestServer> {
  const host = options.host ?? ctx.cfg.rest.host;
  const port = options.port ?? ctx.cfg.rest.port;
  assertLoopback(host);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new AppError('INVALID_PARAM', 'port out of range', { param: 'port', reason: 'OUT_OF_RANGE', min: 0, max: 65535 });
  }
  const app = buildRestServer(ctx, options);
  try {
    await app.listen({ host, port });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'EADDRINUSE') {
      await app.close().catch(() => undefined);
      throw new AppError('CONFIG_ERROR', `port ${port} is already in use`, {
        reason: 'PORT_IN_USE',
        host,
        port,
        hint: 'stop the other instance or use --port 0 for a random port',
      });
    }
    await app.close().catch(() => undefined);
    throw new AppError('CONFIG_ERROR', `failed to start REST server: ${String((e as Error).message ?? e)}`, {
      reason: 'LISTEN_FAILED',
      host,
      port,
    });
  }
  const address = app.server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const actualHost = typeof address === 'object' && address ? address.address : host;
  return {
    app,
    host: actualHost,
    port: actualPort,
    healthUrl: `http://${host}:${actualPort}/health`,
    close: async () => {
      await app.close();
    },
  };
}

export type { ErrorCode };
