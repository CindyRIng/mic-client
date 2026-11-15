import { afterEach, describe, expect, it } from 'vitest';
import {
  installFetchMock,
  restoreAllFetchMocks,
  searchResponder,
  captchaRedirect,
} from '../helpers/mock-fetch.js';
import { createTestEnv, type TestEnv } from '../helpers/env.js';
import { glassFullFixture, buildSearchPayload, paginateItems, synthesizeItems } from '../helpers/fixtures.js';
import { Cache } from '../../src/core/cache/cache.js';
import { Logger } from '../../src/core/logger.js';

/**
 * FR-08 — SQLite cache behaviour (hit / TTL / refresh / stale / single-flight / stats).
 * Cases reference docs/06 TC-34..TC-39 and docs/05 §6.
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

function cappedPages(): Array<Record<string, unknown>> {
  return paginateItems(synthesizeItems(glassItems(), 100 * 20), { total: 2000, capped: true });
}

function singlePage(): Array<Record<string, unknown>> {
  return [buildSearchPayload({ items: glassItems(), page: 1, total: 20, totalPage: 1 })];
}

describe('cache hit / refresh / disabled (TC-34/TC-36)', () => {
  it('serves the second identical request from cache without an upstream call', async () => {
    env = createTestEnv();
    const mock = installFetchMock(searchResponder({ pages: cappedPages() }));

    const first = await env.search.search({ keyword: 'glass' });
    const second = await env.search.search({ keyword: 'glass' });

    expect(first.meta.cached).toBe(false);
    expect(second.meta.cached).toBe(true);
    expect(second.meta.source).toBe('cache');
    expect(second.meta.stale).toBe(false);
    expect(mock.calls).toHaveLength(1);
    expect(second.data.items.map((i) => i.account)).toEqual(first.data.items.map((i) => i.account));
  });

  it('refresh=true bypasses the read cache and refetches from upstream', async () => {
    env = createTestEnv();
    const mock = installFetchMock(searchResponder({ pages: cappedPages() }));

    await env.search.search({ keyword: 'glass' });
    await env.search.search({ keyword: 'glass' });
    const refreshed = await env.search.search({ keyword: 'glass', refresh: true });
    const after = await env.search.search({ keyword: 'glass' });

    expect(refreshed.meta.cached).toBe(false);
    expect(refreshed.meta.source).toBe('json');
    expect(after.meta.cached).toBe(true);
    expect(mock.calls).toHaveLength(2);
  });

  it('cache disabled → every request goes upstream', async () => {
    env = createTestEnv({ cache: false });
    const mock = installFetchMock(searchResponder({ pages: cappedPages() }));

    const a = await env.search.search({ keyword: 'glass' });
    const b = await env.search.search({ keyword: 'glass' });

    expect(a.meta.cached).toBe(false);
    expect(b.meta.cached).toBe(false);
    expect(mock.calls).toHaveLength(2);
  });

  it('cache survives a Cache instance recreation on the same data dir', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: cappedPages() }));
    await env.search.search({ keyword: 'glass' });

    env.cache.close();
    const reopened = new Cache(env.cfg, new Logger({ level: 'error', json: false }));
    try {
      expect(reopened.stats().entries.search_page_cache).toBeGreaterThanOrEqual(1);
    } finally {
      reopened.close();
    }
  });
});

describe('cache TTL and stale fallback (TC-35)', () => {
  it('expired cache + upstream challenge → stale fallback with warning', async () => {
    env = createTestEnv({ overrides: { cache: { ttl_list_s: 0 } } });
    installFetchMock(searchResponder({ pages: singlePage() }));
    const first = await env.search.search({ keyword: 'glass' });
    expect(first.meta.cached).toBe(false);

    installFetchMock(() => captchaRedirect());
    const stale = await env.search.search({ keyword: 'glass' });

    expect(stale.meta.cached).toBe(true);
    expect(stale.meta.stale).toBe(true);
    expect(stale.meta.source).toBe('cache');
    expect(stale.data.items).toHaveLength(20);
    expect(stale.meta.warnings.some((w) => /STALE/.test(w.code))).toBe(true);
  });

  it('expired cache + upstream success → refreshed data, not stale', async () => {
    env = createTestEnv({ overrides: { cache: { ttl_list_s: 0 } } });
    const mock = installFetchMock(searchResponder({ pages: singlePage() }));
    await env.search.search({ keyword: 'glass' });
    const second = await env.search.search({ keyword: 'glass' });

    expect(second.meta.cached).toBe(false);
    expect(second.meta.stale).toBe(false);
    expect(mock.calls.length).toBe(2);
  });

  it('no cache + upstream challenge → CAPTCHA_REQUIRED (no stale fallback)', async () => {
    env = createTestEnv();
    installFetchMock(() => captchaRedirect());
    await expect(env.search.search({ keyword: 'glass' })).rejects.toMatchObject({ code: 'CAPTCHA_REQUIRED' });
  });
});

describe('cache stores companies / stats / clear (TC-38/TC-39)', () => {
  it('upserts company projections with tier and ad flags', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 2000, totalPage: 100, capped: true })] }));
    await env.search.search({ keyword: 'glass' });

    const rows = env.cache.db
      .prepare('SELECT account, company_id, membership_tier, raw_cs_level, is_ad FROM companies ORDER BY account')
      .all() as Array<{ account: string; company_id: number | null; membership_tier: string; raw_cs_level: number | null; is_ad: number }>;
    expect(rows).toHaveLength(20);
    const tiers = rows.map((r) => r.membership_tier);
    expect(tiers.filter((t) => t === 'diamond').length).toBe(19);
    expect(tiers.filter((t) => t === 'gold').length).toBe(1);
    expect(rows.every((r) => r.company_id && r.company_id > 0)).toBe(true);
    expect(rows.filter((r) => r.is_ad === 1).length).toBeGreaterThan(0);

    // cached second search must not duplicate rows
    await env.search.search({ keyword: 'glass' });
    const count = env.cache.db.prepare('SELECT COUNT(*) AS n FROM companies').get() as { n: number };
    expect(count.n).toBe(20);
  });

  it('stats reports schema version/entries and clear(search) empties search cache', async () => {
    env = createTestEnv();
    installFetchMock(searchResponder({ pages: cappedPages() }));
    await env.search.search({ keyword: 'glass' });

    const stats = env.cache.stats();
    expect(stats.schema_version).toBe(1);
    expect(stats.entries.search_page_cache).toBe(1);
    expect(stats.entries.companies).toBe(20);
    expect(stats.ttl_seconds.list).toBe(21600);

    const removed = env.cache.clear('search');
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(env.cache.stats().entries.search_page_cache).toBe(0);
  });

  it('empty result pages are cached with the shorter empty-list TTL', async () => {
    env = createTestEnv();
    installFetchMock(
      searchResponder({ pages: [buildSearchPayload({ items: [], page: 1, total: 0, totalPage: 0 })] }),
    );
    await env.search.search({ keyword: 'glass', province: 'Qinghai' });

    const row = env.cache.db
      .prepare('SELECT fetched_at, expires_at FROM search_page_cache LIMIT 1')
      .get() as { fetched_at: number; expires_at: number } | undefined;
    expect(row).toBeTruthy();
    expect(row!.expires_at - row!.fetched_at).toBe(env.cfg.cache.ttl_empty_list_s);
  });

  it('single-flight: two concurrent identical searches share one upstream request', async () => {
    env = createTestEnv();
    const mock = installFetchMock(async (req) => {
      await new Promise((r) => setTimeout(r, 15));
      return searchResponder({ pages: cappedPages() })(req);
    });

    const [a, b] = await Promise.all([
      env.search.search({ keyword: 'glass' }),
      env.search.search({ keyword: 'glass' }),
    ]);
    expect(mock.calls).toHaveLength(1);
    expect(a.data.items).toHaveLength(20);
    expect(b.data.items).toHaveLength(20);
  });
});
