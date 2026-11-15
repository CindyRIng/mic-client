import crypto from 'node:crypto';
import { AppError, type Meta, type Warning, type WarningCode } from '../errors.js';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import type {
  CompanyListItem,
  Pagination,
  SearchQuery,
  SearchResult,
} from '../models.js';
import type { Cache } from '../cache/cache.js';
import type { SupplierSearchApi, UpstreamSearchPage } from '../api/search.js';
import { SupplierSearchParams } from '../api/search.js';
import {
  allProvinces,
  matchCity,
  matchProvince,
  type CityMatch,
  type ProvinceMatch,
} from '../regions/dict.js';
import { assertSupportedTierFilter } from '../membership/tiers.js';

export interface SearchInput {
  keyword?: string;
  province?: string;
  city?: string;
  category_code?: string;
  membership_tier?: string;
  audited?: boolean | string;
  management_certification?: string;
  business_type?: string;
  annual_revenue?: string;
  rd_capacity?: string;
  page?: number | string;
  page_size?: number | string;
  refresh?: boolean | string;
  include_ads?: boolean | string;
  request_id?: string;
}

const BUSINESS_TYPE_MAP: Record<string, string> = {
  manufacturer: '1',
  factory: '1',
  trading_company: '2',
  trading: '2',
  group_corporation: '4',
  group: '4',
  other: '8',
};

const ANNUAL_REVENUE_MAP: Record<string, string> = {
  under_1m_usd: '1',
  '1m_2_5m_usd': '2',
  '2_5m_5m_usd': '3',
  '5m_10m_usd': '4',
  '10m_50m_usd': '5',
  '50m_100m_usd': '6',
  over_100m_usd: '7',
};

const RD_CAPACITY_MAP: Record<string, string> = {
  oem: '4',
  odm: '5',
  quick_response: '01',
  fast_delivery: '02',
  small_amount_payment: '03',
};

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function bool(v: unknown, dflt: boolean): boolean {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  throw new AppError('INVALID_PARAM', `invalid boolean: ${String(v)}`, { reason: 'INVALID_ENUM' });
}

function intIn(v: unknown, dflt: number, min: number, max: number, param: string): number {
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new AppError('INVALID_PARAM', `${param} out of range`, { param, reason: 'OUT_OF_RANGE', min, max });
  }
  return n;
}

