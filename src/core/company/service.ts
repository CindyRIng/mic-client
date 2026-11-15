import { AppError, makeMeta, type Meta, type Warning } from '../errors.js';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { newRequestId } from '../logger.js';
import type { Cache } from '../cache/cache.js';
import type {
  AuditInfo,
  AvailabilityReason,
  CompanyDetail,
  ContactInfo,
  Enrichment,
  MembershipInfo,
  ResponseInfo,
  ReviewSummary,
} from '../models.js';
import { CompanyDetailApi, type CompanyDetailPayload, type DetailRequestOptions } from '../api/company.js';
import { CompanyEnricher, parseRatingDisplay, type EnrichRequestOptions } from '../api/enrich.js';
import { auditedFromDetail, listMembership, mergeAudited, mergeMembership } from '../membership/tiers.js';
import { allProvinces } from '../regions/dict.js';

export const INCLUDE_KEYS = ['audit', 'response', 'contacts', 'reviews'] as const;
export type IncludeKey = (typeof INCLUDE_KEYS)[number];

export type LookupKind = 'account' | 'com_id' | 'encode_com_id';

export interface Lookup {
  kind: LookupKind;
  value: string;
}

export interface CompanyInput {
  /** 位置参数：account / 数字 comId / encodeComId（自动判别，docs/04 §2.7.2）。 */
  lookup?: string;
  account?: string;
  com_id?: string;
  encode_com_id?: string;
  include?: string | readonly string[] | null;
  refresh?: boolean | string | number | null;
  request_id?: string;
  /** 由会话层注入；未注入时 m 站挑战 → NEED_HUMAN_VERIFICATION。 */
  onCaptcha?: (srcUrl: string) => Promise<void>;
  /** 浏览器兜底取 HTML（会话层注入）。 */
  onBrowserFetch?: (url: string) => Promise<string>;
}

export interface CompanyResponse {
  data: CompanyDetail;
  meta: Meta;
}

interface CompanyRow {
  account: string;
  company_id: number | null;
  encode_com_id: string | null;
  company_name: string;
  province: string | null;
  city: string | null;
  country: string | null;
  main_products_json: string;
  business_types_json: string;
  system_certifications_json: string;
  membership_tier: string;
  raw_cs_level: number | null;
  since_year: number | null;
  capability_stars: number | null;
  audited: number | null;
  employees: number | null;
  turnover: string | null;
  plant_area: string | null;
  company_url: string | null;
  company_info_url: string | null;
}

interface CompanyDetailsRow {
  account: string;
  company_name: string;
  address: string | null;
  established_at: string | null;
  employees: number | null;
  employee_text: string | null;
  business_types_json: string;
  main_products_json: string;
  system_certifications_json: string;
  rating_value: number | null;
  rating_display: string | null;
  review_list_url: string | null;
  sgs_member: number | null;
  fetched_at: number;
  expires_at: number;
  source: string;
}

interface MembershipRow {
  tier: string;
  raw_cs_level: number | null;
  raw_member_level: string | null;
  since_year: number | null;
  evidence_json: string;
  confidence: string;
  has_conflict: number;
}

interface AuditRow {
  audited: number | null;
  sections_json: string;
  audited_section_count: number | null;
  agency: string | null;
  report_no: string | null;
  verify_url: string | null;
  verified_items_count: number | null;
  source: string;
  fetched_at: number;
  expires_at: number | null;
}

interface ResponseRow {
  avg_response_hours: number | null;
  timely_reply_ratio: number | null;
  top_avg_response_hours: number | null;
  top_timely_reply_ratio: number | null;
  range_display: string | null;
  window_days: number;
  as_of: string | null;
  source: string;
  fetched_at: number;
  expires_at: number;
  availability_reason: AvailabilityReason | null;
}

interface ContactRow {
  persons_json: string;
  primary_json: string | null;
  channels_json: string;
  inquiry_url: string | null;
  source: string;
  fetched_at: number;
  expires_at: number;
}

interface ReviewRow {
  rating_value: number | null;
  rating_display: string | null;
  review_count: number | null;
  items_json: string;
  source: string;
  fetched_at: number;
  expires_at: number;
  availability_reason: AvailabilityReason | null;
}

/** 详情快照（基础通道），缓存行/上游解析结果都能转换到这一层。 */
interface DetailSnapshot {
  source?: 'json' | 'html' | 'browser';
  company_name: string;
  address: string | null;
  established_at: string | null;
  employees: number | null;
  employee_text: string | null;
  business_types: string[];
  main_products: string[];
  system_certifications: string[];
  rating_value: number | null;
  rating_display: string | null;
  review_list_url: string | null;
  sgs_member: boolean | null;
  fetched_at: number;
}

export type AvailabilityItem = { field: string; reason: AvailabilityReason };

