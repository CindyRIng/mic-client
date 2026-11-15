import { AppError } from '../errors.js';
import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

export const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
export const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
}

export class CookieJar {
  private cookies = new Map<string, Cookie>();

  private key(c: Pick<Cookie, 'name' | 'domain' | 'path'>): string {
    return `${c.domain}\u0000${c.path}\u0000${c.name}`;
  }

  set(c: Omit<Cookie, 'path'> & { path?: string }): void {
    const path = c.path ?? '/';
    this.cookies.set(this.key({ name: c.name, domain: c.domain, path }), { ...c, path });
  }

  addSetCookie(raw: string, requestHost: string): void {
    const parts = raw.split(';').map((p) => p.trim());
    const [pair, ...attrs] = parts;
    if (!pair || !pair.includes('=')) return;
    const idx = pair.indexOf('=');
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!name) return;
    let domain = requestHost;
    let path = '/';
    let expires: number | undefined;
    for (const attr of attrs) {
      const [k, v] = attr.split('=').map((x) => x?.trim());
      const lk = (k ?? '').toLowerCase();
      if (lk === 'domain' && v) domain = v.replace(/^\./, '').toLowerCase();
      else if (lk === 'path' && v) path = v;
      else if (lk === 'max-age' && v) {
        const n = Number(v);
        if (Number.isFinite(n)) expires = Date.now() + n * 1000;
      } else if (lk === 'expires' && v) {
        const t = Date.parse(v);
        if (!Number.isNaN(t)) expires = t;
      }
    }
    this.set({ name, value, domain, path, expires });
  }

  headerFor(host: string, now = Date.now()): string {
    const h = host.toLowerCase();
    const parts: string[] = [];
    for (const c of this.cookies.values()) {
      if (c.expires !== undefined && c.expires <= now) continue;
      const d = c.domain.toLowerCase();
      if (h === d || h.endsWith('.' + d)) parts.push(`${c.name}=${c.value}`);
    }
    return parts.join('; ');
  }

  toJSON(): Cookie[] {
    return [...this.cookies.values()];
  }

  load(cookies: Cookie[]): void {
    for (const c of cookies) this.set(c);
  }

  clear(): void {
    this.cookies.clear();
  }
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST';
  host?: string;
  form?: Record<string, string | number | undefined>;
  body?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  referer?: string;
  /** treat redirects manually; default true (needed to detect captcha redirects). */
  manualRedirect?: boolean;
  retries?: number;
  /** optional captcha solver injected by session layer */
  onCaptcha?: (srcUrl: string) => Promise<void>;
}

export interface HttpResponse {
  status: number;
  finalUrl: string;
  headers: Record<string, string>;
  body: string;
  fromCache?: boolean;
}

interface RateLimiterOptions {
  minMs: number;
  maxMs: number;
  timeoutMs: number;
}

class RateLimiter {
  private chain: Promise<void> = Promise.resolve();
  private nextAllowed = 0;
  constructor(private readonly opts: RateLimiterOptions) {}

  async acquire(): Promise<() => void> {
    const started = Date.now();
    const waitSlot = this.chain.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, this.nextAllowed - now) + rand(this.opts.minMs, this.opts.maxMs);
      if (Date.now() - started > this.opts.timeoutMs) {
        throw new AppError('RATE_LIMITED', 'upstream request queue wait exceeded', {
          waited_ms: Date.now() - started,
          queue_max_wait_ms: this.opts.timeoutMs,
        });
      }
      await sleep(wait);
      this.nextAllowed = Date.now();
    });
    this.chain = waitSlot.catch(() => undefined);
    await waitSlot;
    return () => undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rand(min: number, max: number): number {
  return min + Math.floor(Math.random() * Math.max(1, max - min + 1));
}

const CAPTCHA_HOST = 'captcha.made-in-china.com';

export class HttpClient {
  readonly cookies: CookieJar;
  private readonly limiter: RateLimiter;
  private readonly inFlight = new Map<string, Promise<HttpResponse>>();

  constructor(
    private readonly cfg: Config,
    private readonly logger: Logger,
    cookies?: Cookie[],
  ) {
    this.cookies = new CookieJar();
    if (cookies) this.cookies.load(cookies);
    this.limiter = new RateLimiter({
      minMs: cfg.upstream.rate_min_ms,
      maxMs: cfg.upstream.rate_max_ms,
      timeoutMs: cfg.upstream.queue_max_wait_ms,
    });
  }

