import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.resolve(HERE, '..', 'fixtures');
export const API_FIXTURES_DIR = path.join(FIXTURES_DIR, 'api');

/** Load a JSON fixture by path relative to tests/fixtures/api (e.g. 'mobile-search/x.json'). */
export function loadFixture<T = unknown>(relPath: string): T {
  const file = path.join(API_FIXTURES_DIR, relPath);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as T;
}

/** Load a plain-text fixture by path relative to tests/fixtures/api. */
export function loadTextFixture(relPath: string): string {
  return fs.readFileSync(path.join(API_FIXTURES_DIR, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// Upstream search payload types (subset used by tests)
// ---------------------------------------------------------------------------

export interface RawSearchFixture {
  total?: number | string;
  totalNum?: string;
  page?: number | string;
  pageSize?: number | string;
  totalPage?: number | string;
  dataList?: Array<Record<string, unknown>>;
  _note?: string;
  [key: string]: unknown;
}

const GLASS_FULL = 'mobile-search/supplier-search-glass-p1.full.json';

/** The canonical 20-item glass page-1 fixture (complete dataList). */
export function glassFullFixture(): RawSearchFixture {
  return loadFixture<RawSearchFixture>(GLASS_FULL);
}

export interface SearchPayloadOptions {
  items: Array<Record<string, unknown>>;
  page: number;
  total: number;
  totalPage?: number;
  pageSize?: number;
  totalNum?: string;
  /** force totalNum to "2,000+" and total=2000 (upstream cap behaviour) */
  capped?: boolean;
}

/** Build an upstream `POST /search/supplier` JSON payload. */
export function buildSearchPayload(opts: SearchPayloadOptions): Record<string, unknown> {
  const pageSize = opts.pageSize ?? 20;
  const total = opts.capped ? 2000 : opts.total;
  const totalNum = opts.capped ? '2,000+' : (opts.totalNum ?? total.toLocaleString('en-US'));
  const totalPage = opts.totalPage ?? Math.max(1, Math.ceil(total / pageSize));
  return {
    total,
    totalNum,
    page: opts.page,
    pageSize,
    totalPage,
    dataStartIndex: (opts.page - 1) * pageSize,
    dataList: opts.items,
    dataFromCorrect: false,
    correctKey: null,
    correctResultNum: 0,
    needSuggest: false,
    redirectUrl: null,
    crawlerFspError: false,
    startIndex: (opts.page - 1) * pageSize,
    adList: null,
    calassifyWords: null,
    showPlanB: false,
    searchLanguageCode: '0',
    searchTransEn: null,
    foreignVisit: false,
  };
}

/**
 * Split a list of raw items into upstream-shaped pages of 20 (or custom size).
 * Total is the *upstream* total, which may exceed the number of provided items;
 * pages beyond the provided data are ignored unless `repeatLastPage` is set.
 */
export function paginateItems(
  items: Array<Record<string, unknown>>,
  opts: { pageSize?: number; total?: number; totalPage?: number; capped?: boolean; startPage?: number } = {},
): Array<Record<string, unknown>> {
  const pageSize = opts.pageSize ?? 20;
  const startPage = opts.startPage ?? 1;
  const total = opts.capped ? 2000 : (opts.total ?? items.length);
  const totalPage = opts.totalPage ?? Math.max(1, Math.ceil(total / pageSize));
  const pages: Array<Record<string, unknown>> = [];
  for (let i = 0; i < Math.ceil(items.length / pageSize); i++) {
    pages.push(
      buildSearchPayload({
        items: items.slice(i * pageSize, (i + 1) * pageSize),
        page: startPage + i,
        total,
        totalPage,
        pageSize,
        capped: opts.capped,
      }),
    );
  }
  return pages;
}

/** Clone a raw item `n` times with unique account/company_id (deterministic). */
export function synthesizeItems(
  template: Array<Record<string, unknown>>,
  n: number,
  suffixPrefix = 'p',
): Array<Record<string, unknown>> {
  if (!template.length) throw new Error('synthesizeItems: empty template');
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i++) {
    const base = template[i % template.length]!;
    const copy: Record<string, unknown> = { ...base };
    copy.account = `${String(base.mainUserAccount)}-${suffixPrefix}${String(i).padStart(3, '0')}`;
    copy.mainUserAccount = copy.account;
    copy.id = 900000000 + i;
    copy.name = `${String(base.name)} ${suffixPrefix}${String(i).padStart(3, '0')}`;
    // keep encodeComId-ish unique but deterministic
    copy.encodeComId = `enc${String(i).padStart(6, '0')}`;
    out.push(copy);
  }
  return out;
}