const TTL_KEY: Record<IncludeKey, keyof Config['cache']> = {
  audit: 'ttl_audit_s',
  response: 'ttl_response_s',
  contacts: 'ttl_contacts_s',
  reviews: 'ttl_reviews_s',
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** ISO 8601 +08:00（docs/03 §1.4：固定 Asia/Shanghai，不用 Z）。 */
export function shanghaiIso(epochSeconds: number | null | undefined): string | null {
  if (epochSeconds === null || epochSeconds === undefined) return null;
  const d = new Date(epochSeconds * 1000 + 8 * 3600_000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+08:00`
  );
}

function parseBool(v: unknown, dflt: boolean): boolean {
  if (v === undefined || v === null || v === '') return dflt;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  throw new AppError('INVALID_PARAM', `invalid boolean: ${String(v)}`, { reason: 'INVALID_ENUM', allowed: ['true', 'false'] });
}

function parseJsonArray<T>(json: string | null | undefined): T[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function cellBool(v: number | null): boolean | null {
  if (v === null || v === undefined) return null;
  return v === 1;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * 规范化 account 输入：接受 `account`、`company-<account>`、
 * `https://m.made-in-china.com/company-<account>/info.html`、`https://<account>.en.made-in-china.com/`（docs/03 §8.2）。
 */
export function normalizeAccountInput(raw: string): string | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const host = u.hostname.toLowerCase();
      if (host.endsWith('.en.made-in-china.com')) {
        const sub = host.slice(0, -'.en.made-in-china.com'.length);
        if (sub && !sub.includes('.')) return sub.toLowerCase();
      }
      const m = /^\/company-([A-Za-z0-9._-]+)(?:\/|$)/.exec(u.pathname);
      if (m && m[1]) return m[1].toLowerCase();
      return null;
    } catch {
      return null;
    }
  }
  // 路径/前缀形态
  const m = /(?:^|\/)company-([A-Za-z0-9._-]+)/.exec(s);
  if (m && m[1]) s = m[1];
  s = s.replace(/^company-/, '').replace(/[/?#].*$/, '').replace(/\.html?$/i, '').trim().toLowerCase();
  return s.length ? s : null;
}

function isValidAccount(account: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,62}$/.test(account);
}

/**
 * 判别并校验 lookup（docs/03 §8.2 + docs/04 §2.7.2 C1）：
 * 数字 → com_id；含大写字母的 6–32 位字母数字 → encode_com_id；其余 → account。
 */
export function classifyLookup(input: Pick<CompanyInput, 'lookup' | 'account' | 'com_id' | 'encode_com_id'>): Lookup {
  const provided: Array<{ kind: LookupKind | 'auto'; raw: string }> = [];
  if (input.account !== undefined && String(input.account).trim() !== '') {
    provided.push({ kind: 'account', raw: String(input.account).trim() });
  }
  if (input.com_id !== undefined && String(input.com_id).trim() !== '') {
    provided.push({ kind: 'com_id', raw: String(input.com_id).trim() });
  }
  if (input.encode_com_id !== undefined && String(input.encode_com_id).trim() !== '') {
    provided.push({ kind: 'encode_com_id', raw: String(input.encode_com_id).trim() });
  }
  if (input.lookup !== undefined && String(input.lookup).trim() !== '') {
    provided.push({ kind: 'auto', raw: String(input.lookup).trim() });
  }
  if (provided.length === 0) {
    throw new AppError('INVALID_PARAM', 'company identifier is required', {
      params: ['lookup', 'account', 'com_id', 'encode_com_id'],
    });
  }
  const distinct = new Set(provided.map((p) => `${p.kind === 'auto' ? 'auto' : p.kind}:${p.raw}`));
  if (provided.length > 1) {
    // 位置参数与同名选项值相同是允许的（docs/04 C1）
    const auto = provided.find((p) => p.kind === 'auto');
    const explicit = provided.filter((p) => p.kind !== 'auto');
    const compatible =
      auto &&
      explicit.length === 1 &&
      normalizeAccountInput(auto.raw) === normalizeAccountInput(explicit[0]!.raw);
    if (!compatible) {
      throw new AppError('INVALID_PARAM', 'multiple company identifiers provided', {
        provided: provided.map((p) => p.kind),
        hint: 'pass exactly one of lookup/--account/--com-id/--encode-com-id',
        distinct: distinct.size,
      });
    }
  }
  const chosen = provided.find((p) => p.kind !== 'auto') ?? provided[0]!;
  if (chosen.kind === 'account') {
    const account = normalizeAccountInput(chosen.raw);
    if (!account || !isValidAccount(account)) {
      throw new AppError('INVALID_PARAM', `invalid account: ${chosen.raw}`, {
        param: 'account',
        reason: 'INVALID_ACCOUNT',
        value: chosen.raw,
      });
    }
    return { kind: 'account', value: account };
  }
  if (chosen.kind === 'com_id') {
    if (!/^\d+$/.test(chosen.raw)) {
      throw new AppError('INVALID_PARAM', `invalid com_id: ${chosen.raw}`, {
        param: 'com_id',
        value: chosen.raw,
        hint: 'com_id must be a numeric Made-in-China company id',
      });
    }
    return { kind: 'com_id', value: chosen.raw };
  }
  if (chosen.kind === 'encode_com_id') {
    if (!/^[A-Za-z0-9._-]{4,64}$/.test(chosen.raw)) {
      throw new AppError('INVALID_PARAM', `invalid encode_com_id: ${chosen.raw}`, {
        param: 'encode_com_id',
        reason: 'INVALID_ENUM',
        value: chosen.raw,
      });
    }
    return { kind: 'encode_com_id', value: chosen.raw };
  }
  const auto = chosen.raw;
  if (/^\d+$/.test(auto)) return { kind: 'com_id', value: auto };
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(auto) && /[A-Z]/.test(auto) && !/^[a-z0-9._-]+$/.test(auto)) {
    return { kind: 'encode_com_id', value: auto };
  }
  const account = normalizeAccountInput(auto);
  if (!account || !isValidAccount(account)) {
    throw new AppError('INVALID_PARAM', `invalid company identifier: ${auto}`, {
      param: 'lookup',
      reason: 'INVALID_ACCOUNT',
      value: auto,
      hint: 'use a mainUserAccount, a numeric comId, or an indexed encodeComId',
    });
  }
  return { kind: 'account', value: account };
}

/** 解析 include 参数（默认 audit,response；none/all/逗号组合；固定排序）。 */
export function parseInclude(input: string | readonly string[] | null | undefined): IncludeKey[] {
  if (input === undefined || input === null || input === '') return ['audit', 'response'];
  const raw = Array.isArray(input) ? input : String(input).split(',');
  const values = raw.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
  if (values.length === 0) return ['audit', 'response'];
  const set = new Set<IncludeKey>();
  let all = false;
  let none = false;
  for (const v of values) {
    if (v === 'all') {
      all = true;
      continue;
    }
    if (v === 'none') {
      none = true;
      continue;
    }
    if ((INCLUDE_KEYS as readonly string[]).includes(v)) {
      set.add(v as IncludeKey);
      continue;
    }
    throw new AppError('INVALID_PARAM', `invalid include value: ${v}`, {
      param: 'include',
      reason: 'INVALID_INCLUDE',
      value: v,
      allowed: ['none', 'all', ...INCLUDE_KEYS],
    });
  }
  if (none && (all || set.size > 0)) {
    throw new AppError('INVALID_PARAM', "include=none cannot be combined with other values", {
      param: 'include',
      reason: 'INVALID_INCLUDE',
      allowed: ['none', 'all', ...INCLUDE_KEYS],
    });
  }
  if (none) return [];
  if (all) return [...INCLUDE_KEYS];
  return INCLUDE_KEYS.filter((k) => set.has(k));
}

/** 是否为「上游失败」类错误（用于 stale-while-error 回退）。 */
function isUpstreamFailure(e: unknown): boolean {
  if (!(e instanceof AppError)) return false;
  return e.code === 'UPSTREAM_UNAVAILABLE' || e.code === 'UPSTREAM_CHANGED' || e.code === 'PARSE_ERROR' || e.code === 'RATE_LIMITED';
}

