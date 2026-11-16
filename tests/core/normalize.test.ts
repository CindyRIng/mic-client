import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import { createNormalizerService } from '../helpers/env.js';

/**
 * FR-01/02/07 — parameter & region normalization (pure, no network, no SQLite).
 * Cases reference docs/06 TC-01..TC-12 / AC-04/06/08 and docs/03 §7.
 */

function expectAppError(fn: () => unknown, code: string, reason?: string): AppError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    const err = e as AppError;
    expect(err.code).toBe(code);
    if (reason) expect(err.details?.['reason']).toBe(reason);
    return err;
  }
  throw new Error('expected AppError to be thrown');
}

describe('normalize: search modes (TC-01..TC-04)', () => {
  const svc = createNormalizerService();

  it('keyword only → search_mode=keyword', () => {
    const n = svc.normalize({ keyword: 'glass' });
    expect(n.query.search_mode).toBe('keyword');
    expect(n.query.keyword).toBe('glass');
    expect(n.query.keyword_effective).toBe('glass');
    expect(n.query.province).toBeNull();
    expect(n.query.city).toBeNull();
    expect(n.query.region_validated).toBe(false);
    expect(n.query.page).toBe(1);
    expect(n.query.page_size).toBe(20);
    expect(n.query.include_ads).toBe(true);
    expect(n.upstream.word).toBe('glass');
  });

  it('trims keyword and collapses surrounding whitespace', () => {
    const n = svc.normalize({ keyword: '  glass  ' });
    expect(n.query.keyword).toBe('glass');
    expect(n.upstream.word).toBe('glass');
  });

  it('province only → search_mode=region with lowercase region keyword', () => {
    const n = svc.normalize({ province: 'Hebei' });
    expect(n.query.search_mode).toBe('region');
    expect(n.query.keyword).toBeNull();
    expect(n.query.province).toBe('Hebei');
    expect(n.query.keyword_effective).toBe('hebei');
    expect(n.query.region_validated).toBe(true);
    expect(n.upstream.word).toBe('hebei');
    expect(n.upstream.province).toBe('Hebei');
  });

  it('Chinese province name is normalized to English', () => {
    const n = svc.normalize({ province: '河北' });
    expect(n.query.province).toBe('Hebei');
    expect(n.query.province_zh).toBe('河北');
    expect(n.query.keyword_effective).toBe('hebei');
  });

  it('Chinese city input (no province) infers province and region keyword', () => {
    const n = svc.normalize({ city: '廊坊' });
    expect(n.query.search_mode).toBe('region');
    expect(n.query.city).toBe('Langfang');
    expect(n.query.city_zh).toBe('廊坊');
    expect(n.query.province).toBe('Hebei');
    expect(n.query.keyword_effective).toBe('langfang');
  });

  it('English city input (no province) infers province', () => {
    const n = svc.normalize({ city: 'langfang' });
    expect(n.query.city).toBe('Langfang');
    expect(n.query.province).toBe('Hebei');
    expect(n.query.keyword_effective).toBe('langfang');
  });

  it('keyword + province → mixed mode, keyword wins as upstream word', () => {
    const n = svc.normalize({ keyword: 'glass', province: 'Hebei' });
    expect(n.query.search_mode).toBe('mixed');
    expect(n.query.keyword_effective).toBe('glass');
    expect(n.upstream.word).toBe('glass');
    expect(n.upstream.province).toBe('Hebei');
  });

  it('keyword + city → mixed mode with inferred province', () => {
    const n = svc.normalize({ keyword: 'glass', city: 'Langfang' });
    expect(n.query.search_mode).toBe('mixed');
    expect(n.query.province).toBe('Hebei');
    expect(n.query.city).toBe('Langfang');
  });
});

describe('normalize: CJK keyword handling (TC-07)', () => {
  const svc = createNormalizerService();

  it('CJK region word as keyword is converted to region mode', () => {
    const n = svc.normalize({ keyword: '河北' });
    expect(n.query.search_mode).toBe('region');
    expect(n.query.province).toBe('Hebei');
    expect(n.query.keyword).toBeNull();
    expect(n.query.keyword_effective).toBe('hebei');
  });

  it('CJK product keyword → INVALID_PARAM reason=NON_ENGLISH_KEYWORD', () => {
    const err = expectAppError(() => svc.normalize({ keyword: '玻璃' }), 'INVALID_PARAM', 'NON_ENGLISH_KEYWORD');
    expect(err.details?.['param']).toBe('keyword');
    expect(typeof err.details?.['hint']).toBe('string');
  });

  it('CJK keyword conflicting with explicit region args → INVALID_PARAM', () => {
    expectAppError(
      () => svc.normalize({ keyword: '河北 glass', province: 'Hebei' }),
      'INVALID_PARAM',
      'NON_ENGLISH_KEYWORD',
    );
  });
});

