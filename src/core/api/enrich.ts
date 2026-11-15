import { AppError } from '../errors.js';
import type { HttpClient } from '../http/client.js';
import type { Logger } from '../logger.js';

/** 增强接口（docs/03 §8.4、research/upstream-api.md §3.5）。全部匿名 JSON。 */
export const SGS_SECTIONS_URL = 'https://www.made-in-china.com/multi-search/sgs/report';
export const REPLY_RATE_URL = 'https://data.made-in-china.com/extend/busiMerge/replyRate';
export const SUB_ACCOUNTS_URL = 'https://www.made-in-china.com/im.do';
export const REVIEWS_URL = 'https://m.made-in-china.com/user/review/front/next';

export interface AuditSection {
  name: string;
  audited: boolean;
}

export interface ReplyRateData {
  avg_response_hours: number | null;
  timely_reply_ratio: number | null;
  top_avg_response_hours: number | null;
  top_timely_reply_ratio: number | null;
  range_display: string | null;
  as_of: string;
}

export interface SubAccountPerson {
  name: string;
  id: string;
}

export interface ReviewItemData {
  review_id: string;
  rating: number;
  title: string | null;
  content: string | null;
  sender_name: string | null;
  sender_country: string | null;
  created_at: string | null;
  product_title: string | null;
  product_url: string | null;
}

export interface ReviewsData {
  review_count: number | null;
  total_page: number | null;
  items: ReviewItemData[];
}

export interface EnrichRequestOptions {
  onCaptcha?: (srcUrl: string) => Promise<void>;
}

function record(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function ratioOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  if (n === null || n < 0 || n > 1) return null;
  return n;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.trunc(n);
}

/**
 * replyRate 的 `date` 参数 = 「今天 − 2 天」（Asia/Shanghai），输出 YYYYMMDD。
 * 依据 research/upstream-api.md §3.5b（页面 JS 取 today-2d）。
 */