export class CompanyService {
  constructor(
    private readonly cfg: Config,
    private readonly logger: Logger,
    private readonly cache: Cache,
    private readonly api: CompanyDetailApi,
    private readonly enricher: CompanyEnricher,
  ) {}

  // ------------------------------------------------------------------
  // 公开入口
  // ------------------------------------------------------------------

  async get(input: CompanyInput): Promise<CompanyResponse> {
    const requestId = input.request_id ?? newRequestId();
    const include = parseInclude(input.include);
    const refresh = parseBool(input.refresh, false);
    const lookup = classifyLookup(input);
    const warnings: Warning[] = [];

    const account = await this.resolveAccount(lookup, input);
    let companyBefore = this.readCompanyRow(account);
    const canCache = this.cfg.cache.enabled;
    const now = nowSeconds();

    let detail: DetailSnapshot;
    let membership: MembershipInfo;
    let audited: boolean | null;
    let cached = false;
    let stale = false;
    let source: 'json' | 'cache' | 'browser' = 'json';
    let detailFetchedAt = now;
    const cachedDetailRow = canCache ? this.readDetailRow(account) : null;
    const cachedMembershipRow = canCache ? this.readMembershipRow(account) : null;

    if (cachedDetailRow && !refresh && cachedDetailRow.expires_at > now) {
      detail = snapshotFromDetailRow(cachedDetailRow);
      detailFetchedAt = cachedDetailRow.fetched_at;
      cached = true;
      source = 'cache';
      const merged = this.membershipFromCache(cachedMembershipRow, companyBefore, detail, warnings);
      membership = merged.membership;
      audited = this.auditedFromCache(companyBefore, cachedDetailRow);
    } else {
      try {
        const payload = await this.fetchBase(account, input.onCaptcha, input.onBrowserFetch);
        if (payload.source === 'browser') source = 'browser';
        else if (payload.source === 'html') source = 'json';
        detailFetchedAt = nowSeconds();
        detail = snapshotFromPayload(payload);
        const merged = this.mergeFreshMembership(companyBefore, payload, warnings);
        membership = merged.membership;
        const listAudited = companyBefore ? cellBool(companyBefore.audited) : null;
        const detailAudited = auditedFromDetail({
          sgsMember: payload.sgs_member,
          auditReportLogo: payload.audit_logo
            ? { showAuditLogo: payload.audit_logo.show_audit_logo, logoText: payload.audit_logo.logo_text }
            : null,
        });
        const auditedMerge = mergeAudited(listAudited, detailAudited);
        audited = auditedMerge.audited;
        if (canCache) {
          this.writeBaseCache(account, payload, detail, membership, merged.conflict, audited, warnings, requestId);
          companyBefore = this.readCompanyRow(payload.account) ?? companyBefore;
        } else {
          companyBefore = rowFromPayload(payload);
        }
      } catch (e) {
        if (cachedDetailRow && this.cfg.cache.allow_stale && isUpstreamFailure(e)) {
          this.logger.warn('company: upstream failed, serving stale detail cache', {
            account,
            error: (e as Error).message,
            fetched_at: cachedDetailRow.fetched_at,
          });
          detail = snapshotFromDetailRow(cachedDetailRow);
          detailFetchedAt = cachedDetailRow.fetched_at;
          cached = true;
          stale = true;
          source = 'cache';
          warnings.push({
            code: 'STALE_DATA',
            message: 'upstream failed, served stale company detail cache',
            details: { original_fetched_at: shanghaiIso(cachedDetailRow.fetched_at), reason: (e as Error).message },
          });
          const merged = this.membershipFromCache(cachedMembershipRow, companyBefore, detail, warnings);
          membership = merged.membership;
          audited = this.auditedFromCache(companyBefore, cachedDetailRow);
        } else {
          this.translateCaptchaError(e, input.onCaptcha);
          throw e;
        }
      }
    }

    if (membership.tier === 'free' && audited === true) {
      // docs/05 §4.5：free 需要「无会员徽章 + 无 AS」同时成立；有 AS 时降级为 unknown，避免误判。
      membership = {
        ...membership,
        tier: 'unknown',
        confidence: 'low',
        evidence: [...membership.evidence, 'derived:free-suppressed-by-audited'],
      };
    }

    const baseDetail = this.composeDetail(account, companyBefore, detail, membership, audited, include, source, warnings);
    const availability: AvailabilityItem[] = [...baseDetail.availability];

    const enrich = await this.loadEnrichment({
      account: baseDetail.detail.account || account,
      encodeComId: baseDetail.detail.encode_com_id,
      include,
      refresh,
      detail,
      membership,
      onCaptcha: input.onCaptcha,
      warnings,
      canCache,
    });
    availability.push(...enrich.availability);

    const data: CompanyDetail = {
      ...baseDetail.detail,
      enrichment: enrich.enrichment,
      availability,
    };

    const meta: Meta = makeMeta({
      request_id: requestId,
      cached,
      stale,
      fetched_at: shanghaiIso(detailFetchedAt),
      source,
      warnings,
    });
    return { data, meta };
  }

  // ------------------------------------------------------------------
  // lookup
  // ------------------------------------------------------------------

  private async resolveAccount(lookup: Lookup, input: CompanyInput): Promise<string> {
    if (lookup.kind === 'account') return lookup.value;
    if (lookup.kind === 'com_id') {
      try {
        return await this.api.resolveAccountByComId(lookup.value, { onCaptcha: input.onCaptcha });
      } catch (e) {
        this.translateCaptchaError(e, input.onCaptcha);
        throw e;
      }
    }
    // encodeComId：只查本地 companies 索引（docs/03 §8.2 / docs/04 C4）
    const row = this.cache.db
      .prepare('SELECT account FROM companies WHERE encode_com_id = ? LIMIT 1')
      .get(lookup.value) as { account: string } | undefined;
    if (row?.account) return row.account.toLowerCase();
    throw new AppError('NOT_FOUND', 'company not found by encode com id (not indexed locally)', {
      resource: 'company',
      input: lookup.value,
      reason: 'ENCODE_COM_ID_NOT_INDEXED',
      hint: 'search the company first, or use mainUserAccount / numeric com id',
    });
  }

