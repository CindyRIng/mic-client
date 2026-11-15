import { afterEach, describe, expect, it } from 'vitest';
import {
  installFetchMock,
  restoreAllFetchMocks,
  searchResponder,
  textResponse,
  captchaRedirect,
} from '../helpers/mock-fetch.js';
import { createTestEnv, type TestEnv } from '../helpers/env.js';
import { buildSearchPayload, glassFullFixture } from '../helpers/fixtures.js';

/**
 * FR-12/FR-13 — upstream challenge / contract / retry error propagation.
 * Cases reference docs/06 TC-41/TC-48/TC-51/TC-52 and docs/03 §12.
 */

const glassItems = () => glassFullFixture().dataList as Array<Record<string, unknown>>;

let env: TestEnv | undefined;

afterEach(() => {
  restoreAllFetchMocks();
  env?.close();
  env = undefined;
});

async function withFakeTimers<T>(advanceMs: number, fn: () => Promise<T>): Promise<T> {
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  try {
    const promise = fn();
    await vi.advanceTimersByTimeAsync(advanceMs);
    return await promise;
  } finally {
    vi.useRealTimers();
  }
}

describe('upstream challenge & contract errors (TC-48/TC-53)', () => {
  it('302 → captcha yields CAPTCHA_REQUIRED without retrying', async () => {
    env = createTestEnv();
    const mock = installFetchMock(() => captchaRedirect());
    await expect(env.search.search({ keyword: 'glass' })).rejects.toMatchObject({
      code: 'CAPTCHA_REQUIRED',
    });
    expect(mock.calls).toHaveLength(1);
  });

  it('non-JSON 200 response yields UPSTREAM_CHANGED (contract)', async () => {
    env = createTestEnv();
    installFetchMock(() => textResponse('<html>not json</html>'));
    await expect(env.search.search({ keyword: 'glass' })).rejects.toMatchObject({
      code: 'UPSTREAM_CHANGED',
    });
  });

  it('JSON response missing dataList yields UPSTREAM_CHANGED with issue details', async () => {
    env = createTestEnv();
    installFetchMock(() => ({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ total: 1 }) }));
    try {
      await env.search.search({ keyword: 'glass' });
      throw new Error('expected UPSTREAM_CHANGED');
    } catch (e) {
      const err = e as { code?: string; details?: { issues?: unknown[] } };
      expect(err.code).toBe('UPSTREAM_CHANGED');
      expect(Array.isArray(err.details?.issues)).toBe(true);
    }
  });
});

describe('upstream retry / rate limit (TC-51/TC-52)', () => {
  it('5xx is retried (3 attempts) then surfaces UPSTREAM_UNAVAILABLE', async () => {
    env = createTestEnv();
    const mock = installFetchMock(() => ({ status: 503, headers: {}, body: 'down' }));
    const err = await withFakeTimers(25_000, () =>
      env!.search.search({ keyword: 'glass' }).catch((e) => e as { code?: string }),
    );
    expect((err as { code?: string }).code).toBe('UPSTREAM_UNAVAILABLE');
    expect(mock.calls).toHaveLength(3); // initial + 2 retries (cfg 默认)
  });

  it('429 is retried then surfaces RATE_LIMITED', async () => {
    env = createTestEnv();
    const mock = installFetchMock(() => ({ status: 429, headers: { 'retry-after': '1' }, body: 'slow down' }));
    const err = await withFakeTimers(25_000, () =>
      env!.search.search({ keyword: 'glass' }).catch((e) => e as { code?: string }),
    );
    expect((err as { code?: string }).code).toBe('RATE_LIMITED');
    expect(mock.calls).toHaveLength(3);
  });

  it('transient 503 then success recovers with retry', async () => {
    env = createTestEnv();
    let n = 0;
    installFetchMock((req) => {
      n += 1;
      if (n === 1) return { status: 503, headers: {}, body: 'down' };
      return searchResponder({
        pages: [buildSearchPayload({ items: glassItems(), page: 1, total: 20, totalPage: 1 })],
      })(req);
    });
    const res = await withFakeTimers(10_000, () => env!.search.search({ keyword: 'glass' }));
    expect(res.data.items).toHaveLength(20);
    expect(n).toBe(2);
  });
});
