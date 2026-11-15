import { z } from 'zod';
import { AppError } from '../errors.js';
import type { HttpClient } from '../http/client.js';
import type { Logger } from '../logger.js';
import type { CompanyListItem } from '../models.js';
import { auditedFromList, listMembership, parseStars } from '../membership/tiers.js';

export const SEARCH_URL = 'https://m.made-in-china.com/search/supplier';
export const REFINE_URL = 'https://m.made-in-china.com/search/supplier/refine';

export interface SupplierSearchParams {
  word: string;
  page: number;
  province?: string;
  catCode?: string;
  memberLevel?: string;
  managementCertification?: string;
  comBusinessType?: string;
  annualRevenue?: string;
  rdCapacity?: string;
}

const rawItemSchema = z
  .object({
    id: z.union([z.number(), z.string()]).nullable().optional(),
    name: z.string().optional(),
    mainUserAccount: z.string().optional(),
    memberType: z.union([z.number(), z.string()]).nullable().optional(),
    auditType: z.union([z.number(), z.string()]).nullable().optional(),
    showAuditLogo: z.boolean().nullable().optional(),
    logoText: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    province: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    mainProduct: z.string().nullable().optional(),
    businessTypeList: z.array(z.string()).nullable().optional(),
    systemCertificationList: z.array(z.string()).nullable().optional(),
    comTurnOver: z.string().nullable().optional(),
    comPlantArea: z.string().nullable().optional(),
    comEmployee: z.union([z.number(), z.string()]).nullable().optional(),
    encodeComId: z.string().nullable().optional(),
    csLevel: z.union([z.number(), z.string()]).nullable().optional(),
    companySymbol: z.object({ stars: z.union([z.number(), z.string()]).nullable().optional() }).nullable().optional(),
    showAd: z.union([z.boolean(), z.number()]).nullable().optional(),
    ad: z.union([z.boolean(), z.number()]).nullable().optional(),
    advertise: z.unknown().optional(),
    deliveryType: z.string().nullable().optional(),
  })
  .passthrough();

export interface RawSupplierItem {
  [key: string]: unknown;
  mainUserAccount?: string;
  name?: string;
}

const searchResponseSchema = z.object({
  total: z.union([z.number(), z.string()]).optional(),
  totalNum: z.union([z.number(), z.string()]).optional(),
  page: z.union([z.number(), z.string()]).optional(),
  pageSize: z.union([z.number(), z.string()]).optional(),
  totalPage: z.union([z.number(), z.string()]).optional(),
  dataList: z.array(rawItemSchema).optional(),
});

