import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildRestServer } from '../../src/adapters/rest/server.js';
import { AppError, type Meta } from '../../src/core/errors.js';
import type { CompanyDetail } from '../../src/core/models.js';
import {
  installMockFetch,
  jsonResponse,
  makeTestContext,
  rawSupplierItem,
  supplierSearchPayload,
  type MockFetch,
  type TestEnv,
} from './helpers.js';

let env: TestEnv | null = null;
let app: FastifyInstance | null = null;
let mock: MockFetch | null = null;

function setup(handler?: (url: string, init?: RequestInit) => Response | undefined): TestEnv {
  env = makeTestContext();
  mock = installMockFetch((url, init) => {
    const response = handler?.(url, init);
    if (!response) throw new Error(`unexpected upstream fetch in test: ${url}`);
    return response;
  });
  app = buildRestServer(env.ctx);
  return env;
}

function setupWithCompany(
  companyDetail: (input: unknown, requestId: string) => Promise<{ data: CompanyDetail; meta: Meta }>,
): TestEnv {
  env = makeTestContext();
  mock = installMockFetch((url) => {
    throw new Error(`unexpected upstream fetch in test: ${url}`);
  });
  app = buildRestServer(env.ctx, { companyDetail: companyDetail as never });
  return env;
}

afterEach(async () => {
  if (app) await app.close();
  app = null;
  if (mock) mock.restore();
  mock = null;
  if (env) env.close();
  env = null;
});

function fakeCompanyDetail(overrides: Partial<CompanyDetail> = {}): CompanyDetail {
  return {
    account: 'xingchenglass',
    company_id: '1800987236',
    encode_com_id: 'UCJfyzwThnqK',
    company_name: 'Hebei Xingchen Glass Technology Co., Ltd.',
    province: 'Hebei',
    city: 'Langfang',
    country: 'China',
    address: null,
    established_at: '2015-10-30',
    main_products: ['Glass Cup'],
    business_types: ['Manufacturer/Factory'],
    membership: {
      tier: 'diamond',
      raw_cs_level: 50,
      raw_member_level: 'diamond',
      since_year: 2025,
      evidence: ['json:csLevel=50'],
      confidence: 'high',
    },
    audited: true,
    capability_stars: 2,
    system_certifications: ['ISO 9001'],
    employees: 21,
    turnover: null,
    plant_area: null,
    company_url: 'https://m.made-in-china.com/company-xingchenglass/',
    company_info_url: 'https://m.made-in-china.com/company-xingchenglass/info.html',
    detail_source: 'json',
    include: ['audit', 'response'],
    enrichment: { audit: null, response: null, contacts: null, reviews: null },
    availability: [],
    ...overrides,
  };
}

function companyMeta(requestId: string): Meta {
  return {
    request_id: requestId,
    cached: false,
    stale: false,
    fetched_at: '2026-11-15T23:00:00+08:00',
    source: 'json',
    warnings: [],
  };
}

