import { AppError } from '../errors.js';
import type { HttpClient, HttpResponse } from '../http/client.js';
import type { Logger } from '../logger.js';

/** m 站（移动站）主数据通道：docs/03 §8.4、research/upstream-api.md §3.4。 */
export const MOBILE_COMPANY_ORIGIN = 'https://m.made-in-china.com';

/** account 允许字符集（与 docs/03 §8.2 的 `INVALID_ACCOUNT` 规则一致）。 */
export const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/** 数字 comId（上游 `/company/<digits>` 301 → `/company-<account>/`）。 */
export const COM_ID_RE = /^\d+$/;

export interface AuditLogoSignals {
  show_audit_logo: boolean | null;
  logo_text: string | null;
}

/**
 * 归一化后的 m 站公司详情（基础通道）。
 * 字段全部来自 `info.html`：`ssrData` JSON + 正文标签文本（员工数/地址/认证体系）。
 */
export interface CompanyDetailPayload {
  account: string;
  company_id: string;
  encode_com_id: string | null;
  company_name: string;
  member_level: string | null;
  member_since: string | null;
  is_diamond_member: boolean | null;
  sgs_member: boolean | null;
  audit_logo: AuditLogoSignals | null;
  main_products: string[];
  business_types: string[];
  /** ssrData.companyInfo.content.establishment（YYYY-MM-DD，空串→null） */
  establishment: string | null;
  /** 正文 `Year of Establishment`（ssrData 缺失时的兜底） */
  body_establishment: string | null;
  rating_display: string | null;
  review_list_url: string | null;
  stars: number | null;
  rd: string[];
  online_trade_able: boolean | null;
  leading_factory: boolean | null;
  logo_url: string | null;
  company_url: string | null;
  company_info_url: string | null;
  /** info.html 正文 `Address` */
  address: string | null;
  /** info.html 正文 `Number of Employees` */
  employees: number | null;
  /** 正文员工数原文（如 "21" / "80"），保留证据 */
  employee_text: string | null;
  /** info.html 正文 `Management System Certification` 切分结果 */
  system_certifications: string[];
  /** 原始 ssrData JSON（可截断后落库） */
  ssr_raw: unknown;
  source: 'json';
}

export interface DetailRequestOptions {
  /** 验证码/JS challenge 求解器；由会话层注入（M3）。未注入时抛 CAPTCHA_REQUIRED。 */
  onCaptcha?: (srcUrl: string) => Promise<void>;
}

/** 上游正文中可能出现的字段标签（用于截断长文本）。 */
const BODY_LABELS = [
  'Business Type',
  'R&D Capacity',
  'Main Products',
  'Year of Establishment',
  'Number of Employees',
  'Management System Certification',
  'Address',
  'Rating',
  'Company Overview',
  'Hot Products',
  'Categories',
  'Contact Us',
] as const;

const NEXT_LABEL_RE = new RegExp(`\\s(?:${BODY_LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*[:：]`, 'i');

/** EdgeOne JS challenge / Focus Captcha 直出页的判别（403/200 伪装）。 */
export function isChallengePage(res: Pick<HttpResponse, 'body'>): boolean {
  const body = res.body ?? '';
  if (body.length >= 8000) return false;
  return (
    /__tst_status|EO_Bot_Ssid/.test(body) ||
    /captcha\.made-in-china\.com|verification\.html/i.test(body) ||
    /Please complete the following operation|Swipe right to complete verification/i.test(body)
  );
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&copy;': ' ',
    '&reg;': ' ',
    '&hellip;': '…',
    '&mdash;': '—',
    '&ndash;': '–',
  };
  let out = s;
  for (const [k, v] of Object.entries(named)) out = out.split(k).join(v);
  out = out.replace(/&#(\d+);/g, (_, n: string) => {
    const code = Number(n);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  });
  out = out.replace(/&#x([0-9a-f]+);/gi, (_, n: string) => {
    const code = Number.parseInt(n, 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  });
  return out;
}