export function replyRateDate(now: Date = new Date()): string {
  const shanghaiMs = now.getTime() + 8 * 3600_000;
  const target = new Date(shanghaiMs - 2 * 86_400_000);
  const y = target.getUTCFullYear();
  const m = String(target.getUTCMonth() + 1).padStart(2, '0');
  const d = String(target.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** 解析上游评分文案（"4.9/5"）→ 4.9；无值/不合法 → null。 */
export function parseRatingDisplay(display: string | null | undefined): number | null {
  if (!display) return null;
  const m = /(\d+(?:\.\d+)?)/.exec(display);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 5 ? n : null;
}

async function requestJson(
  http: HttpClient,
  url: string,
  opts: EnrichRequestOptions,
  headers: Record<string, string>,
): Promise<unknown> {
  const res = await http.request(url, {
    headers: { Accept: 'application/json, text/plain, */*', ...headers },
    retries: 0,
    onCaptcha: opts.onCaptcha,
  });
  if (res.status !== 200) {
    throw new AppError('UPSTREAM_UNAVAILABLE', `enrichment HTTP ${res.status}`, { url, status: res.status });
  }
  try {
    return JSON.parse(res.body);
  } catch (e) {
    throw new AppError(
      'UPSTREAM_CHANGED',
      'enrichment endpoint returned non-JSON',
      { url, body_head: res.body.slice(0, 200) },
      { cause: e },
    );
  }
}

export class CompanyEnricher {
  constructor(
    private readonly http: HttpClient,
    private readonly logger: Logger,
  ) {}

  /** a) SGS/CTI 审核报告章节（9 章节 `{content, audit}`）。 */
  async auditSections(encodeComId: string, opts: EnrichRequestOptions = {}): Promise<AuditSection[]> {
    const url = `${SGS_SECTIONS_URL}?comId=${encodeURIComponent(encodeComId)}`;
    const json = record(await requestJson(this.http, url, opts, { Referer: 'https://www.made-in-china.com/' }));
    const code = intOrNull(json?.['code']);
    if (code !== 0) {
      throw new AppError('UPSTREAM_CHANGED', 'SGS report response code !== 0', { url, code });
    }
    const data = json?.['data'];
    if (!Array.isArray(data)) {
      throw new AppError('UPSTREAM_CHANGED', 'SGS report response data is not an array', { url });
    }
    return data.map((row) => {
      const r = record(row) ?? {};
      return { name: strOrNull(r['content']) ?? '', audited: r['audit'] === true };
    });
  }

  /** b) 近 30 天平均响应时长 / 及时回复率。`data` 为空 = 供应商无响应数据（不是失败）。 */
  async replyRate(encodeComId: string, opts: EnrichRequestOptions = {}, now: Date = new Date()): Promise<ReplyRateData | null> {
    const asOf = replyRateDate(now);
    const url = `${REPLY_RATE_URL}?date=${asOf}&comId=${encodeURIComponent(encodeComId)}&operatorNo=all`;
    const json = record(await requestJson(this.http, url, opts, { Referer: 'https://www.made-in-china.com/' }));
    const status = intOrNull(json?.['status']);
    if (status !== 1) {
      throw new AppError('UPSTREAM_CHANGED', 'replyRate response status !== 1', { url, status });
    }
    const data = json?.['data'];
    if (data === null || data === undefined) return null;
    if (!Array.isArray(data)) {
      throw new AppError('UPSTREAM_CHANGED', 'replyRate response data is not an array', { url });
    }
    const row = record(data[0]);
    if (!row) return null;
    return {
      avg_response_hours: numOrNull(row['l30BusiReplyDurAvg']),
      timely_reply_ratio: ratioOrNull(row['l30BusiIntimeReplyRatio']),
      top_avg_response_hours: numOrNull(row['l30TopReplyDurAvg']),
      top_timely_reply_ratio: ratioOrNull(row['l30TopIntimeReplyRatio']),
      range_display: strOrNull(row['l30BusiReplyDurAvgRange']),
      as_of: asOf,
    };
  }

  /** c) TradeMessenger 子账号（联系人名单；仅名字 + TM id）。 */
  async subAccounts(encodeComId: string, opts: EnrichRequestOptions = {}): Promise<SubAccountPerson[]> {
    const url = `${SUB_ACCOUNTS_URL}?xcase=getSubAccount&comIdStr=${encodeURIComponent(encodeComId)}`;
    const json = await requestJson(this.http, url, opts, { Referer: 'https://www.made-in-china.com/' });
    const direct = Array.isArray(json) ? json : record(json)?.[encodeComId];
    if (direct === null || direct === undefined) return [];
    if (!Array.isArray(direct)) {
      throw new AppError('UPSTREAM_CHANGED', 'getSubAccount response shape changed', {
        url,
        keys: record(json) ? Object.keys(record(json)!) : typeof json,
      });
    }
    const persons: SubAccountPerson[] = [];
    for (const row of direct) {
      const r = record(row);
      if (!r) continue;
      const name = strOrNull(r['name']);
      const id = strOrNull(r['id']);
      if (name && id) persons.push({ name, id });
    }
    return persons;
  }

  /** d) 公司评分/评价列表（第一页，最多 10 条摘要）。 */
  async reviews(encodeComId: string, opts: EnrichRequestOptions = {}): Promise<ReviewsData> {
    const url =
      `${REVIEWS_URL}?pageNum=1&sortType=1&foldFlag=false&reviewType=0` +
      `&receiverComId=${encodeURIComponent(encodeComId)}&prodId=`;
    const json = record(
      await requestJson(this.http, url, opts, {
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://m.made-in-china.com/',
      }),
    );
    const code = intOrNull(json?.['code']);
    if (code !== 0) {
      throw new AppError('UPSTREAM_CHANGED', 'company reviews response code !== 0', {
        url,
        code,
        err: strOrNull(json?.['err']),
      });
    }
    const content = record(json?.['content']);
    if (!content) {
      throw new AppError('UPSTREAM_CHANGED', 'company reviews response content missing', { url });
    }
    const list = content['reviewSearchItemVOList'];
    const items: ReviewItemData[] = [];
    if (Array.isArray(list)) {
      for (const row of list.slice(0, 10)) {
        const r = record(row);
        if (!r) continue;
        const reviewId = strOrNull(r['reviewId']);
        if (!reviewId) continue;
        const rating = intOrNull(r['overallReview']);
        items.push({
          review_id: reviewId,
          rating: rating === null ? 0 : Math.max(0, Math.min(5, rating)),
          title: strOrNull(r['titleText']),
          content: typeof r['reviewContent'] === 'string' ? r['reviewContent'] : null,
          sender_name: strOrNull(r['senderName']),
          sender_country: strOrNull(r['senderIpCountry']),
          created_at: (strOrNull(r['sourceFinishTime']) ?? '').slice(0, 10) || null,
          product_title: strOrNull(r['titleText']),
          product_url: strOrNull(r['titleUrl']),
        });
      }
    }
    return {
      review_count: intOrNull(content['totalCount']),
      total_page: intOrNull(content['totalPage']),
      items,
    };
  }
}