  private isUpstream(url: string): boolean {
    try {
      const h = new URL(url).hostname;
      return h === 'made-in-china.com' || h.endsWith('.made-in-china.com');
    } catch {
      return false;
    }
  }

  async request(url: string, opts: HttpRequestOptions = {}): Promise<HttpResponse> {
    const method = opts.method ?? 'GET';
    const timeoutMs = opts.timeoutMs ?? this.cfg.upstream.timeout_ms;
    const retries = opts.retries ?? 2;
    const key = `${method} ${url} ${opts.body ?? ''} ${JSON.stringify(opts.form ?? {})}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const task = this.runWithRetry(url, method, opts, timeoutMs, retries);
    this.inFlight.set(key, task.finally(() => this.inFlight.delete(key)) as Promise<HttpResponse>);
    return this.inFlight.get(key)!;
  }

  private async runWithRetry(
    url: string,
    method: 'GET' | 'POST',
    opts: HttpRequestOptions,
    timeoutMs: number,
    retries: number,
  ): Promise<HttpResponse> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(rand(1500, 3500) * attempt);
      if (this.isUpstream(url)) await this.limiter.acquire();
      try {
        const res = await this.once(url, method, opts, timeoutMs);
        if (res.status === 429) {
          lastError = new AppError('RATE_LIMITED', 'upstream rate limited', { url, status: 429 });
          continue;
        }
        if (res.status >= 500) {
          lastError = new AppError('UPSTREAM_UNAVAILABLE', `upstream status ${res.status}`, { url, status: res.status });
          continue;
        }
        return res;
      } catch (e) {
        lastError = e;
        if (e instanceof AppError && e.code === 'CAPTCHA_REQUIRED' && opts.onCaptcha) {
          await opts.onCaptcha((e.details?.['captcha_url'] as string) ?? url);
          continue;
        }
        if (e instanceof AppError && (e.code === 'CAPTCHA_REQUIRED' || e.code === 'NEED_HUMAN_VERIFICATION')) throw e;
      }
    }
    if (lastError instanceof AppError) throw lastError;
    throw new AppError('UPSTREAM_UNAVAILABLE', `upstream request failed: ${String(lastError)}`, { url });
  }

  private async once(
    url: string,
    method: 'GET' | 'POST',
    opts: HttpRequestOptions,
    timeoutMs: number,
  ): Promise<HttpResponse> {
    const u = new URL(url);
    const headers: Record<string, string> = {
      'User-Agent': opts.host === 'mobile' ? MOBILE_UA : DESKTOP_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/json,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...opts.headers,
    };
    const cookie = this.cookies.headerFor(u.hostname);
    if (cookie) headers['Cookie'] = cookie;
    if (opts.referer) headers['Referer'] = opts.referer;
    let body: string | undefined;
    if (method === 'POST') {
      if (opts.form) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        body = new URLSearchParams(
          Object.entries(opts.form).filter(([, v]) => v !== undefined) as Array<[string, string]>,
        ).toString();
      } else {
        body = opts.body ?? '';
        headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(u, { method, headers, body, redirect: 'manual', signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      throw new AppError('UPSTREAM_UNAVAILABLE', `request failed: ${String((e as Error).message ?? e)}`, { url });
    } finally {
      clearTimeout(timer);
    }
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) this.cookies.addSetCookie(sc, u.hostname);

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, u).toString();
      if (next.includes(CAPTCHA_HOST) || /verification\.html/.test(next)) {
        throw new AppError('CAPTCHA_REQUIRED', 'upstream requires Focus Captcha', {
          src_url: url,
          captcha_url: next,
        });
      }
      if (/\/company\/[0-9]+/.test(next)) {
        // 301 numeric comId resolver: return the redirect target so caller can extract account
        return {
          status: res.status,
          finalUrl: next,
          headers: Object.fromEntries(res.headers.entries()),
          body: '',
        };
      }
      // follow same-host redirects (login, locale) once
      const follow = await fetch(next, {
        method: 'GET',
        headers: { 'User-Agent': headers['User-Agent']!, 'Accept-Language': 'en-US,en;q=0.9', Cookie: this.cookies.headerFor(new URL(next).hostname) },
        redirect: 'manual',
      });
      const followBody = await follow.text();
      return {
        status: follow.status,
        finalUrl: next,
        headers: Object.fromEntries(follow.headers.entries()),
        body: followBody,
      };
    }

    const text = await res.text();
    return {
      status: res.status,
      finalUrl: url,
      headers: Object.fromEntries(res.headers.entries()),
      body: text,
    };
  }
}
