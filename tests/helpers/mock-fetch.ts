/**
 * Programmable `fetch` mock for offline tests.
 *
 * The production `HttpClient` uses global `fetch`; tests install a responder that
 * receives every request (method/url/headers/body) and returns a spec:
 *   - `{ status, headers, body }` → real `Response`
 *   - `{ throw: <Error> }` or direct throw → fetch rejects (simulate network/AppError)
 *
 * Scenarios covered (see docs/06 §5): 200 JSON, 302→captcha, 429, 5xx,
 * total "2,000+" cap, page clamp, EdgeOne JS challenge HTML.
 */
import { AppError } from '../../src/core/errors.js';

export interface MockRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export interface MockResponseSpec {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** reject the fetch promise with this error instead of resolving a Response */
  throw?: Error;
}

export type MockResponder = (req: MockRequest) => MockResponseSpec | Promise<MockResponseSpec>;

export interface FetchMock {
  calls: MockRequest[];
  /** requests whose URL matches predicate */
  callsMatching(predicate: (req: MockRequest) => boolean): MockRequest[];
  restore(): void;
  reset(): void;
}

let restoreStack: Array<() => void> = [];
let activeCalls: MockRequest[] = [];

function normalizeRequest(input: unknown, init?: RequestInit): MockRequest {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String((input as Request).url);
  const headers: Record<string, string> = {};
  const rawHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  if (rawHeaders) {
    const entries = rawHeaders instanceof Headers ? rawHeaders.entries() : Object.entries(rawHeaders as Record<string, string>);
    for (const [k, v] of entries) headers[k.toLowerCase()] = String(v);
  }
  const body = init?.body === undefined || init.body === null ? '' : String(init.body);
  return { url, method: (init?.method ?? 'GET').toUpperCase(), headers, body };
}

/** Install a fetch mock. Always pair with `restore()` in afterEach. */
export function installFetchMock(responder: MockResponder): FetchMock {
  const original = globalThis.fetch;
  const calls: MockRequest[] = [];
  activeCalls = calls;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const req = normalizeRequest(input, init);
    calls.push(req);
    const spec = await responder(req);
    if (spec.throw) throw spec.throw;
    const response = new Response(spec.body ?? '', {
      status: spec.status ?? 200,
      headers: spec.headers ?? {},
    });
    return response;
  }) as typeof fetch;
  restoreStack.push(() => {
    globalThis.fetch = original;
  });
  return {
    calls,
    callsMatching: (predicate) => calls.filter(predicate),
    restore: () => {
      globalThis.fetch = original;
    },
    reset: () => {
      calls.length = 0;
    },
  };
}

/** Restore every fetch mock installed during the current test (idempotent). */
export function restoreAllFetchMocks(): void {
  for (const restore of restoreStack.reverse()) restore();
  restoreStack = [];
  activeCalls = [];
}

/** Number of requests observed in the current mock (handy after restore). */
export function observedCalls(): MockRequest[] {
  return activeCalls;
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

export function jsonResponse(value: unknown, status = 200): MockResponseSpec {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(value),
  };
}

/** Upstream redirects to Focus Captcha (HttpClient maps to CAPTCHA_REQUIRED). */
export function captchaRedirect(): MockResponseSpec {
  return {
    status: 302,
    headers: {
      location: 'https://captcha.made-in-china.com/verification.html?srcUrl=https%3A%2F%2Fm.made-in-china.com%2Fsearch%2Fsupplier',
    },
    body: '',
  };
}

/** EdgeOne JS challenge (~987B, `__tst_status` marker). */
export function edgeJsChallenge(): MockResponseSpec {
  const script = '<script>document.cookie="__tst_status=abc123; path=/";location.reload()</script>';
  const pad = ' '.repeat(Math.max(0, 980 - script.length));
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<html><body>${script}${pad}</body></html>`,
  };
}

/** Focus Captcha HTML page (5.6-5.9KB marker "请验证"). */
export function focusCaptchaPage(): MockResponseSpec {
  const head = '<html><head><title>请验证 / Focus Captcha</title></head><body><div>Focus Captcha</div>';
  const pad = 'x'.repeat(Math.max(0, 5800 - head.length - 7));
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `${head}${pad}</body></html>`,
  };
}

export function rateLimited(retryAfter = '2'): MockResponseSpec {
  return {
    status: 429,
    headers: { 'retry-after': retryAfter, 'content-type': 'text/html' },
    body: 'rate limited',
  };
}

export function serverError(status = 503): MockResponseSpec {
  return { status, headers: { 'content-type': 'text/html' }, body: 'upstream error' };
}

/** Plain text / malformed JSON body (PARSE/UPSTREAM_CHANGED scenarios). */
export function textResponse(body: string, status = 200): MockResponseSpec {
  return { status, headers: { 'content-type': 'text/plain' }, body };
}

export function throwAppError(error: AppError): MockResponseSpec {
  return { throw: error };
}

// ---------------------------------------------------------------------------
// Upstream search responder (routes POST /search/supplier)
// ---------------------------------------------------------------------------

export interface SearchPage {
  page: number;
  payload: Record<string, unknown>;
}

export interface SearchResponderOptions {
  /** upstream-shaped pages; request page > pages.length is clamped to last page */
  pages: Array<Record<string, unknown>>;
  /** simulate upstream page clamp for out-of-range pages (default true) */
  clampPage?: boolean;
  /** optional override for specific upstream page number */
  overrides?: Record<number, Record<string, unknown>>;
  /** capture requests for assertions */
  onRequest?: (form: URLSearchParams, page: number) => void;
}

export function parseForm(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

export function pageFromForm(body: string): number {
  const raw = parseForm(body).get('page');
  const n = raw === null ? 1 : Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 1;
}

/** Build a responder that serves upstream search JSON pages by `page` form field. */
export function searchResponder(opts: SearchResponderOptions): MockResponder {
  const { pages, clampPage = true } = opts;
  return (req) => {
    if (!req.url.includes('/search/supplier') || req.method !== 'POST') {
      return serverError(404);
    }
    const form = parseForm(req.body);
    const page = Number(form.get('page') ?? '1');
    const pageNo = Number.isFinite(page) ? Math.trunc(page) : 1;
    opts.onRequest?.(form, pageNo);
    const override = opts.overrides?.[pageNo];
    if (override) return jsonResponse(override);
    if (pageNo < 1 || pageNo > pages.length) {
      if (clampPage) {
        const last = pages[pages.length - 1] ?? {};
        // upstream returns last page content with the last page number
        return jsonResponse({ ...last, page: pages.length });
      }
      return jsonResponse({ total: 0, totalNum: '0', page: 1, pageSize: 20, totalPage: 1, dataList: [] });
    }
    return jsonResponse(pages[pageNo - 1]);
  };
}
