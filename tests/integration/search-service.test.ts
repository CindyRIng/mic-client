import { afterEach, describe, expect, it } from 'vitest';
import { installFetchMock, restoreAllFetchMocks, searchResponder } from '../helpers/mock-fetch.js';
import { createTestEnv, type TestEnv } from '../helpers/env.js';
import {
  buildSearchPayload,
  glassFullFixture,
  loadFixture,
  paginateItems,
  synthesizeItems,
} from '../helpers/fixtures.js';
import { searchResultSchema } from '../../src/core/models.js';

/**
 * L3 integration — mock upstream + real SQLite cache through SearchService.
 * Deterministic: no network, rate limit 0, fixed fixtures.
 * Cases reference docs/06 §2.3 (E2/E3) and TC-01/03/11/34/35.
 */

let env: TestEnv | undefined;

afterEach(() => {
  restoreAllFetchMocks();
  env?.close();
  env = undefined;
});

function glassItems(): Array<Record<string, unknown>> {
  return glassFullFixture().dataList as Array<Record<string, unknown>>;
}

describe('SearchService end-to-end (mock upstream + temp SQLite)', () => {
  it('keyword search → schema-valid result → cached replay → companies projection', async () => {
    env = createTestEnv();
    installFetchMock(
      searchResponder({
        pages: paginateItems(synthesizeItems(glassItems(), 100 * 20), { total: 2000, capped: true }),
      }),
    );

    const first = await env.search.search({ keyword: 'glass', request_id: 'req_test_123' });
    // contract schema validation (docs/03 SearchResult)
    const parsed = searchResultSchema.parse(first.data);
    expect(parsed.items).toHaveLength(20);
    expect(parsed.pagination.total_capped).toBe(true);
    expect(first.meta.request_id).toBe('req_test_123');
    expect(Date.parse(first.meta.fetched_at!)).not.toBeNaN();
    expect(first.meta.source).toBe('json');

    const second = await env.search.search({ keyword: 'glass' });
    expect(second.meta.cached).toBe(true);
    expect(second.meta.source).toBe('cache');
    expect(second.data.items).toEqual(first.data.items);
    expect(second.data.pagination).toEqual(first.data.pagination);

    const companies = env.cache.db.prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number };
    expect(companies.n).toBe(20);
  });

  it('region + membership filter: upstream form is correct and totals survive the round trip', async () => {
    env = createTestEnv();
    const hebei = loadFixture<{ dataList: Array<Record<string, unknown>> }>(
      'mobile-search/supplier-search-province-hebei.json',
    ).dataList;
    const mock = installFetchMock(
      searchResponder({
        pages: [buildSearchPayload({ items: synthesizeItems(hebei, 20), page: 1, total: 522, totalPage: 27 })],
      }),
    );
    const res = await env.search.search({ province: '河北', membership_tier: 'diamond' });

    const form = new URLSearchParams(mock.calls[0]!.body);
    expect(form.get('word')).toBe('hebei');
    expect(form.get('province')).toBe('Hebei');
    expect(form.get('memberLevel')).toBe('50');

    expect(res.data.query.search_mode).toBe('region');
    expect(res.data.pagination.total).toBe(522);
    expect(res.data.pagination.total_page).toBe(27);
    expect(res.data.items.every((i) => i.membership.tier === 'diamond')).toBe(true);
  });

  it('multifilter baseline: 5 conditions → total=45, total_page=3 (docs/06 B-04)', async () => {
    env = createTestEnv();
    const fixture = loadFixture<{ total: number; totalPage: number; dataList: Array<Record<string, unknown>> }>(
      'mobile-search/supplier-search-multifilter.json',
    );
    installFetchMock(searchResponder({ pages: [fixture as unknown as Record<string, unknown>] }));

    const res = await env.search.search({
      province: 'Hebei',
      membership_tier: 'diamond',
      management_certification: '-5',
      category_code: '1500000000',
      business_type: 'manufacturer',
    });

    expect(res.data.pagination.total).toBe(45);
    expect(res.data.pagination.total_page).toBe(3);
    expect(res.data.pagination.total_display).toBe('45');
    expect(res.data.pagination.has_more).toBe(true);
  });

  it('city scan end-to-end: all returned items match the city and warnings describe coverage', async () => {
    env = createTestEnv({ overrides: { search: { scan_max_pages: 2 } } });
    const hebei = loadFixture<{ dataList: Array<Record<string, unknown>> }>(
      'mobile-search/supplier-search-province-hebei.json',
    ).dataList;
    installFetchMock(searchResponder({ pages: paginateItems(synthesizeItems(hebei, 80), { total: 80 }) }));

    const res = await env.search.search({ province: 'Hebei', city: '廊坊' });
    expect(res.data.items.length).toBeGreaterThan(0);
    expect(res.data.items.every((i) => i.city === 'Langfang')).toBe(true);
    const warn = res.meta.warnings.find((w) => w.code === 'CITY_FILTERED_LOCALLY');
    expect(warn?.details?.['scanned_pages']).toBe(2);
    expect(res.data.pagination.total_is_lower_bound).toBe(true);
  });

  it('stale degrade end-to-end keeps data usable and flags meta.stale', async () => {
    env = createTestEnv({ overrides: { cache: { ttl_list_s: 0 } } });
    installFetchMock(
      searchResponder({ pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 20, totalPage: 1 })] }),
    );
    await env.search.search({ keyword: 'glass' });

    installFetchMock(() => ({ status: 302, headers: { location: 'https://captcha.made-in-china.com/verification.html' }, body: '' }));
    const stale = await env.search.search({ keyword: 'glass' });

    expect(stale.meta.stale).toBe(true);
    expect(stale.meta.cached).toBe(true);
    expect(stale.meta.source).toBe('cache');
    expect(stale.data.items).toHaveLength(20);
    expect(stale.meta.warnings.length).toBeGreaterThan(0);
  });

  it('does not persist cache rows when the upstream request fails', async () => {
    env = createTestEnv();
    installFetchMock(() => ({ status: 503, headers: {}, body: 'upstream down' }));
    const { vi } = await import('vitest');
    vi.useFakeTimers();
    try {
      const p = env.search.search({ keyword: 'glass' }).catch((e) => e as { code?: string });
      await vi.advanceTimersByTimeAsync(20_000);
      const err = (await p) as { code?: string };
      expect(err.code).toBe('UPSTREAM_UNAVAILABLE');
    } finally {
      vi.useRealTimers();
    }
    const count = env.cache.db.prepare('SELECT COUNT(*) AS n FROM search_page_cache').get() as { n: number };
    expect(count.n).toBe(0);
  });
});