/** ISO8601 with +08:00 offset (contract requires Asia/Shanghai formatting). */
export function formatIsoCst(epochSeconds: number | null): string | null {
  if (epochSeconds === null) return null;
  const d = new Date(epochSeconds * 1000 + 8 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+08:00`
  );
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function stable(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
}

function totalDisplay(total: number, capped: boolean): string {
  return capped ? '2,000+' : total.toLocaleString('en-US');
}

interface NormalizedSearch {
  query: SearchQuery;
  upstream: Omit<SupplierSearchParams, 'page'>;
  localCity: CityMatch | null;
  auditedFilter: boolean;
  includeAds: boolean;
  warnings: Warning[];
}

export class SearchService {
  constructor(
    private readonly cfg: Config,
    private readonly logger: Logger,
    private readonly cache: Cache,
    private readonly api: SupplierSearchApi,
  ) {}

  normalize(input: SearchInput): NormalizedSearch {
    const warnings: Warning[] = [];
    let keyword = str(input.keyword);
    let provinceInput = str(input.province);
    let cityInput = str(input.city);

    // CJK keyword: try to interpret as a region name
    if (keyword && CJK.test(keyword)) {
      const asProvince = matchProvince(keyword);
      const asCity = asProvince ? null : matchCity(keyword);
      if (asProvince && !provinceInput && !cityInput) {
        provinceInput = asProvince.name;
        keyword = undefined;
      } else if (asCity && !provinceInput && !cityInput) {
        cityInput = asCity.name;
        keyword = undefined;
      } else {
        throw new AppError('INVALID_PARAM', 'Chinese keyword is not supported by the English site', {
          param: 'keyword',
          reason: 'NON_ENGLISH_KEYWORD',
          hint: 'use an English keyword, or pass province/city to search by region',
        });
      }
    }

    let province: ProvinceMatch | null = null;
    if (provinceInput) province = matchProvince(provinceInput);
    if (provinceInput && !province) {
      throw new AppError('INVALID_PARAM', `unknown province: ${provinceInput}`, {
        param: 'province',
        reason: 'UNKNOWN_PROVINCE',
        allowed_provinces: allProvinces().map((p) => p.name),
      });
    }

    let city: CityMatch | null = null;
    if (cityInput) {
      let m = matchCity(cityInput, province ?? undefined);
      if (!m) {
        // province-scoped lookup failed: try global lookup to detect province/city mismatch
        const global = matchCity(cityInput);
        if (global && province) {
          warnings.push({
            code: 'CITY_PROVINCE_MISMATCH',
            message: 'city does not belong to the given province; province inferred from city',
            details: { city: global.name, given_province: province.name, inferred_province: global.province.name },
          });
          m = global;
          province = global.province;
        }
      }
      if (m) {
        city = m;
        if (province && m.province.name !== province.name) {
          warnings.push({
            code: 'CITY_PROVINCE_MISMATCH',
            message: 'city does not belong to the given province; province inferred from city',
            details: { city: m.name, given_province: province.name, inferred_province: m.province.name },
          });
          province = m.province;
        } else {
          province = province ?? m.province;
        }
      } else if (province) {
        if (!province.cities_complete) {
          warnings.push({
            code: 'CITY_NOT_IN_DICTIONARY',
            message: 'city not in dictionary; passing through with exact matching',
            details: { city: cityInput, province: province.name },
          });
          city = {
            name: cityInput,
            name_zh: cityInput,
            seo_cc: null,
            province,
          };
        } else {
          throw new AppError('INVALID_PARAM', `unknown city: ${cityInput}`, {
            param: 'city',
            reason: 'UNKNOWN_CITY',
            allowed_cities: province.cities.map((c) => c.name),
          });
        }
      } else {
        throw new AppError('INVALID_PARAM', 'cannot infer province for unknown city', {
          param: 'city',
          reason: 'UNKNOWN_CITY',
          hint: 'pass an English province together with the city',
        });
      }
    }

    if (!keyword && !province && !city) {
      throw new AppError('INVALID_PARAM', 'either keyword or province/city is required', {
        reason: 'MISSING_REQUIRED_COMBO',
        params: ['keyword', 'province', 'city'],
      });
    }

    const page = intIn(input.page, 1, 1, 100, 'page');
    const pageSize = intIn(input.page_size, this.cfg.search.default_page_size, 1, 100, 'page_size');
    const refresh = bool(input.refresh, false);
    const includeAds = bool(input.include_ads, true);
    const auditedFilter = bool(input.audited, false);

    const filters: Record<string, string | number | boolean> = {};
    let memberLevel: string | undefined;
    if (input.membership_tier) {
      const tier = assertSupportedTierFilter(String(input.membership_tier));
      memberLevel = tier === 'diamond' ? '50' : '30';
      filters.membership_tier = tier;
    }
    let comBusinessType: string | undefined;
    if (input.business_type) {
      const code = BUSINESS_TYPE_MAP[String(input.business_type)];
      if (!code) {
        throw new AppError('INVALID_PARAM', `invalid business_type: ${input.business_type}`, {
          param: 'business_type',
          reason: 'INVALID_ENUM',
        });
      }
      comBusinessType = code;
      filters.business_type = String(input.business_type);
    }
    let annualRevenue: string | undefined;
    if (input.annual_revenue) {
      const code = ANNUAL_REVENUE_MAP[String(input.annual_revenue)];
      if (!code) {
        throw new AppError('INVALID_PARAM', `invalid annual_revenue: ${input.annual_revenue}`, {
          param: 'annual_revenue',
          reason: 'INVALID_ENUM',
        });
      }
      annualRevenue = code;
      filters.annual_revenue = String(input.annual_revenue);
    }
    let rdCapacity: string | undefined;
    if (input.rd_capacity) {
      const code = RD_CAPACITY_MAP[String(input.rd_capacity)];
      if (!code) {
        throw new AppError('INVALID_PARAM', `invalid rd_capacity: ${input.rd_capacity}`, {
          param: 'rd_capacity',
          reason: 'INVALID_ENUM',
        });
      }
      rdCapacity = code;
      filters.rd_capacity = String(input.rd_capacity);
    }
    const categoryCode = str(input.category_code);
    if (categoryCode) filters.category_code = categoryCode;
    const managementCertification = str(input.management_certification);
    if (managementCertification) filters.management_certification = managementCertification;

    const searchMode: SearchQuery['search_mode'] = keyword ? (province || city ? 'mixed' : 'keyword') : 'region';
    const keywordEffective = keyword ?? (city?.name ?? province?.name ?? '').toLowerCase();
    if (!keywordEffective) {
      throw new AppError('INVALID_PARAM', 'empty effective keyword', { reason: 'MISSING_REQUIRED_COMBO' });
    }

    const query: SearchQuery = {
      keyword: keyword ?? null,
      keyword_effective: keywordEffective,
      province: province?.name ?? null,
      province_zh: province?.name_zh ?? null,
      city: city?.name ?? null,
      city_zh: city?.name_zh ?? null,
      search_mode: searchMode,
      region_validated: searchMode !== 'keyword',
      filters,
      page,
      page_size: pageSize,
      refresh,
      include_ads: includeAds,
    };

    const upstream: Omit<SupplierSearchParams, 'page'> = {
      word: keywordEffective,
      province: province?.api_value,
      catCode: categoryCode,
      memberLevel,
      managementCertification,
      comBusinessType,
      annualRevenue,
      rdCapacity,
    };
    return { query, upstream, localCity: city, auditedFilter, includeAds, warnings };
  }

  async search(input: SearchInput): Promise<SearchResponse> {
    const norm = this.normalize(input);
    const { query, upstream, localCity, auditedFilter, includeAds } = norm;
    const warnings: Warning[] = [...norm.warnings];
    const requestId = input.request_id ?? 'req_' + Date.now().toString(36);
    const localFilter = Boolean(localCity || auditedFilter);

    const pageInfo = localFilter
      ? await this.scanWithLocalFilter(upstream, query, { city: localCity, audited: auditedFilter }, requestId, warnings)
      : await this.fetchWindow(upstream, query, requestId, warnings);

    let items = pageInfo.items;
    if (!includeAds) {
      const before = items.length;
      items = items.filter((i) => !i.is_ad);
      const removed = before - items.length;
      if (removed > 0) {
        warnings.push({
          code: 'ADS_FILTERED',
          message: 'advertisement items filtered out',
          details: { count: removed },
        });
      }
    }

    const pagination: Pagination = {
      page: query.page,
      page_size: query.page_size,
      total: pageInfo.total,
      total_page: pageInfo.totalPage,
      has_more: pageInfo.hasMore,
      total_capped: pageInfo.totalCapped,
      total_display: totalDisplay(pageInfo.total, pageInfo.totalCapped),
      page_clamped: pageInfo.pageClamped,
      total_is_lower_bound: pageInfo.totalIsLowerBound,
    };

    const meta: Meta = {
      request_id: requestId,
      cached: pageInfo.cached,
      stale: pageInfo.stale,
      fetched_at: formatIsoCst(pageInfo.fetchedAt || null),
      source: pageInfo.source,
      warnings,
    };

    return { data: { query, pagination, items }, meta };
  }

  private async fetchPage(
    upstream: Omit<SupplierSearchParams, 'page'>,
    page: number,
    refresh: boolean,
    requestId: string,
    warnings: Warning[],
  ): Promise<{
    page: UpstreamSearchPage;
    cached: boolean;
    stale: boolean;
    fetchedAt: number;
    source: 'json' | 'cache';
  }> {
    const params = stable({ ...upstream, page });
    const hashParams = stable({ ...upstream, word: upstream.word.toLowerCase(), page });
    const paramsHash = sha256(JSON.stringify(hashParams));
    const cacheKey = 'search:' + paramsHash;
    if (this.cfg.cache.enabled && !refresh) {
      const hit = this.cache.getSearchPage(cacheKey);
      if (hit) {
        const payload = JSON.parse(hit.payload_json) as CompanyListItem[];
        const pageData: UpstreamSearchPage = {
          total: hit.total,
          totalNum: hit.total_num_raw ?? String(hit.total),
          totalCapped: Boolean(hit.total_capped),
          page: hit.page,
          pageSize: 20,
          totalPage: hit.total_page,
          items: payload,
          raw: [],
        };
        if (!hit.stale) {
          return { page: pageData, cached: true, stale: false, fetchedAt: hit.fetched_at, source: 'cache' };
        }
        // stale: try upstream; on failure fall back below
        try {
          const fresh = await this.api.search({ ...upstream, page });
          this.writePage(cacheKey, paramsHash, params, upstream, page, fresh, requestId);
          return { page: fresh, cached: false, stale: false, fetchedAt: Math.floor(Date.now() / 1000), source: 'json' };
        } catch (e) {
          if (this.cfg.cache.allow_stale) {
            warnings.push({
              code: 'STALE_DATA',
              message: 'upstream failed, served stale cache',
              details: { original_fetched_at: hit.fetched_at, reason: String((e as Error).message ?? e) },
            });
            this.cache.markStale(cacheKey);
            return { page: pageData, cached: true, stale: true, fetchedAt: hit.fetched_at, source: 'cache' };
          }
          throw e;
        }
      }
    }
    const fresh = await this.api.search({ ...upstream, page });
    this.writePage(cacheKey, paramsHash, params, upstream, page, fresh, requestId);
    return { page: fresh, cached: false, stale: false, fetchedAt: Math.floor(Date.now() / 1000), source: 'json' };
  }

  private writePage(
    cacheKey: string,
    paramsHash: string,
    params: Record<string, unknown>,
    upstream: Omit<SupplierSearchParams, 'page'>,
    page: number,
    fresh: UpstreamSearchPage,
    requestId: string,
  ): void {
    this.cache.putSearchPage({
      cacheKey,
      paramsHash,
      upstreamParams: params,
      word: upstream.word,
      province: upstream.province ?? null,
      filters: {
        catCode: upstream.catCode,
        memberLevel: upstream.memberLevel,
        managementCertification: upstream.managementCertification,
        comBusinessType: upstream.comBusinessType,
        annualRevenue: upstream.annualRevenue,
        rdCapacity: upstream.rdCapacity,
      },
      page,
      total: fresh.total,
      totalNumRaw: fresh.totalNum,
      totalCapped: fresh.totalCapped,
      totalPage: fresh.totalPage,
      items: fresh.items,
      source: 'json',
      warnings: [],
      requestId,
      upstreamUrl: 'https://m.made-in-china.com/search/supplier',
      httpStatus: 200,
    });
    this.cache.upsertCompanies(fresh.items, fresh.raw);
  }

  private async fetchWindow(
    upstream: Omit<SupplierSearchParams, 'page'>,
    query: SearchQuery,
    requestId: string,
    warnings: Warning[],
  ): Promise<{
    items: CompanyListItem[];
    total: number;
    totalPage: number;
    hasMore: boolean;
    totalCapped: boolean;
    pageClamped: boolean;
    totalIsLowerBound: boolean;
    cached: boolean;
    stale: boolean;
    fetchedAt: number;
    source: 'json' | 'cache';
  }> {
    const { page, page_size: pageSize, refresh } = query;
    const firstUpstream = Math.floor(((page - 1) * pageSize) / 20) + 1;
    const lastUpstream = Math.floor((page * pageSize - 1) / 20) + 1;
    if (pageSize !== 20) {
      warnings.push({
        code: 'PAGE_SIZE_NOT_NATIVE',
        message: 'page_size is not the native upstream page size (20); pages are stitched/sliced',
        details: { upstream_page_size: 20 },
      });
    }
    const pages: UpstreamSearchPage[] = [];
    let cached = true;
    let stale = false;
    let fetchedAt = 0;
    let source: 'json' | 'cache' = 'cache';
    for (let p = firstUpstream; p <= lastUpstream; p++) {
      const r = await this.fetchPage(upstream, p, refresh, requestId, warnings);
      pages.push(r.page);
      cached = cached && r.cached;
      stale = stale || r.stale;
      fetchedAt = Math.max(fetchedAt, r.fetchedAt);
      if (!r.cached) source = 'json';
      if (r.page.totalPage < p) break;
    }
    const total = pages[0]?.total ?? 0;
    const totalCapped = pages[0]?.totalCapped ?? false;
    const totalPage = Math.max(1, Math.ceil(total / pageSize));
    const pageClamped = page > totalPage;
    const effectivePage = pageClamped ? totalPage : page;
    const all = dedupe(pages.flatMap((p) => p.items), warnings);
    // items fetched start at upstream window offset (firstUpstream-1)*20, not at page 1
    const pageStart = (effectivePage - 1) * pageSize;
    const windowBase = (firstUpstream - 1) * 20;
    const start = Math.max(0, pageStart - windowBase);
    const items = all.slice(start, start + pageSize);
    if (total < all.length) {
      // upstream total lower than fetched items (ads/dup) — keep both truthful
    }
    if (pageClamped) {
      warnings.push({
        code: 'PAGE_CLAMPED',
        message: 'requested page exceeds total_page; clamped to last page',
        details: { requested_page: page, effective_page: effectivePage },
      });
    }
    if (totalCapped) {
      warnings.push({
        code: 'TOTAL_CAPPED',
        message: 'upstream total is capped at 2,000+',
        details: { total_display: '2,000+' },
      });
    }
    return {
      items,
      total,
      totalPage,
      hasMore: effectivePage < totalPage,
      totalCapped,
      pageClamped,
      totalIsLowerBound: false,
      cached,
      stale,
      fetchedAt,
      source: cached ? 'cache' : source,
    };
  }

  private async scanWithLocalFilter(
    upstream: Omit<SupplierSearchParams, 'page'>,
    query: SearchQuery,
    filter: { city: CityMatch | null; audited: boolean },
    requestId: string,
    warnings: Warning[],
  ): Promise<{
    items: CompanyListItem[];
    total: number;
    totalPage: number;
    hasMore: boolean;
    totalCapped: boolean;
    pageClamped: boolean;
    totalIsLowerBound: boolean;
    cached: boolean;
    stale: boolean;
    fetchedAt: number;
    source: 'json' | 'cache';
  }> {
    const { page, page_size: pageSize, refresh } = query;
    const budget = Math.max(1, this.cfg.search.scan_max_pages);
    const matched: CompanyListItem[] = [];
    const seen = new Set<string>();
    let scanned = 0;
    let stopReason: 'end' | 'page_satisfied' | 'budget_exhausted' = 'budget_exhausted';
    let upstreamTotal = 0;
    let upstreamTotalPage = 0;
    let totalCapped = false;
    let reachedEnd = false;
    let cached = true;
    let stale = false;
    let fetchedAt = 0;
    let source: 'json' | 'cache' = 'cache';
    const need = page * pageSize;

    const matches = (item: CompanyListItem): boolean => {
      if (filter.city) {
        const want = filter.city.name.toLowerCase();
        if (!item.city || item.city.toLowerCase() !== want) return false;
      }
      if (filter.audited && item.audited !== true) return false;
      return true;
    };

    for (let p = 1; p <= budget; p++) {
      const r = await this.fetchPage(upstream, p, refresh, requestId, warnings);
      scanned = p;
      cached = cached && r.cached;
      stale = stale || r.stale;
      fetchedAt = Math.max(fetchedAt, r.fetchedAt);
      if (!r.cached) source = 'json';
      upstreamTotal = r.page.total;
      upstreamTotalPage = r.page.totalPage;
      totalCapped = r.page.totalCapped;
      for (const item of r.page.items) {
        if (seen.has(item.account)) continue;
        seen.add(item.account);
        if (matches(item)) matched.push(item);
      }
      if (p >= upstreamTotalPage) {
        reachedEnd = true;
        stopReason = 'end';
        break;
      }
      if (matched.length >= need) {
        stopReason = 'page_satisfied';
        break;
      }
    }
    if (!reachedEnd && stopReason !== 'page_satisfied') stopReason = 'budget_exhausted';

    if (filter.city) {
      warnings.push({
        code: 'CITY_FILTERED_LOCALLY',
        message: 'city filter applied client-side',
        details: { city: filter.city.name, scanned_pages: scanned, matched: matched.length, scan_budget: budget },
      });
    }
    if (filter.audited) {
      warnings.push({
        code: 'CLIENT_SIDE_FILTER',
        message: 'audited filter applied client-side',
        details: { filters: ['audited'], scanned_pages: scanned, matched: matched.length },
      });
    }
    if (matched.length === 0 && filter.city) {
      warnings.push({
        code: 'CITY_FILTER_EMPTY',
        message: 'city filter produced zero results',
        details: { city: filter.city.name, province_total: upstreamTotal },
      });
    }
    const lowerBound = !reachedEnd;
    if (lowerBound) {
      warnings.push({
        code: 'NON_EXHAUSTIVE',
        message:
          stopReason === 'page_satisfied'
            ? 'local filter stopped after page was satisfied; total is a lower bound'
            : 'local filter scan budget exhausted before upstream end; total is a lower bound',
        details: { reason: stopReason, scanned_pages: scanned, scan_budget: budget },
      });
      if (filter.city && stopReason === 'budget_exhausted') {
        warnings.push({
          code: 'CITY_FILTER_TRUNCATED',
          message: 'city filter results truncated by scan budget',
          details: { city: filter.city.name, scan_budget: budget },
        });
      }
    }
    if (totalCapped) {
      warnings.push({
        code: 'TOTAL_CAPPED',
        message: 'upstream total is capped at 2,000+',
        details: { total_display: '2,000+' },
      });
    }
    const total = matched.length;
    const totalPage = Math.max(1, Math.ceil(total / pageSize));
    const pageClamped = page > totalPage && !lowerBound;
    const effectivePage = pageClamped ? totalPage : page;
    const items = matched.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);
    if (pageClamped) {
      warnings.push({
        code: 'PAGE_CLAMPED',
        message: 'requested page exceeds total_page; clamped to last page',
        details: { requested_page: page, effective_page: effectivePage },
      });
    }
    return {
      items,
      total,
      totalPage,
      hasMore: lowerBound || effectivePage < totalPage,
      totalCapped,
      pageClamped,
      totalIsLowerBound: lowerBound,
      cached,
      stale,
      fetchedAt,
      source: cached ? 'cache' : source,
    };
  }
}

function dedupe(items: CompanyListItem[], warnings: Warning[]): CompanyListItem[] {
  const seen = new Set<string>();
  const out: CompanyListItem[] = [];
  for (const i of items) {
    if (seen.has(i.account)) continue;
    seen.add(i.account);
    out.push(i);
  }
  if (out.length !== items.length) {
    warnings.push({ code: 'DUPLICATES_REMOVED', message: 'duplicate items removed', details: { count: items.length - out.length } });
  }
  return out;
}

export interface SearchResponse {
  data: SearchResult;
  meta: Meta;
}

export type { Warning, WarningCode };