  /** m 站验证码/挑战 → NEED_HUMAN_VERIFICATION（未注入求解器）或 CAPTCHA_SOLVE_FAILED（注入但仍挑战）。 */
  private translateCaptchaError(e: unknown, onCaptcha?: (srcUrl: string) => Promise<void>): void {
    if (!(e instanceof AppError) || e.code !== 'CAPTCHA_REQUIRED') return;
    const srcUrl = (e.details?.['src_url'] as string | undefined) ?? null;
    if (onCaptcha) {
      throw new AppError('CAPTCHA_SOLVE_FAILED', 'automatic captcha solving did not clear the company page challenge', {
        stage: 'captcha',
        reason: 'captcha_still_required',
        src_url: srcUrl,
        retryable: true,
      });
    }
    throw new AppError('NEED_HUMAN_VERIFICATION', 'company page requires human verification; run `mic auth`', {
      stage: 'captcha',
      reason: 'auto_solve_disabled',
      action: 'mic auth',
      session_state: 'challenge',
      src_url: srcUrl,
      retryable: false,
    });
  }

  private async fetchBase(
    account: string,
    onCaptcha?: (srcUrl: string) => Promise<void>,
    onBrowserFetch?: (url: string) => Promise<string>,
  ): Promise<CompanyDetailPayload> {
    const opts: DetailRequestOptions = {};
    if (onCaptcha) opts.onCaptcha = onCaptcha;
    if (onBrowserFetch) opts.browserHtml = onBrowserFetch;
    return this.api.fetchDetail(account, opts);
  }

  // ------------------------------------------------------------------
  // 会员 / 认证合并
  // ------------------------------------------------------------------

  private membershipFromCache(
    membershipRow: MembershipRow | null,
    companyBefore: CompanyRow | null,
    detail: DetailSnapshot,
    warnings: Warning[],
  ): { membership: MembershipInfo; conflict: boolean } {
    if (membershipRow) {
      const membership: MembershipInfo = {
        tier: (membershipRow.tier as MembershipInfo['tier']) ?? 'unknown',
        raw_cs_level: membershipRow.raw_cs_level,
        raw_member_level: (membershipRow.raw_member_level as MembershipInfo['raw_member_level']) ?? null,
        since_year: membershipRow.since_year,
        evidence: parseJsonArray<string>(membershipRow.evidence_json),
        confidence: (membershipRow.confidence as MembershipInfo['confidence']) ?? 'low',
      };
      const conflict = membershipRow.has_conflict === 1;
      if (conflict) {
        warnings.push({
          code: 'MEMBER_EVIDENCE_CONFLICT',
          message: `membership evidence conflict: list=${companyBefore?.membership_tier ?? 'unknown'}, detail=${membership.raw_member_level ?? 'unknown'}`,
          details: { list: companyBefore?.membership_tier ?? 'unknown', detail: membership.raw_member_level ?? 'unknown' },
        });
      }
      return { membership, conflict };
    }
    // 旧的/缺 membership_info 的缓存：用列表 csLevel + 详情 sgs 兜底，不猜 free
    const listInfo = companyBefore ? listMembership({ csLevel: companyBefore.raw_cs_level }) : null;
    const merged = mergeMembership(listInfo, {
      memberLevel: null,
      memberSince: null,
      isDiamondMember: null,
    });
    warnings.push(...merged.warnings);
    return { membership: merged.membership, conflict: merged.conflict };
  }

  private mergeFreshMembership(
    companyBefore: CompanyRow | null,
    payload: CompanyDetailPayload,
    warnings: Warning[],
  ): { membership: MembershipInfo; conflict: boolean } {
    const listInfo = companyBefore ? listMembership({ csLevel: companyBefore.raw_cs_level }) : null;
    const merged = mergeMembership(listInfo, {
      memberLevel: payload.member_level,
      memberSince: payload.member_since,
      isDiamondMember: payload.is_diamond_member,
    });
    warnings.push(...merged.warnings);
    if (!companyBefore?.raw_cs_level && payload.member_level) {
      // 详情优先：列表无 csLevel 时，详情 memberLevel 提升置信度由 mergeMembership 处理
      this.logger.debug('company: membership from detail only (no list csLevel)', {
        account: payload.account,
        member_level: payload.member_level,
      });
    }
    // 详情 memberSince 与列表 since_year 不同只记录内部证据，不新增 warning 码（docs/05 §4.5）
    return merged;
  }

  private auditedFromCache(companyBefore: CompanyRow | null, detailRow: CompanyDetailsRow): boolean | null {
    const listAudited = companyBefore ? cellBool(companyBefore.audited) : null;
    const detailAudited = cellBool(detailRow.sgs_member);
    return mergeAudited(listAudited, detailAudited).audited;
  }

  // ------------------------------------------------------------------
  // 组装 CompanyDetail
  // ------------------------------------------------------------------

  private composeDetail(
    account: string,
    companyBefore: CompanyRow | null,
    detail: DetailSnapshot,
    membership: MembershipInfo,
    audited: boolean | null,
    include: IncludeKey[],
    source: 'json' | 'cache' | 'browser' | 'html',
    warnings: Warning[],
  ): { detail: Omit<CompanyDetail, 'enrichment' | 'availability'>; availability: AvailabilityItem[] } {
    const availability: AvailabilityItem[] = [];
    const addMissing = (field: string) => availability.push({ field, reason: 'not_provided_by_supplier' });

    const mainProducts = detail.main_products.length
      ? detail.main_products
      : parseJsonArray<string>(companyBefore?.main_products_json ?? null);
    const businessTypes = detail.business_types.length
      ? detail.business_types
      : parseJsonArray<string>(companyBefore?.business_types_json ?? null);
    const systemCertifications = dedupeStrings([
      ...detail.system_certifications,
      ...parseJsonArray<string>(companyBefore?.system_certifications_json ?? null),
    ]);
    const employees = detail.employees ?? companyBefore?.employees ?? null;
    const turnover = strOrNull(companyBefore?.turnover ?? null);
    const plantArea = strOrNull(companyBefore?.plant_area ?? null);
    const urlAccount = companyBefore?.account ?? account;
    const parsedRegion = parseAddressRegion(detail.address);
    if (companyBefore?.city && parsedRegion.city && companyBefore.city.toLowerCase() !== parsedRegion.city.toLowerCase()) {
      warnings.push({
        code: 'ADDRESS_MISMATCH',
        message: 'detail address city does not match list city; list value kept',
        details: { address: detail.address, city: companyBefore.city, address_city: parsedRegion.city },
      });
    } else if (
      companyBefore?.province &&
      parsedRegion.province &&
      companyBefore.province.toLowerCase() !== parsedRegion.province.toLowerCase()
    ) {
      warnings.push({
        code: 'ADDRESS_MISMATCH',
        message: 'detail address province does not match list province; list value kept',
        details: { address: detail.address, province: companyBefore.province, address_province: parsedRegion.province },
      });
    }
    const companyUrl =
      strOrNull(companyBefore?.company_url ?? null) ?? `https://m.made-in-china.com/company-${urlAccount}/`;

    if (detail.address === null) addMissing('address');
    if (detail.established_at === null) addMissing('established_at');
    if (employees === null) addMissing('employees');
    if (turnover === null) addMissing('turnover');
    if (plantArea === null) addMissing('plant_area');

    const composed: Omit<CompanyDetail, 'enrichment' | 'availability'> = {
      account: companyBefore?.account ?? account,
      company_id: String(companyBefore?.company_id ?? '') || account,
      encode_com_id: companyBefore?.encode_com_id ?? null,
      company_name: detail.company_name || (companyBefore?.company_name ?? ''),
      province: strOrNull(companyBefore?.province ?? null),
      city: strOrNull(companyBefore?.city ?? null),
      country: strOrNull(companyBefore?.country ?? null),
      address: detail.address,
      established_at: detail.established_at,
      main_products: mainProducts,
      business_types: businessTypes,
      membership,
      audited,
      capability_stars: companyBefore?.capability_stars ?? null,
      system_certifications: systemCertifications,
      employees,
      turnover,
      plant_area: plantArea,
      company_url: companyUrl,
      company_info_url: `https://m.made-in-china.com/company-${urlAccount}/info.html`,
      detail_source: detail.source ?? source,
      include: [...include],
    };
    return { detail: composed, availability };
  }

