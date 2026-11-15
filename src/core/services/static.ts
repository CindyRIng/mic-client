import { AppError } from '../errors.js';
import { UPSTREAM_CONTRACT_VERSION } from '../../version.js';
import type { MembershipLevels, Province, RegionsResult } from '../models.js';
import { allProvinces, matchProvince } from '../regions/dict.js';

export function listRegions(provinceInput?: string): RegionsResult {
  let provinces = allProvinces();
  if (provinceInput) {
    const p = matchProvince(provinceInput);
    if (!p) {
      throw new AppError('INVALID_PARAM', `unknown province: ${provinceInput}`, {
        param: 'province',
        reason: 'UNKNOWN_PROVINCE',
        allowed_provinces: provinces.map((x) => x.name),
      });
    }
    provinces = [p];
  }
  const out: Province[] = provinces.map((p) => ({
    name: p.name,
    name_zh: p.name_zh,
    api_value: p.api_value,
    cities_complete: p.cities_complete,
    cities: p.cities.map((c) => ({ name: c.name, name_zh: c.name_zh, seo_cc: c.seo_cc })),
  }));
  return { provinces: out };
}

export function membershipLevels(): MembershipLevels {
  return {
    levels: [
      {
        tier: 'diamond',
        label: 'Diamond Member',
        description: '钻石会员：公开可见的最高会员等级（年费 59,800 元）；列表 csLevel=50，详情 memberLevel=diamond。',
        price_cny_per_year: 59800,
        visible_on_page: true,
      },
      {
        tier: 'gold',
        label: 'Gold Member',
        description: '金牌会员：入门付费等级（年费 31,100 元）；列表 csLevel=30，详情 memberLevel=gold。',
        price_cny_per_year: 31100,
        visible_on_page: true,
      },
      {
        tier: 'free',
        label: 'Free Member',
        description: '免费会员：页面无等级徽章；仅详情可确认无徽章时判为 free，列表侧一律 unknown。',
        price_cny_per_year: 0,
        visible_on_page: false,
      },
      {
        tier: 'unknown',
        label: 'Unknown',
        description: '无法判定：上游字段缺失/冲突，客户端不猜测。',
        price_cny_per_year: null,
        visible_on_page: false,
      },
    ],
    notes: [
      'Audited Supplier（AS）是与会员等级正交的第三方认证，独立字段 audited，不属于 tier。',
      'KA / SKA / GSKA 是阿里巴巴国际站客户分层，不是 Made-in-China 术语；MIC 页面/API 无此标识。',
      'MIC 的“优享/尊享/MKA”大客户分层未纳入正式会员级别，公网无独立徽章，客户端不抓取。',
      '会员起始年 since_year 来自详情 memberSince，不是公司成立年 established_at。',
    ],
  };
}

// ---------------------------------------------------------------------------
// Region data builders (docs/03 §5 / §11.13) — shared by CLI / REST / MCP
// ---------------------------------------------------------------------------

export interface RegionProvinceData {
  name: string;
  name_zh: string;
  api_value: string;
  city_count: number | null;
  cities_complete: boolean;
  source: 'refine' | 'seo_facet' | 'static';
  verified_at: string;
}

export interface RegionCityData {
  name: string;
  name_zh: string;
  province: string;
  source: 'refine' | 'seo_facet' | 'static';
  verified: boolean;
  count_hint: number | null;
}

export interface ProvincesData {
  count: number;
  provinces: RegionProvinceData[];
}

export interface ProvinceDetailData {
  province: RegionProvinceData;
  cities: RegionCityData[];
}

function provinceToData(p: Province): RegionProvinceData {
  return {
    name: p.name,
    name_zh: p.name_zh,
    api_value: p.api_value,
    city_count: p.cities_complete && p.cities ? p.cities.length : null,
    cities_complete: p.cities_complete,
    source: p.cities_complete ? 'seo_facet' : 'refine',
    verified_at: `${UPSTREAM_CONTRACT_VERSION}T00:00:00+08:00`,
  };
}

/** CLI/REST/MCP 共用的 regions data：无 province → {count, provinces[]}；有 → {province, cities[]}。 */
export function buildRegionsData(provinceInput?: string): ProvincesData | ProvinceDetailData {
  const result: RegionsResult = listRegions(provinceInput);
  if (provinceInput) {
    const province = result.provinces[0];
    if (!province) {
      throw new AppError('INVALID_PARAM', `unknown province: ${provinceInput}`, {
        param: 'province',
        reason: 'UNKNOWN_PROVINCE',
      });
    }
    return {
      province: provinceToData(province),
      cities: (province.cities ?? [])
        .filter((c): c is NonNullable<typeof c> => Boolean(c))
        .map((c) => ({
          name: c.name,
          name_zh: c.name_zh,
          province: province.name,
          source: 'seo_facet' as const,
          verified: province.cities_complete,
          count_hint: null,
        })),
    };
  }
  return { count: result.provinces.length, provinces: result.provinces.map(provinceToData) };
}