export interface UpstreamSearchPage {
  total: number;
  totalNum: string;
  totalCapped: boolean;
  page: number;
  pageSize: number;
  totalPage: number;
  items: CompanyListItem[];
  raw: RawSupplierItem[];
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function splitList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = strOrNull(v);
  if (!s) return [];
  return s
    .split(/[,，]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseTotal(raw: z.infer<typeof searchResponseSchema>): { total: number; totalNum: string; capped: boolean } {
  const totalNumRaw = raw.totalNum;
  if (typeof totalNumRaw === 'string' && /[+,]/.test(totalNumRaw) && /2,?000\+|2000\+/.test(totalNumRaw)) {
    return { total: 2000, totalNum: totalNumRaw, capped: true };
  }
  const t = num(raw.total ?? totalNumRaw);
  if (t > 2000) return { total: 2000, totalNum: String(t), capped: true };
  return { total: t, totalNum: String(t), capped: false };
}

function isAd(item: z.infer<typeof rawItemSchema>): boolean {
  const truthy = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
  return truthy(item.showAd) || truthy(item.ad) || Boolean(item.advertise) || item.deliveryType === 'ads';
}

export function mapSupplierItem(raw: RawSupplierItem): CompanyListItem {
  const it = raw as z.infer<typeof rawItemSchema>;
  const account = String(it.mainUserAccount ?? '').trim();
  if (!account) {
    throw new AppError('UPSTREAM_CHANGED', 'supplier item without mainUserAccount', {
      sample_keys: Object.keys(raw).slice(0, 20),
    });
  }
  const companyId = String(it.id ?? '').trim();
  const membership = listMembership({ csLevel: it.csLevel, memberType: it.memberType });
  const audited = auditedFromList({
    auditType: it.auditType,
    showAuditLogo: it.showAuditLogo,
    logoText: it.logoText,
  });
  const starsRaw = it.companySymbol?.stars;
  const employeesRaw = num(it.comEmployee);
  return {
    account,
    company_id: companyId,
    encode_com_id: strOrNull(it.encodeComId),
    company_name: String(it.name ?? '').trim(),
    province: strOrNull(it.province),
    city: strOrNull(it.city),
    country: strOrNull(it.country),
    main_products: splitList(it.mainProduct),
    business_types: splitList(it.businessTypeList),
    membership,
    audited,
    capability_stars: parseStars(starsRaw),
    system_certifications: splitList(it.systemCertificationList),
    employees: employeesRaw > 0 ? employeesRaw : null,
    turnover: strOrNull(it.comTurnOver),
    plant_area: strOrNull(it.comPlantArea),
    company_url: `https://m.made-in-china.com/company-${account}/`,
    company_info_url: `https://m.made-in-china.com/company-${account}/info.html`,
    detail_source: 'json',
    is_ad: isAd(it),
  };
}

export class SupplierSearchApi {
  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  async search(params: SupplierSearchParams, signal?: AbortSignal): Promise<UpstreamSearchPage> {
    const form: Record<string, string | number> = { word: params.word, page: params.page };
    if (params.province) form.province = params.province;
    if (params.catCode) form.catCode = params.catCode;
    if (params.memberLevel) form.memberLevel = params.memberLevel;
    if (params.managementCertification) form.managementCertification = params.managementCertification;
    if (params.comBusinessType) form.comBusinessType = params.comBusinessType;
    if (params.annualRevenue) form.annualRevenue = params.annualRevenue;
    if (params.rdCapacity) form.rdCapacity = params.rdCapacity;

    const res = await this.http.request(SEARCH_URL, {
      method: 'POST',
      host: 'mobile',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://m.made-in-china.com/',
      },
      form,
      signal,
    } as never);
    if (res.status !== 200) {
      throw new AppError('UPSTREAM_UNAVAILABLE', `supplier search HTTP ${res.status}`, { status: res.status });
    }
    let json: unknown;
    try {
      json = JSON.parse(res.body);
    } catch {
      throw new AppError('UPSTREAM_CHANGED', 'supplier search returned non-JSON', {
        content_type: res.headers['content-type'] ?? null,
        body_head: res.body.slice(0, 200),
      });
    }
    const parsed = searchResponseSchema.safeParse(json);
    if (!parsed.success || !parsed.data.dataList) {
      throw new AppError('UPSTREAM_CHANGED', 'supplier search response shape changed', {
        issues: parsed.success ? ['missing dataList'] : parsed.error.issues.slice(0, 5),
      });
    }
    const { total, totalNum, capped } = parseTotal(parsed.data);
    const items = parsed.data.dataList.map((it) => mapSupplierItem(it as RawSupplierItem));
    return {
      total,
      totalNum,
      totalCapped: capped,
      page: num(parsed.data.page) || params.page,
      pageSize: num(parsed.data.pageSize) || 20,
      totalPage: Math.max(1, num(parsed.data.totalPage)),
      items,
      raw: parsed.data.dataList as RawSupplierItem[],
    };
  }

  async refine(word: string, province?: string): Promise<unknown> {
    const qs = new URLSearchParams({ word, page: '1' });
    if (province) qs.set('province', province);
    const res = await this.http.request(`${REFINE_URL}?${qs.toString()}`, {
      host: 'mobile',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://m.made-in-china.com/',
      },
    });
    if (res.status !== 200) {
      throw new AppError('UPSTREAM_UNAVAILABLE', `refine HTTP ${res.status}`, { status: res.status });
    }
    try {
      return JSON.parse(res.body);
    } catch {
      throw new AppError('UPSTREAM_CHANGED', 'refine returned non-JSON', { body_head: res.body.slice(0, 200) });
    }
  }
}
