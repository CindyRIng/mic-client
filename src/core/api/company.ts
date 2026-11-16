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
  source: 'json' | 'html' | 'browser';
}

export interface DetailRequestOptions {
  /** 验证码/JS challenge 求解器；由会话层注入（M3）。未注入时抛 CAPTCHA_REQUIRED。 */
  onCaptcha?: (srcUrl: string) => Promise<void>;
  /** 浏览器兜底：当 HTTP 通道仍被挑战时，用已验证的浏览器会话取回页面 HTML。 */
  browserHtml?: (url: string) => Promise<string>;
}

/** 上游正文中可能出现的字段标签（用于截断长文本）。 */
const BODY_LABELS = [
  'Business Type',
  'R&D Capacity',
  'Main Products',
  'Year of Establishment',
  'Number of Employees',
  'Management System Certification',
  'Product Certification',
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
      let s = andPart.replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '');
      if (!s) continue;
      // drop sentence-like fragments (the mobile page sometimes flattens a long paragraph)
      if (s.length > 40 || /\.\s/.test(s)) continue;
      // strip trailing noise words ("BSCI audits", "ISO 9001 certification")
      s = s.replace(/\s+(?:audits?|certifi(?:cation|cates?)|certified|standards?)$/i, '').trim();
      // only keep tokens that clearly look like certification names
      if (!CERT_HINT_RE.test(s) && !/^others?$/i.test(s)) continue;
      if (!/^(?:ISO|IATF|BSCI|CE|FDA|LFGB|HACCP|BRC|GMP|OHSAS|SEDEX|SA\s?8000|ASME|RoHS|REACH|FSC|ANSI|ASTM|EN|DIN|JIS|SGS|TUV|TÜV|EICC|WRAP|AIB|LEED|BREEAM|PAS|QSR|QQS|IFS|Others)/i.test(s)) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(s);
      if (out.length >= 15) return out;
    }
  }
  return out;
}

const CERT_TOKEN_RE =
  /\b(ISO\s?\d{4,5}(?::\d{4})?|IATF\s?16949|BSCI|CE|FDA|LFGB|HACCP|BRC|GMP|OHSAS\s?\d{2,5}|SEDEX|SA\s?8000|ASME|RoHS|REACH|FSC|EICC|WRAP|AIB|LEED|BREEAM)\b/gi;

function canonicalCertToken(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  const iso = /^ISO\s?(\d{4,5})(?::(\d{4}))?$/i.exec(t);
  if (iso) return `ISO ${iso[1]}${iso[2] ? `:${iso[2]}` : ''}`;
  if (/^1S0\s?\d/i.test(t)) return t.replace(/^1S0/i, 'ISO');
  return t.toUpperCase() === 'CE' ? 'CE' : t;
}

/** Extract certification names mentioned in the company description (bounded context). */
export function extractCertificationsFromText(text: string | null): string[] {
  if (!text) return [];
  const normalized = text.replace(/\b1S0(?=\s?\d)/g, 'ISO');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of normalized.matchAll(CERT_TOKEN_RE)) {
    const raw = m[0] ?? '';
    const idx = m.index ?? 0;
    const context = normalized.slice(Math.max(0, idx - 120), idx + raw.length + 120);
    if (!/certif|passed|audit|inspection|standard|compliance/i.test(context)) continue;
    const token = canonicalCertToken(raw);
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= 12) break;
  }
  return out;
}

export interface CompanyBodyFields {
  address: string | null;
  employees: number | null;
  employee_text: string | null;
  establishment: string | null;
  system_certifications: string[];
  main_products: string[];
  business_types: string[];
}

