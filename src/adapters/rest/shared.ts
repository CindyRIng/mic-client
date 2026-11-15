/**
 * Adapter-layer shared glue used by both the REST server and the MCP server:
 * response-envelope helpers, static data builders (regions / membership levels /
 * version / cache stats) and the tolerant bridge to the M2 company-detail service.
 *
 * NOTE: this file lives under adapters/rest only because the M3 write scope allows
 * `src/adapters/rest/**` + `src/adapters/mcp/**`; the MCP adapter imports it. It has
 * no Fastify dependency and is safe for stdio usage.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'better-sqlite3';
import type { AppContext } from '../../core/container.js';
import { AppError, makeMeta, type Meta } from '../../core/errors.js';
import type { CompanyDetail, MembershipLevels, Province, RegionsResult } from '../../core/models.js';
import { listRegions, membershipLevels } from '../../core/services/static.js';
import { VERSION, UPSTREAM_CONTRACT_VERSION } from '../../version.js';

export const API_VERSION = 'v1';
export const CST_OFFSET_MS = 8 * 60 * 60 * 1000;

/** ISO8601 in +08:00 (docs/03 §1.4). */
export function toIsoCst(ms: number = Date.now()): string {
  return new Date(ms + CST_OFFSET_MS).toISOString().replace('Z', '+08:00');
}

export function nowIso(): string {
  return toIsoCst();
}

