import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, ensureDirs, type Config } from '../../src/core/config.js';
import { Logger } from '../../src/core/logger.js';
import { HttpClient } from '../../src/core/http/client.js';
import { Cache } from '../../src/core/cache/cache.js';
import { CompanyDetailApi } from '../../src/core/api/company.js';
import { CompanyEnricher } from '../../src/core/api/enrich.js';
import { CompanyService } from '../../src/core/company/service.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(HERE, 'fixtures');

export function fixtureText(relPath: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, relPath), 'utf8');
}

export function fixtureJson<T = unknown>(relPath: string): T {
  return JSON.parse(fixtureText(relPath)) as T;
}

export function ssrFixture<T = Record<string, unknown>>(name: string): T {
  return fixtureJson<T>(`ssr-data/${name}`);
}

export function htmlFixture(name: string): string {
  return fixtureText(`html/${name}`);
}

export function enrichFixture<T = unknown>(name: string): T {
  return fixtureJson<T>(`enrich/${name}`);
}

/** 用 ssrData JSON 拼一个最小 info.html（可附加正文字段块）。 */
export function buildCompanyHtml(ssr: unknown, bodyItems: string[] = []): string {
  const body = bodyItems
    .map((it) => `      <li class="info-item"><span class="info-label">${it}</span></li>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>company</title></head>
<body><div class="company-detail"><ul class="info-list">
${body}
</ul></div>
<script type="text/json" id="ssrData">
${JSON.stringify(ssr)}
</script></body></html>`;
}

export interface MockCall {
  url: string;
  init: RequestInit;
}

export type MockHandler = (url: string, init: RequestInit, call: MockCall) => Response | Promise<Response>;

export interface FetchMock {
  calls: MockCall[];
  urls(): string[];
  restore(): void;
}

/** 替换 globalThis.fetch；返回调用记录与恢复函数。 */
export function installFetchMock(handler: MockHandler): FetchMock {
  const original = globalThis.fetch;
  const calls: MockCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const call = { url, init };
    calls.push(call);
    return handler(url, init, call);
  }) as typeof fetch;
  return {
    calls,
    urls: () => calls.map((c) => c.url),
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export function redirectResponse(location: string, status = 302): Response {
  return new Response('', { status, headers: { location } });
}

export interface TestContext {
  cfg: Config;
  logger: Logger;
  http: HttpClient;
  cache: Cache;
  api: CompanyDetailApi;
  enricher: CompanyEnricher;
  service: CompanyService;
  dataDir: string;
  close(): void;
}

export interface TestContextOptions {
  cacheEnabled?: boolean;
}

export function makeTestConfig(dataDir: string, opts: TestContextOptions = {}): Config {
  const cfg = structuredClone(DEFAULT_CONFIG);
  cfg.data_dir = dataDir;
  cfg.log_dir = path.join(dataDir, 'logs');
  cfg.profile_dir = path.join(dataDir, 'profile');
  cfg.db_file = 'mic.sqlite';
  cfg.log_level = 'error';
  cfg.upstream = { ...cfg.upstream, rate_min_ms: 0, rate_max_ms: 0, timeout_ms: 5000, queue_max_wait_ms: 60_000 };
  if (opts.cacheEnabled === false) cfg.cache = { ...cfg.cache, enabled: false };
  ensureDirs(cfg);
  return cfg;
}

export function createTestContext(opts: TestContextOptions = {}): TestContext {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mic-m2-company-'));
  const cfg = makeTestConfig(dataDir, opts);
  const logger = new Logger({ level: 'error', json: true });
  const http = new HttpClient(cfg, logger);
  const cache = new Cache(cfg, logger);
  const api = new CompanyDetailApi(http, logger);
  const enricher = new CompanyEnricher(http, logger);
  const service = new CompanyService(cfg, logger, cache, api, enricher);
  return {
    cfg,
    logger,
    http,
    cache,
    api,
    enricher,
    service,
    dataDir,
    close: () => {
      cache.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** 直接插入一条「列表搜索」写缓存的公司行（模拟 M1 search 的结果）。 */
export function seedListCompany(
  cache: Cache,
  input: {
    account: string;
    companyName?: string;
    csLevel?: number | null;
    audited?: boolean | null;
    province?: string | null;
    city?: string | null;
    country?: string | null;
    encodeComId?: string | null;
    companyId?: number | null;
    stars?: number | null;
  },
): void {
  const now = Math.floor(Date.now() / 1000);
  cache.db
    .prepare(
      `INSERT INTO companies
        (account, company_id, encode_com_id, company_name, province, city, country,
         main_products_json, business_types_json, system_certifications_json, membership_tier,
         raw_cs_level, since_year, capability_stars, audited, employees, turnover, plant_area,
         company_url, company_info_url, is_ad, detail_source, first_seen_at, last_seen_at, raw_item_json)
       VALUES (?,?,?,?,?,?,?, '[]','[]','[]', ?, ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?, 0, 'json', ?, ?, '{}')
       ON CONFLICT(account) DO UPDATE SET
         raw_cs_level = excluded.raw_cs_level,
         audited = excluded.audited,
         membership_tier = excluded.membership_tier`,
    )
    .run(
      input.account,
      input.companyId ?? null,
      input.encodeComId ?? null,
      input.companyName ?? `${input.account} Co., Ltd.`,
      input.province ?? null,
      input.city ?? null,
      input.country ?? null,
      input.csLevel === 50 ? 'diamond' : input.csLevel === 30 ? 'gold' : 'unknown',
      input.csLevel ?? null,
      input.stars ?? null,
      input.audited === null || input.audited === undefined ? null : input.audited ? 1 : 0,
      `https://m.made-in-china.com/company-${input.account}/`,
      `https://m.made-in-china.com/company-${input.account}/info.html`,
      now,
      now,
    );
}

/** 把缓存详情的过期时间改成过去（构造 stale 场景）。 */
export function expireDetailCache(cache: Cache, account: string): void {
  cache.db.prepare('UPDATE company_details SET expires_at = 1 WHERE account = ? COLLATE NOCASE').run(account);
}

/** 标准 5 个 m 站/增强端点路由（fixtures 驱动）。 */
export function standardRoutes(overrides: {
  infoHtml?: () => Response;
  sgs?: () => Response;
  replyRate?: () => Response;
  subAccounts?: () => Response;
  reviews?: () => Response;
} = {}): MockHandler {
  return (url) => {
    if (url.includes('/info.html')) {
      return overrides.infoHtml ? overrides.infoHtml() : htmlResponse(htmlFixture('xingchenglass-info.html'));
    }
    if (url.includes('multi-search/sgs/report')) {
      return overrides.sgs ? overrides.sgs() : jsonResponse(enrichFixture('sgs-sections.json'));
    }
    if (url.includes('busiMerge/replyRate')) {
      return overrides.replyRate ? overrides.replyRate() : jsonResponse(enrichFixture('reply-rate.json'));
    }
    if (url.includes('im.do')) {
      if (overrides.subAccounts) return overrides.subAccounts();
      // 默认路由用于 xingchenglass（encodeComId=UCJfyzwThnqK）的端到端服务测试
      return jsonResponse(enrichFixture('tm-sub-accounts-xingchenglass.json'));
    }
    if (url.includes('user/review/front/next')) {
      return overrides.reviews ? overrides.reviews() : jsonResponse(enrichFixture('reviews.json'));
    }
    return new Response(`unexpected url: ${url}`, { status: 599 });
  };
}