function splitCommaList(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(/[,，;；]/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** 从 info.html 正文提取员工数/地址/认证体系/成立年（research/upstream-api.md §3.4）。 */
export function extractBodyFields(html: string): CompanyBodyFields {
  const text = htmlToText(html);
  const employeesRaw = findLabeledValue(text, ['Number of Employees', 'Employees']);
  const { employees, text: employeeText } = parseEmployeeCount(employeesRaw ? cutAtNextLabel(employeesRaw) : null);
  const addressRaw = findLabeledValue(text, ['Address']);
  const address = addressRaw ? cutAtNextLabel(addressRaw) || null : null;
  const certRaw = findLabeledValue(text, [
    'Management System Certification',
    'Product Certification',
    'Mgmt. Certification',
    'Certifications',
  ]);
  const mainProductsRaw = findLabeledValue(text, ['Main Products']);
  const businessTypesRaw = findLabeledValue(text, ['Business Type']);
  const establishmentRaw = findLabeledValue(text, ['Year of Establishment']);
  const structuredCerts = splitCertifications(certRaw ? cutAtNextLabel(certRaw) : null);
  const textCerts = extractCertificationsFromText(text);
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const c of [...structuredCerts, ...textCerts]) {
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return {
    address,
    employees,
    employee_text: employeeText,
    establishment: normalizeEstablishment(establishmentRaw),
    system_certifications: merged.slice(0, 15),
    main_products: splitCommaList(mainProductsRaw ? cutAtNextLabel(mainProductsRaw) : null).slice(0, 50),
    business_types: splitCommaList(businessTypesRaw ? cutAtNextLabel(businessTypesRaw) : null).slice(0, 20),
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

function companyNameFromHtml(html: string): string | null {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title) {
    let name = stripTags(title).split('|')[0]?.trim() ?? '';
    if (name.includes(' - ')) name = name.split(' - ').pop()?.trim() ?? name;
    if (name) return name;
  }
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  return h1 ? stripTags(h1) || null : null;
}

/**
 * 解析 `info.html` → `CompanyDetailPayload`。
 * ssrData 必须存在且 `companyInfo.code===0`；部分页面的 `content.comName`/`mainProducts`
 * 为空（实测 transoceanmetal），此时回退到 `<title>` 与正文标签，避免整条详情失败。
 */
export function parseCompanyDetailHtml(
  html: string,
  requestedAccount?: string,
  source: 'json' | 'html' | 'browser' = 'json',
): CompanyDetailPayload {
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
  const body = extractBodyFields(html);
  const companyName =
    strOrNull(content['comName']) ??
    strOrNull(content['companyName']) ??
    companyNameFromHtml(html) ??
    requestedAccount ??
    '';
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
    main_products: strArray(content['mainProducts']).length ? strArray(content['mainProducts']) : body.main_products,
    business_types: strArray(content['businessTypes']).length ? strArray(content['businessTypes']) : body.business_types,
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
    source,
  };
}

/** 免费会员没有移动站详情：`info.html` 会 301 到桌面 showroom/子域名页（无 ssrData）。 */
export function isDesktopCompanyHtml(html: string): boolean {
  if (html.includes('ssrData')) return false;
  return /made-in-china\.com\/showroom\//i.test(html) || /class="[^"]*(?:showroom|company-home)/i.test(html) || /Main Products\s*:/i.test(html);
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Parse the desktop showroom page used by free members (no mobile ssrData).
 * Available fields: company name, address, account-registered year, business type,
 * main products, management-system certifications, membership/audited badges,
 * encodeComId. Employee count / established date are not published on this page
 * and stay null (surfaced via `availability`).
 */
export function parseDesktopCompanyHtml(
  html: string,
  requestedAccount?: string,
  source: 'json' | 'html' | 'browser' = 'html',
  sourceUrl: string | null = null,
): CompanyDetailPayload {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const account =
    requestedAccount ?? parseAccountFromUrl(sourceUrl ?? '') ?? null;
  if (!h1 && !title) {
    throw new AppError('UPSTREAM_CHANGED', 'desktop company page has neither h1 nor title', {
      reason: 'DESKTOP_COMPANY_PAGE_INVALID',
      bytes: html.length,
    });
  }
  const name = stripTags((h1?.[1] ?? title?.[1] ?? '').split(' - ')[0] ?? '').trim();
  const start = h1 ? html.indexOf(h1[0]) : 0;
  const windowHtml = html.slice(Math.max(0, start), Math.max(0, start) + 26000);
  const text = htmlToText(windowHtml);
  const windowLabels = [
    'Address',
    'Account Registered in',
    'Business Range',
    'Management System Certification',
    'Business Type',
    'Main Products',
    'More',
    'Company Introduction',
    'Production Capacity',
  ];
  const labelValue = (label: string, next: string[]): string | null => {
    const re = new RegExp(`(?:^|\\s)${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'i');
    const m = re.exec(text);
    if (!m) return null;
    const from = m.index + m[0].length;
    let to = text.length;
    for (const n of next) {
      const i = text.indexOf(n, from);
      if (i >= 0 && i < to) to = i;
    }
    const v = text.slice(from, to).replace(/\s+/g, ' ').trim();
    return v || null;
  };
  const address = labelValue('Address', ['Account Registered in', 'Business Range', ...windowLabels.filter((x) => x !== 'Address')]);
  const registered = labelValue('Account Registered in', ['Business Range', 'Management System Certification', 'Business Type', 'Main Products', 'More']);
  const certRaw = labelValue('Management System Certification', ['Business Type', 'Main Products', 'More', 'Company Introduction']);
  const businessRaw = labelValue('Business Type', ['Main Products', 'More', 'Company Introduction']);
  const productsRaw = labelValue('Main Products', ['More', 'Company Introduction', 'Production Capacity']);
  const registeredYear = registered ? /((?:19|20)\d{2})/.exec(registered)?.[1] ?? null : null;

  const h1Block = text.slice(0, Math.min(text.length, 2500));
  const memberLevel = /Diamond\s+Member/i.test(h1Block) ? 'diamond' : /Gold\s+Member/i.test(h1Block) ? 'gold' : null;
  const audited = /Audited\s+Supplier/i.test(h1Block) ? true : null;
  const encodeMatch = /<input[^>]*name=["']comId["'][^>]*value=["']([^"']+)["']/i.exec(html) ?? /value=["']([^"']+)["'][^>]*name=["']comId["']/i.exec(html);
  const encodeComId = encodeMatch?.[1] ? decodeEntities(encodeMatch[1]) : null;
  const splitComma = (v: string | null): string[] =>
    v ? v.split(/[,，;；]/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 50) : [];

  return {
    account: account ?? requestedAccount ?? '',
    company_id: '',
    encode_com_id: encodeComId,
    company_name: name,
    member_level: memberLevel,
    member_since: registeredYear,
    is_diamond_member: memberLevel === 'diamond' ? true : null,
    sgs_member: audited,
    audit_logo: null,
    main_products: splitComma(productsRaw),
    business_types: splitComma(businessRaw),
    establishment: null,
    body_establishment: null,
    rating_display: null,
    review_list_url: null,
    stars: null,
    rd: [],
    online_trade_able: null,
    leading_factory: null,
    logo_url: null,
    company_url: sourceUrl,
    company_info_url: account ? `https://m.made-in-china.com/company-${account}/info.html` : null,
    address,
    employees: null,
    employee_text: null,
    system_certifications: splitComma(certRaw),
    ssr_raw: null,
    source,
  };
}

/** Parse mobile ssrData first; fall back to desktop showroom HTML (free members). */
export function parseAnyCompanyHtml(
  html: string,
  requestedAccount?: string,
  source: 'json' | 'html' | 'browser' = 'json',
  sourceUrl: string | null = null,
): CompanyDetailPayload {
  if (html.includes('ssrData')) {
    return parseCompanyDetailHtml(html, requestedAccount, source);
  }
  if (isDesktopCompanyHtml(html)) {
    return parseDesktopCompanyHtml(html, requestedAccount, source === 'json' ? 'html' : source, sourceUrl);
  }
  throw new AppError('UPSTREAM_CHANGED', 'company page is neither mobile ssrData nor desktop showroom', {
    reason: 'COMPANY_PAGE_UNRECOGNIZED',
    bytes: html.length,
  });
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
    };
    // Do not let HttpClient fire onCaptcha automatically: the browser-rendered HTML
    // fallback is more reliable than re-using HTTP cookies, and we want to try it first.
    let res: HttpResponse | null = null;
    let blockedError: unknown = null;
    try {
      res = await this.http.request(url, requestOpts);
    } catch (e) {
      if (e instanceof AppError && (e.code === 'CAPTCHA_REQUIRED' || e.code === 'CAPTCHA_SOLVE_FAILED')) {
        blockedError = e;
      } else {
        throw e;
      }
    }
    const blocked = blockedError !== null || (res !== null && isChallengePage(res));
    if (blocked) {
      if (opts.browserHtml) {
        this.logger.info('company: HTTP path challenged; using verified browser-rendered HTML', { url });
        const html = await opts.browserHtml(url);
        const payload = parseAnyCompanyHtml(html, account, 'browser', url);
        this.logger.debug('company: parsed info.html via browser fallback', {
          account: payload.account,
          bytes: html.length,
        });
        return payload;
      }
      if (opts.onCaptcha) {
        this.logger.info('company: challenge page detected, invoking injected captcha solver', { url });
        await opts.onCaptcha(url);
        res = await this.http.request(url, requestOpts);
      } else if (blockedError) {
        throw blockedError;
      }
    }
    if (!res || isChallengePage(res)) {
      throw new AppError('CAPTCHA_REQUIRED', 'company page is behind an EdgeOne/Focus challenge', {
        stage: 'captcha',
        reason: 'COMPANY_PAGE_CHALLENGE',
        src_url: url,
        bytes: res?.body.length ?? 0,
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
    const payload = parseAnyCompanyHtml(res.body, account, 'json', res.finalUrl);
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
    };
    let res: HttpResponse | null = null;
    let blockedError: unknown = null;
    try {
      res = await this.http.request(url, requestOpts);
    } catch (e) {
      if (e instanceof AppError && (e.code === 'CAPTCHA_REQUIRED' || e.code === 'CAPTCHA_SOLVE_FAILED')) {
        blockedError = e;
      } else {
        throw e;
      }
    }
    if (blockedError !== null || (res !== null && isChallengePage(res))) {
      if (!opts.onCaptcha) {
        if (blockedError) throw blockedError;
        throw new AppError('CAPTCHA_REQUIRED', 'comId resolver is behind an EdgeOne/Focus challenge', {
          stage: 'captcha',
          reason: 'COM_ID_RESOLVER_CHALLENGE',
          src_url: url,
        });
      }
      await opts.onCaptcha(url);
      res = await this.http.request(url, requestOpts);
    }
    if (res === null) {
      if (blockedError) throw blockedError;
      throw new AppError('CAPTCHA_REQUIRED', 'comId resolver is behind an EdgeOne/Focus challenge', {
        stage: 'captcha',
        reason: 'COM_ID_RESOLVER_CHALLENGE',
        src_url: url,
      });
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
