import { REGIONS_SEED, type CitySeed, type ProvinceSeed } from './data.js';
import { AppError } from '../errors.js';

export interface ProvinceMatch {
  name: string;
  name_zh: string;
  api_value: string;
  com_province: string;
  seo_cp: string;
  cities_complete: boolean;
  cities: CitySeed[];
}

export interface CityMatch {
  name: string;
  name_zh: string;
  seo_cc: string | null;
  province: ProvinceMatch;
}

const provinces: ProvinceSeed[] = REGIONS_SEED.provinces;

function lower(s: string): string {
  return s.trim().toLowerCase();
}

/** Normalize a province input (English/Chinese/alias) into a province match. */
export function matchProvince(input: string): ProvinceMatch | null {
  const v = lower(input);
  for (const p of provinces) {
    if (lower(p.name) === v || lower(p.name_zh) === v || lower(p.api_value) === v) return p;
    if (p.aliases.some((a) => lower(a) === v)) return p;
  }
  return null;
}

/** Resolve a province or throw INVALID_PARAM with allowed values. */
export function resolveProvince(input: string): ProvinceMatch {
  const m = matchProvince(input);
  if (m) return m;
  throw new AppError('INVALID_PARAM', `unknown province: ${input}`, {
    param: 'province',
    reason: 'UNKNOWN_PROVINCE',
    allowed_provinces: provinces.map((p) => p.name),
  });
}

/** Match a city by English/Chinese name when the province dictionary contains it. */
export function matchCity(input: string, province?: ProvinceMatch): CityMatch | null {
  const v = lower(input);
  const candidates: ProvinceMatch[] = province ? [province] : provinces;
  for (const p of candidates) {
    for (const c of p.cities) {
      if (lower(c.name) === v || lower(c.name_zh) === v) {
        return { name: c.name, name_zh: c.name_zh, seo_cc: c.seo_cc, province: p };
      }
    }
  }
  return null;
}

export function provinceCitiesComplete(province: ProvinceMatch): boolean {
  return province.cities_complete;
}

export function allProvinces(): ProvinceMatch[] {
  return provinces;
}

export function findProvinceByCityName(input: string): ProvinceMatch | null {
  const m = matchCity(input);
  return m ? m.province : null;
}

export function isCjk(text: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text);
}
