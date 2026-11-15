import { afterEach, describe, expect, it } from 'vitest';
import { buildCli } from '../../src/adapters/cli/index.js';
import { renderCompanySummary } from '../../src/adapters/cli/commands/company.js';
import type { CompanyDetail } from '../../src/core/models.js';
import { createTestContext, htmlFixture, htmlResponse, installFetchMock, standardRoutes } from './helpers.js';

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('mic company — CLI wiring', () => {
  it('registers the company command with lookup + identifier options', () => {
    const program = buildCli();
    const company = program.commands.find((c) => c.name() === 'company');
    expect(company).toBeTruthy();
    expect(company!.description()).toContain('company detail');
    const optionNames = company!.options.map((o) => o.long);
    expect(optionNames).toEqual(
      expect.arrayContaining(['--account', '--com-id', '--encode-com-id', '--include']),
    );
    expect(company!.usage()).toContain('lookup');
  });

  it('renderCompanySummary renders the documented human-readable summary', async () => {
    const ctx = createTestContext();
    const mock = installFetchMock(
      standardRoutes({ infoHtml: () => htmlResponse(htmlFixture('xingchenglass-info.html')) }),
    );
    cleanup = () => {
      mock.restore();
      ctx.close();
    };
    const result = await ctx.service.get({ lookup: 'xingchenglass', include: 'all' });
    const text = renderCompanySummary(result.data, result.meta);
    expect(text).toContain('公司：Hebei Xingchen Glass Technology Co., Ltd.');
    expect(text).toContain('账号：xingchenglass');
    expect(text).toContain('comId：1800987236');
    expect(text).toContain('encodeComId：UCJfyzwThnqK');
    expect(text).toContain('地区：Hebei / Langfang / China');
    expect(text).toContain('会员：diamond');
    expect(text).toContain('Since 2025');
    expect(text).toContain('认证：Audited Supplier');
    expect(text).toContain('主营：Glass Cup');
    expect(text).toContain('成立：2015-10-30');
    expect(text).toContain('员工：21');
    expect(text).toContain('认证体系：ISO 9001, BSCI');
    expect(text).toContain('评分：4.9/5（评论数 24');
    expect(text).toContain('星级：2/5');
    expect(text).toContain('响应：平均 1.74h');
    expect(text).toContain('联系人：cindy');
    expect(text).toContain('not_public_by_platform');
    expect(text).toContain('状态：success');
    expect(text).toContain(`请求：${result.meta.request_id}`);
  });

  it('renderCompanySummary shows null/not-requested semantics without inventing values', () => {
    const data: CompanyDetail = {
      account: 'minimalco',
      company_id: '1',
      encode_com_id: null,
      company_name: 'Minimal Co., Ltd.',
      province: null,
      city: null,
      country: null,
      address: null,
      established_at: null,
      main_products: [],
      business_types: [],
      membership: {
        tier: 'unknown',
        raw_cs_level: null,
        raw_member_level: null,
        since_year: null,
        evidence: [],
        confidence: 'low',
      },
      audited: null,
      capability_stars: null,
      system_certifications: [],
      employees: null,
      turnover: null,
      plant_area: null,
      company_url: 'https://m.made-in-china.com/company-minimalco/',
      company_info_url: 'https://m.made-in-china.com/company-minimalco/info.html',
      detail_source: 'json',
      include: [],
      enrichment: { audit: null, response: null, contacts: null, reviews: null },
      availability: [
        { field: 'turnover', reason: 'not_provided_by_supplier' },
        { field: 'plant_area', reason: 'not_provided_by_supplier' },
      ],
    };
    const text = renderCompanySummary(data, {
      request_id: 'req_test1',
      cached: false,
      stale: false,
      fetched_at: null,
      source: 'json',
      warnings: [],
    });
    expect(text).toContain('会员：unknown');
    expect(text).toContain('营收：-（not_provided_by_supplier）');
    expect(text).toContain('评分：-（未请求 enrichment.reviews）');
    expect(text).toContain('响应：-（未请求 enrichment.response）');
    expect(text).toContain('联系人：-（未请求 enrichment.contacts）');
  });
});