  // ------------------------------------------------------------------
  // 增强（audit / response / contacts / reviews）
  // ------------------------------------------------------------------

  private async loadEnrichment(args: {
    account: string;
    encodeComId: string | null;
    include: IncludeKey[];
    refresh: boolean;
    detail: DetailSnapshot;
    membership: MembershipInfo;
    onCaptcha?: (srcUrl: string) => Promise<void>;
    warnings: Warning[];
    canCache: boolean;
  }): Promise<{ enrichment: Enrichment; availability: AvailabilityItem[]; cached: boolean }> {
    const { account, include, refresh, warnings, canCache } = args;
    const enrichment: Enrichment = { audit: null, response: null, contacts: null, reviews: null };
    const availability: AvailabilityItem[] = [];
    const failed: IncludeKey[] = [];
    let cached = false;
    if (include.length === 0) return { enrichment, availability, cached: true };

    if (!args.encodeComId) {
      for (const key of include) failed.push(key);
      warnings.push({
        code: 'ENRICHMENT_PARTIAL',
        message: 'enrichment skipped: encode_com_id unavailable (cannot call enrichment endpoints)',
        details: { failed: [...failed] },
      });
      for (const key of include) availability.push({ field: `enrichment.${key}`, reason: 'fetch_blocked' });
      return { enrichment, availability, cached: false };
    }
    const encodeComId = args.encodeComId;
    const reqOpts: EnrichRequestOptions = args.onCaptcha ? { onCaptcha: args.onCaptcha } : {};
    const now = nowSeconds();

    // 串行抓取：HttpClient 的限速队列在并发时会触发 RATE_LIMITED（queue_max_wait_ms）
    for (const key of include) {
      const cacheRow =
        canCache && !refresh ? this.readEnrichRow(key, account) : null;
      if (cacheRow && cacheRow.expires_at > now) {
        cached = true;
        const obj = this.enrichmentFromRow(key, cacheRow, args, 'cache');
        if (obj) {
          (enrichment as Record<string, unknown>)[key] = obj.value;
          availability.push(...obj.availability);
        }
        continue;
      }
      try {
        const obj = await this.fetchEnrichment(key, encodeComId, args, reqOpts);
        (enrichment as Record<string, unknown>)[key] = obj.value;
        availability.push(...obj.availability);
        if (canCache) this.writeEnrichRow(key, account, obj, warnings);
      } catch (e) {
        if (cacheRow && this.cfg.cache.allow_stale && isUpstreamFailure(e)) {
          cached = true;
          warnings.push({
            code: 'STALE_DATA',
            message: `upstream failed, served stale enrichment cache for ${key}`,
            details: {
              scope: key,
              original_fetched_at: shanghaiIso(cacheRow.fetched_at),
              reason: (e as Error).message,
            },
          });
          const obj = this.enrichmentFromRow(key, cacheRow, args, 'cache');
          if (obj) {
            (enrichment as Record<string, unknown>)[key] = obj.value;
            availability.push(...obj.availability);
          }
          continue;
        }
        this.logger.warn('company: enrichment failed, degrading to null', {
          account,
          section: key,
          error: (e as Error).message,
        });
        failed.push(key);
        availability.push({ field: `enrichment.${key}`, reason: 'fetch_blocked' });
      }
    }
    if (failed.length) {
      warnings.push({
        code: 'ENRICHMENT_PARTIAL',
        message: 'one or more enrichment sections failed; null returned for them',
        details: { failed: [...failed] },
      });
    }
    return { enrichment, availability, cached };
  }

