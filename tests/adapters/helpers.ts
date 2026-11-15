/**
 * Test helpers for adapters/**: temp AppContext, mocked upstream fetch and small
 * deterministic upstream payload builders (no network, no browser).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext, closeContext, type AppContext } from '../../src/core/container.js';

export interface TestEnv {
  ctx: AppContext;
  dir: string;
  close: () => void;
}

const CONFIG_OVERRIDES = (dir: string) => ({
  data_dir: dir,
  profile_dir: path.join(dir, 'profile'),
  log_dir: path.join(dir, 'logs'),
  log_level: 'error',
  rest: { host: '127.0.0.1', port: 0, strict_params: false },
  cache: { enabled: true, busy_timeout_ms: 1000 },
  upstream: {
    timeout_ms: 2000,
    rate_min_ms: 0,
    rate_max_ms: 0,
    max_concurrency: 1,
    queue_max_wait_ms: 2000,
    html_enabled: false,
    browser_enabled: false,
  },
  captcha: { autosolve: false, max_attempts: 1, solve_timeout_s: 5 },
  search: { scan_max_pages: 10, default_page_size: 20 },
});

/** Create an isolated AppContext (temp data/profile/log dirs, cache enabled). */
export function makeTestContext(): TestEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mic-adapters-test-'));
  const previousConfig = process.env['MIC_CONFIG'];
  process.env['MIC_CONFIG'] = path.join(dir, 'missing-config.json');
  const ctx = createContext({ configOverrides: CONFIG_OVERRIDES(dir), logLevel: 'error', jsonLogs: false });
  return {
    ctx,
    dir,
    close: () => {
      closeContext(ctx);
      fs.rmSync(dir, { recursive: true, force: true });
      if (previousConfig === undefined) delete process.env['MIC_CONFIG'];
      else process.env['MIC_CONFIG'] = previousConfig;
    },
  };
}

export type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export interface MockFetch {
  calls: Array<{ url: string; init?: RequestInit }>;
  restore: () => void;
}

/** Install a global fetch mock; unmatched URLs throw (tests must stay offline). */
export function installMockFetch(handler: FetchHandler): MockFetch {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mock = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  globalThis.fetch = mock;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export interface RawSupplierItemOptions {
  account?: string;
  name?: string;
  id?: number;
  csLevel?: number | null;
  city?: string;
  province?: string;
  mainProduct?: string;
  audited?: boolean;
  ad?: boolean;
  stars?: string;
}

export function rawSupplierItem(opts: RawSupplierItemOptions = {}): Record<string, unknown> {
  const account = opts.account ?? 'glass-a';
  return {
    id: opts.id ?? 1001,
    name: opts.name ?? 'Hebei Example Glass Co., Ltd.',
    mainUserAccount: account,
    encodeComId: `ENC${account.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)}`,
    memberType: 10,
    csLevel: opts.csLevel === undefined ? 50 : opts.csLevel,
    auditType: opts.audited === false ? 0 : 1,
    showAuditLogo: opts.audited !== false,
    logoText: opts.audited !== false ? 'Audited Supplier' : null,
    city: opts.city ?? 'Langfang',
    province: opts.province ?? 'Hebei',
    country: 'China',
    mainProduct: opts.mainProduct ?? 'Glass Cup, Glass Jar',
    businessTypeList: ['Manufacturer/Factory'],
    systemCertificationList: ['ISO 9001'],
    comTurnOver: '',
    comPlantArea: '',
    comEmployee: null,
    companySymbol: { stars: opts.stars ?? '2' },
    showAd: opts.ad === true,
    finishTime: null,
  };
}

export function supplierSearchPayload(opts: {
  items: Array<Record<string, unknown>>;
  total?: number;
  totalPage?: number;
  page?: number;
  totalNum?: string;
}): Record<string, unknown> {
  const page = opts.page ?? 1;
  const total = opts.total ?? opts.items.length;
  return {
    total,
    totalNum: opts.totalNum ?? String(total),
    page,
    pageSize: 20,
    totalPage: opts.totalPage ?? Math.max(1, Math.ceil(total / 20)),
    dataFromCorrect: false,
    needSuggest: false,
    dataList: opts.items,
  };
}
