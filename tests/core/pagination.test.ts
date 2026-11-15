import { afterEach, describe, expect, it } from 'vitest';
import {
  installFetchMock,
  restoreAllFetchMocks,
  searchResponder,
  parseForm,
  type FetchMock,
} from '../helpers/mock-fetch.js';
import { createTestEnv, type TestEnv } from '../helpers/env.js';
import { buildSearchPayload, glassFullFixture, loadFixture, paginateItems, synthesizeItems } from '../helpers/fixtures.js';

/**
 * FR-03 — pagination stitching/clamping and the "2,000+" cap (docs/03 §1.7).
 * Cases reference docs/06 TC-13..TC-17 and B-01/B-05 baselines.
 */

let env: TestEnv | undefined;
let mock: FetchMock | undefined;

afterEach(() => {
  restoreAllFetchMocks();
  env?.close();
  env = undefined;
  mock = undefined;
});

function glassItems(): Array<Record<string, unknown>> {
  return glassFullFixture().dataList as Array<Record<string, unknown>>;
}

/** Multi-page pages for the glass 2,000+ query (cap), 20/page. */
function cappedPages(pages = 110): Array<Record<string, unknown>> {
  return paginateItems(synthesizeItems(glassItems(), pages * 20), { total: 2000, capped: true, totalPage: pages });
}

function hebeiItems(): Array<Record<string, unknown>> {
  return loadFixture<{ dataList: Array<Record<string, unknown>> }>(
    'mobile-search/supplier-search-province-hebei.json',
  ).dataList;
}

function hebeiPages(pages = 56): Array<Record<string, unknown>> {
  // deterministic unique accounts so window offsets can be asserted by account name
  return paginateItems(synthesizeItems(hebeiItems(), pages * 20), { total: 1101, totalPage: pages });
}

describe('pagination: native page size (TC-01/TC-16)', () => {
  it('page 1: 20 items, capped total "2,000+", total_page=100', async () => {
    env = createTestEnv();
    mock = installFetchMock(searchResponder({ pages: cappedPages(100) }));
    const res = await env.search.search({ keyword: 'glass', page: 1 });

    expect(res.data.items).toHaveLength(20);
    expect(res.data.pagination).toMatchObject({
      page: 1,
      page_size: 20,
      total: 2000,
      total_page: 100,
      has_more: true,
      total_capped: true,
      total_display: '2,000+',
      page_clamped: false,
      total_is_lower_bound: false,
    });
    expect(res.meta.warnings.map((w) => w.code)).toContain('TOTAL_CAPPED');
    expect(res.meta.cached).toBe(false);
    expect(res.meta.source).toBe('json');
  });

  it('non-capped total keeps the exact comma-grouped display (1101)', async () => {
    env = createTestEnv();
    mock = installFetchMock(searchResponder({ pages: hebeiPages() }));
    const res = await env.search.search({ keyword: 'hebei', province: 'Hebei' });

    expect(res.data.pagination.total).toBe(1101);
    expect(res.data.pagination.total_capped).toBe(false);
    expect(res.data.pagination.total_display).toBe('1,101');
    expect(res.data.pagination.total_page).toBe(56);
    expect(res.meta.warnings.map((w) => w.code)).not.toContain('TOTAL_CAPPED');
  });

  it('sends the required upstream headers (XHR, mobile UA) and form params', async () => {
    env = createTestEnv();
    mock = installFetchMock(searchResponder({ pages: cappedPages(100) }));
    await env.search.search({ keyword: 'glass', province: 'Hebei', page: 2, membership_tier: 'diamond' });

    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0]!;
    expect(call.url).toContain('m.made-in-china.com/search/supplier');
    expect(call.method).toBe('POST');
    expect(call.headers['x-requested-with']).toBe('XMLHttpRequest');
    expect(call.headers['user-agent']).toMatch(/iPhone|Mobile/);
    const form = parseForm(call.body);
    expect(form.get('word')).toBe('glass');
    expect(form.get('province')).toBe('Hebei');
    expect(form.get('page')).toBe('2');
    expect(form.get('memberLevel')).toBe('50');
  });
});

describe('pagination: non-native page sizes (TC-30, PAGE_SIZE_NOT_NATIVE)', () => {
  it('page_size=30 page 1 → 30 items stitched from 2 upstream pages', async () => {
    env = createTestEnv();
    mock = installFetchMock(searchResponder({ pages: cappedPages(100) }));
    const res = await env.search.search({ keyword: 'glass', page: 1, page_size: 30 });

    expect(res.data.items).toHaveLength(30);
    expect(res.data.pagination.page_size).toBe(30);
    expect(res.meta.warnings.map((w) => w.code)).toContain('PAGE_SIZE_NOT_NATIVE');
    expect(mock.calls).toHaveLength(2);
  });

  it('page_size=40 page 1 → 40 items from 2 upstream pages', async () => {
    env = createTestEnv();
    mock = installFetchMock(searchResponder({ pages: cappedPages(100) }));
    const res = await env.search.search({ keyword: 'glass', page: 1, page_size: 40 });
    expect(res.data.items).toHaveLength(40);
    expect(mock.calls).toHaveLength(2);
  });

  it('page_size=100 page 1 → 100 items from 5 upstream pages', async () => {
    env = createTestEnv();
    mock = installFetchMock(searchResponder({ pages: cappedPages(100) }));
    const res = await env.search.search({ keyword: 'glass', page: 1, page_size: 100 });

    expect(res.data.items).toHaveLength(100);
    expect(res.data.pagination.total_page).toBe(20); // ceil(2000/100)
    expect(mock.calls).toHaveLength(5);
  });
});

