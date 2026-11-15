import { describe, expect, it } from 'vitest';
import { mapSupplierItem } from '../../src/core/api/search.js';
import { companyListItemSchema } from '../../src/core/models.js';
import { glassFullFixture } from '../helpers/fixtures.js';

/**
 * FR-04/FR-06 — list row normalization from upstream `dataList` items.
 * Cases reference docs/06 TC-14/TC-16/TC-17/TC-19 and docs/05 §3.
 */

function fixtureItems(): Array<Record<string, unknown>> {
  return glassFullFixture().dataList as Array<Record<string, unknown>>;
}

describe('mapSupplierItem: required fields & normalization (TC-19/AC-14/AC-16/AC-18)', () => {
  it('maps a full fixture row to the contract model (schema-valid)', () => {
    const raw = fixtureItems().find((i) => i['mainUserAccount'] === 'gsglassmirror')!;
    const item = mapSupplierItem(raw as never);
    expect(companyListItemSchema.safeParse(item).success).toBe(true);

    expect(item.account).toBe('gsglassmirror');
    expect(item.company_id).toBe('1936521904');
    expect(item.company_name).toBe('Hangzhou Kongshing Smart Home Co., Ltd.');
    expect(item.province).toBe('Zhejiang');
    expect(item.city).toBe('Hangzhou');
    expect(item.main_products).toEqual(['Mirror Tempered Glass']);
    expect(item.business_types).toEqual(['Manufacturer/Factory']);
    expect(item.system_certifications).toEqual(['ISO 9001', 'ISO 50001']);
    expect(item.membership.tier).toBe('diamond');
    expect(item.membership.raw_cs_level).toBe(50);
    expect(item.membership.evidence).toContain('json:csLevel=50');
    expect(item.capability_stars).toBe(3);
    expect(item.audited).toBe(true);
    expect(item.company_url).toBe('https://m.made-in-china.com/company-gsglassmirror/');
    expect(item.company_info_url).toBe('https://m.made-in-china.com/company-gsglassmirror/info.html');
    expect(item.detail_source).toBe('json');
    expect(item.is_ad).toBe(true); // ad=true even though showAd=false: contract treats it as an AD row
  });

  it('splits mainProduct on commas and trims entries', () => {
    const raw = {
      ...fixtureItems()[0],
      mainUserAccount: 'split-test',
      mainProduct: 'Glass Cup, French Press ,Coffee Pot,,',
    };
    const item = mapSupplierItem(raw as never);
    expect(item.main_products).toEqual(['Glass Cup', 'French Press', 'Coffee Pot']);
  });

  it('normalizes empty strings to null and zero employees to null', () => {
    const raw = {
      ...fixtureItems()[0],
      mainUserAccount: 'null-test',
      comTurnOver: '',
      comPlantArea: '   ',
      comEmployee: 0,
      encodeComId: '',
      city: '',
    };
    const item = mapSupplierItem(raw as never);
    expect(item.turnover).toBeNull();
    expect(item.plant_area).toBeNull();
    expect(item.employees).toBeNull();
    expect(item.encode_com_id).toBeNull();
    expect(item.city).toBeNull();
  });

  it('parses string numbers for stars / csLevel / auditType', () => {
    const raw = {
      ...fixtureItems()[0],
      mainUserAccount: 'string-numbers',
      csLevel: '30',
      auditType: '1',
      companySymbol: { stars: '4' },
    };
    const item = mapSupplierItem(raw as never);
    expect(item.membership.tier).toBe('gold');
    expect(item.membership.raw_cs_level).toBe(30);
    expect(item.audited).toBe(true);
    expect(item.capability_stars).toBe(4);
  });

  it('maps missing membership signals to unknown (never guesses)', () => {
    const raw = { mainUserAccount: 'no-tier', name: 'No Tier Co', id: 123 };
    const item = mapSupplierItem(raw as never);
    expect(item.membership.tier).toBe('unknown');
    expect(item.membership.raw_cs_level).toBeNull();
    expect(item.membership.since_year).toBeNull();
    expect(item.membership.confidence).toBe('low');
    expect(item.audited).toBeNull();
    expect(item.capability_stars).toBeNull();
  });

  it('flags advertisement rows via showAd/ad/advertise/deliveryType', () => {
    const base = { mainUserAccount: 'ad-a', name: 'A', id: 1 };
    expect(mapSupplierItem({ ...base, showAd: true } as never).is_ad).toBe(true);
    expect(mapSupplierItem({ ...base, ad: 1 } as never).is_ad).toBe(true);
    expect(mapSupplierItem({ ...base, advertise: { id: 'x' } } as never).is_ad).toBe(true);
    expect(mapSupplierItem({ ...base, deliveryType: 'ads' } as never).is_ad).toBe(true);
    expect(mapSupplierItem({ ...base } as never).is_ad).toBe(false);
  });

  it('rejects rows without mainUserAccount as UPSTREAM_CHANGED', () => {
    expect(() => mapSupplierItem({ name: 'Broken', id: 1 } as never)).toThrowError(
      expect.objectContaining({ code: 'UPSTREAM_CHANGED' }),
    );
  });

  it('all 20 glass fixture rows map to schema-valid items', () => {
    const items = fixtureItems().map((raw) => mapSupplierItem(raw as never));
    expect(items).toHaveLength(20);
    for (const item of items) expect(companyListItemSchema.safeParse(item).success).toBe(true);
    const tiers = items.map((i) => i.membership.tier);
    expect(tiers.filter((t) => t === 'diamond').length).toBe(19);
    expect(tiers.filter((t) => t === 'gold').length).toBe(1);
    expect(items.filter((i) => i.audited === true).length).toBe(18);
    expect(items.filter((i) => i.audited === false).length).toBe(2);
  });
});