  private async fetchEnrichment(
    key: IncludeKey,
    encodeComId: string,
    args: { detail: DetailSnapshot; membership: MembershipInfo; warnings: Warning[] },
    reqOpts: EnrichRequestOptions,
  ): Promise<{ value: unknown; availability: AvailabilityItem[]; row: Record<string, unknown> }> {
    const availability: AvailabilityItem[] = [];
    if (key === 'audit') {
      const sections = await this.enricher.auditSections(encodeComId, reqOpts);
      const audited = args.detail.sgs_member ?? sections.length > 0;
      const auditedCount = sections.filter((s) => s.audited).length;
      const value: AuditInfo = {
        audited,
        sections,
        audited_section_count: Math.min(9, auditedCount),
        agency: null,
        report_no: null,
        verify_url: null,
        verified_items_count: null,
        source: 'json',
        fetched_at: shanghaiIso(nowSeconds()) ?? '',
      };
      return {
        value,
        availability,
        row: {
          audited: audited ? 1 : 0,
          sections_json: JSON.stringify(sections),
          audited_section_count: Math.min(9, auditedCount),
        },
      };
    }
    if (key === 'response') {
      const data = await this.enricher.replyRate(encodeComId, reqOpts);
      const value: ResponseInfo = {
        avg_response_hours: data?.avg_response_hours ?? null,
        timely_reply_ratio: data?.timely_reply_ratio ?? null,
        top_avg_response_hours: data?.top_avg_response_hours ?? null,
        top_timely_reply_ratio: data?.top_timely_reply_ratio ?? null,
        range_display: data?.range_display ?? null,
        window_days: 30,
        as_of: data?.as_of ?? '',
        source: 'json',
        fetched_at: shanghaiIso(nowSeconds()) ?? '',
      };
      if (!data) {
        availability.push({ field: 'enrichment.response', reason: 'not_provided_by_supplier' });
      }
      return { value, availability, row: this.responseRow(value, data ? null : 'not_provided_by_supplier') };
    }
    if (key === 'contacts') {
      const persons = await this.enricher.subAccounts(encodeComId, reqOpts);
      const value: ContactInfo = {
        persons: persons.map((p) => ({
          name: p.name,
          id: p.id,
          title: null,
          department: null,
          online: null,
          chat_available: true,
        })),
        primary: null,
        channels: {
          phone: null,
          email: null,
          whatsapp: null,
          skype: null,
          wechat: null,
          reason: 'not_public_by_platform',
        },
        inquiry_url: null,
        source: 'json',
        fetched_at: shanghaiIso(nowSeconds()) ?? '',
      };
      // 职位/部门/主联系人首期不抓（docs/03 §8.4）
      availability.push({ field: 'enrichment.contacts.primary', reason: 'not_provided_by_supplier' });
      return { value, availability, row: this.contactRow(value) };
    }
    const data = await this.enricher.reviews(encodeComId, reqOpts);
    const ratingValue = args.detail.rating_value;
    const ratingDisplay = args.detail.rating_display;
    const items = data.items;
    const noReviews = items.length === 0 && (data.review_count === null || data.review_count === 0) && ratingValue === null;
    const value: ReviewSummary = {
      rating_value: ratingValue,
      rating_display: ratingDisplay,
      review_count: data.review_count,
      items,
      source: 'json',
      fetched_at: shanghaiIso(nowSeconds()) ?? '',
    };
    if (noReviews) availability.push({ field: 'reviews', reason: 'no_reviews' });
    return {
      value,
      availability,
      row: {
        rating_value: ratingValue,
        rating_display: ratingDisplay,
        review_count: data.review_count,
        items_json: JSON.stringify(items),
        availability_reason: noReviews ? 'no_reviews' : null,
      },
    };
  }

  private responseRow(value: ResponseInfo, availabilityReason: AvailabilityReason | null): Record<string, unknown> {
    return {
      avg_response_hours: value.avg_response_hours,
      timely_reply_ratio: value.timely_reply_ratio,
      top_avg_response_hours: value.top_avg_response_hours,
      top_timely_reply_ratio: value.top_timely_reply_ratio,
      range_display: value.range_display,
      window_days: 30,
      as_of: value.as_of,
      availability_reason: availabilityReason,
    };
  }

  private contactRow(value: ContactInfo): Record<string, unknown> {
    return {
      persons_json: JSON.stringify(value.persons),
      primary_json: null,
      channels_json: JSON.stringify(value.channels),
      inquiry_url: null,
    };
  }

  // ------------------------------------------------------------------
  // 读缓存
  // ------------------------------------------------------------------

  private readCompanyRow(account: string): CompanyRow | null {
    const row = this.cache.db
      .prepare('SELECT * FROM companies WHERE account = ? COLLATE NOCASE LIMIT 1')
      .get(account) as CompanyRow | undefined;
    return row ?? null;
  }

  private readDetailRow(account: string): CompanyDetailsRow | null {
    const row = this.cache.db
      .prepare('SELECT * FROM company_details WHERE account = ? COLLATE NOCASE LIMIT 1')
      .get(account) as CompanyDetailsRow | undefined;
    return row ?? null;
  }

  private readMembershipRow(account: string): MembershipRow | null {
    const row = this.cache.db
      .prepare('SELECT * FROM membership_info WHERE account = ? COLLATE NOCASE LIMIT 1')
      .get(account) as MembershipRow | undefined;
    return row ?? null;
  }

  private readEnrichRow(key: IncludeKey, account: string): { row: unknown; fetched_at: number; expires_at: number } | null {
    const table = ENRICH_TABLE[key];
    const row = this.cache.db
      .prepare(`SELECT * FROM ${table} WHERE account = ? COLLATE NOCASE LIMIT 1`)
      .get(account) as Record<string, unknown> | undefined;
    if (!row) return null;
    const fetchedAt = Number(row['fetched_at'] ?? 0);
    const expiresAt = Number(row['expires_at'] ?? 0);
    return { row, fetched_at: fetchedAt, expires_at: expiresAt };
  }

  private enrichmentFromRow(
    key: IncludeKey,
    cacheRow: { row: unknown; fetched_at: number; expires_at: number },
    args: { detail: DetailSnapshot },
    source: 'json' | 'cache',
  ): { value: Enrichment[IncludeKey]; availability: AvailabilityItem[] } | null {
    const row = cacheRow.row as Record<string, unknown>;
    const fetchedAt = shanghaiIso(cacheRow.fetched_at) ?? '';
    const availability: AvailabilityItem[] = [];
    if (key === 'audit') {
      const sections = parseJsonArray<{ name: string; audited: boolean }>(String(row['sections_json'] ?? '[]'));
      const audited = cellBool(row['audited'] as number | null) ?? sections.length > 0;
      const value: AuditInfo = {
        audited,
        sections,
        audited_section_count: Number(row['audited_section_count'] ?? sections.filter((s) => s.audited).length),
        agency: strOrNull(row['agency'] as string | null),
        report_no: strOrNull(row['report_no'] as string | null),
        verify_url: strOrNull(row['verify_url'] as string | null),
        verified_items_count: row['verified_items_count'] === null ? null : Number(row['verified_items_count']),
        source,
        fetched_at: fetchedAt,
      };
      return { value, availability };
    }
    if (key === 'response') {
      const reason = row['availability_reason'] as AvailabilityReason | null;
      const value: ResponseInfo = {
        avg_response_hours: row['avg_response_hours'] === null ? null : Number(row['avg_response_hours']),
        timely_reply_ratio: row['timely_reply_ratio'] === null ? null : Number(row['timely_reply_ratio']),
        top_avg_response_hours: row['top_avg_response_hours'] === null ? null : Number(row['top_avg_response_hours']),
        top_timely_reply_ratio: row['top_timely_reply_ratio'] === null ? null : Number(row['top_timely_reply_ratio']),
        range_display: strOrNull(row['range_display'] as string | null),
        window_days: 30,
        as_of: strOrNull(row['as_of'] as string | null) ?? '',
        source,
        fetched_at: fetchedAt,
      };
      if (reason) availability.push({ field: 'enrichment.response', reason });
      return { value, availability };
    }
    if (key === 'contacts') {
      const value: ContactInfo = {
        persons: parseJsonArray<ContactInfo['persons'][number]>(String(row['persons_json'] ?? '[]')),
        primary: null,
        channels: {
          phone: null,
          email: null,
          whatsapp: null,
          skype: null,
          wechat: null,
          reason: 'not_public_by_platform',
        },
        inquiry_url: strOrNull(row['inquiry_url'] as string | null),
        source,
        fetched_at: fetchedAt,
      };
      availability.push({ field: 'enrichment.contacts.primary', reason: 'not_provided_by_supplier' });
      return { value, availability };
    }
    const reason = row['availability_reason'] as AvailabilityReason | null;
    const value: ReviewSummary = {
      rating_value: row['rating_value'] === null ? null : Number(row['rating_value']),
      rating_display: strOrNull(row['rating_display'] as string | null),
      review_count: row['review_count'] === null ? null : Number(row['review_count']),
      items: parseJsonArray<ReviewSummary['items'][number]>(String(row['items_json'] ?? '[]')),
      source,
      fetched_at: fetchedAt,
    };
    if (reason) availability.push({ field: 'reviews', reason });
    return { value, availability };
  }