/**
 * 把 info.html 转为「一行一个字段」的文本：
 * script/style 剔除，块级标签换行，行内标签保留空格，HTML 实体解码。
 */
export function htmlToText(html: string): string {
  let s = html.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(
    /<\/(?:div|p|li|ul|ol|dl|dt|dd|td|th|tr|table|tbody|thead|tfoot|section|article|header|footer|h[1-6]|form|label)\s*>/gi,
    '\n',
  );
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0\ufeff]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** 从文本行中定位 `<label>: <value>`；标签在行尾时取下一行。 */
function findLabeledValue(text: string, labels: readonly string[]): string | null {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|\\n|[ \\t])${escaped}[ \\t]*[:：]?[ \\t]*([^\\n]*)`, 'i');
    const m = re.exec(text);
    if (!m) continue;
    let value = (m[1] ?? '').trim();
    if (!value) {
      const rest = text.slice(m.index + m[0].length);
      value = (rest.split('\n')[1] ?? '').trim();
    }
    if (value) return value;
  }
  return null;
}

/** 截断到下一个已知标签之前（正文可能被压成一行，如某些移动端模板）。 */
function cutAtNextLabel(value: string): string {
  const m = NEXT_LABEL_RE.exec(' ' + value);
  if (!m) return value.trim();
  return value.slice(0, Math.max(0, m.index - 1)).trim();
}

export function normalizeEstablishment(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = /((?:19|20)\d{2})(?:[-/.](\d{1,2}))?(?:[-/.](\d{1,2}))?/.exec(s);
  if (!m) return null;
  const year = m[1]!;
  const month = m[2] ? m[2].padStart(2, '0') : null;
  const day = m[3] ? m[3].padStart(2, '0') : null;
  if (month && day) return `${year}-${month}-${day}`;
  if (month) return `${year}-${month}`;
  return year;
}

export function parseEmployeeCount(text: string | null): { employees: number | null; text: string | null } {
  if (!text) return { employees: null, text: null };
  const m = /(\d[\d,]{0,8})/.exec(text);
  if (!m) return { employees: null, text: text.trim() || null };
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) return { employees: null, text: text.trim() || null };
  return { employees: Math.trunc(n), text: text.trim() };
}

const CERT_HINT_RE = /(ISO|IATF|BSCI|CE|FDA|LFGB|HACCP|BRC|GMP|OHSAS|SEDEX|SA\s?8000|ASME|RoHS|REACH|FSC|ANSI|ASTM|EN\s?\d|DIN|JIS|SGS|TUV|TÜV|EICC|WRAP|AIB|LEED|BREEAM|PAS|QSR|QQS|IFS)/i;

export function splitCertifications(text: string | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawPart of text.split(/[,，;；、|]/)) {
    for (const andPart of rawPart.split(/\s+and\s+/i)) {
      const s = andPart.replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '');
      if (!s) continue;
      // drop sentence-like fragments (the mobile page sometimes flattens a long paragraph)
      if (s.length > 40 || /\.\s/.test(s)) continue;
      if (/\.(?:\s|$)/.test(s) && !CERT_HINT_RE.test(s)) continue;
      if (!CERT_HINT_RE.test(s) && s.length > 20 && !/^others?$/i.test(s)) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= 15) return out;
    }
  }
  return out;
}

export interface CompanyBodyFields {
  address: string | null;
  employees: number | null;
  employee_text: string | null;
  establishment: string | null;
  system_certifications: string[];
}

/** 从 info.html 正文提取员工数/地址/认证体系/成立年（research/upstream-api.md §3.4）。 */
export function extractBodyFields(html: string): CompanyBodyFields {
  const text = htmlToText(html);
  const employeesRaw = findLabeledValue(text, ['Number of Employees', 'Employees']);
  const { employees, text: employeeText } = parseEmployeeCount(employeesRaw ? cutAtNextLabel(employeesRaw) : null);
  const addressRaw = findLabeledValue(text, ['Address']);
  const address = addressRaw ? cutAtNextLabel(addressRaw) || null : null;
  const certRaw = findLabeledValue(text, ['Management System Certification', 'Mgmt. Certification', 'Certifications']);
  const establishmentRaw = findLabeledValue(text, ['Year of Establishment']);
  return {
    address,
    employees,
    employee_text: employeeText,
    establishment: normalizeEstablishment(establishmentRaw),
    system_certifications: splitCertifications(certRaw ? cutAtNextLabel(certRaw) : null),
  };
}

const SSR_DATA_RE = [
  /<script\b[^>]*\bid\s*=\s*["']ssrData["'][^>]*>([\s\S]*?)<\/script>/i,
  /<script\b[^>]*\btype\s*=\s*["']text\/json["'][^>]*\bid\s*=\s*["']ssrData["'][^>]*>([\s\S]*?)<\/script>/i,
];

/** 取页内 `<script type="text/json" id="ssrData">` 文本并 JSON.parse。 */
export function parseSsrData(html: string): unknown {
  let raw: string | null = null;
  for (const re of SSR_DATA_RE) {
    const m = re.exec(html);
    if (m && m[1] !== undefined) {
      raw = m[1];
      break;
    }
  }
  if (raw === null) {
    throw new AppError('UPSTREAM_CHANGED', 'company info.html has no ssrData script (upstream structure changed?)', {
      reason: 'SSR_DATA_MISSING',
      body_bytes: html.length,
    });
  }
  try {
    return JSON.parse(raw.trim());
  } catch (e) {
    throw new AppError(
      'PARSE_ERROR',
      'failed to JSON.parse ssrData from company info.html',
      { reason: 'SSR_DATA_INVALID_JSON', body_bytes: html.length, snippet: raw.slice(0, 200) },
      { cause: e },
    );
  }
}

function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function boolOrNull(v: unknown): boolean | null {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return null;
}

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? '').trim()).filter((x) => x.length > 0);
}

function starsFromSymbol(symbol: Record<string, unknown> | null): number | null {
  if (!symbol) return null;
  const intStars = intOrNull(symbol['intStars']);
  if (intStars !== null && intStars >= 0 && intStars <= 5) return intStars;
  const stars = intOrNull(symbol['stars']);
  if (stars !== null && stars >= 0 && stars <= 5) return stars;
  return null;
}

/**
 * 解析 `info.html` → `CompanyDetailPayload`。
 * 契约校验（docs/05 §4.7）：ssrData 必须存在，`companyInfo.code===0` 且 `content.comName` 非空。
 */
export function parseCompanyDetailHtml(html: string, requestedAccount?: string): CompanyDetailPayload {
  const ssr = record(parseSsrData(html));
  if (!ssr) {
    throw new AppError('UPSTREAM_CHANGED', 'ssrData root is not an object', { reason: 'SSR_DATA_SHAPE' });
  }
  const companyInfo = record(ssr['companyInfo']);
  const content = companyInfo ? record(companyInfo['content']) : null;
  if (!companyInfo || !content) {
    throw new AppError('UPSTREAM_CHANGED', 'ssrData.companyInfo.content missing', {
      reason: 'COMPANY_INFO_MISSING',
      ssr_keys: Object.keys(ssr).slice(0, 20),
    });
  }
  const code = intOrNull(companyInfo['code']);
  if (code !== 0) {
    throw new AppError('UPSTREAM_CHANGED', 'ssrData.companyInfo.code !== 0', {
      reason: 'COMPANY_INFO_ERROR',
      code,
      err: strOrNull(companyInfo['err']),
    });
  }
  const companyName = strOrNull(content['comName']);
  if (!companyName) {
    throw new AppError('UPSTREAM_CHANGED', 'ssrData.companyInfo.content.comName is empty', {
      reason: 'COMPANY_NAME_MISSING',
    });
  }
  const body = extractBodyFields(html);
  const account =
    strOrNull(ssr['logUsername']) ??
    (requestedAccount ? requestedAccount.trim().toLowerCase() : null) ??
    '';
  if (!account) {
    throw new AppError('UPSTREAM_CHANGED', 'ssrData.logUsername missing', { reason: 'COMPANY_ACCOUNT_MISSING' });
  }
  const auditLogoRaw = record(content['auditReportLogo']);
  const auditLogo: AuditLogoSignals | null = auditLogoRaw
    ? {
        show_audit_logo: boolOrNull(auditLogoRaw['showAuditLogo']),
        logo_text: strOrNull(auditLogoRaw['logoText']),
      }
    : null;
  const reviewStats = record(content['reviewStatistics']);
  const rating = reviewStats ? strOrNull(reviewStats['rating']) : null;
  const linkConfig = record(ssr['linkConfig']);
  const companyId = strOrNull(ssr['comId']) ?? strOrNull(content['comId']) ?? '';
  const companyUrl =
    (linkConfig ? strOrNull(linkConfig['swrHomepageUrl']) : null) ??
    `${MOBILE_COMPANY_ORIGIN}/company-${account}/`;
  const companyInfoUrl =
    (linkConfig ? strOrNull(linkConfig['swrCompanyInfoUrl']) : null) ??
    `${MOBILE_COMPANY_ORIGIN}/company-${account}/info.html`;
  const ssrEstablishment = normalizeEstablishment(content['establishment']);

  return {
    account,
    company_id: companyId,
    encode_com_id: strOrNull(content['comId']),
    company_name: companyName,
    member_level: strOrNull(content['memberLevel']),
    member_since: strOrNull(content['memberSince']),
    is_diamond_member: boolOrNull(ssr['isDiamondMember']),
    sgs_member: boolOrNull(content['sgsMember']),
    audit_logo: auditLogo,
    main_products: strArray(content['mainProducts']),
    business_types: strArray(content['businessTypes']),
    establishment: ssrEstablishment ?? body.establishment,
    body_establishment: body.establishment,
    rating_display: rating,
    review_list_url: reviewStats ? strOrNull(reviewStats['reviewListUrl']) : null,
    stars: starsFromSymbol(record(content['companySymbol'])),
    rd: strArray(content['rd']),
    online_trade_able: boolOrNull(content['onlineTradeAble']),
    leading_factory: boolOrNull(ssr['leadingFactory']),
    logo_url: strOrNull(content['logoUrl']),
    company_url: companyUrl,
    company_info_url: companyInfoUrl,
    address: body.address,
    employees: body.employees,
    employee_text: body.employee_text,
    system_certifications: body.system_certifications,
    ssr_raw: ssr,
    source: 'json',
  };
}

/** 从 URL 提取 account：m 站 `/company-<account>/...`、`/company/<digits>`、`<account>.en.made-in-china.com`。 */
export function parseAccountFromUrl(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === 'm.made-in-china.com') {
    const m = /^\/company-([A-Za-z0-9._-]+)(?:\/|$)/.exec(u.pathname);
    if (m && m[1]) return m[1].toLowerCase();
    return null;
  }
  if (host.endsWith('.en.made-in-china.com')) {
    const sub = host.slice(0, -'.en.made-in-china.com'.length);
    if (sub && !sub.includes('.')) return sub.toLowerCase();
    const m = /^\/company-([A-Za-z0-9._-]+)(?:\/|$)/.exec(u.pathname);
    if (m && m[1]) return m[1].toLowerCase();
    return null;
  }
  if (host.endsWith('.made-in-china.com')) {
    const sub = host.slice(0, -'.made-in-china.com'.length);
    if (sub && !sub.includes('.') && !['www', 'm', 'data'].includes(sub)) return sub.toLowerCase();
  }
  return null;
}

function extractLogUsernameFromHtml(html: string): string | null {
  try {
    const ssr = record(parseSsrData(html));
    return ssr ? strOrNull(ssr['logUsername']) : null;
  } catch {
    return null;
  }
}

export class CompanyDetailApi {
  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  infoUrl(account: string): string {
    return `${MOBILE_COMPANY_ORIGIN}/company-${account}/info.html`;
  }

  homeUrl(account: string): string {
    return `${MOBILE_COMPANY_ORIGIN}/company-${account}/`;
  }

  /** 抓取并解析 `company-<account>/info.html`。 */
  async fetchDetail(account: string, opts: DetailRequestOptions = {}): Promise<CompanyDetailPayload> {
    const url = this.infoUrl(account);
    const requestOpts = {
      host: 'mobile' as const,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: MOBILE_COMPANY_ORIGIN + '/',
      },
      referer: MOBILE_COMPANY_ORIGIN + '/',
      retries: 1,
      onCaptcha: opts.onCaptcha,
    };
    let res = await this.http.request(url, requestOpts);
    if (isChallengePage(res) && opts.onCaptcha) {
      this.logger.info('company: challenge page detected, invoking injected captcha solver', { url });
      await opts.onCaptcha(url);
      res = await this.http.request(url, requestOpts);
    }
    if (isChallengePage(res)) {
      throw new AppError('CAPTCHA_REQUIRED', 'company page is behind an EdgeOne/Focus challenge', {
        stage: 'captcha',
        reason: 'COMPANY_PAGE_CHALLENGE',
        src_url: url,
        bytes: res.body.length,
      });
    }
    if (res.status === 404) {
      throw new AppError('NOT_FOUND', `company not found: ${account}`, {
        resource: 'company',
        input: account,
        reason: 'ACCOUNT_NOT_FOUND',
      });
    }
    if (res.status !== 200) {
      throw new AppError('UPSTREAM_UNAVAILABLE', `company info.html HTTP ${res.status}`, {
        url,
        status: res.status,
      });
    }
    const payload = parseCompanyDetailHtml(res.body, account);
    this.logger.debug('company: parsed info.html', {
      account: payload.account,
      bytes: res.body.length,
      has_member_level: payload.member_level !== null,
      employees: payload.employees,
    });
    return payload;
  }

  /**
   * 数字 comId → account：`GET m/company/<comId>` 的 301 `Location: /company-<account>/`。
   * HttpClient 会把 301 跟随到目标页（或对数字目标直接返回 3xx + finalUrl），两种形态都从 finalUrl 解析。
   */
  async resolveAccountByComId(comId: string, opts: DetailRequestOptions = {}): Promise<string> {
    const url = `${MOBILE_COMPANY_ORIGIN}/company/${encodeURIComponent(comId)}`;
    const requestOpts = {
      host: 'mobile' as const,
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      referer: MOBILE_COMPANY_ORIGIN + '/',
      retries: 0,
      onCaptcha: opts.onCaptcha,
    };
    let res = await this.http.request(url, requestOpts);
    if (isChallengePage(res) && opts.onCaptcha) {
      await opts.onCaptcha(url);
      res = await this.http.request(url, requestOpts);
    }
    if (isChallengePage(res)) {
      throw new AppError('CAPTCHA_REQUIRED', 'comId resolver is behind an EdgeOne/Focus challenge', {
        stage: 'captcha',
        reason: 'COM_ID_RESOLVER_CHALLENGE',
        src_url: url,
      });
    }
    if (res.status === 404) {
      throw new AppError('NOT_FOUND', `comId not found: ${comId}`, {
        resource: 'company',
        input: comId,
        reason: 'COM_ID_UNRESOLVED',
      });
    }
    const fromUrl = parseAccountFromUrl(res.finalUrl);
    const fromBody = res.status === 200 ? extractLogUsernameFromHtml(res.body) : null;
    const account = fromUrl ?? (fromBody ? fromBody.toLowerCase() : null);
    if (!account) {
      throw new AppError('NOT_FOUND', `cannot resolve account from comId ${comId}`, {
        resource: 'company',
        input: comId,
        reason: 'COM_ID_UNRESOLVED',
        status: res.status,
        final_url: res.finalUrl,
      });
    }
    this.logger.debug('company: resolved comId -> account', { comId, account, status: res.status });
    return account;
  }
}