describe('normalize: region validation (TC-05/TC-08)', () => {
  const svc = createNormalizerService();

  it('empty keyword+province+city → INVALID_PARAM MISSING_REQUIRED_COMBO', () => {
    expectAppError(() => svc.normalize({}), 'INVALID_PARAM', 'MISSING_REQUIRED_COMBO');
  });

  it('unknown province → INVALID_PARAM UNKNOWN_PROVINCE with allowed list (32)', () => {
    const err = expectAppError(() => svc.normalize({ province: 'Atlantis' }), 'INVALID_PARAM', 'UNKNOWN_PROVINCE');
    expect(err.details?.['param']).toBe('province');
    expect(Array.isArray(err.details?.['allowed_provinces'])).toBe(true);
    expect((err.details?.['allowed_provinces'] as string[]).length).toBe(32);
  });

  it('unknown city in a complete province → INVALID_PARAM UNKNOWN_CITY with 10 Hebei cities', () => {
    const err = expectAppError(
      () => svc.normalize({ province: 'Hebei', city: 'Atlantis' }),
      'INVALID_PARAM',
      'UNKNOWN_CITY',
    );
    expect((err.details?.['allowed_cities'] as string[]).length).toBe(11);
  });

  it('unknown city in an incomplete province is passed through (region mode)', () => {
    const n = svc.normalize({ province: 'Guangdong', city: 'Foobar' });
    expect(n.query.city).toBe('Foobar');
    expect(n.query.province).toBe('Guangdong');
    expect(n.query.search_mode).toBe('region');
    expect(n.query.keyword_effective).toBe('foobar');
  });
});

describe('normalize: page & enum validation (TC-08/TC-15)', () => {
  const svc = createNormalizerService();

  it.each([0, 101, -1, 'abc'])('page=%s → INVALID_PARAM OUT_OF_RANGE', (page) => {
    expectAppError(() => svc.normalize({ keyword: 'glass', page }), 'INVALID_PARAM', 'OUT_OF_RANGE');
  });

  it.each([0, 101])('page_size=%s → INVALID_PARAM OUT_OF_RANGE', (size) => {
    expectAppError(() => svc.normalize({ keyword: 'glass', page_size: size }), 'INVALID_PARAM', 'OUT_OF_RANGE');
  });

  it('membership_tier=diamond maps to upstream memberLevel=50', () => {
    const n = svc.normalize({ province: 'Hebei', membership_tier: 'diamond' });
    expect(n.upstream.memberLevel).toBe('50');
    expect(n.query.filters['membership_tier']).toBe('diamond');
  });

  it('membership_tier=gold maps to upstream memberLevel=30', () => {
    const n = svc.normalize({ province: 'Hebei', membership_tier: 'gold' });
    expect(n.upstream.memberLevel).toBe('30');
  });

  it.each(['free', 'unknown', 'ka'])('membership_tier=%s is unsupported → INVALID_PARAM', (tier) => {
    expectAppError(
      () => svc.normalize({ province: 'Hebei', membership_tier: tier }),
      'INVALID_PARAM',
      'UNSUPPORTED_MEMBERSHIP_FILTER',
    );
  });

  it('audited=true enables the client-side audited filter', () => {
    expect(svc.normalize({ province: 'Hebei', audited: true }).auditedFilter).toBe(true);
    expect(svc.normalize({ province: 'Hebei', audited: 'true' }).auditedFilter).toBe(true);
    expect(svc.normalize({ province: 'Hebei', audited: 'false' }).auditedFilter).toBe(false);
  });

  it('business_type/annual_revenue/rd_capacity map to upstream codes', () => {
    const n = svc.normalize({
      keyword: 'glass',
      province: 'Hebei',
      business_type: 'manufacturer',
      annual_revenue: 'under_1m_usd',
      rd_capacity: 'oem',
      category_code: '1500000000',
      management_certification: '-5',
    });
    expect(n.upstream.comBusinessType).toBe('1');
    expect(n.upstream.annualRevenue).toBe('1');
    expect(n.upstream.rdCapacity).toBe('4');
    expect(n.upstream.catCode).toBe('1500000000');
    expect(n.upstream.managementCertification).toBe('-5');
  });

  it.each([
    ['business_type', 'foo'],
    ['annual_revenue', 'lots'],
    ['rd_capacity', 'warp'],
    ['refresh', 'maybe'],
  ] as const)('%s=%s → INVALID_PARAM INVALID_ENUM', (field, value) => {
    const input: Record<string, unknown> = { keyword: 'glass', [field]: value };
    expectAppError(() => svc.normalize(input), 'INVALID_PARAM', 'INVALID_ENUM');
  });

  it('boolean flags accept 1/0 strings; include_ads default true', () => {
    const n = svc.normalize({ keyword: 'glass', refresh: '1', include_ads: '0' });
    expect(n.query.refresh).toBe(true);
    expect(n.query.include_ads).toBe(false);
    expect(n.includeAds).toBe(false);
  });
});
