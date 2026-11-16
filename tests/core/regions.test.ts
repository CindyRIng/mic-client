import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/core/errors.js';
import { listRegions, membershipLevels } from '../../src/core/services/static.js';
import { allProvinces, matchCity, matchProvince, resolveProvince } from '../../src/core/regions/dict.js';

/**
 * FR-07 — region dictionary (32 provinces = 31 m-site refine + Qinghai from SEO facet).
 * FR-06 — membership levels explanation endpoint data (docs/03 §6).
 * Cases reference docs/06 TC-06/TC-08/TC-33 and docs/05 §5.
 */

describe('region dictionary (TC-06 / AC-31..AC-33)', () => {
  it('exposes 32 provinces including Qinghai and the complete Hebei city list', () => {
    const { provinces } = listRegions();
    expect(provinces).toHaveLength(32);
    const names = provinces.map((p) => p.name);
    expect(names).toContain('Qinghai');
    expect(names).toContain('Hebei');
    expect(new Set(names).size).toBe(32);

    const hebei = provinces.find((p) => p.name === 'Hebei')!;
    expect(hebei.name_zh).toBe('河北');
    expect(hebei.api_value).toBe('Hebei');
    expect(hebei.cities_complete).toBe(true);
    expect(hebei.cities!.map((c) => c!.name)).toEqual([
      'Shijiazhuang',
      'Hengshui',
      'Cangzhou',
      'Xingtai',
      'Baoding',
      'Langfang',
      'Handan',
      'Tangshan',
      'Qinhuangdao',
      'Zhangjiakou',
      'Chengde',
    ]);
    expect(hebei.cities!.find((c) => c!.name === 'Langfang')!.name_zh).toBe('廊坊');
  });

  it('filters to one province by English or Chinese name', () => {
    expect(listRegions('Hebei').provinces.map((p) => p.name)).toEqual(['Hebei']);
    expect(listRegions('河北').provinces.map((p) => p.name)).toEqual(['Hebei']);
    expect(listRegions('hebei').provinces.map((p) => p.name)).toEqual(['Hebei']);
  });

  it('returns an INVALID_PARAM error with allowed provinces for unknown input', () => {
    try {
      listRegions('Atlantis');
      throw new Error('expected error');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      const err = e as AppError;
      expect(err.code).toBe('INVALID_PARAM');
      expect(err.details?.['reason']).toBe('UNKNOWN_PROVINCE');
      expect((err.details?.['allowed_provinces'] as string[]).length).toBe(32);
    }
  });

  it('all 32 api_value entries are unique (upstream province param safety)', () => {
    const values = allProvinces().map((p) => p.api_value);
    expect(new Set(values).size).toBe(32);
  });

  it('matches province aliases and city names (case-insensitive)', () => {
    expect(matchProvince('Hong Kong')?.name).toBe('Hongkong S.A.R.');
    expect(matchProvince('InnerMongolia')?.name).toBe('Inner Mongolia');
    expect(matchCity('廊坊')?.name).toBe('Langfang');
    expect(matchCity('langfang')?.name).toBe('Langfang');
    expect(matchCity('廊坊', matchProvince('Shandong') ?? undefined)).toBeNull();
    expect(resolveProvince('Hebei').name).toBe('Hebei');
  });
});

describe('membership levels explanation (TC-33 / AC-29)', () => {
  it('lists the 4 contract tiers in order with prices and AS orthogonality notes', () => {
    const data = membershipLevels();
    expect(data.levels.map((l) => l.tier)).toEqual(['diamond', 'gold', 'free', 'unknown']);
    expect(data.levels.find((l) => l.tier === 'diamond')!.price_cny_per_year).toBe(59800);
    expect(data.levels.find((l) => l.tier === 'gold')!.price_cny_per_year).toBe(31100);
    expect(data.levels.find((l) => l.tier === 'free')!.visible_on_page).toBe(false);

    const notes = data.notes.join('\n');
    expect(notes).toMatch(/Audited Supplier/i);
    expect(notes).toMatch(/KA \/ SKA/);
    expect(notes).not.toMatch(/tier\s*[:=]\s*ka/i);
  });
});