describe('REST adapter — contract basics (docs/03)', () => {
  it('GET /health returns the documented liveness shape', async () => {
    setup();
    const res = await app!.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('ok');
    expect(body.data.api_version).toBe('v1');
    expect(body.data.session.mode).toBeDefined();
    expect(body.data.cache.path).toContain('mic.sqlite');
    expect(body.meta.request_id).toMatch(/^req_/);
    expect(res.headers['x-request-id']).toBe(body.meta.request_id);
  });

  it('GET /api/version returns version + upstream contract', async () => {
    setup();
    const res = await app!.inject({ method: 'GET', url: '/api/version' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.api_version).toBe('v1');
    expect(body.data.upstream_contract.version).toBe('2026-11-15');
    expect(body.data.node_version).toBe(process.version);
  });

  it('GET /api/regions lists 32 provinces and Hebei cities', async () => {
    setup();
    const all = await app!.inject({ method: 'GET', url: '/api/regions' });
    expect(all.statusCode).toBe(200);
    const allBody = all.json();
    expect(allBody.data.count).toBe(32);
    const hebei = allBody.data.provinces.find((p: { name: string }) => p.name === 'Hebei');
    expect(hebei.api_value).toBe('Hebei');
    expect(hebei.cities_complete).toBe(true);

    const detail = await app!.inject({ method: 'GET', url: '/api/regions?province=Hebei' });
    expect(detail.statusCode).toBe(200);
    const detailBody = detail.json();
    expect(detailBody.data.province.name).toBe('Hebei');
    expect(detailBody.data.cities.length).toBe(11);
    expect(detailBody.data.cities[0].province).toBe('Hebei');

    const unknown = await app!.inject({ method: 'GET', url: '/api/regions?province=Nowhere' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe('INVALID_PARAM');
    expect(unknown.json().error.details.reason).toBe('UNKNOWN_PROVINCE');
  });

  it('GET /api/membership/levels returns tiers + audit + KA/SKA clarification', async () => {
    setup();
    const res = await app!.inject({ method: 'GET', url: '/api/membership/levels' });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.tiers.map((t: { tier: string }) => t.tier)).toEqual(['diamond', 'gold', 'free', 'unknown']);
    expect(data.tiers[0].price_cny_per_year).toBe(59800);
    expect(data.audit.independent_of_tier).toBe(true);
    expect(data.not_mic_tiers.map((t: { code: string }) => t.code)).toEqual(['ka', 'ska', 'gska']);
  });

  it('Unknown route → 404 NOT_FOUND and invalid Host → 400 HOST_NOT_ALLOWED', async () => {
    setup();
    const notFound = await app!.inject({ method: 'GET', url: '/api/nope' });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json().error.code).toBe('NOT_FOUND');
    expect(notFound.json().error.details.reason).toBe('ROUTE_NOT_FOUND');

    const badHost = await app!.inject({ method: 'GET', url: '/health', headers: { host: 'evil.example.com' } });
    expect(badHost.statusCode).toBe(400);
    expect(badHost.json().error.code).toBe('INVALID_PARAM');
    expect(badHost.json().error.details.reason).toBe('HOST_NOT_ALLOWED');
  });

  it('echoes a valid X-Request-Id and generates one when absent', async () => {
    setup();
    const echoed = await app!.inject({ method: 'GET', url: '/api/version', headers: { 'x-request-id': 'req_test_abc123' } });
    expect(echoed.headers['x-request-id']).toBe('req_test_abc123');
    expect(echoed.json().meta.request_id).toBe('req_test_abc123');
    const generated = await app!.inject({ method: 'GET', url: '/api/version', headers: { 'x-request-id': 'bad id with spaces' } });
    expect(generated.json().meta.request_id).toMatch(/^req_/);
  });
});

describe('REST adapter — search (upstream mocked)', () => {
  const items = [
    rawSupplierItem({ account: 'glass-a', name: 'Langfang Glass A', id: 1001, city: 'Langfang', province: 'Hebei' }),
    rawSupplierItem({ account: 'glass-b', name: 'Langfang Glass B', id: 1002, city: 'Langfang', province: 'Hebei' }),
    rawSupplierItem({ account: 'glass-c', name: 'Tangshan Glass C', id: 1003, city: 'Tangshan', province: 'Hebei', csLevel: 30 }),
  ];

  it('returns normalized items, pagination and caches repeat calls', async () => {
    setup((url) => {
      if (url.startsWith('https://m.made-in-china.com/search/supplier')) {
        return jsonResponse(supplierSearchPayload({ items, total: 45, totalPage: 3 }));
      }
      return undefined;
    });
    const first = await app!.inject({ method: 'GET', url: '/api/search/factories?keyword=glass&province=Hebei' });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.data.items).toHaveLength(3);
    expect(body.data.items[0].account).toBe('glass-a');
    expect(body.data.items[0].membership.tier).toBe('diamond');
    expect(body.data.items[2].membership.tier).toBe('gold');
    expect(body.data.pagination.total).toBe(45);
    expect(body.data.pagination.total_page).toBe(3);
    expect(body.data.query.search_mode).toBe('mixed');
    expect(body.meta.source).toBe('json');
    expect(body.meta.cached).toBe(false);
    expect(mock!.calls).toHaveLength(1);
    const form = mock!.calls[0]!.init!.body as string;
    expect(form).toContain('word=glass');
    expect(form).toContain('province=Hebei');
    const headers = mock!.calls[0]!.init!.headers as Record<string, string>;
    expect(headers['X-Requested-With']).toBe('XMLHttpRequest');

    const second = await app!.inject({ method: 'GET', url: '/api/search/factories?keyword=glass&province=Hebei' });
    expect(second.json().meta.cached).toBe(true);
    expect(second.json().meta.source).toBe('cache');
    expect(mock!.calls).toHaveLength(1);
  });

  it('maps upstream 2,000+ cap to TOTAL_CAPPED and clamping to PAGE_CLAMPED', async () => {
    setup((url, init) => {
      if (!url.startsWith('https://m.made-in-china.com/search/supplier')) return undefined;
      const form = String(init?.body ?? '');
      const page = Number(new URLSearchParams(form).get('page') ?? '1');
      if (page === 1) {
        return jsonResponse(supplierSearchPayload({ items, total: 2000, totalPage: 100, totalNum: '2,000+' }));
      }
      // page 9 reaches a smaller (non-capped) result set: upstream clamps to its last page
      return jsonResponse(supplierSearchPayload({ items: items.slice(0, 2), total: 25, totalPage: 2 }));
    });
    const capped = await app!.inject({ method: 'GET', url: '/api/search/factories?keyword=glass&province=Hebei' });
    const body = capped.json();
    expect(body.data.pagination.total).toBe(2000);
    expect(body.data.pagination.total_capped).toBe(true);
    expect(body.data.pagination.total_display).toBe('2,000+');
    expect(body.meta.warnings.map((w: { code: string }) => w.code)).toContain('TOTAL_CAPPED');

    const clamped = await app!.inject({ method: 'GET', url: '/api/search/factories?keyword=glass&province=Hebei&page=9' });
    const clampedBody = clamped.json();
    expect(clampedBody.data.pagination.page_clamped).toBe(true);
    expect(clampedBody.meta.warnings.map((w: { code: string }) => w.code)).toContain('PAGE_CLAMPED');
  });

  it('stitches upstream pages for page_size>20 and warns PAGE_SIZE_NOT_NATIVE', async () => {
    setup((url) => {
      if (!url.startsWith('https://m.made-in-china.com/search/supplier')) return undefined;
      return jsonResponse(supplierSearchPayload({ items, total: 45, totalPage: 3 }));
    });
    const res = await app!.inject({ method: 'GET', url: '/api/search/factories?keyword=glass&province=Hebei&page_size=40' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.pagination.page_size).toBe(40);
    expect(body.data.items.length).toBe(3);
    expect(body.meta.warnings.map((w: { code: string }) => w.code)).toContain('PAGE_SIZE_NOT_NATIVE');
    expect(mock!.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('validates params (combo / Chinese keyword / free tier / page range)', async () => {
    setup();
    const combo = await app!.inject({ method: 'GET', url: '/api/search/factories' });
    expect(combo.statusCode).toBe(400);
    expect(combo.json().error.details.reason).toBe('MISSING_REQUIRED_COMBO');

    const chinese = await app!.inject({
      method: 'GET',
      url: `/api/search/factories?keyword=${encodeURIComponent('玻璃')}`,
    });
    expect(chinese.statusCode).toBe(400);
    expect(chinese.json().error.details.reason).toBe('NON_ENGLISH_KEYWORD');

    const free = await app!.inject({ method: 'GET', url: '/api/search/factories?keyword=glass&membership_tier=free' });
    expect(free.statusCode).toBe(400);
    expect(free.json().error.details.reason).toBe('UNSUPPORTED_MEMBERSHIP_FILTER');

    const page = await app!.inject({ method: 'GET', url: '/api/search/factories?keyword=glass&page=101' });
    expect(page.statusCode).toBe(400);
    expect(page.json().error.details.reason).toBe('OUT_OF_RANGE');
  });

  it('maps upstream captcha redirects to NEED_HUMAN_VERIFICATION (409)', async () => {
    setup((url) => {
      if (url.startsWith('https://m.made-in-china.com/search/supplier')) {
        return new Response('', {
          status: 302,
          headers: { location: 'https://captcha.made-in-china.com/verification.html?srcUrl=x' },
        });
      }
      return undefined;
    });
    const res = await app!.inject({ method: 'GET', url: '/api/search/factories?keyword=glass&province=Hebei' });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe('NEED_HUMAN_VERIFICATION');
    expect(body.error.details.action).toBe('mic auth');
    expect(body.meta.source).toBe('cache');
  });
});

describe('REST adapter — company detail (injected M2 service)', () => {
  it('returns CompanyDetail from the bridge', async () => {
    setupWithCompany(async (_input, requestId) => ({ data: fakeCompanyDetail(), meta: companyMeta(requestId) }));
    const res = await app!.inject({ method: 'GET', url: '/api/companies/xingchenglass' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.account).toBe('xingchenglass');
    expect(body.data.membership.tier).toBe('diamond');
    expect(body.data.membership.since_year).toBe(2025);
    expect(body.data.enrichment).toEqual({ audit: null, response: null, contacts: null, reviews: null });
  });

  it('accepts include=none / include=all and rejects invalid include', async () => {
    const seen: unknown[] = [];
    setupWithCompany(async (input, requestId) => {
      seen.push(input);
      return { data: fakeCompanyDetail({ include: [] }), meta: companyMeta(requestId) };
    });
    const none = await app!.inject({ method: 'GET', url: '/api/companies/xingchenglass?include=none' });
    expect(none.statusCode).toBe(200);
    expect((seen[0] as { include: string[] }).include).toEqual([]);

    const all = await app!.inject({ method: 'GET', url: '/api/companies/xingchenglass?include=all' });
    expect(all.statusCode).toBe(200);
    expect((seen[1] as { include: string[] }).include).toEqual(['audit', 'response', 'contacts', 'reviews']);

    const bad = await app!.inject({ method: 'GET', url: '/api/companies/xingchenglass?include=phone' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details.reason).toBe('INVALID_INCLUDE');
  });

  it('degrades with NOT_FOUND when the M2 service is not ready', async () => {
    setupWithCompany(async () => {
      throw new AppError('NOT_FOUND', 'company detail service is not available yet (M2 in progress)', {
        reason: 'COMPANY_SERVICE_NOT_READY',
      });
    });
    const res = await app!.inject({ method: 'GET', url: '/api/companies/xingchenglass' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.details.reason).toBe('COMPANY_SERVICE_NOT_READY');
  });

  it('maps path parameters to account / com_id / encode_com_id lookups', async () => {
    const seen: Array<Record<string, unknown>> = [];
    setupWithCompany(async (input, requestId) => {
      seen.push(input as Record<string, unknown>);
      return { data: fakeCompanyDetail(), meta: companyMeta(requestId) };
    });
    await app!.inject({ method: 'GET', url: '/api/companies/1800987236' });
    expect(seen[0]?.['com_id']).toBe('1800987236');
    expect(seen[0]?.['account']).toBeUndefined();

    await app!.inject({ method: 'GET', url: '/api/companies/company-xingchenglass' });
    expect(seen[1]?.['account']).toBe('xingchenglass');

    const encodedUrl = encodeURIComponent('https://m.made-in-china.com/company-xingchenglass/info.html');
    await app!.inject({ method: 'GET', url: `/api/companies/${encodedUrl}` });
    expect(seen[2]?.['account']).toBe('xingchenglass');

    const invalid = await app!.inject({ method: 'GET', url: '/api/companies/bad%20account!' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.details.reason).toBe('INVALID_ACCOUNT');
  });

  it('maps RATE_LIMITED to 429 + Retry-After', async () => {
    setupWithCompany(async () => {
      throw new AppError('RATE_LIMITED', 'queue busy', { retry_after_seconds: 3, queue: 'upstream' });
    });
    const res = await app!.inject({ method: 'GET', url: '/api/companies/xingchenglass' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('3');
    expect(res.json().error.code).toBe('RATE_LIMITED');
  });
});

describe('REST adapter — cache endpoints', () => {
  it('POST /api/cache/refresh invalidates search cache and reports counts', async () => {
    setup((url) =>
      url.startsWith('https://m.made-in-china.com/search/supplier')
        ? jsonResponse(supplierSearchPayload({ items: [rawSupplierItem()], total: 1 }))
        : undefined,
    );
    await app!.inject({ method: 'GET', url: '/api/search/factories?keyword=glass&province=Hebei' });
    const statsBefore = await app!.inject({ method: 'GET', url: '/api/cache/stats' });
    expect(statsBefore.json().data.entries.search_pages).toBe(1);
    expect(statsBefore.json().data.db.schema_version).toBe(1);

    const refresh = await app!.inject({
      method: 'POST',
      url: '/api/cache/refresh',
      payload: { scope: 'search', target: { keyword: 'glass', province: 'Hebei' }, wait: false },
    });
    expect(refresh.statusCode).toBe(200);
    const body = refresh.json();
    expect(body.data.scope).toBe('search');
    expect(body.data.invalidated.search_pages).toBe(1);
    expect(body.data.result).toBeNull();
    expect(body.meta.source).toBe('cache');

    const statsAfter = await app!.inject({ method: 'GET', url: '/api/cache/stats' });
    expect(statsAfter.json().data.entries.search_pages).toBe(0);
  });

  it('POST /api/cache/refresh wait=true refetches via the search service', async () => {
    setup((url) =>
      url.startsWith('https://m.made-in-china.com/search/supplier')
        ? jsonResponse(supplierSearchPayload({ items: [rawSupplierItem()], total: 1 }))
        : undefined,
    );
    const res = await app!.inject({
      method: 'POST',
      url: '/api/cache/refresh',
      payload: { scope: 'search', target: { keyword: 'glass', province: 'Hebei' }, wait: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.result.items).toHaveLength(1);
    expect(body.data.enabled).toBe(true);
  });

  it('rejects invalid refresh bodies', async () => {
    setup();
    const badScope = await app!.inject({ method: 'POST', url: '/api/cache/refresh', payload: { scope: 'nope' } });
    expect(badScope.statusCode).toBe(400);
    expect(badScope.json().error.details.reason).toBe('INVALID_SCOPE');

    const missingTarget = await app!.inject({ method: 'POST', url: '/api/cache/refresh', payload: { scope: 'search' } });
    expect(missingTarget.statusCode).toBe(400);
    expect(missingTarget.json().error.details.reason).toBe('INVALID_TARGET');

    const allWithTarget = await app!.inject({
      method: 'POST',
      url: '/api/cache/refresh',
      payload: { scope: 'all', target: { keyword: 'glass' } },
    });
    expect(allWithTarget.statusCode).toBe(400);
    expect(allWithTarget.json().error.details.reason).toBe('INVALID_TARGET');
  });
});

describe('REST adapter — strict params mode', () => {
  it('rejects unknown query params when rest.strict_params=true', async () => {
    env = makeTestContext();
    env.ctx.cfg.rest.strict_params = true;
    mock = installMockFetch(() => {
      throw new Error('no upstream expected');
    });
    app = buildRestServer(env.ctx);
    const res = await app.inject({ method: 'GET', url: '/api/search/factories?keyword=glass&foo=bar' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.reason).toBe('UNKNOWN_QUERY_PARAM');
  });
});
