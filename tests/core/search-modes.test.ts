import { afterEach, describe, expect, it } from 'vitest';
import { installFetchMock, restoreAllFetchMocks, searchResponder, parseForm } from '../helpers/mock-fetch.js';
import { createTestEnv, type TestEnv } from '../helpers/env.js';
import {
  buildSearchPayload,
  glassFullFixture,
  loadFixture,
  paginateItems,
  synthesizeItems,
} from '../helpers/fixtures.js';

/**
 * FR-01/FR-02 — search modes, client-side city/audited filtering, ad handling.
 * Cases reference docs/06 TC-01..TC-12 and docs/03 §7.5/§7.6.
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

function hebeiLangfangItems(n: number): Array<Record<string, unknown>> {
  const hebei = loadFixture<{ dataList: Array<Record<string, unknown>> }>(
    'mobile-search/supplier-search-province-hebei.json',
  ).dataList;
  // xingchenglass (Langfang, diamond), Joesco (Hengshui, diamond) … cloned alternately
  return synthesizeItems(hebei, n);
}

function hebeiPagesWith(items: Array<Record<string, unknown>>, total: number): Array<Record<string, unknown>> {
  return paginateItems(items, { total });
}

describe('search modes end-to-end (TC-01..TC-04)', () => {
  it('keyword mode: query echo, mode and upstream word', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: hebeiPagesWith(hebeiLangfangItems(40), 40) }));
    const res = await env.search.search({ keyword: 'Glass' });

    expect(res.data.query.search_mode).toBe('keyword');
    expect(res.data.query.keyword).toBe('Glass');
    expect(res.data.query.keyword_effective).toBe('Glass');
    expect(res.data.query.region_validated).toBe(false);
    expect(res.data.items).toHaveLength(20);
  });

  it('region mode: Hebei keyword derived as lowercase + province upstream param', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: hebeiPagesWith(hebeiLangfangItems(56 * 20), 1101) }));
    const res = await env.search.search({ province: '河北' });

    expect(res.data.query).toMatchObject({
      search_mode: 'region',
      keyword: null,
      keyword_effective: 'hebei',
      province: 'Hebei',
      province_zh: '河北',
      region_validated: true,
    });
    expect(res.data.pagination.total).toBe(1101);
    expect(res.data.pagination.total_display).toBe('1,101');
  });

  it('mixed mode: keyword + province keeps the keyword as upstream word', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: hebeiPagesWith(hebeiLangfangItems(34 * 20), 669) }));
    const res = await env.search.search({ keyword: 'glass', province: 'Hebei' });

    expect(res.data.query.search_mode).toBe('mixed');
    expect(res.data.query.keyword_effective).toBe('glass');
    expect(res.data.pagination.total).toBe(669);
  });
});

describe('client-side city filter (TC-03/TC-09)', () => {
  it('scans pages, keeps only the requested city and reports coverage warnings', async () => {
    env = createTestEnv({ overrides: { search: { scan_max_pages: 2 } } });
    // 4 upstream pages, enough Langfang matches within the first 2 scanned pages
    installFetchMock(searchResponder({ pages: hebeiPagesWith(hebeiLangfangItems(80), 80) }));
    const res = await env.search.search({ province: 'Hebei', city: '廊坊' });

    expect(res.data.query.city).toBe('Langfang');
    expect(res.data.query.city_zh).toBe('廊坊');
    expect(res.data.items.length).toBeGreaterThan(0);
    expect(res.data.items.every((i) => i.city === 'Langfang')).toBe(true);

    const cityWarn = res.meta.warnings.find((w) => w.code === 'CITY_FILTERED_LOCALLY');
    expect(cityWarn).toBeTruthy();
    expect(cityWarn!.details?.['city']).toBe('Langfang');
    expect(cityWarn!.details?.['scan_budget']).toBe(2);
    expect(cityWarn!.details?.['scanned_pages']).toBe(2);

    // page satisfied → total is a lower bound and marked non-exhaustive
    expect(res.data.pagination.total_is_lower_bound).toBe(true);
    const nonExhaustive = res.meta.warnings.find((w) => w.code === 'NON_EXHAUSTIVE');
    expect(nonExhaustive).toBeTruthy();
    expect(nonExhaustive!.details?.['reason']).toBe('page_satisfied');
  });

  it('budget exhausted without matches → CITY_FILTER_EMPTY + truncated lower bound', async () => {
    env = createTestEnv({ overrides: { search: { scan_max_pages: 1 } } });
    // page content has no Langfang city
    installFetchMock(searchResponder({ pages: hebeiPagesWith(glassItems(), 40) }));
    const res = await env.search.search({ province: 'Hebei', city: 'Langfang' });

    expect(res.data.items).toEqual([]);
    expect(res.data.pagination.total).toBe(0);
    expect(res.data.pagination.total_is_lower_bound).toBe(true);

    const codes = res.meta.warnings.map((w) => w.code);
    expect(codes).toContain('CITY_FILTERED_LOCALLY');
    expect(codes).toContain('CITY_FILTER_EMPTY');
    expect(codes).toContain('CITY_FILTER_TRUNCATED');
    const nonExhaustive = res.meta.warnings.find((w) => w.code === 'NON_EXHAUSTIVE');
    expect(nonExhaustive!.details?.['reason']).toBe('budget_exhausted');
  });

  it('city-only mode infers province for the upstream filter', async () => {
    env = createTestEnv({ overrides: { search: { scan_max_pages: 1 } } });
    installFetchMock(searchResponder({ pages: hebeiPagesWith(hebeiLangfangItems(20), 20) }));
    const res = await env.search.search({ city: '廊坊' });

    expect(res.data.query.province).toBe('Hebei');
    expect(res.data.query.search_mode).toBe('region');
  });
});

describe('client-side audited filter (TC-10)', () => {
  it('keeps only audited items and reports CLIENT_SIDE_FILTER', async () => {
    env = createTestEnv({ overrides: { search: { scan_max_pages: 1 } } });
    // single upstream page (totalPage=1): record reaches the end → exact total
    installFetchMock(searchResponder({ pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 20 })] }));
    const res = await env.search.search({ province: 'Hebei', audited: true });

    expect(res.data.items.length).toBeGreaterThan(0);
    expect(res.data.items.every((i) => i.audited === true)).toBe(true);
    expect(res.data.pagination.total).toBe(res.data.items.length);
    expect(res.data.pagination.total_is_lower_bound).toBe(false);
    expect(res.meta.warnings.map((w) => w.code)).toContain('CLIENT_SIDE_FILTER');
  });

  it('does not send audited to upstream; scans instead', async () => {
    env = createTestEnv({ overrides: { search: { scan_max_pages: 1 } } });
    const mock = installFetchMock(
      searchResponder({ pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 20 })] }),
    );
    await env.search.search({ province: 'Hebei', audited: true });
    expect(mock.calls.length).toBe(1);
    const form = parseForm(mock.calls[0]!.body);
    expect(form.get('memberLevel')).toBeNull();
    expect(form.get('word')).toBe('hebei');
  });
});

describe('advertisement handling (TC-18)', () => {
  it('keeps ads by default and marks is_ad', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 2000, totalPage: 100, capped: true })] }));
    const res = await env.search.search({ keyword: 'glass' });

    expect(res.data.items).toHaveLength(20);
    expect(res.data.items.some((i) => i.is_ad)).toBe(true);
    expect(res.meta.warnings.map((w) => w.code)).not.toContain('ADS_FILTERED');
  });

  it('include_ads=false filters ads and reports the removed count', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 2000, totalPage: 100, capped: true })] }));
    const res = await env.search.search({ keyword: 'glass', include_ads: false });

    const adCount = glassItems().filter((i) => {
      const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
      return truthy(i['showAd']) || truthy(i['ad']) || Boolean(i['advertise']) || i['deliveryType'] === 'ads';
    }).length;
    expect(adCount).toBeGreaterThan(0);
    expect(res.data.items).toHaveLength(20 - adCount);
    expect(res.data.items.every((i) => !i.is_ad)).toBe(true);
    const warn = res.meta.warnings.find((w) => w.code === 'ADS_FILTERED');
    expect(warn!.details?.['count']).toBe(adCount);
  });
});

describe('upstream filter mapping (TC-09/TC-11)', () => {
  it('membership_tier + business_type + annual_revenue + rd_capacity + certification are mapped', async () => {
    env = createTestEnv();
    const mock = installFetchMock(
      searchResponder({
        pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 45, totalPage: 3 })],
      }),
    );
    await env.search.search({
      province: 'Hebei',
      membership_tier: 'diamond',
      business_type: 'manufacturer',
      annual_revenue: '10m_50m_usd',
      rd_capacity: 'oem',
      category_code: '1500000000',
      management_certification: '-5',
    });

    const form = parseForm(mock.calls[0]!.body);
    expect(form.get('word')).toBe('hebei');
    expect(form.get('province')).toBe('Hebei');
    expect(form.get('memberLevel')).toBe('50');
    expect(form.get('comBusinessType')).toBe('1');
    expect(form.get('annualRevenue')).toBe('5');
    expect(form.get('rdCapacity')).toBe('4');
    expect(form.get('catCode')).toBe('1500000000');
    expect(form.get('managementCertification')).toBe('-5');
  });
});