describe('pagination: window offsets for page > 1 (fixed by Lead 2026-11-15)', () => {
  it('page=2&page_size=20 returns 20 items from the global 20..39 window', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: cappedPages(100) }));
    const res = await env.search.search({ keyword: 'glass', page: 2 });

    expect(res.data.items).toHaveLength(20);
    expect(res.data.items[0]!.account).toContain('p020');
    expect(res.data.items[19]!.account).toContain('p039');
    expect(res.data.pagination.page).toBe(2);
    expect(res.data.pagination.page_clamped).toBe(false);
  });

  it('page=2&page_size=30 returns the global 30..59 window', async () => {
    env = createTestEnv();
    const mock = installFetchMock(searchResponder({ pages: cappedPages(100) }));
    const res = await env.search.search({ keyword: 'glass', page: 2, page_size: 30 });

    expect(mock.calls).toHaveLength(2); // upstream pages 2 and 3
    expect(res.data.items).toHaveLength(30);
    expect(res.data.items[0]!.account).toContain('p030');
    expect(res.data.items[29]!.account).toContain('p059');
  });

  it('page=3&page_size=40 returns the global 80..119 window (stitched pages 5..6)', async () => {
    env = createTestEnv();
    const mock = installFetchMock(searchResponder({ pages: cappedPages(100) }));
    const res = await env.search.search({ keyword: 'glass', page: 3, page_size: 40 });

    expect(mock.calls).toHaveLength(2); // upstream pages 5 and 6
    expect(res.data.items).toHaveLength(40);
    expect(res.data.items[0]!.account).toContain('p080');
    expect(res.data.items[39]!.account).toContain('p119');
  });
});

describe('pagination: clamp, dedupe, empty results (TC-10/TC-12/TC-13)', () => {
  it('page beyond total_page (but ≤100) → page_clamped=true, has_more=false', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: hebeiPages() }));
    const res = await env.search.search({ keyword: 'hebei', province: 'Hebei', page: 60 });

    expect(res.data.pagination.page).toBe(60);
    expect(res.data.pagination.total_page).toBe(56);
    expect(res.data.pagination.page_clamped).toBe(true);
    expect(res.data.pagination.has_more).toBe(false);
    const clamped = res.meta.warnings.find((w) => w.code === 'PAGE_CLAMPED');
    expect(clamped).toBeTruthy();
    expect(clamped!.details?.['requested_page']).toBe(60);
    expect(clamped!.details?.['effective_page']).toBe(56);
    // clamped page returns the last-page content (docs/03 §1.7 rule 4)
    expect(res.data.items).toHaveLength(20);
    expect(res.data.items[0]!.account).toContain('p1100');
    expect(res.data.items[19]!.account).toContain('p1119');
  });

  it('page=101 is rejected by parameter validation (upstream max page 100)', async () => {
    env = createTestEnv();
    mock = installFetchMock(searchResponder({ pages: cappedPages(100) }));
    await expect(env.search.search({ keyword: 'glass', page: 101 })).rejects.toMatchObject({
      code: 'INVALID_PARAM',
      details: { reason: 'OUT_OF_RANGE' },
    });
    expect(mock.calls).toHaveLength(0);
  });

  it('dedupes duplicate accounts across stitched pages', async () => {
    env = createTestEnv();
    const items = synthesizeItems(glassItems(), 40);
    items[20] = { ...items[0]! }; // duplicate account across page 1/2
    installFetchMock(searchResponder({ pages: paginateItems(items, { total: 40 }) }));
    const res = await env.search.search({ keyword: 'glass', page: 1, page_size: 40 });

    expect(res.data.items).toHaveLength(39);
    expect(new Set(res.data.items.map((i) => i.account)).size).toBe(39);
    expect(res.meta.warnings.map((w) => w.code)).toContain('DUPLICATES_REMOVED');
  });

  it('empty upstream result is a success response, not NOT_FOUND (TC-17)', async () => {
    env = createTestEnv();
    installFetchMock(
      searchResponder({
        pages: [buildSearchPayload({ items: [], page: 1, total: 0, totalPage: 0 })],
      }),
    );
    const res = await env.search.search({ keyword: 'glass', province: 'Qinghai' });

    expect(res.data.items).toEqual([]);
    expect(res.data.pagination.total).toBe(0);
    expect(res.data.pagination.total_display).toBe('0');
    expect(res.data.pagination.has_more).toBe(false);
    expect(res.meta.stale).toBe(false);
  });

  it('second identical request is served from cache with one upstream call', async () => {
    env = createTestEnv();
    mock = installFetchMock(searchResponder({ pages: cappedPages(100) }));
    const first = await env.search.search({ keyword: 'glass', page: 1 });
    const second = await env.search.search({ keyword: 'glass', page: 1 });

    expect(first.meta.cached).toBe(false);
    expect(second.meta.cached).toBe(true);
    expect(second.meta.source).toBe('cache');
    expect(mock.calls).toHaveLength(1);
    expect(second.data.items.map((i) => i.account)).toEqual(first.data.items.map((i) => i.account));
  });
});