export function toIsoCstOrNull(epochSeconds: number | null | undefined): string | null {
  if (epochSeconds === null || epochSeconds === undefined) return null;
  return toIsoCst(epochSeconds * 1000);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function baseMeta(requestId: string, partial: Partial<Meta> = {}): Meta {
  return makeMeta({ request_id: requestId, fetched_at: nowIso(), source: 'cache', ...partial });
}

/** meta for an error envelope: local errors use source=cache, upstream errors use json. */
export function errorMeta(code: string, requestId: string, source?: Meta['source']): Meta {
  const upstream =
    code === 'UPSTREAM_CHANGED' ||
    code === 'UPSTREAM_UNAVAILABLE' ||
    code === 'PARSE_ERROR' ||
    code === 'CAPTCHA_SOLVE_FAILED' ||
    code === 'CAPTCHA_REQUIRED';
  return baseMeta(requestId, { source: source ?? (upstream ? 'json' : 'cache'), fetched_at: nowIso() });
}

/** Fill missing meta fields when the underlying service returns a partial object. */
export function fitMeta(raw: unknown, requestId: string, fallback: Partial<Meta> = {}): Meta {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Partial<Meta>;
  return {
    request_id: typeof obj.request_id === 'string' && obj.request_id ? obj.request_id : requestId,
    cached: typeof obj.cached === 'boolean' ? obj.cached : (fallback.cached ?? false),
    stale: typeof obj.stale === 'boolean' ? obj.stale : (fallback.stale ?? false),
    fetched_at: typeof obj.fetched_at === 'string' && obj.fetched_at ? obj.fetched_at : (fallback.fetched_at ?? nowIso()),
    source: obj.source ?? fallback.source ?? 'cache',
    warnings: Array.isArray(obj.warnings) ? obj.warnings : (fallback.warnings ?? []),
  };
}

// ---------------------------------------------------------------------------
// Regions (docs/03 §5 / §11.13)
// ---------------------------------------------------------------------------

export {
  buildRegionsData,
  type ProvinceDetailData,
  type ProvincesData,
  type RegionCityData,
  type RegionProvinceData,
} from '../../core/services/static.js';

// ---------------------------------------------------------------------------
// Membership levels (docs/03 §6)
// ---------------------------------------------------------------------------

export interface MembershipTierData {
  tier: string;
  name_zh: string;
  name_en: string;
  rank: number;
  price_cny_per_year: number | null;
  raw_cs_level: number | null;
  badge: string | null;
  evidence_hint: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface MembershipLevelsData {
  tiers: MembershipTierData[];
  audit: Record<string, unknown>;
  big_customer_programs: Array<Record<string, unknown>>;
  not_mic_tiers: Array<Record<string, unknown>>;
  raw_field_mapping: Record<string, Record<string, string>>;
}

const TIER_META: Record<
  string,
  Omit<MembershipTierData, 'tier' | 'price_cny_per_year'>
> = {
  diamond: {
    name_zh: '钻石会员',
    name_en: 'Diamond Member',
    rank: 3,
    raw_cs_level: 50,
    badge: 'icon-diamond / diamond_32.png',
    evidence_hint: 'json:csLevel=50 或 json:memberLevel=diamond',
    confidence: 'high',
  },
  gold: {
    name_zh: '金牌会员',
    name_en: 'Gold Member',
    rank: 2,
    raw_cs_level: 30,
    badge: 'icon-gold / gold_32.png',
    evidence_hint: 'json:csLevel=30 或 json:memberLevel=gold',
    confidence: 'high',
  },
  free: {
    name_zh: '免费会员',
    name_en: 'Free Member (no badge)',
    rank: 1,
    raw_cs_level: null,
    badge: null,
    evidence_hint: '页面完整加载且无会员徽章/无 AS/无 member-since（需详情确认，列表侧不猜 free）',
    confidence: 'medium',
  },
  unknown: {
    name_zh: '未知',
    name_en: 'Unknown',
    rank: 0,
    raw_cs_level: null,
    badge: null,
    evidence_hint: '无可靠证据（新版列表页/结构变化/风控），不猜测',
    confidence: 'low',
  },
};

export function buildMembershipLevelsData(): MembershipLevelsData {
  const levels: MembershipLevels = membershipLevels();
  return {
    tiers: levels.levels.map((l) => ({
      tier: l.tier,
      ...(TIER_META[l.tier] ?? TIER_META['unknown']!),
      price_cny_per_year: l.price_cny_per_year,
    })),
    audit: {
      independent_of_tier: true,
      name_zh: '认证供应商',
      name_en: 'Audited Supplier',
      upstream_flags: ['sgsMember', 'auditType', 'showAuditLogo', 'auditReportLogo.logoText'],
      agencies: ['SGS', 'Bureau Veritas', 'TÜV Rheinland', 'CCIC', 'CTI'],
      note: 'AS 与会员等级正交；列表 auditType/showAuditLogo、详情 sgsMember/auditReportLogo 判定',
    },
    big_customer_programs: [
      { code: 'youxiang', name_zh: '优享', public_badge: false, note: '大客户分层；公网无独立徽章，客户端不抓取' },
      { code: 'zunxiang', name_zh: '尊享', public_badge: false, note: '官方承认、未纳入正式会员级别' },
      { code: 'mka', name_zh: 'MKA', public_badge: false, note: '面向行业龙头供应商的大客户会员' },
    ],
    not_mic_tiers: [
      { code: 'ka', name: 'KA', reason: '阿里巴巴国际站客户分层（Key Account），公网无 MIC 标识，禁止映射进 membership.tier' },
      { code: 'ska', name: 'SKA', reason: '阿里国际站 Super Key Account，同上' },
      { code: 'gska', name: 'GSKA', reason: '阿里国际站 Group Super Key Account，同上' },
    ],
    raw_field_mapping: { csLevel: { '50': 'diamond', '30': 'gold' }, memberLevel: { diamond: 'diamond', gold: 'gold' } },
  };
}

// ---------------------------------------------------------------------------
// Version / cache stats (docs/03 §4/§10)
// ---------------------------------------------------------------------------

export function buildVersionData(): Record<string, unknown> {
  return {
    name: 'mic-client',
    version: VERSION,
    api_version: API_VERSION,
    build: { commit: null, built_at: null },
    node_version: process.version,
    upstream_contract: {
      version: UPSTREAM_CONTRACT_VERSION,
      researched_at: `${UPSTREAM_CONTRACT_VERSION}T22:50:00+08:00`,
      notes: 'm-site anonymous JSON endpoints (search/refine/company ssrData/enrichment)',
    },
  };
}

export function buildCacheStatsData(ctx: AppContext): Record<string, unknown> {
  const stats = ctx.cache.stats();
  const entries = stats.entries as Record<string, number>;
  const sumEntries = Object.values(entries).reduce((a, b) => a + b, 0);
  let walSize = 0;
  try {
    walSize = fs.statSync(`${stats.db_path}-wal`).size;
  } catch {
    walSize = 0;
  }
  return {
    enabled: stats.enabled,
    db: {
      path: stats.db_path,
      schema_version: stats.schema_version,
      size_bytes: stats.db_size_bytes,
      wal_size_bytes: walSize,
      ok: true,
    },
    entries: {
      search_pages: entries['search_page_cache'] ?? 0,
      search_indexes: entries['search_indexes'] ?? 0,
      companies: entries['companies'] ?? 0,
      company_details: entries['company_details'] ?? 0,
      enrichment: countTables(ctx, ['audit_info', 'response_info', 'contact_info', 'review_summary']),
      regions: countTables(ctx, ['regions_provinces', 'regions_cities']),
      total: sumEntries,
    },
    stale_entries: stats.stale_entries,
    hit_stats: { scope: 'process_lifetime', hits: 0, misses: 0, hit_rate: 0 },
    ttl_seconds: stats.ttl_seconds,
    last_refresh_at: ctx.cache.getRuntime('cache.last_refresh_at'),
    last_vacuum_at: ctx.cache.getRuntime('cache.last_vacuum_at'),
  };
}

/** Count rows in optional tables; missing tables count as 0. */
export function countTables(ctx: AppContext, tables: string[]): number {
  return tables.reduce((sum, table) => sum + tableCount(ctx, table), 0);
}

export function tableCount(ctx: AppContext, table: string): number {
  try {
    const db = ctx.cache.db as Database;
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number } | undefined;
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Company detail service bridge (M2: src/core/company/service.ts) — tolerant
// ---------------------------------------------------------------------------

export interface CompanyLookupInput {
  account?: string;
  com_id?: string;
  encode_com_id?: string;
  include?: string[];
  refresh?: boolean;
  request_id?: string;
  /** Optional captcha handler injected into the M2 service (browser fallback). */
  onCaptcha?: (srcUrl: string) => Promise<void>;
}

export interface CompanyDetailResponse {
  data: CompanyDetail;
  meta: Meta;
}

type Invoker = (ctx: AppContext, input: CompanyLookupInput, requestId: string) => Promise<CompanyDetailResponse>;

interface CompanyServiceLike {
  get(input: CompanyLookupInput & { request_id?: string }): Promise<unknown>;
}

/** `ctx.company` is wired by core/container.ts (M2); prefer it over the dynamic bridge. */
function ctxCompany(ctx: AppContext): CompanyServiceLike | null {
  const candidate = (ctx as unknown as { company?: unknown }).company;
  if (candidate && typeof (candidate as CompanyServiceLike).get === 'function') return candidate as CompanyServiceLike;
  return null;
}

const COMPANY_FN_NAMES = ['getCompanyDetail', 'getCompany', 'getDetail', 'fetchCompanyDetail', 'fetchCompany', 'detail', 'get'];
const COMPANY_CLASS_NAMES = ['CompanyService', 'CompanyDetailService', 'DetailService', 'Company'];
const COMPANY_METHOD_NAMES = ['getCompanyDetail', 'getCompany', 'getDetail', 'detail', 'fetchDetail', 'fetchCompany', 'get', 'run'];
const COMPANY_FACTORY_NAMES = ['createCompanyService', 'createCompanyDetailService', 'createDetailService'];

let companyInvoker: Invoker | null = null;
let companyInvokerResolved = false;
let companyModule: Record<string, unknown> | null = null;

async function importCompanyModule(): Promise<Record<string, unknown> | null> {
  if (companyModule) return companyModule;
  const specifier = new URL('../../core/company/service.js', import.meta.url).href;
  try {
    const mod = (await import(specifier)) as Record<string, unknown>;
    companyModule = mod;
    return mod;
  } catch {
    return null;
  }
}

function looksLikeCompanyDetail(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && 'account' in (value as object) && 'membership' in (value as object));
}

function normalizeCompanyResult(result: unknown, requestId: string): CompanyDetailResponse {
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if (obj['ok'] === true && obj['data']) {
      return { data: obj['data'] as CompanyDetail, meta: fitMeta(obj['meta'], requestId) };
    }
    if (obj['data'] && obj['meta']) {
      return { data: obj['data'] as CompanyDetail, meta: fitMeta(obj['meta'], requestId, { cached: false, source: 'json' }) };
    }
    if (looksLikeCompanyDetail(obj)) {
      return { data: obj as unknown as CompanyDetail, meta: fitMeta(null, requestId, { cached: false, source: 'json' }) };
    }
  }
  throw new AppError('UPSTREAM_CHANGED', 'company detail service returned an unexpected shape', {
    service: 'src/core/company/service.ts',
    hint: 'the service must return {data: CompanyDetail, meta: Meta}',
  });
}

async function callCompanyFn(fn: (...args: unknown[]) => unknown, input: CompanyLookupInput): Promise<unknown> {
  const attempts: Array<() => unknown> = [
    () => fn(input),
    () => fn({ ...input, include: input.include ?? ['audit', 'response'] }),
    () => fn(input.account ?? input.com_id ?? input.encode_com_id, input.include, input.refresh),
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof TypeError) {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function serviceArgs(ctx: AppContext): unknown[] {
  return [ctx.cfg, ctx.logger, ctx.cache, ctx.http, ctx.supplierApi, ctx.search];
}

function instantiateCompanyService(Ctor: new (...args: never[]) => unknown, ctx: AppContext): unknown {
  const args = serviceArgs(ctx);
  const arity = Math.max(0, Math.min(args.length, Ctor.length ?? args.length));
  if (arity === 0) return new (Ctor as unknown as new () => unknown)();
  if (arity === 1) return new (Ctor as unknown as new (v: unknown) => unknown)(ctx);
  return new (Ctor as unknown as new (...a: unknown[]) => unknown)(...args.slice(0, arity));
}

function findMethod(service: unknown): string | null {
  if (!service || typeof service !== 'object') return null;
  for (const name of COMPANY_METHOD_NAMES) {
    if (typeof (service as Record<string, unknown>)[name] === 'function') return name;
  }
  return null;
}

function methodInvoker(resolveService: (ctx: AppContext) => unknown, label: string): Invoker {
  return async (ctx, input, requestId) => {
    let service: unknown;
    try {
      service = resolveService(ctx);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('UPSTREAM_CHANGED', `company detail service failed to initialize (${label})`, {
        reason: 'SERVICE_INIT_FAILED',
        error: errorMessage(e),
      });
    }
    const method = findMethod(service);
    if (!method) {
      throw new AppError('UPSTREAM_CHANGED', `company detail service has no usable method (${label})`, {
        expected_methods: COMPANY_METHOD_NAMES,
      });
    }
    const fn = (service as Record<string, unknown>)[method] as (...args: unknown[]) => unknown;
    return normalizeCompanyResult(await callCompanyFn(fn.bind(service) as (...args: unknown[]) => unknown, input), requestId);
  };
}

function classInvoker(Ctor: new (...args: never[]) => unknown, label: string): Invoker {
  const instances = new Map<AppContext, unknown>();
  return methodInvoker((ctx) => {
    let service = instances.get(ctx);
    if (!service) {
      service = instantiateCompanyService(Ctor, ctx);
      instances.set(ctx, service);
    }
    return service;
  }, label);
}

/**
 * Known M2 shape: `CompanyService(cfg, logger, cache, CompanyDetailApi, CompanyEnricher)`
 * with `get(input)`. The two API classes are instantiated from `core/api/{company,enrich}.js`
 * dynamically (variable specifiers keep this adapter independent of M2 typecheck state).
 */
async function buildKnownM2Invoker(mod: Record<string, unknown>): Promise<Invoker | null> {
  const Ctor = mod['CompanyService'];
  if (typeof Ctor !== 'function') return null;
  const apiSpecifier = new URL('../../core/api/company.js', import.meta.url).href;
  const enrichSpecifier = new URL('../../core/api/enrich.js', import.meta.url).href;
  try {
    const apiMod = (await import(apiSpecifier)) as Record<string, unknown>;
    const enrichMod = (await import(enrichSpecifier)) as Record<string, unknown>;
    const ApiCtor = apiMod['CompanyDetailApi'];
    const EnricherCtor = enrichMod['CompanyEnricher'];
    if (typeof ApiCtor !== 'function' || typeof EnricherCtor !== 'function') return null;
    const instances = new Map<AppContext, unknown>();
    return methodInvoker((ctx) => {
      let service = instances.get(ctx);
      if (!service) {
        const api = new (ApiCtor as new (http: unknown, logger: unknown) => unknown)(ctx.http, ctx.logger);
        const enricher = new (EnricherCtor as new (http: unknown, logger: unknown) => unknown)(ctx.http, ctx.logger);
        service = new (Ctor as new (...args: unknown[]) => unknown)(ctx.cfg, ctx.logger, ctx.cache, api, enricher);
        instances.set(ctx, service);
      }
      return service;
    }, 'CompanyService(M2)');
  } catch {
    return null;
  }
}

async function buildInvoker(): Promise<Invoker | null> {
  const mod = await importCompanyModule();
  if (!mod) return null;

  const known = await buildKnownM2Invoker(mod);
  if (known) return known;

  // 1) factory functions: `createCompanyService(ctx)` (lazy, cached per ctx)
  for (const name of COMPANY_FACTORY_NAMES) {
    const factory = mod[name] as ((ctx: AppContext) => unknown) | undefined;
    if (typeof factory !== 'function') continue;
    const instances = new Map<AppContext, unknown>();
    return methodInvoker((ctx) => {
      let service = instances.get(ctx);
      if (!service) {
        service = factory(ctx);
        instances.set(ctx, service);
      }
      return service;
    }, name);
  }

  // 2) module-level functions (e.g. `export function getCompanyDetail(input)`)
  for (const name of COMPANY_FN_NAMES) {
    const fn = mod[name];
    if (typeof fn !== 'function') continue;
    return async (_ctx, input, requestId) =>
      normalizeCompanyResult(await callCompanyFn(fn as (...args: unknown[]) => unknown, input), requestId);
  }

  // 3) classes (M2 style: `new CompanyService(cfg, logger, cache, ...)` + `getDetail(input)`)
  for (const name of COMPANY_CLASS_NAMES) {
    const Ctor = mod[name];
    if (typeof Ctor !== 'function') continue;
    return classInvoker(Ctor as new (...args: never[]) => unknown, name);
  }

  // 4) module-level singleton instance exported as a plain object
  for (const [key, value] of Object.entries(mod)) {
    if (key === 'default' || typeof value === 'function' || !value) continue;
    if (findMethod(value)) return methodInvoker(() => value, `export ${key}`);
  }

  // 5) default-exported class/function
  const def = mod['default'];
  if (typeof def === 'function') {
    return classInvoker(def as new (...args: never[]) => unknown, 'default export');
  }
  if (def && findMethod(def)) return methodInvoker(() => def, 'default export object');
  return null;
}

/** True when the M2 company-detail service is available (used by doctor/tests). */
export async function companyServiceReady(ctx?: AppContext): Promise<boolean> {
  if (ctx && ctxCompany(ctx)) return true;
  return (await importCompanyModule()) !== null;
}

/**
 * Fetch company detail through the M2 service. Degrades with NOT_FOUND when the
 * service module is not present yet (M2 in progress), so REST/MCP stay usable.
 */
export async function getCompanyDetail(
  ctx: AppContext,
  input: CompanyLookupInput,
  requestId: string,
): Promise<CompanyDetailResponse> {
  if (!companyInvokerResolved) {
    companyInvoker = await buildInvoker();
    companyInvokerResolved = true;
  }
  const withCaptcha: CompanyLookupInput = {
    ...input,
    request_id: requestId,
    onCaptcha: async (srcUrl: string) => {
      await solveCaptchaForHttp(ctx, srcUrl);
    },
  };
  const direct = ctxCompany(ctx);
  if (direct) {
    const normalized = normalizeCompanyResult(await direct.get(withCaptcha), requestId);
    return { data: normalized.data, meta: { ...normalized.meta, request_id: requestId } };
  }
  if (!companyInvoker) {
    throw new AppError('NOT_FOUND', 'company detail service is not available yet (M2 in progress)', {
      reason: 'COMPANY_SERVICE_NOT_READY',
      hint: 'use mic search for the factory list meanwhile; REST/MCP company endpoints work once M2 lands',
    });
  }
  const result = await companyInvoker(ctx, withCaptcha, requestId);
  return { data: result.data, meta: { ...result.meta, request_id: requestId } };
}

/** Reset the cached company-service bridge (tests / doctor reload). */
export function resetCompanyServiceBridge(): void {
  companyInvoker = null;
  companyInvokerResolved = false;
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function parseStrictBoolean(value: unknown, param: string): boolean | undefined {
  const raw = firstString(value);
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new AppError('INVALID_PARAM', `${param} must be true or false`, {
    param,
    reason: 'INVALID_ENUM',
    allowed: ['true', 'false'],
  });
}

export function parseIntInRange(value: unknown, param: string, min: number, max: number, dflt?: number): number | undefined {
  const raw = firstString(value);
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AppError('INVALID_PARAM', `${param} out of range`, { param, reason: 'OUT_OF_RANGE', min, max });
  }
  return n;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, reason = 'timeout'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError('UPSTREAM_UNAVAILABLE', `operation timed out after ${timeoutMs}ms`, {
          reason,
          timeout_ms: timeoutMs,
        }),
      );
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Browser fallback for HTTP paths: solve the Focus Captcha in the persistent browser,
 * then refresh the HTTP cookie jar from the exported session and let the caller retry.
 */
export async function solveCaptchaForHttp(ctx: AppContext, srcUrl?: string): Promise<void> {
  const { ensureVerifiedSession, loadSessionCookies } = await import('../../core/session/browser.js');
  await ensureVerifiedSession(srcUrl ?? 'https://m.made-in-china.com/', ctx.cfg, ctx.logger);
  ctx.http.cookies.load(loadSessionCookies(ctx.cfg));
}

export function resolveCompanyPathInput(raw: string): CompanyLookupInput {
  const input = raw.trim();
  if (!input) throw new AppError('INVALID_PARAM', 'account is required', { param: 'account', reason: 'INVALID_ACCOUNT' });
  if (/^\d+$/.test(input)) return { com_id: input };
  let candidate = input;
  try {
    const url = new URL(input);
    const hostLabel = url.hostname.split('.')[0] ?? '';
    const numericPath = url.pathname.match(/\/company\/(\d+)/);
    const pathMatch = url.pathname.match(/\/company-([A-Za-z0-9._-]+)/);
    if (numericPath?.[1]) return { com_id: numericPath[1] };
    if (pathMatch?.[1]) candidate = pathMatch[1];
    else if (hostLabel && hostLabel !== 'www' && hostLabel !== 'm') candidate = hostLabel;
  } catch {
    /* not a URL */
  }
  candidate = candidate.replace(/^company-/, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(candidate)) {
    throw new AppError('INVALID_PARAM', `invalid account: ${raw.slice(0, 80)}`, {
      param: 'account',
      reason: 'INVALID_ACCOUNT',
      allowed_pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$',
    });
  }
  return { account: candidate };
}

/** Look up an account by encodeComId using the local companies index (read-only). */
export function findAccountByEncodeComId(ctx: AppContext, encodeComId: string): string | null {
  try {
    const db = ctx.cache.db as Database;
    const row = db.prepare('SELECT account FROM companies WHERE encode_com_id = ? LIMIT 1').get(encodeComId) as
      | { account?: string }
      | undefined;
    return row?.account ?? null;
  } catch {
    return null;
  }
}

export const DEFAULT_INCLUDES = ['audit', 'response'] as const;
export const ALL_INCLUDES = ['audit', 'response', 'contacts', 'reviews'] as const;

export function parseIncludeTokens(raw: string | undefined): string[] {
  if (raw === undefined || raw === '') return [...DEFAULT_INCLUDES];
  const tokens = raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return [...DEFAULT_INCLUDES];
  if (tokens.includes('none')) {
    if (tokens.length > 1) {
      throw new AppError('INVALID_PARAM', 'include=none cannot be combined with other values', {
        param: 'include',
        reason: 'INVALID_INCLUDE',
        allowed: ['none', 'all', ...ALL_INCLUDES],
      });
    }
    return [];
  }
  if (tokens.includes('all')) return [...ALL_INCLUDES];
  for (const token of tokens) {
    if (!(ALL_INCLUDES as readonly string[]).includes(token)) {
      throw new AppError('INVALID_PARAM', `invalid include value: ${token}`, {
        param: 'include',
        reason: 'INVALID_INCLUDE',
        allowed: ['none', 'all', ...ALL_INCLUDES],
      });
    }
  }
  return [...new Set(tokens)];
}

export function cacheClearScope(scope: string): 'all' | 'search' | 'detail' | 'enrich' | 'regions' {
  switch (scope) {
    case 'search':
      return 'search';
    case 'company':
      return 'detail';
    case 'regions':
      return 'regions';
    case 'all':
      return 'all';
    default:
      throw new AppError('INVALID_PARAM', `invalid scope: ${scope}`, {
        param: 'scope',
        reason: 'INVALID_SCOPE',
        allowed: ['search', 'company', 'regions', 'all'],
      });
  }
}

export function safeStatSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

export function profileStorageStatePath(profileDir: string): string {
  return path.join(profileDir, 'storage-state.json');
}
