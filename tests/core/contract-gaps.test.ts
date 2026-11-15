import { afterEach, describe, expect, it } from 'vitest';
import {
  installFetchMock,
  restoreAllFetchMocks,
  searchResponder,
  captchaRedirect,
} from '../helpers/mock-fetch.js';
import { createTestEnv, type TestEnv } from '../helpers/env.js';
import {
  buildSearchPayload,
  glassFullFixture,
  loadFixture,
  paginateItems,
  synthesizeItems,
} from '../helpers/fixtures.js';

/**
 * Contract-conformance regressions that used to be "known gaps" during M1.
 *
 * All previously reported gaps are now fixed (2026-11-16):
 *  - region keyword mode / province inference are echoed via query.search_mode/province
 *    (no non-canonical warnings; canonical warnings are listed in docs/README §3.5)
 *  - CITY_NOT_IN_DICTIONARY / CITY_PROVINCE_MISMATCH warnings propagate to meta.warnings
 *  - stale fallback uses the canonical STALE_DATA code
 *  - meta.fetched_at is ISO8601 +08:00
 *  - search cache keys normalize keyword case
 *
 * See task-13 history for the original gap list.
 */

const glassItems = () => glassFullFixture().dataList as Array<Record<string, unknown>>;

let env: TestEnv | undefined;

afterEach(() => {
  restoreAllFetchMocks();
  env?.close();
  env = undefined;
});

function hebeiItems(n: number): Array<Record<string, unknown>> {
  const hebei = loadFixture<{ dataList: Array<Record<string, unknown>> }>(
    'mobile-search/supplier-search-province-hebei.json',
  ).dataList;
  return synthesizeItems(hebei, n);
}

describe('region-mode is echoed via query (docs/03 §7.4: no non-canonical warning)', () => {
  it('region search exposes search_mode=region and keeps warnings canonical', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: paginateItems(hebeiItems(56 * 20), { total: 1101 }) }));
    const res = await env.search.search({ province: 'Hebei' });
    expect(res.data.query.search_mode).toBe('region');
    expect(res.data.query.keyword_effective).toBe('hebei');
    expect(res.meta.warnings.map((w) => w.code)).not.toContain('REGION_KEYWORD_MODE');
  });
});

describe('city-only search infers province (echoed via query.province)', () => {
  it('city=廊坊 => province=Hebei, no non-canonical warning', async () => {
    env = createTestEnv({ overrides: { search: { scan_max_pages: 1 } } });
    installFetchMock(searchResponder({ pages: paginateItems(hebeiItems(20), { total: 20 }) }));
    const res = await env.search.search({ city: '廊坊' });
    expect(res.data.query.province).toBe('Hebei');
    expect(res.meta.warnings.map((w) => w.code)).not.toContain('PROVINCE_INFERRED');
  });
});

describe('KNOWN-GAP: passthrough city warning lost (docs/03 §7.5)', () => {
  it('unknown city in incomplete province surfaces CITY_NOT_IN_DICTIONARY warning', async () => {
    env = createTestEnv({ overrides: { search: { scan_max_pages: 1 } } });
    installFetchMock(searchResponder({ pages: paginateItems(hebeiItems(20), { total: 20 }) }));
    const res = await env.search.search({ province: 'Guangdong', city: 'Foobar' });
    expect(res.data.query.city).toBe('Foobar');
    expect(res.meta.warnings.map((w) => w.code)).toContain('CITY_NOT_IN_DICTIONARY');
  });
});

describe('KNOWN-GAP: city/province mismatch handling (docs/03 §7.5)', () => {
  it('province=Shandong&city=廊坊 warns CITY_PROVINCE_MISMATCH and infers Hebei', async () => {
    env = createTestEnv({ overrides: { search: { scan_max_pages: 1 } } });
    installFetchMock(searchResponder({ pages: paginateItems(hebeiItems(20), { total: 20 }) }));
    const res = await env.search.search({ province: 'Shandong', city: '廊坊' });
    expect(res.data.query.province).toBe('Hebei');
    expect(res.meta.warnings.map((w) => w.code)).toContain('CITY_PROVINCE_MISMATCH');
  });
});

describe('stale cache warning code (docs/README canonical = STALE_DATA)', () => {
  it('stale fallback emits canonical STALE_DATA warning', async () => {
    env = createTestEnv({ overrides: { cache: { ttl_list_s: 0 } } });
    installFetchMock(
      searchResponder({ pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 20, totalPage: 1 })] }),
    );
    await env.search.search({ keyword: 'glass' });
    installFetchMock(() => captchaRedirect());
    const stale = await env.search.search({ keyword: 'glass' });
    expect(stale.meta.stale).toBe(true);
    expect(stale.meta.warnings.map((w) => w.code)).toContain('STALE_DATA');
  });
});

describe('KNOWN-GAP: fetched_at timezone offset (README §3.5 / docs/03 §1.3)', () => {
  it('meta.fetched_at is ISO8601 with +08:00 offset', async () => {
    env = createTestEnv();
    installFetchMock(
      searchResponder({ pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 20, totalPage: 1 })] }),
    );
    const res = await env.search.search({ keyword: 'glass' });
    expect(res.meta.fetched_at).toMatch(/\+08:00$/);
  });
});

describe('KNOWN-GAP: cache key keyword normalization (docs/05 §6)', () => {
  it('searching "Glass" then "glass" hits the same cache entry', async () => {
    env = createTestEnv();
    const mock = installFetchMock(
      searchResponder({ pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 20, totalPage: 1 })] }),
    );
    await env.search.search({ keyword: 'Glass' });
    const second = await env.search.search({ keyword: 'glass' });
    expect(second.meta.cached).toBe(true);
    expect(mock.calls).toHaveLength(1);
  });
});
