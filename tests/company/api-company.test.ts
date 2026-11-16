import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import {
  CompanyDetailApi,
  extractBodyFields,
  htmlToText,
  isChallengePage,
  normalizeEstablishment,
  parseAccountFromUrl,
  parseCompanyDetailHtml,
  parseEmployeeCount,
  parseSsrData,
  splitCertifications,
} from '../../src/core/api/company.js';
import {
  createTestContext,
  htmlFixture,
  htmlResponse,
  installFetchMock,
  jsonResponse,
  redirectResponse,
  ssrFixture,
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

function expectAppError(fn: () => unknown, code: string): AppError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    const err = e as AppError;
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected AppError ${code}, nothing thrown`);
}

describe('parseSsrData', () => {
  it('extracts the ssrData JSON script from info.html', () => {
    const ssr = parseSsrData(htmlFixture('xingchenglass-info.html')) as Record<string, unknown>;
    expect(ssr['logUsername']).toBe('xingchenglass');
    expect((ssr['companyInfo'] as Record<string, unknown>)['code']).toBe(0);
  });

  it('accepts a type=text/json script whose attribute order differs', () => {
    const html = '<html><script id="ssrData" type="text/json">{"a":1}</script></html>';
    expect(parseSsrData(html)).toEqual({ a: 1 });
  });

  it('throws UPSTREAM_CHANGED when ssrData script is missing', () => {
    const err = expectAppError(() => parseSsrData(htmlFixture('no-ssrdata-info.html')), 'UPSTREAM_CHANGED');
    expect(err.details?.['reason']).toBe('SSR_DATA_MISSING');
  });

  it('throws PARSE_ERROR when ssrData is not valid JSON', () => {
    const err = expectAppError(() => parseSsrData(htmlFixture('invalid-ssrdata-info.html')), 'PARSE_ERROR');
    expect(err.details?.['reason']).toBe('SSR_DATA_INVALID_JSON');
  });
});

describe('isChallengePage', () => {
  it('detects the EdgeOne JS challenge page', () => {
    expect(isChallengePage({ body: htmlFixture('challenge-edgeone.html') })).toBe(true);
  });

  it('does not flag a normal company page', () => {
    expect(isChallengePage({ body: htmlFixture('xingchenglass-info.html') })).toBe(false);
  });

  it('does not flag a large page that merely mentions verification', () => {
    const body = 'verification.html ' + 'x'.repeat(9000);
    expect(isChallengePage({ body })).toBe(false);
  });
});

describe('parseCompanyDetailHtml', () => {
  it('parses diamond company: ssrData + body fields', () => {
    const payload = parseCompanyDetailHtml(htmlFixture('xingchenglass-info.html'), 'xingchenglass');
    expect(payload.account).toBe('xingchenglass');
    expect(payload.company_id).toBe('1800987236');
    expect(payload.encode_com_id).toBe('UCJfyzwThnqK');
    expect(payload.company_name).toBe('Hebei Xingchen Glass Technology Co., Ltd.');
    expect(payload.member_level).toBe('diamond');
    expect(payload.member_since).toBe('2025');
    expect(payload.is_diamond_member).toBe(true);
    expect(payload.sgs_member).toBe(true);
    expect(payload.audit_logo).toEqual({ show_audit_logo: true, logo_text: 'Audited Supplier' });
    expect(payload.establishment).toBe('2015-10-30');
    expect(payload.employees).toBe(21);
    expect(payload.employee_text).toBe('21');
    expect(payload.address).toContain('Bazhou City, Langfang City, Hebei Province');
    expect(payload.system_certifications).toEqual(['ISO 9001', 'BSCI']);
    expect(payload.stars).toBe(2);
    expect(payload.rating_display).toBe('4.9/5');
    expect(payload.main_products[0]).toBe('Glass Cup');
    expect(payload.main_products[1]).toBe('French Press'); // upstream value has a leading space
    expect(payload.business_types).toEqual(['Manufacturer/Factory & Trading Company']);
    expect(payload.source).toBe('json');
  });

  it('parses gold company body fields (employees / certifications / address)', () => {
    const payload = parseCompanyDetailHtml(htmlFixture('hnfinsulation-info.html'));
    expect(payload.account).toBe('hnfinsulation');
    expect(payload.member_level).toBe('gold');
    expect(payload.member_since).toBe('2025');
    expect(payload.employees).toBe(80);
    expect(payload.system_certifications).toEqual(expect.arrayContaining(['ISO9001:2015', 'ISO14001', 'Others']));
    expect(payload.address).toContain('Caofeidian Industrial Zone');
    expect(payload.establishment).toBe('2019-12-20');
  });

  it('parses a page with no membership evidence (unknown signals)', () => {
    const payload = parseCompanyDetailHtml(htmlFixture('unknownco-info.html'));
    expect(payload.member_level).toBeNull();
    expect(payload.member_since).toBeNull();
    expect(payload.is_diamond_member).toBeNull();
    expect(payload.sgs_member).toBeNull();
    expect(payload.audit_logo).toBeNull();
  });

  it('parses a free-member style page (isDiamondMember=false, no badge)', () => {
    const payload = parseCompanyDetailHtml(htmlFixture('freesampleco-info.html'));
    expect(payload.member_level).toBeNull();
    expect(payload.is_diamond_member).toBe(false);
    expect(payload.sgs_member).toBeNull();
  });

  it('throws UPSTREAM_CHANGED when companyInfo.code !== 0', () => {
    const err = expectAppError(
      () => parseCompanyDetailHtml(htmlFixture('broken-companyinfo-info.html')),
      'UPSTREAM_CHANGED',
    );
    expect(err.details?.['reason']).toBe('COMPANY_INFO_ERROR');
  });

  it('throws UPSTREAM_CHANGED when companyInfo.content is missing', () => {
    const ssr = ssrFixture('xingchenglass-info.json') as Record<string, unknown>;
    ssr['companyInfo'] = { code: 0, success: true };
    const html = `<html><body><script type="text/json" id="ssrData">${JSON.stringify(ssr)}</script></body></html>`;
    const err = expectAppError(() => parseCompanyDetailHtml(html), 'UPSTREAM_CHANGED');
    expect(err.details?.['reason']).toBe('COMPANY_INFO_MISSING');
  });
});

describe('body field helpers', () => {
  it('htmlToText separates block elements and decodes entities', () => {
    const text = htmlToText('<div>Address : Foo &amp; Bar</div><div>Hot Products</div>');
    expect(text).toBe('Address : Foo & Bar\nHot Products');
  });

  it('extractBodyFields returns nulls when labels are absent', () => {
    const fields = extractBodyFields('<html><body><div>No fields here</div></body></html>');
    expect(fields).toEqual({
      address: null,
      employees: null,
      employee_text: null,
      establishment: null,
      system_certifications: [],
      main_products: [],
      business_types: [],
    });
  });

  it('extractBodyFields tolerates a single-line compressed body', () => {
    const html =
      '<div>Business Type : Manufacturer Number of Employees: 1,234 Management System Certification: ISO 9001, BSCI ' +
      'Address: No. 1 Road, Langfang City, Hebei Province Rating : -</div>';
    const fields = extractBodyFields(html);
    expect(fields.employees).toBe(1234);
    expect(fields.system_certifications).toEqual(['ISO 9001', 'BSCI']);
    expect(fields.address).toBe('No. 1 Road, Langfang City, Hebei Province');
  });

  it('normalizeEstablishment handles year-only and slash dates', () => {
    expect(normalizeEstablishment('2019')).toBe('2019');
    expect(normalizeEstablishment('2015/10/30')).toBe('2015-10-30');
    expect(normalizeEstablishment('2021-3-5')).toBe('2021-03-05');
    expect(normalizeEstablishment('')).toBeNull();
    expect(normalizeEstablishment(null)).toBeNull();
    expect(normalizeEstablishment('not a date')).toBeNull();
  });

  it('parseEmployeeCount parses comma groups and returns null on garbage', () => {
    expect(parseEmployeeCount('1,234')).toEqual({ employees: 1234, text: '1,234' });
    expect(parseEmployeeCount('21 People')).toEqual({ employees: 21, text: '21 People' });
    expect(parseEmployeeCount('many')).toEqual({ employees: null, text: 'many' });
    expect(parseEmployeeCount(null)).toEqual({ employees: null, text: null });
  });

  it('splitCertifications trims and dedupes', () => {
    expect(splitCertifications(' ISO 9001 , ISO14001,, BSCI ')).toEqual(['ISO 9001', 'ISO14001', 'BSCI']);
    expect(splitCertifications('iso 9001')).toEqual(['iso 9001']);
    expect(splitCertifications(null)).toEqual([]);
  });

  it('parseAccountFromUrl handles all documented URL forms', () => {
    expect(parseAccountFromUrl('https://m.made-in-china.com/company-xingchenglass/info.html')).toBe('xingchenglass');
    expect(parseAccountFromUrl('https://m.made-in-china.com/company-xingchenglass/')).toBe('xingchenglass');
    expect(parseAccountFromUrl('https://xingchenglass.en.made-in-china.com/')).toBe('xingchenglass');
    expect(parseAccountFromUrl('https://www.made-in-china.com/multi-search/sgs/report')).toBeNull();
  });
});

describe('CompanyDetailApi (mocked fetch)', () => {
  function makeApi(): CompanyDetailApi {
    ctx = createTestContext();
    return ctx.api;
  }

  it('fetchDetail requests the mobile info.html and parses it', async () => {
    const api = makeApi();
    mock = installFetchMock((url) => {
      expect(url).toBe('https://m.made-in-china.com/company-xingchenglass/info.html');
      return htmlResponse(htmlFixture('xingchenglass-info.html'));
    });
    const payload = await api.fetchDetail('xingchenglass');
    expect(payload.account).toBe('xingchenglass');
    expect(payload.member_level).toBe('diamond');
    const ua = String((mock.calls[0]!.init.headers as Record<string, string>)['User-Agent']);
    expect(ua).toContain('iPhone');
  });

  it('fetchDetail maps 404 to NOT_FOUND (ACCOUNT_NOT_FOUND)', async () => {
    const api = makeApi();
    mock = installFetchMock(() => new Response('not found', { status: 404 }));
    const err = await api.fetchDetail('nosuchcompany').then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err!.code).toBe('NOT_FOUND');
    expect(err!.details?.['reason']).toBe('ACCOUNT_NOT_FOUND');
  });

  it('fetchDetail throws CAPTCHA_REQUIRED for an EdgeOne challenge page (no solver injected)', async () => {
    const api = makeApi();
    mock = installFetchMock(() => htmlResponse(htmlFixture('challenge-edgeone.html')));
    const err = await api.fetchDetail('xingchenglass').then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(err!.code).toBe('CAPTCHA_REQUIRED');
    expect(err!.details?.['src_url']).toBe('https://m.made-in-china.com/company-xingchenglass/info.html');
  });

  it('fetchDetail retries once after the injected solver clears the challenge', async () => {
    const api = makeApi();
    let served = 0;
    const solverUrls: string[] = [];
    mock = installFetchMock(() => {
      served += 1;
      return served === 1
        ? htmlResponse(htmlFixture('challenge-edgeone.html'))
        : htmlResponse(htmlFixture('xingchenglass-info.html'));
    });
    const payload = await api.fetchDetail('xingchenglass', {
      onCaptcha: async (u) => {
        solverUrls.push(u);
      },
    });
    expect(payload.account).toBe('xingchenglass');
    expect(solverUrls).toHaveLength(1);
    expect(served).toBe(2);
  });

  it('fetchDetail maps a 302 Focus Captcha redirect to CAPTCHA_REQUIRED', async () => {
    const api = makeApi();
    mock = installFetchMock(() =>
      redirectResponse('https://captcha.made-in-china.com/verification.html?srcUrl=x'),
    );
    const err = await api.fetchDetail('xingchenglass').then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(err!.code).toBe('CAPTCHA_REQUIRED');
  });

  it('fetchDetail maps 5xx to UPSTREAM_UNAVAILABLE', async () => {
    const api = makeApi();
    mock = installFetchMock(() => new Response('boom', { status: 500 }));
    // retries=1 → one extra attempt with a randomized 1.5–3.5s backoff
    const err = await api.fetchDetail('xingchenglass').then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(err!.code).toBe('UPSTREAM_UNAVAILABLE');
  }, 15_000);

  it('resolveAccountByComId parses the 301 Location → account', async () => {
    const api = makeApi();
    mock = installFetchMock((url) => {
      if (url.endsWith('/company/1800987236')) {
        return redirectResponse('https://m.made-in-china.com/company-xingchenglass/', 301);
      }
      if (url.endsWith('/company-xingchenglass/')) return jsonResponse({});
      return new Response('unexpected', { status: 599 });
    });
    const account = await api.resolveAccountByComId('1800987236');
    expect(account).toBe('xingchenglass');
  });

  it('resolveAccountByComId maps an unresolvable target to NOT_FOUND (COM_ID_UNRESOLVED)', async () => {
    const api = makeApi();
    mock = installFetchMock(() => new Response('', { status: 200 }));
    const err = await api.resolveAccountByComId('999999').then(
      () => null,
      (e: unknown) => e as AppError,
    );
    expect(err!.code).toBe('NOT_FOUND');
    expect(err!.details?.['reason']).toBe('COM_ID_UNRESOLVED');
  });
});