  // ------------------------------------------------------------------
  // 写缓存（列名严格对齐 docs/05 §6.2 DDL）
  // ------------------------------------------------------------------

  private writeBaseCache(
    account: string,
    payload: CompanyDetailPayload,
    detail: DetailSnapshot,
    membership: MembershipInfo,
    membershipConflict: boolean,
    audited: boolean | null,
    warnings: Warning[],
    requestId: string,
  ): void {
    const now = nowSeconds();
    const detailExpires = now + this.cfg.cache.ttl_detail_s;
    const availability = this.baseAvailability(detail);
    const canonicalAccount = payload.account || account;
    const region = parseAddressRegion(detail.address);
    const rawItem = {
      detail_only: true,
      account: canonicalAccount,
      comId: payload.company_id,
      encodeComId: payload.encode_com_id,
      source: 'm-company-info',
    };
    try {
      this.cache.db
        .prepare(
          `INSERT INTO companies
            (account, company_id, encode_com_id, company_name, province, city, country,
             main_products_json, business_types_json, system_certifications_json, membership_tier,
             raw_cs_level, since_year, capability_stars, audited, employees, turnover, plant_area,
             company_url, company_info_url, is_ad, detail_source, first_seen_at, last_seen_at, raw_item_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'json',?,?,?)
           ON CONFLICT(account) DO UPDATE SET
             company_name = excluded.company_name,
             company_id = COALESCE(companies.company_id, excluded.company_id),
             encode_com_id = COALESCE(companies.encode_com_id, excluded.encode_com_id),
             last_seen_at = excluded.last_seen_at,
             province = COALESCE(companies.province, excluded.province),
             city = COALESCE(companies.city, excluded.city),
             country = COALESCE(companies.country, excluded.country),
             membership_tier = excluded.membership_tier,
             since_year = COALESCE(excluded.since_year, companies.since_year),
             capability_stars = COALESCE(excluded.capability_stars, companies.capability_stars),
             audited = COALESCE(excluded.audited, companies.audited)`,
        )
        .run(
          canonicalAccount,
          Number.isFinite(Number(payload.company_id)) ? Number(payload.company_id) : null,
          payload.encode_com_id,
          detail.company_name,
          region.province,
          region.city,
          region.province ? 'China' : null,
          JSON.stringify(detail.main_products),
          JSON.stringify(detail.business_types),
          JSON.stringify(detail.system_certifications),
          membership.tier,
          membership.raw_cs_level,
          membership.since_year,
          payload.stars,
          audited === null ? null : audited ? 1 : 0,
          detail.employees ?? null,
          null,
          null,
          payload.company_url,
          payload.company_info_url,
          now,
          now,
          JSON.stringify(rawItem).slice(0, 65536),
        );
    } catch (e) {
      this.cacheWriteWarning(warnings, 'companies', e);
    }

    const detailRow: Record<string, unknown> = {
      account: canonicalAccount,
      company_name: detail.company_name,
      address: detail.address,
      address_city: region.city,
      address_province: region.province,
      established_at: detail.established_at,
      employees: detail.employees,
      employee_text: detail.employee_text,
      business_types_json: JSON.stringify(detail.business_types),
      main_products_json: JSON.stringify(detail.main_products),
      system_certifications_json: JSON.stringify(detail.system_certifications),
      management_certifications_json: JSON.stringify(payload.system_certifications),
      rd_capacity_json: JSON.stringify(payload.rd),
      online_trade_able: payload.online_trade_able === null ? null : payload.online_trade_able ? 1 : 0,
      leading_factory: payload.leading_factory === null ? null : payload.leading_factory ? 1 : 0,
      logo_url: payload.logo_url,
      rating_value: detail.rating_value,
      rating_display: detail.rating_display,
      review_list_url: detail.review_list_url,
      sgs_member: detail.sgs_member === null ? null : detail.sgs_member ? 1 : 0,
      field_sources_json: JSON.stringify({ membership: 'detail_ssr', employees: 'html', address: 'html' }),
      availability_json: JSON.stringify(availability),
      ssr_raw_json: JSON.stringify(payload.ssr_raw ?? null).slice(0, 65536),
      minisite_url: `https://${canonicalAccount}.en.made-in-china.com`,
      fetched_at: now,
      expires_at: detailExpires,
      source: 'json',
      result_status: 'success',
      warnings_json: '[]',
      last_request_id: requestId,
    };
    this.insertOrReplace('company_details', detailRow, warnings);

    const membershipRow: Record<string, unknown> = {
      account: canonicalAccount,
      tier: membership.tier,
      raw_cs_level: membership.raw_cs_level,
      raw_member_level: membership.raw_member_level,
      since_year: membership.since_year,
      evidence_json: JSON.stringify(membership.evidence),
      confidence: membership.confidence,
      member_type: null,
      is_diamond_member: payload.is_diamond_member === null ? null : payload.is_diamond_member ? 1 : 0,
      tier_source:
        membership.raw_member_level !== null ? 'detail_ssr' : membership.tier !== 'unknown' ? 'list_json' : 'none',
      has_conflict: membershipConflict ? 1 : 0,
      external_customer_tier: null,
      updated_at: now,
    };
    this.insertOrReplace('membership_info', membershipRow, warnings);
  }

