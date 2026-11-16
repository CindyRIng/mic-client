import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import {
  isDesktopCompanyHtml,
  parseAnyCompanyHtml,
  parseDesktopCompanyHtml,
} from '../../src/core/api/company.js';

const DESKTOP_HTML = `<!doctype html><html><head>
<title>Filter Mesh Manufacturer, Nylon Filter Bag Supplier - Shijiazhuang Tuya International Trade Co., Ltd</title>
</head><body>
<h1>Shijiazhuang Tuya International Trade Co., Ltd</h1>
<div class="supplier-head">
  <div>Ms. Emily <b>Diamond Member</b> <b>Audited Supplier</b></div>
  <div class="item"><div class="label">Address:</div><div class="txt">No. 198 Zhonghua Street, Shijiazhuang, Hebei, China</div></div>
  <div class="item"><div class="label">Account Registered in:</div><div class="info">2025</div></div>
  <div class="item"><div class="label">Business Range:</div><div class="info">Industrial Equipment</div></div>
  <div class="item"><div class="label">Management System Certification:</div><div class="info">ISO 9001, ISO 9000</div></div>
  <div class="item"><div class="label">Business Type:</div><div class="info">Manufacturer/Factory</div></div>
  <div class="item"><div class="label">Main Products:</div><div class="info">Nylon Filter Mesh, Rosin Press Bag, Screen Printing Mesh</div></div>
</div>
<input type="hidden" value="XBLGshlEZVrS" name="comId">
<div class="desc"><h2>Company Introduction</h2><p>Established 1998.</p></div>
</body></html>`;

const PARTIAL_SSR_HTML = `<!doctype html><html><head>
<title>Company Overview - Transocean Metal Products(Tangshan) Co., Ltd. | Made-in-China.com Mobile</title>
</head><body>
<script type="text/json" id="ssrData">${JSON.stringify({
  isDiamondMember: false,
  comId: '1936936774',
  logUsername: 'transoceanmetal',
  companyInfo: {
    code: 0,
    success: true,
    content: {
      comId: 'KObTgXFuMPHe',
      sgsMember: false,
      auditReportLogo: { showAuditLogo: true, logoText: 'Audited Supplier' },
      mainProducts: [],
      businessTypes: [],
      onlineTradeAble: false,
      companySymbol: { stars: '' },
      rd: [],
    },
  },
  leadingFactory: false,
  linkConfig: {},
})}</script>
<div class="company-info">
  <div><span>Business Type:</span> Manufacturer/Factory</div>
  <div><span>Main Products:</span> Wood Structure Connectors</div>
  <div><span>Year of Establishment:</span> 1995-01-26</div>
  <div><span>Number of Employees:</span> 11</div>
  <div><span>Address:</span> No. 16 Xi Zhong Da Jie, Luannan County, Tangshan City, Hebei Province 063500, China.</div>
</div>
</body></html>`;

describe('company detail desktop fallback (free members without mobile ssrData)', () => {
  it('detects desktop showroom HTML', () => {
    expect(isDesktopCompanyHtml(DESKTOP_HTML)).toBe(true);
    expect(isDesktopCompanyHtml(PARTIAL_SSR_HTML)).toBe(false);
  });

  it('parses company name, main products, certifications, address, since year, badges and encodeComId', () => {
    const p = parseDesktopCompanyHtml(DESKTOP_HTML, 'tuyaltd', 'browser', 'https://www.made-in-china.com/showroom/tuyaltd');
    expect(p.source).toBe('browser');
    expect(p.account).toBe('tuyaltd');
    expect(p.company_name).toContain('Shijiazhuang Tuya');
    expect(p.main_products).toContain('Nylon Filter Mesh');
    expect(p.business_types).toContain('Manufacturer/Factory');
    expect(p.system_certifications).toEqual(expect.arrayContaining(['ISO 9001', 'ISO 9000']));
    expect(p.address).toContain('Zhonghua Street');
    expect(p.member_since).toBe('2025');
    expect(p.member_level).toBe('diamond');
    expect(p.is_diamond_member).toBe(true);
    expect(p.sgs_member).toBe(true);
    expect(p.encode_com_id).toBe('XBLGshlEZVrS');
    // desktop page does not publish these → null (surfaced via availability)
    expect(p.employees).toBeNull();
    expect(p.establishment).toBeNull();
  });

  it('parseAnyCompanyHtml prefers mobile ssrData and falls back to title/body when content fields are empty', () => {
    const p = parseAnyCompanyHtml(PARTIAL_SSR_HTML, 'transoceanmetal', 'browser');
    expect(p.source).toBe('browser');
    expect(p.company_name).toBe('Transocean Metal Products(Tangshan) Co., Ltd.');
    expect(p.main_products).toEqual(['Wood Structure Connectors']);
    expect(p.business_types).toEqual(['Manufacturer/Factory']);
    expect(p.establishment).toBe('1995-01-26');
    expect(p.employees).toBe(11);
    expect(p.encode_com_id).toBe('KObTgXFuMPHe');
    expect(p.company_id).toBe('1936936774');
  });

  it('rejects unrecognized HTML with UPSTREAM_CHANGED', () => {
    try {
      parseAnyCompanyHtml('<html><body>Access Denied</body></html>', 'x', 'browser');
      throw new Error('expected error');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('UPSTREAM_CHANGED');
    }
  });
});
