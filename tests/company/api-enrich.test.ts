import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import { CompanyEnricher, parseRatingDisplay, replyRateDate } from '../../src/core/api/enrich.js';
import {
  createTestContext,
  enrichFixture,
  installFetchMock,
  jsonResponse,
  type FetchMock,
  type TestContext,
} from './helpers.js';

let ctx: TestContext | null = null;
let mock: FetchMock | null = null;

afterEach(() => {
  mock?.restore();
  mock = null;
  ctx?.close();
  ctx = null;
});

function makeEnricher(): CompanyEnricher {
  ctx = createTestContext();
  return ctx.enricher;
}

describe('CompanyEnricher (mocked fetch)', () => {
  it('auditSections parses the 9 SGS section rows', async () => {
    const enricher = makeEnricher();
    mock = installFetchMock((url) => {
      expect(url).toBe('https://www.made-in-china.com/multi-search/sgs/report?comId=bSrtEKgyYcUf');
      return jsonResponse(enrichFixture('sgs-sections.json'));
    });
    const sections = await enricher.auditSections('bSrtEKgyYcUf');
    expect(sections).toHaveLength(9);
    expect(sections[0]).toEqual({ name: 'General Information', audited: true });
    expect(sections.filter((s) => s.audited)).toHaveLength(5);
  });

  it('auditSections maps a code!==0 body to UPSTREAM_CHANGED', async () => {
    const enricher = makeEnricher();
    mock = installFetchMock(() => jsonResponse({ code: 500, msg: 'error' }));
    await expect(enricher.auditSections('bSrtEKgyYcUf')).rejects.toMatchObject({
      code: 'UPSTREAM_CHANGED',
    } satisfies Partial<AppError>);
  });

  it('replyRate parses metrics and sends date=today-2d (Asia/Shanghai)', async () => {
    const enricher = makeEnricher();
    mock = installFetchMock((url) => {
      expect(url).toContain('https://data.made-in-china.com/extend/busiMerge/replyRate?');
      expect(url).toContain('date=20261113');
      expect(url).toContain('comId=UCJfyzwThnqK');
      expect(url).toContain('operatorNo=all');
      return jsonResponse(enrichFixture('reply-rate.json'));
    });
    const data = await enricher.replyRate('UCJfyzwThnqK', {}, new Date('2026-11-15T12:00:00+08:00'));
    expect(data).toEqual({
      avg_response_hours: 1.74,
      timely_reply_ratio: 1,
      top_avg_response_hours: 0.39,
      top_timely_reply_ratio: 1,
      range_display: '≤1.74h',
      as_of: '20261113',
    });
  });

  it('replyRate returns null when upstream has no data row (not a failure)', async () => {
    const enricher = makeEnricher();
    mock = installFetchMock(() => jsonResponse({ status: 1, data: null }));
    await expect(enricher.replyRate('UCJfyzwThnqK')).resolves.toBeNull();
  });

  it('subAccounts returns TM persons for the encodeComId', async () => {
    const enricher = makeEnricher();
    mock = installFetchMock((url) => {
      expect(url).toBe('https://www.made-in-china.com/im.do?xcase=getSubAccount&comIdStr=bSrtEKgyYcUf');
      return jsonResponse(enrichFixture('tm-sub-accounts.json'));
    });
    const persons = await enricher.subAccounts('bSrtEKgyYcUf');
    expect(persons).toHaveLength(4);
    expect(persons[0]).toEqual({ name: 'Lisa', id: 'bSrtEKgyYcUf_00' });
  });

  it('reviews parses items + totalCount and caps at 10', async () => {
    const enricher = makeEnricher();
    mock = installFetchMock((url) => {
      expect(url).toContain('https://m.made-in-china.com/user/review/front/next?pageNum=1');
      expect(url).toContain('receiverComId=UCJfyzwThnqK');
      expect((mock!.calls[0]!.init.headers as Record<string, string>)['X-Requested-With']).toBe('XMLHttpRequest');
      return jsonResponse(enrichFixture('reviews.json'));
    });
    const data = await enricher.reviews('UCJfyzwThnqK');
    expect(data.review_count).toBe(24);
    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toMatchObject({
      review_id: 'FJZxrWmMYnqc',
      rating: 5,
      sender_name: 'A***r',
      sender_country: 'Spain',
      created_at: '2026-08-28',
      product_url: expect.stringContaining('m.made-in-china.com/product/'),
    });
  });

  it('reviews maps an invalid-param code to UPSTREAM_CHANGED', async () => {
    const enricher = makeEnricher();
    mock = installFetchMock(() => jsonResponse({ code: 900004, err: 'invalid param' }));
    await expect(enricher.reviews('1800987236')).rejects.toMatchObject({ code: 'UPSTREAM_CHANGED' });
  });

  it('non-JSON body → UPSTREAM_CHANGED', async () => {
    const enricher = makeEnricher();
    mock = installFetchMock(
      () => new Response('<html>challenge</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    );
    await expect(enricher.auditSections('x')).rejects.toMatchObject({ code: 'UPSTREAM_CHANGED' });
  });

  it('HTTP 429 → RATE_LIMITED (surfaced by HttpClient, no extra retry)', async () => {
    const enricher = makeEnricher();
    mock = installFetchMock(() => new Response('', { status: 429 }));
    await expect(enricher.subAccounts('x')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('date / rating helpers', () => {
  it('replyRateDate subtracts two days in Asia/Shanghai', () => {
    expect(replyRateDate(new Date('2026-11-15T12:00:00+08:00'))).toBe('20261113');
    // 2026-11-16T00:30+08:00 → Shanghai date 2026-11-14
    expect(replyRateDate(new Date('2026-11-15T16:30:00Z'))).toBe('20261114');
    expect(replyRateDate(new Date('2026-11-01T00:10:00+08:00'))).toBe('20261030');
  });

  it('parseRatingDisplay parses upstream rating text', () => {
    expect(parseRatingDisplay('4.9/5')).toBeCloseTo(4.9);
    expect(parseRatingDisplay('5')).toBe(5);
    expect(parseRatingDisplay(null)).toBeNull();
    expect(parseRatingDisplay('-')).toBeNull();
  });
});