  private writeEnrichRow(
    key: IncludeKey,
    account: string,
    obj: { value: unknown; row: Record<string, unknown> },
    warnings: Warning[],
  ): void {
    const now = nowSeconds();
    const ttl = Number(this.cfg.cache[TTL_KEY[key]] ?? 0);
    const base: Record<string, unknown> = {
      account,
      source: 'json',
      fetched_at: now,
      expires_at: now + ttl,
      result_status: 'success',
      warnings_json: '[]',
    };
    if (key === 'audit') {
      const row: Record<string, unknown> = {
        ...base,
        audited: obj.row['audited'] ?? null,
        sections_json: obj.row['sections_json'] ?? '[]',
        audited_section_count: obj.row['audited_section_count'] ?? 0,
        agency: null,
        report_no: null,
        verify_url: null,
        verified_items_count: null,
        evidence_json: '[]',
      };
      this.insertOrReplace('audit_info', row, warnings);
      return;
    }
    if (key === 'response') {
      this.insertOrReplace('response_info', { ...base, ...obj.row }, warnings);
      return;
    }
    if (key === 'contacts') {
      this.insertOrReplace('contact_info', { ...base, ...obj.row }, warnings);
      return;
    }
    this.insertOrReplace('review_summary', { ...base, ...obj.row }, warnings);
  }

  private insertOrReplace(table: string, row: Record<string, unknown>, warnings: Warning[]): void {
    const columns = Object.keys(row);
    const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
    try {
      this.cache.db.prepare(sql).run(...columns.map((c) => normalizeSqlValue(row[c])));
    } catch (e) {
      this.cacheWriteWarning(warnings, table, e);
    }
  }

  /** 缓存写失败不阻塞响应；缺列/缺表信息要清楚（便于 schema 升级排障）。 */
  private cacheWriteWarning(warnings: Warning[], table: string, e: unknown): void {
    const message = e instanceof Error ? e.message : String(e);
    const missingColumn = /no column named ([\w]+)/i.exec(message)?.[1] ?? null;
    const missingTable = /no such table:?\s*([\w]+)/i.exec(message)?.[1] ?? null;
    const details: Record<string, unknown> = { table, error: message };
    if (missingColumn) details['missing_column'] = missingColumn;
    if (missingTable) details['missing_table'] = missingTable;
    if (!this.cfg.cache.enabled) return; // 仅 --no-cache 场景：本来就不写
    this.logger.error('company: failed to write cache row', { table, error: message, missing_column: missingColumn });
    warnings.push({ code: 'CACHE_WRITE_FAILED', message: `failed to write cache table ${table}`, details });
  }

  private baseAvailability(detail: DetailSnapshot): AvailabilityItem[] {
    const out: AvailabilityItem[] = [];
    if (detail.address === null) out.push({ field: 'address', reason: 'not_provided_by_supplier' });
    if (detail.established_at === null) out.push({ field: 'established_at', reason: 'not_provided_by_supplier' });
    if (detail.employees === null) out.push({ field: 'employees', reason: 'not_provided_by_supplier' });
    return out;
  }
}

/** 从详情地址尾部解析城市/省（内部派生，仅用于缓存列与 ADDRESS_MISMATCH 校验，不覆盖列表值）。 */
export function parseAddressRegion(address: string | null | undefined): { province: string | null; city: string | null } {
  if (!address) return { province: null, city: null };
  const lower = address.toLowerCase();
  for (const p of allProvinces()) {
    const zh = (p.name_zh ?? '').toLowerCase();
    if (!lower.includes(p.name.toLowerCase()) && !(zh && lower.includes(zh))) continue;
    let city: string | null = null;
    for (const c of p.cities ?? []) {
      if (lower.includes(c.name.toLowerCase())) {
        city = c.name;
        break;
      }
    }
    return { province: p.name, city };
  }
  return { province: null, city: null };
}

/** 无列表缓存时的公司行替身（--no-cache / 详情直查）。 */
function rowFromPayload(payload: CompanyDetailPayload): CompanyRow {
  return {
    account: payload.account,
    company_id: Number.isFinite(Number(payload.company_id)) ? Number(payload.company_id) : null,
    encode_com_id: payload.encode_com_id,
    company_name: payload.company_name,
    province: null,
    city: null,
    country: null,
    main_products_json: JSON.stringify(payload.main_products),
    business_types_json: JSON.stringify(payload.business_types),
    system_certifications_json: JSON.stringify(payload.system_certifications),
    membership_tier: 'unknown',
    raw_cs_level: null,
    since_year: null,
    capability_stars: payload.stars,
    audited: null,
    employees: payload.employees,
    turnover: null,
    plant_area: null,
    company_url: payload.company_url,
    company_info_url: payload.company_info_url,
  };
}

const ENRICH_TABLE: Record<IncludeKey, string> = {
  audit: 'audit_info',
  response: 'response_info',
  contacts: 'contact_info',
  reviews: 'review_summary',
};

function strOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normalizeSqlValue(v: unknown): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return JSON.stringify(v);
}

function snapshotFromPayload(payload: CompanyDetailPayload): DetailSnapshot {
  return {
    source: payload.source ?? 'json',
    company_name: payload.company_name,
    address: payload.address,
    established_at: payload.establishment,
    employees: payload.employees,
    employee_text: payload.employee_text,
    business_types: payload.business_types,
    main_products: payload.main_products,
    system_certifications: payload.system_certifications,
    rating_value: parseRatingDisplay(payload.rating_display),
    rating_display: payload.rating_display,
    review_list_url: payload.review_list_url,
    sgs_member: payload.sgs_member,
    fetched_at: nowSeconds(),
  };
}

function snapshotFromDetailRow(row: CompanyDetailsRow): DetailSnapshot {
  return {
    company_name: row.company_name,
    address: strOrNull(row.address),
    established_at: strOrNull(row.established_at),
    employees: row.employees === null || row.employees === undefined ? null : Number(row.employees),
    employee_text: strOrNull(row.employee_text),
    business_types: parseJsonArray<string>(row.business_types_json),
    main_products: parseJsonArray<string>(row.main_products_json),
    system_certifications: parseJsonArray<string>(row.system_certifications_json),
    rating_value: row.rating_value === null ? null : Number(row.rating_value),
    rating_display: strOrNull(row.rating_display),
    review_list_url: strOrNull(row.review_list_url),
    sgs_member: cellBool(row.sgs_member),
    fetched_at: row.fetched_at,
  };
}
