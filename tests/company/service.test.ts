import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import { companyDetailSchema } from '../../src/core/models.js';
import { CompanyService, classifyLookup, parseInclude, shanghaiIso } from '../../src/core/company/service.js';
import { replyRateDate } from '../../src/core/api/enrich.js';
import {
  buildCompanyHtml,
  createTestContext,
  expireDetailCache,
  htmlFixture,
  htmlResponse,
  installFetchMock,
  jsonResponse,
  seedListCompany,
  ssrFixture,
  standardRoutes,
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

function useDefaultRoutes(): void {
  ctx = createTestContext();
  mock = installFetchMock(standardRoutes());
}

function service(): CompanyService {
  if (!ctx) throw new Error('context missing');
  return ctx.service;
}

async function expectRejection(promise: Promise<unknown>, code: string): Promise<AppError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e as AppError,
  );
  expect(err).toBeInstanceOf(AppError);
  expect(err!.code).toBe(code);
  return err!;
}

function cacheRowCount(c: TestContext, table: string): number {
  return (c.cache.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe('CompanyService — 基础详情 + 会员识别', () => {
  it('diamond: ssrData detail wins, since_year/audited/stars/address merged', async () => {
    useDefaultRoutes();
    const { data, meta } = await service().get({ lookup: 'xingchenglass' });
    expect(data.account).toBe('xingchenglass');
    expect(data.company_id).toBe('1800987236');
    expect(data.encode_com_id).toBe('UCJfyzwThnqK');
    expect(data.company_name).toBe('Hebei Xingchen Glass Technology Co., Ltd.');
    expect(data.membership.tier).toBe('diamond');
    expect(data.membership.raw_member_level).toBe('diamond');
    expect(data.membership.since_year).toBe(2025);
    expect(data.membership.confidence).toBe('high');
    expect(data.membership.evidence).toContain('json:memberLevel=diamond');
    expect(data.audited).toBe(true);
    expect(data.employees).toBe(21);
    expect(data.established_at).toBe('2015-10-30');
    expect(data.address).toContain('Langfang City, Hebei Province');
    expect(data.capability_stars).toBe(2);
    expect(data.system_certifications).toEqual(['ISO 9001', 'BSCI']);
    expect(data.main_products).toHaveLength(10);
    expect(data.business_types).toEqual(['Manufacturer/Factory & Trading Company']);
    // 地址派生地区（无列表缓存时也保证地区可用；不覆盖列表值）
    expect(data.province).toBe('Hebei');
    expect(data.city).toBe('Langfang');
    expect(data.country).toBe('China');
    expect(data.include).toEqual(['audit', 'response']);
    expect(data.detail_source).toBe('json');
    expect(data.enrichment.audit).not.toBeNull();
    expect(data.enrichment.response).not.toBeNull();
    expect(data.enrichment.contacts).toBeNull();
    expect(data.enrichment.reviews).toBeNull();
    expect(meta.cached).toBe(false);
    expect(meta.stale).toBe(false);
    expect(meta.source).toBe('json');
    expect(meta.fetched_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);
    expect(meta.warnings.map((w) => w.code)).not.toContain('ENRICHMENT_PARTIAL');
    // 缺失语义：turnover/plant_area 供应商未填
    const avail = Object.fromEntries(data.availability.map((a) => [a.field, a.reason]));
    expect(avail['turnover']).toBe('not_provided_by_supplier');
    expect(avail['plant_area']).toBe('not_provided_by_supplier');
    expect(avail['employees']).toBeUndefined();
    expect(avail['address']).toBeUndefined();
    // 输出必须能通过 docs/03 §11.10 CompanyDetail zod 契约
    expect(() => companyDetailSchema.parse(data)).not.toThrow();
  });

  it('writes base + default enrichment rows to SQLite', async () => {
    useDefaultRoutes();
    await service().get({ lookup: 'xingchenglass' });
    const c = ctx!;
    expect(cacheRowCount(c, 'companies')).toBe(1);
    expect(cacheRowCount(c, 'company_details')).toBe(1);
    expect(cacheRowCount(c, 'membership_info')).toBe(1);
    expect(cacheRowCount(c, 'audit_info')).toBe(1);
    expect(cacheRowCount(c, 'response_info')).toBe(1);
    expect(cacheRowCount(c, 'contact_info')).toBe(0);
    expect(cacheRowCount(c, 'review_summary')).toBe(0);
    const detail = c.cache.db
      .prepare('SELECT * FROM company_details WHERE account = ?')
      .get('xingchenglass') as Record<string, unknown>;
    expect(detail['address_province']).toBe('Hebei');
    expect(detail['address_city']).toBe('Langfang');
    expect(detail['employees']).toBe(21);
    expect(detail['sgs_member']).toBe(1);
  });

  it('include=all: audit/response/contacts/reviews + contacts channels always null/not_public', async () => {
    useDefaultRoutes();
    const { data } = await service().get({ lookup: 'xingchenglass', include: 'all' });
    expect(data.include).toEqual(['audit', 'response', 'contacts', 'reviews']);
    const audit = data.enrichment.audit!;
    expect(audit.audited).toBe(true);
    expect(audit.sections).toHaveLength(9);
    expect(audit.audited_section_count).toBe(5);
    expect(audit.agency).toBeNull();
    const response = data.enrichment.response!;
    expect(response.avg_response_hours).toBe(1.74);
    expect(response.timely_reply_ratio).toBe(1);
    expect(response.window_days).toBe(30);
    // replyRate 的 as_of = 请求日（今天-2，Asia/Shanghai），随运行日变化
    expect(response.as_of).toBe(replyRateDate(new Date()));
    const contacts = data.enrichment.contacts!;
    expect(contacts.persons).toHaveLength(4);
    expect(contacts.persons[0]).toMatchObject({ name: 'cindy', id: 'UCJfyzwThnqK_00', title: null, department: null, online: null, chat_available: true });
    expect(contacts.channels).toEqual({
      phone: null,
      email: null,
      whatsapp: null,
      skype: null,
      wechat: null,
      reason: 'not_public_by_platform',
    });
    expect(contacts.primary).toBeNull();
    const reviews = data.enrichment.reviews!;
    expect(reviews.rating_value).toBeCloseTo(4.9);
    expect(reviews.rating_display).toBe('4.9/5');
    expect(reviews.review_count).toBe(24);
    expect(reviews.items).toHaveLength(2);
    // 首期不抓：职位/部门/主联系人不猜、不建「登录可得」
    const avail = Object.fromEntries(data.availability.map((a) => [a.field, a.reason]));
    expect(avail['enrichment.contacts.primary']).toBe('not_provided_by_supplier');
    expect(JSON.stringify(data.availability)).not.toContain('needs_login');
  });

  it('gold: hnfinsulation detail signals', async () => {
    ctx = createTestContext();
    mock = installFetchMock(
      standardRoutes({ infoHtml: () => htmlResponse(htmlFixture('hnfinsulation-info.html')) }),
    );
    const { data } = await service().get({ lookup: 'hnfinsulation' });
    expect(data.membership.tier).toBe('gold');
    expect(data.membership.raw_member_level).toBe('gold');
    expect(data.membership.since_year).toBe(2025);
    expect(data.audited).toBe(true);
    expect(data.employees).toBe(80);
    expect(data.established_at).toBe('2019-12-20');
    expect(data.system_certifications).toEqual(['ISO9001:2015', 'ISO14001', 'Others']);
    expect(data.province).toBe('Hebei');
    expect(data.city).toBe('Tangshan');
  });

  it('unknown: no membership evidence → tier unknown (never guessed)', async () => {
    ctx = createTestContext();
    mock = installFetchMock(standardRoutes({ infoHtml: () => htmlResponse(htmlFixture('unknownco-info.html')) }));
    const { data } = await service().get({ lookup: 'unknownco', include: 'none' });
    expect(data.membership.tier).toBe('unknown');
    expect(data.membership.confidence).toBe('low');
    expect(data.membership.since_year).toBeNull();
    expect(data.membership.raw_member_level).toBeNull();
    expect(data.audited).toBeNull();
    expect(data.availability).toContainEqual({ field: 'employees', reason: 'not_provided_by_supplier' });
    expect(() => companyDetailSchema.parse(data)).not.toThrow();
  });

  it('free: page loaded, no badge, no AS → tier free (medium)', async () => {
    ctx = createTestContext();
    mock = installFetchMock(standardRoutes({ infoHtml: () => htmlResponse(htmlFixture('freesampleco-info.html')) }));
    const { data } = await service().get({ lookup: 'freesampleco', include: 'none' });
    expect(data.membership.tier).toBe('free');
    expect(data.membership.confidence).toBe('medium');
    expect(data.membership.evidence).toContain('json:no-member-badge');
  });

  it('free candidate with Audited Supplier is downgraded to unknown (docs/05 §4.5)', async () => {
    const ssr = ssrFixture('hnfinsulation-info.json') as Record<string, unknown>;
    const content = ((ssr['companyInfo'] as Record<string, unknown>)['content'] ?? {}) as Record<string, unknown>;
    delete content['memberLevel'];
    delete content['memberSince'];
    ssr['isDiamondMember'] = false;
    const html = buildCompanyHtml(ssr, ['Number of Employees', 'Address: Somewhere, Hebei Province']);
    ctx = createTestContext();
    mock = installFetchMock(standardRoutes({ infoHtml: () => htmlResponse(html) }));
    const { data } = await service().get({ lookup: 'hnfinsulation', include: 'none' });
    expect(data.audited).toBe(true);
    expect(data.membership.tier).toBe('unknown');
    expect(data.membership.evidence).toContain('derived:free-suppressed-by-audited');
  });

  it('membership conflict: list gold vs detail diamond → detail wins + MEMBER_EVIDENCE_CONFLICT', async () => {
    ctx = createTestContext();
    seedListCompany(ctx.cache, {
      account: 'xingchenglass',
      csLevel: 30,
      audited: true,
      province: 'Hebei',
      city: 'Langfang',
      country: 'China',
      encodeComId: 'UCJfyzwThnqK',
    });
    mock = installFetchMock(standardRoutes());
    const { data, meta } = await service().get({ lookup: 'xingchenglass', include: 'none' });
    expect(data.membership.tier).toBe('diamond');
    expect(data.membership.raw_cs_level).toBe(30);
    expect(data.membership.raw_member_level).toBe('diamond');
    expect(data.membership.confidence).toBe('medium');
    expect(data.membership.evidence).toEqual(
      expect.arrayContaining(['json:csLevel=30', 'json:memberLevel=diamond']),
    );
    const warning = meta.warnings.find((w) => w.code === 'MEMBER_EVIDENCE_CONFLICT');
    expect(warning).toBeTruthy();
    expect(warning!.details).toMatchObject({ list_tier: 'gold', detail_tier: 'diamond' });
  });

  it('audited conflict: list false, detail true → detail wins', async () => {
    ctx = createTestContext();
    seedListCompany(ctx.cache, { account: 'xingchenglass', csLevel: 50, audited: false });
    mock = installFetchMock(standardRoutes());
    const { data } = await service().get({ lookup: 'xingchenglass', include: 'none' });
    expect(data.audited).toBe(true);
  });

  it('audited conflict: list true, detail explicitly false → detail wins', async () => {
    const ssr = ssrFixture('xingchenglass-info.json') as Record<string, unknown>;
    const content = ((ssr['companyInfo'] as Record<string, unknown>)['content'] ?? {}) as Record<string, unknown>;
    content['sgsMember'] = false;
    content['auditReportLogo'] = { showAuditLogo: false, logoText: '' };
    const html = buildCompanyHtml(ssr);
    ctx = createTestContext();
    seedListCompany(ctx.cache, { account: 'xingchenglass', csLevel: 50, audited: true });
    mock = installFetchMock(standardRoutes({ infoHtml: () => htmlResponse(html) }));
    const { data } = await service().get({ lookup: 'xingchenglass', include: 'none' });
    expect(data.membership.tier).toBe('diamond');
    expect(data.audited).toBe(false);
  });

  it('membership since_year parses memberSince ("2018" and date-like "2019-06-01")', async () => {
    ctx = createTestContext();
    mock = installFetchMock(
      standardRoutes({ infoHtml: () => htmlResponse(htmlFixture('lvxingmirror-info.html')) }),
    );
    const lvxing = await service().get({ lookup: 'lvxingmirror', include: 'none' });
    expect(lvxing.data.membership.since_year).toBe(2018);

    const ssr = ssrFixture('hnfinsulation-info.json') as Record<string, unknown>;
    const content = ((ssr['companyInfo'] as Record<string, unknown>)['content'] ?? {}) as Record<string, unknown>;
    content['memberSince'] = '2019-06-01';
    const html = buildCompanyHtml(ssr);
    mock.restore();
    mock = installFetchMock(standardRoutes({ infoHtml: () => htmlResponse(html) }));
    const dated = await service().get({ lookup: 'hnfinsulation', include: 'none' });
    expect(dated.data.membership.since_year).toBe(2019);
  });
});

describe('CompanyService — 增强降级 / 缓存 / lookup', () => {
  it('enrichment failure degrades to null + fetch_blocked + ENRICHMENT_PARTIAL (does not fail request)', async () => {
    ctx = createTestContext();
    mock = installFetchMock(standardRoutes({ replyRate: () => jsonResponse({ status: 0, code: 500 }) }));
    const { data, meta } = await service().get({ lookup: 'xingchenglass' });
    expect(data.enrichment.audit).not.toBeNull();
    expect(data.enrichment.response).toBeNull();
    expect(data.availability).toContainEqual({ field: 'enrichment.response', reason: 'fetch_blocked' });
    const partial = meta.warnings.find((w) => w.code === 'ENRICHMENT_PARTIAL');
    expect(partial).toBeTruthy();
    expect(partial!.details?.['failed']).toEqual(['response']);
  });

  it('audit enrichment failure → audit null, response still available', async () => {
    ctx = createTestContext();
    mock = installFetchMock(standardRoutes({ sgs: () => jsonResponse({ code: 9, msg: 'no report' }) }));
    const { data, meta } = await service().get({ lookup: 'xingchenglass' });
    expect(data.enrichment.audit).toBeNull();
    expect(data.enrichment.response).not.toBeNull();
    expect(data.availability).toContainEqual({ field: 'enrichment.audit', reason: 'fetch_blocked' });
    expect(meta.warnings.find((w) => w.code === 'ENRICHMENT_PARTIAL')?.details?.['failed']).toEqual(['audit']);
  });

  it('cache hit: second call does not touch upstream and reports cached/cache', async () => {
    useDefaultRoutes();
    const first = await service().get({ lookup: 'xingchenglass' });
    expect(mock!.calls).toHaveLength(3); // info + audit + response
    const second = await service().get({ lookup: 'xingchenglass' });
    expect(mock!.calls).toHaveLength(3);
    expect(second.meta.cached).toBe(true);
    expect(second.meta.stale).toBe(false);
    expect(second.meta.source).toBe('cache');
    expect(second.data.detail_source).toBe('cache');
    expect(second.data.enrichment.audit!.source).toBe('cache');
    expect(second.data.membership).toEqual(first.data.membership);
    expect(second.meta.fetched_at).toBe(first.meta.fetched_at);
  });

  it('refresh=true forces base + requested enrichment re-fetch', async () => {
    useDefaultRoutes();
    await service().get({ lookup: 'xingchenglass' });
    expect(mock!.calls).toHaveLength(3);
    const refreshed = await service().get({ lookup: 'xingchenglass', refresh: true });
    expect(mock!.calls).toHaveLength(6);
    expect(refreshed.meta.cached).toBe(false);
    expect(refreshed.meta.source).toBe('json');
  });

  it('stale-while-error: upstream structurally broken → stale detail cache + STALE_DATA', async () => {
    useDefaultRoutes();
    const first = await service().get({ lookup: 'xingchenglass', include: 'none' });
    expireDetailCache(ctx!.cache, 'xingchenglass');
    mock!.restore();
    mock = installFetchMock(
      standardRoutes({ infoHtml: () => htmlResponse(htmlFixture('no-ssrdata-info.html')) }),
    );
    const second = await service().get({ lookup: 'xingchenglass', include: 'none' });
    expect(second.meta.stale).toBe(true);
    expect(second.meta.cached).toBe(true);
    expect(second.meta.source).toBe('cache');
    expect(second.meta.warnings.map((w) => w.code)).toContain('STALE_DATA');
    expect(second.data.company_name).toBe(first.data.company_name);
    expect(second.data.membership.tier).toBe('diamond');
  });

  it('include=none makes no enrichment calls', async () => {
    useDefaultRoutes();
    const { data } = await service().get({ lookup: 'xingchenglass', include: 'none' });
    expect(mock!.calls).toHaveLength(1);
    expect(data.include).toEqual([]);
    expect(data.enrichment).toEqual({ audit: null, response: null, contacts: null, reviews: null });
  });

  it('encodeComId lookup resolves only from the local companies index', async () => {
    ctx = createTestContext();
    mock = installFetchMock(standardRoutes());
    const missing = await expectRejection(service().get({ lookup: 'UCJfyzwThnqK' }), 'NOT_FOUND');
    expect(missing.details?.['reason']).toBe('ENCODE_COM_ID_NOT_INDEXED');
    expect(mock!.calls).toHaveLength(0);

    seedListCompany(ctx.cache, {
      account: 'xingchenglass',
      csLevel: 50,
      encodeComId: 'UCJfyzwThnqK',
    });
    const { data } = await service().get({ lookup: 'UCJfyzwThnqK', include: 'none' });
    expect(data.account).toBe('xingchenglass');
    expect(data.membership.tier).toBe('diamond');
  });

  it('numeric comId is resolved via the m-site 301 to account', async () => {
    ctx = createTestContext();
    const std = standardRoutes();
    mock = installFetchMock((url, init, call) => {
      if (url.endsWith('/company/1800987236')) {
        return new Response('', {
          status: 301,
          headers: { location: '/company-xingchenglass/' },
        });
      }
      if (url === 'https://m.made-in-china.com/company-xingchenglass/') return htmlResponse('');
      return std(url, init, call);
    });
    const { data } = await service().get({ lookup: '1800987236', include: 'none' });
    expect(data.account).toBe('xingchenglass');
    expect(data.company_id).toBe('1800987236');
  });

  it('upstream 404 → NOT_FOUND ACCOUNT_NOT_FOUND', async () => {
    ctx = createTestContext();
    mock = installFetchMock(standardRoutes({ infoHtml: () => new Response('', { status: 404 }) }));
    const err = await expectRejection(service().get({ lookup: 'nosuchcompany' }), 'NOT_FOUND');
    expect(err.details?.['reason']).toBe('ACCOUNT_NOT_FOUND');
  });

  it('m-site challenge without solver → NEED_HUMAN_VERIFICATION with src_url', async () => {
    ctx = createTestContext();
    mock = installFetchMock(
      standardRoutes({ infoHtml: () => htmlResponse(htmlFixture('challenge-edgeone.html')) }),
    );
    const err = await expectRejection(service().get({ lookup: 'xingchenglass' }), 'NEED_HUMAN_VERIFICATION');
    expect(err.details?.['src_url']).toBe('https://m.made-in-china.com/company-xingchenglass/info.html');
    expect(err.details?.['action']).toBe('mic auth');
  });

  it('m-site challenge with solver that does not clear it → CAPTCHA_SOLVE_FAILED (retryable)', async () => {
    ctx = createTestContext();
    mock = installFetchMock(
      standardRoutes({ infoHtml: () => htmlResponse(htmlFixture('challenge-edgeone.html')) }),
    );
    const solverCalls: string[] = [];
    const err = await expectRejection(
      service().get({
        lookup: 'xingchenglass',
        onCaptcha: async (u) => {
          solverCalls.push(u);
        },
      }),
      'CAPTCHA_SOLVE_FAILED',
    );
    expect(err.retryable).toBe(true);
    expect(solverCalls).toHaveLength(1);
  });

  it('m-site challenge cleared by solver → detail returned', async () => {
    ctx = createTestContext();
    let infoCalls = 0;
    mock = installFetchMock(
      standardRoutes({
        infoHtml: () => {
          infoCalls += 1;
          return infoCalls === 1
            ? htmlResponse(htmlFixture('challenge-edgeone.html'))
            : htmlResponse(htmlFixture('xingchenglass-info.html'));
        },
      }),
    );
    const solverCalls: string[] = [];
    const { data } = await service().get({
      lookup: 'xingchenglass',
      include: 'none',
      onCaptcha: async (u) => {
        solverCalls.push(u);
      },
    });
    expect(solverCalls).toHaveLength(1);
    expect(data.membership.tier).toBe('diamond');
  });

  it('--no-cache mode: no SQLite writes, data still complete from payload', async () => {
    ctx = createTestContext({ cacheEnabled: false });
    mock = installFetchMock(standardRoutes());
    const { data, meta } = await service().get({ lookup: 'xingchenglass' });
    expect(meta.cached).toBe(false);
    expect(meta.source).toBe('json');
    expect(data.company_id).toBe('1800987236');
    expect(data.encode_com_id).toBe('UCJfyzwThnqK');
    expect(mock!.calls).toHaveLength(3);
    expect(cacheRowCount(ctx, 'company_details')).toBe(0);
    expect(meta.warnings.map((w) => w.code)).not.toContain('CACHE_WRITE_FAILED');
  });
});

describe('CompanyService — 参数校验', () => {
  it('invalid include → INVALID_PARAM INVALID_INCLUDE', async () => {
    useDefaultRoutes();
    const err = await expectRejection(
      service().get({ lookup: 'xingchenglass', include: 'audit,bogus' }),
      'INVALID_PARAM',
    );
    expect(err.details?.['reason']).toBe('INVALID_INCLUDE');
    expect(mock!.calls).toHaveLength(0);
  });

  it('include=none combined with others is invalid', () => {
    expect(() => parseInclude('none,audit')).toThrowError(AppError);
    expect(parseInclude('all')).toEqual(['audit', 'response', 'contacts', 'reviews']);
    expect(parseInclude('reviews,audit')).toEqual(['audit', 'reviews']);
    expect(parseInclude(undefined)).toEqual(['audit', 'response']);
    expect(parseInclude('none')).toEqual([]);
  });

  it('missing identifier → INVALID_PARAM', async () => {
    useDefaultRoutes();
    await expectRejection(service().get({}), 'INVALID_PARAM');
  });

  it('shanghaiIso renders +08:00 timestamps', () => {
    expect(shanghaiIso(0)).toMatch(/^1970-01-01T08:00:00\+08:00$/);
    expect(shanghaiIso(null)).toBeNull();
  });
});

describe('classifyLookup', () => {
  it('classifies accounts, URLs, comIds and encodeComIds', () => {
    expect(classifyLookup({ lookup: 'xingchenglass' })).toEqual({ kind: 'account', value: 'xingchenglass' });
    expect(classifyLookup({ lookup: 'company-xingchenglass' })).toEqual({
      kind: 'account',
      value: 'xingchenglass',
    });
    expect(
      classifyLookup({ lookup: 'https://m.made-in-china.com/company-xingchenglass/info.html' }),
    ).toEqual({ kind: 'account', value: 'xingchenglass' });
    expect(classifyLookup({ lookup: 'https://xingchenglass.en.made-in-china.com/' })).toEqual({
      kind: 'account',
      value: 'xingchenglass',
    });
    expect(classifyLookup({ lookup: '1800987236' })).toEqual({ kind: 'com_id', value: '1800987236' });
    expect(classifyLookup({ lookup: 'UCJfyzwThnqK' })).toEqual({
      kind: 'encode_com_id',
      value: 'UCJfyzwThnqK',
    });
    expect(classifyLookup({ account: 'XingChenGlass' })).toEqual({ kind: 'account', value: 'xingchenglass' });
    expect(classifyLookup({ com_id: '123' })).toEqual({ kind: 'com_id', value: '123' });
    expect(classifyLookup({ encode_com_id: 'AbCd1234' })).toEqual({
      kind: 'encode_com_id',
      value: 'AbCd1234',
    });
  });

  it('rejects multiple identifiers and invalid values', () => {
    expect(() => classifyLookup({ lookup: 'a', account: 'b' })).toThrowError(AppError);
    expect(() => classifyLookup({})).toThrowError(AppError);
    expect(() => classifyLookup({ com_id: 'abc' })).toThrowError(AppError);
    expect(() => classifyLookup({ lookup: 'bad account!' })).toThrowError(AppError);
  });

  it('allows the same value passed as positional + option (CLI C1)', () => {
    expect(classifyLookup({ lookup: 'xingchenglass', account: 'xingchenglass' })).toEqual({
      kind: 'account',
      value: 'xingchenglass',
    });
  });
});
