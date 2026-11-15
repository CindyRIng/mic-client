/**
 * Browser session layer (M3): lazy cloakbrowser persistent context, Focus Captcha
 * auto-solve, session export/import for the HTTP fast path, and `mic auth` support.
 *
 * Design notes (docs/02, docs/07, docs/research/captcha-autosolve.md):
 * - cloakbrowser is loaded with a dynamic `import()` so the JSON-first main path never
 *   pays for it (and does not fail when the binary/display is unavailable).
 * - One BrowserContext per process/profile is reused; concurrent users are serialized by
 *   a promise queue.
 * - Captcha images are decoded in Node (see ./captcha.ts) and the drag is executed with
 *   Playwright mouse events; the page's own FCaptcha widget submits /captcha/check.
 * - Never log cookie values or storageState contents.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright-core';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import { AppError } from '../errors.js';
import { ensureDirs, type Config } from '../config.js';
import type { Logger } from '../logger.js';
import type { Cookie } from '../http/client.js';
import { offsetToDragDistance, solveCaptchaFromPngs } from './captcha.js';

// ---------------------------------------------------------------------------
// Minimal ambient declarations for code that runs inside the page (evaluate).
// The project TS lib does not include DOM; these are only used inside
// `page.evaluate` callbacks and never executed in Node.
// ---------------------------------------------------------------------------
interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface PageElementLike {
  getBoundingClientRect(): PageRect;
}
declare const document: {
  body?: { innerText?: string } | null;
  querySelector(selectors: string): PageElementLike | null;
};
declare const window: {
  focusCaptcha?: { setSize?: { img_width?: number; imgWidth?: number } };
};
declare function fetch(input: string, init?: { credentials?: string }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
declare function btoa(data: string): string;

export const CAPTCHA_HOST = 'captcha.made-in-china.com';
const M_SITE = 'https://m.made-in-china.com/';
const WWW_SITE = 'https://www.made-in-china.com/';
const LOGIN_STATUS_URL = 'https://login.made-in-china.com/login/status/check';

export interface SessionPaths {
  profileDir: string;
  storageState: string;
  authJson: string;
  cookieJar: string;
  sessionLock: string;
}

export function sessionPaths(cfg: Config): SessionPaths {
  return {
    profileDir: cfg.profile_dir,
    storageState: path.join(cfg.profile_dir, 'storage-state.json'),
    authJson: path.join(cfg.profile_dir, 'auth.json'),
    cookieJar: path.join(cfg.data_dir, 'session', 'cookies.json'),
    sessionLock: path.join(cfg.profile_dir, 'session.lock'),
  };
}

export interface AuthState {
  last_auth_at: string | null;
  last_check_at: string | null;
  login: boolean | null;
  cookie_names: string[];
}

export interface ExportedSession {
  storage_state_path: string;
  cookie_jar_path: string;
  cookie_count: number;
  cookie_names: string[];
  last_auth_at: string;
  login: boolean | null;
}

export function readAuthState(cfg: Config): AuthState | null {
  const { authJson } = sessionPaths(cfg);
  try {
    const raw = JSON.parse(fs.readFileSync(authJson, 'utf8')) as Partial<AuthState>;
    return {
      last_auth_at: raw.last_auth_at ?? null,
      last_check_at: raw.last_check_at ?? null,
      login: typeof raw.login === 'boolean' ? raw.login : null,
      cookie_names: Array.isArray(raw.cookie_names) ? raw.cookie_names.map(String) : [],
    };
  } catch {
    return null;
  }
}

export function storageStateAgeSeconds(cfg: Config): number | null {
  try {
    const st = fs.statSync(sessionPaths(cfg).storageState);
    return Math.max(0, Math.floor((Date.now() - st.mtimeMs) / 1000));
  } catch {
    return null;
  }
}

export function sessionState(cfg: Config): {
  storage_state_present: boolean;
  storage_state_age_seconds: number | null;
  last_verified_at: string | null;
  login: boolean | null;
  cookie_count: number;
} {
  const auth = readAuthState(cfg);
  const cookieCount = loadSessionCookies(cfg).length;
  const age = storageStateAgeSeconds(cfg);
  return {
    storage_state_present: age !== null,
    storage_state_age_seconds: age,
    last_verified_at: auth?.last_auth_at ?? null,
    login: auth?.login ?? null,
    cookie_count: cookieCount,
  };
}

export function loadSessionCookies(cfg: Config): Cookie[] {
  const { cookieJar } = sessionPaths(cfg);
  try {
    const raw = JSON.parse(fs.readFileSync(cookieJar, 'utf8')) as Array<Partial<Cookie>>;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((c) => typeof c.name === 'string' && typeof c.value === 'string' && c.name.length > 0)
      .map((c) => ({
        name: String(c.name),
        value: String(c.value),
        domain: typeof c.domain === 'string' && c.domain ? c.domain : 'made-in-china.com',
        path: typeof c.path === 'string' && c.path ? c.path : '/',
        ...(typeof c.expires === 'number' ? { expires: c.expires } : {}),
      }));
  } catch {
    return [];
  }
}

/** `mic auth --reset`: remove session files only (idempotent), keep profile/cache. */
export function resetSession(cfg: Config): { removed: string[] } {
  const paths = sessionPaths(cfg);
  const removed: string[] = [];
  for (const file of [paths.storageState, paths.authJson, paths.cookieJar]) {
    try {
      if (!fs.existsSync(file)) continue;
      fs.rmSync(file, { force: true });
      removed.push(file);
    } catch {
      /* ignore */
    }
  }
  return { removed };
}

async function writePrivateFile(file: string, data: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fsp.writeFile(file, data, { mode: 0o600 });
  await fsp.chmod(file, 0o600).catch(() => undefined);
}

/** Persist storageState + auth metadata + HTTP cookie jar (0600). */
export async function exportSession(ctx: BrowserContext, cfg: Config): Promise<ExportedSession> {
  ensureDirs(cfg);
  const paths = sessionPaths(cfg);
  const storageState = await ctx.storageState();
  const cookies = await ctx.cookies();
  const now = new Date().toISOString();
  const login = await checkLogin(ctx);
  await writePrivateFile(paths.storageState, JSON.stringify(storageState));
  await writePrivateFile(
    paths.authJson,
    JSON.stringify({ last_auth_at: now, last_check_at: now, login, cookie_names: cookies.map((c) => c.name) }, null, 2),
  );
  const jar: Cookie[] = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    ...(typeof c.expires === 'number' && c.expires > 0 ? { expires: c.expires * 1000 } : {}),
  }));
  await writePrivateFile(paths.cookieJar, JSON.stringify(jar, null, 2));
  return {
    storage_state_path: paths.storageState,
    cookie_jar_path: paths.cookieJar,
    cookie_count: cookies.length,
    cookie_names: cookies.map((c) => c.name),
    last_auth_at: now,
    login,
  };
}

/** Probe login state through the public login/status endpoint (anonymous => false). */
export async function checkLogin(ctx: BrowserContext): Promise<boolean | null> {
  try {
    const res = await ctx.request.get(LOGIN_STATUS_URL, { timeout: 8000 });
    const text = await res.text();
    if (/not\s+logged\s+in/i.test(text) || /"code"\s*:\s*10010/.test(text)) return false;
    if (/"login"\s*:\s*true/.test(text) || /"code"\s*:\s*0\b/.test(text)) return true;
    return null;
  } catch {
    return null;
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface CaptchaGetPayload {
  originalImageUrl?: string;
  jigsawImageUrl?: string;
  token?: string;
  secretKey?: string;
}

interface CaptchaCheckPayload {
  repCode?: string;
  repMsg?: string;
}

/** Collects FCaptcha /captcha/get and /captcha/check responses from a page. */
class CaptchaWatcher {
  private lastGet: CaptchaGetPayload | null = null;
  private getWaiters: Array<(v: CaptchaGetPayload | null) => void> = [];
  private checkResults: CaptchaCheckPayload[] = [];
  private checkWaiters: Array<(v: CaptchaCheckPayload | null) => void> = [];
  private readonly handler: (res: unknown) => void;
  getCount = 0;
  checkCount = 0;
  parseFailures = 0;

  constructor(
    private readonly page: Page,
    private readonly logger?: Logger,
  ) {
    this.handler = (raw: unknown): void => {
      const res = raw as {
        url: () => string;
        request: () => { method: () => string };
        text: () => Promise<string>;
      };
      void (async () => {
        try {
          const url = res.url();
          if (res.request().method() !== 'POST') return;
          if (/\/captcha\/get$/.test(url)) {
            this.getCount++;
            const rawPayload = JSON.parse(await res.text()) as {
              repCode?: string;
              repData?: CaptchaGetPayload;
            } & CaptchaGetPayload;
            // FCaptcha returns {repCode, repData:{originalImageUrl,jigsawImageUrl,token,secretKey}}
            const data = rawPayload.repData ?? rawPayload;
            this.lastGet = {
              originalImageUrl: data.originalImageUrl,
              jigsawImageUrl: data.jigsawImageUrl,
              token: data.token,
              secretKey: data.secretKey,
            };
            const waiters = this.getWaiters;
            this.getWaiters = [];
            for (const w of waiters) w(this.lastGet);
          } else if (/\/captcha\/check$/.test(url)) {
            this.checkCount++;
            this.checkResults.push(JSON.parse(await res.text()) as CaptchaCheckPayload);
            const waiters = this.checkWaiters;
            this.checkWaiters = [];
            for (const w of waiters) w(this.checkResults[this.checkResults.length - 1] ?? null);
          }
        } catch (e) {
          this.parseFailures++;
          this.logger?.debug('captcha watcher: response parse failed', { error: String(e) });
        }
      })();
    };
    page.on('response', this.handler);
    page.on('request', (req) => {
      const u = req.url();
      if (/\/captcha\//.test(u)) this.logger?.debug('captcha watcher: seen request', { method: req.method(), url: u.slice(0, 120) });
    });
  }

  takeLastGet(): CaptchaGetPayload | null {
    return this.lastGet;
  }

  resetLastGet(): void {
    this.lastGet = null;
  }

  waitForGet(timeoutMs: number): Promise<CaptchaGetPayload | null> {
    if (this.lastGet) return Promise.resolve(this.lastGet);
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: CaptchaGetPayload | null): void => {
        if (done) return;
        done = true;
        resolve(v);
      };
      this.getWaiters.push(finish);
      void sleep(timeoutMs).then(() => finish(null));
    });
  }

  waitForCheck(timeoutMs: number, afterCount: number): Promise<CaptchaCheckPayload | null> {
    const existing = this.checkResults[afterCount];
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: CaptchaCheckPayload | null): void => {
        if (done) return;
        done = true;
        resolve(v);
      };
      this.checkWaiters.push(finish);
      void sleep(timeoutMs).then(() => finish(null));
    });
  }

  dispose(): void {
    try {
      this.page.off('response', this.handler as never);
    } catch {
      /* ignore */
    }
  }
}

async function readSliderState(
  page: Page,
): Promise<{ rect: { x: number; y: number; width: number; height: number } | null; imgWidth: number }> {
  return page.evaluate(() => {
    const candidates = ['.fcaptcha-verify-move-block', '.verify-move-block', '[class*="move-block"]', '[class*="slider"]'];
    let el: PageElementLike | null = null;
    for (const sel of candidates) {
      el = document.querySelector(sel);
      if (el) break;
    }
    const rect = el ? el.getBoundingClientRect() : null;
    const fc = (window as { focusCaptcha?: { setSize?: { img_width?: number; imgWidth?: number } } }).focusCaptcha;
    const rawWidth = fc?.setSize?.img_width ?? fc?.setSize?.imgWidth ?? 280;
    return {
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      imgWidth: Number(rawWidth) || 280,
    };
  });
}

async function dragSlider(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
  domDelta: number,
): Promise<void> {
  const sx = rect.x + rect.width / 2;
  const sy = rect.y + rect.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const jitterY = Math.sin(i * 1.3) * 0.8;
    await page.mouse.move(sx + domDelta * progress, sy + jitterY);
    await sleep(10 + Math.random() * 25);
  }
  await sleep(120);
  await page.mouse.up();
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

async function fetchCaptchaImages(page: Page, urls: { bg: string; jig: string }): Promise<{ bg: Buffer; jig: Buffer }> {
  try {
    const [bgRes, jigRes] = await Promise.all([
      page.context().request.get(urls.bg, { timeout: 10000 }),
      page.context().request.get(urls.jig, { timeout: 10000 }),
    ]);
    if (bgRes.ok() && jigRes.ok()) {
      const bg = Buffer.from(await bgRes.body());
      const jig = Buffer.from(await jigRes.body());
      if (bg.length > 100 && jig.length > 100) return { bg, jig };
    }
  } catch {
    /* fall back to in-page fetch */
  }
  const encoded = await page.evaluate(async (u: { bg: string; jig: string }) => {
    const toBase64 = (buffer: ArrayBuffer): string => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
      }
      return btoa(binary);
    };
    const load = async (url: string): Promise<string> => {
      const res = await fetch(url, { credentials: 'include' });
      const buf = await res.arrayBuffer();
      return toBase64(buf);
    };
    return { bg: await load(u.bg), jig: await load(u.jig) };
  }, urls);
  return { bg: decodeBase64(encoded.bg), jig: decodeBase64(encoded.jig) };
}

export interface CaptchaAttemptRecord {
  attempt: number;
  offset_x: number | null;
  dom_delta: number | null;
  rep_code: string | null;
  error?: string;
}

export interface CaptchaSolveResult {
  solved: boolean;
  offsetX: number;
  domDelta: number;
  attempts: CaptchaAttemptRecord[];
}

/**
 * Auto-solve the Focus Captcha currently shown on `page`.
 * Throws CAPTCHA_SOLVE_FAILED after `cfg.captcha.max_attempts` failures.
 */
export async function solveFocusCaptcha(page: Page, cfg: Config, logger?: Logger): Promise<CaptchaSolveResult> {
  if (!cfg.captcha.autosolve) {
    throw new AppError('NEED_HUMAN_VERIFICATION', 'captcha auto-solve is disabled by configuration', {
      stage: 'captcha',
      action: 'mic auth',
      reason: 'autosolve_disabled',
    });
  }
  const watcher = new CaptchaWatcher(page, logger);
  const attempts: CaptchaAttemptRecord[] = [];
  try {
    // Start from a clean captcha load: the widget fetches /captcha/get on load.
    // (Reloading inside an attempt can navigate away while the response body is
    // being read, which previously produced "no /captcha/get payload".)
    await page.reload({ waitUntil: 'load', timeout: 60000 }).catch(() => undefined);
    await sleep(1500);
    for (let attempt = 1; attempt <= cfg.captcha.max_attempts; attempt++) {
      let payload = watcher.takeLastGet();
      if (!payload) {
        if (attempt === 1 && (watcher.parseFailures > 0 || watcher.getCount === 0)) {
          await page.reload({ waitUntil: 'load', timeout: 60000 }).catch(() => undefined);
          await sleep(1500);
        }
        payload = await watcher.waitForGet(12000);
      }
      if (!payload?.originalImageUrl || !payload.jigsawImageUrl) {
        attempts.push({ attempt, offset_x: null, dom_delta: null, rep_code: null, error: 'no /captcha/get payload' });
        watcher.resetLastGet();
        await sleep(1000);
        continue;
      }
      const bgUrl = new URL(payload.originalImageUrl, `https://${CAPTCHA_HOST}`).toString();
      const jigUrl = new URL(payload.jigsawImageUrl, `https://${CAPTCHA_HOST}`).toString();
      const images = await fetchCaptchaImages(page, { bg: bgUrl, jig: jigUrl });
      const offset = solveCaptchaFromPngs(images.bg, images.jig);
      const slider = await readSliderState(page);
      if (!slider.rect || slider.rect.width <= 0) {
        attempts.push({ attempt, offset_x: offset.x, dom_delta: null, rep_code: null, error: 'slider not found' });
        watcher.resetLastGet();
        await sleep(1200);
        continue;
      }
      const domDelta = offsetToDragDistance(offset.x, slider.imgWidth);
      const checkStart = watcher.checkCount;
      await dragSlider(page, slider.rect, domDelta);
      const check = await watcher.waitForCheck(8000, checkStart);
      attempts.push({
        attempt,
        offset_x: offset.x,
        dom_delta: Number(domDelta.toFixed(2)),
        rep_code: check?.repCode ?? null,
      });
      if (check?.repCode === '0000') {
        logger?.info('captcha: solved', { attempt, offset_x: offset.x, dom_delta: Number(domDelta.toFixed(2)) });
        watcher.resetLastGet();
        return { solved: true, offsetX: offset.x, domDelta, attempts };
      }
      logger?.debug('captcha: attempt failed', { attempt, rep_code: check?.repCode ?? null });
      watcher.resetLastGet();
      // Reload to force a fresh /captcha/get (the widget does not refetch after a wrong drag).
      await page.reload({ waitUntil: 'load', timeout: 60000 }).catch(() => undefined);
      await sleep(2000);
    }
    throw new AppError('CAPTCHA_SOLVE_FAILED', 'automatic captcha solving failed', {
      attempts: attempts.map((a) => ({ attempt: a.attempt, rep_code: a.rep_code, offset_x: a.offset_x })),
      max_attempts: cfg.captcha.max_attempts,
    });
  } finally {
    watcher.dispose();
  }
}

export async function isCaptchaPage(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes(CAPTCHA_HOST) || url.includes('/verification.html')) return true;
  const title = await page.title().catch(() => '');
  if (/Focus Captcha|请验证/i.test(title)) return true;
  try {
    const body = await page.evaluate(() => (document.body?.innerText ?? '').slice(0, 600));
    return /Focus Captcha|not a robot|Swipe right|请验证/i.test(body);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Persistent context management
// ---------------------------------------------------------------------------

let contextPromise: Promise<BrowserContext> | null = null;
let contextKey = '';
let contextHeadless: boolean | null = null;
let sessionQueue: Promise<unknown> = Promise.resolve();

/** Serialize browser page operations (single persistent context, no parallel pages). */
export function withBrowserSession<T>(fn: () => Promise<T>): Promise<T> {
  const run = sessionQueue.then(fn, fn);
  sessionQueue = run.catch(() => undefined);
  return run;
}

export async function closeBrowserSession(): Promise<void> {
  if (!contextPromise) return;
  const current = contextPromise;
  contextPromise = null;
  contextKey = '';
  contextHeadless = null;
  try {
    const ctx = await current;
    await ctx.close();
  } catch {
    /* ignore */
  }
}

export interface LaunchBrowserOptions {
  headless?: boolean;
}

/**
 * Launch (or reuse) the cloakbrowser persistent context. Dynamic import keeps the
 * JSON fast path free of the browser dependency.
 */
export async function getBrowserContext(
  cfg: Config,
  logger: Logger,
  opts: LaunchBrowserOptions = {},
): Promise<BrowserContext> {
  const headless = opts.headless ?? cfg.browser.headless;
  const key = cfg.profile_dir;
  if (contextPromise && contextKey === key && contextHeadless === headless) return contextPromise;
  if (contextPromise) await closeBrowserSession();
  contextKey = key;
  contextHeadless = headless;
  ensureDirs(cfg);
  fs.mkdirSync(cfg.profile_dir, { recursive: true, mode: 0o700 });
  const launchOptions: LaunchPersistentContextOptions = {
    userDataDir: cfg.profile_dir,
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    humanize: true,
  };
  contextPromise = (async () => {
    let cloak: typeof import('cloakbrowser');
    try {
      cloak = await import('cloakbrowser');
    } catch (e) {
      throw new AppError('CONFIG_ERROR', 'cloakbrowser is not available; run through ~/cloak-env/bin/cloak-run', {
        reason: 'CLOAKBROWSER_MISSING',
        error: String((e as Error).message ?? e),
        hint: 'see docs/07: use ~/cloak-env/bin/cloak-run node dist/cli.js <command>',
      });
    }
    try {
      const ctx = await cloak.launchPersistentContext(launchOptions);
      logger.info('browser: persistent context launched', { profile: cfg.profile_dir, headless });
      ctx.setDefaultTimeout(60000);
      return ctx;
    } catch (e) {
      throw new AppError('CONFIG_ERROR', 'failed to launch the browser session', {
        reason: 'BROWSER_LAUNCH_FAILED',
        error: String((e as Error).message ?? e),
        hint: 'check DISPLAY (visible mode), cloakbrowser license/binary; run `mic doctor`',
      });
    }
  })();
  try {
    return await contextPromise;
  } catch (e) {
    contextPromise = null;
    contextKey = '';
    contextHeadless = null;
    throw e;
  }
}

/** Wait until the page leaves the Focus Captcha widget (it redirects to srcUrl after verifyCaptcha). */
async function waitForCaptchaRedirect(page: Page, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(500);
    try {
      const url = page.url();
      if (!/captcha\.made-in-china\.com|verification\.html/.test(url)) return true;
      if (!(await isCaptchaPage(page))) return true;
    } catch {
      /* navigation in progress */
    }
  }
  return false;
}

export interface VerifiedSessionResult {
  verified: true;
  url: string;
  script: 'captcha-solved' | 'already-verified';
  session: ExportedSession;
  captcha_attempts: CaptchaAttemptRecord[];
}

/**
 * Open `url` in the persistent browser, auto-solve Focus Captcha when redirected,
 * verify the target page is reachable, then export the session for the HTTP path.
 */
export async function ensureVerifiedSession(
  url: string,
  cfg: Config,
  logger: Logger,
  opts: LaunchBrowserOptions = {},
): Promise<VerifiedSessionResult> {
  const ctx = await getBrowserContext(cfg, logger, opts);
  return withBrowserSession(async () => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    try {
      // If we were redirected to the Focus Captcha page, the destination lives in `srcUrl`.
      let targetUrl = url;
      try {
        const u = new URL(url);
        if (u.hostname === CAPTCHA_HOST || u.pathname.endsWith('/verification.html')) {
          const src = u.searchParams.get('srcUrl');
          if (src) targetUrl = src;
        }
      } catch {
        /* keep url */
      }
      await page.goto(url, { waitUntil: 'load', timeout: 90000 }).catch((e: unknown) => {
        logger.warn('browser: goto failed, continuing with current page', { error: String((e as Error).message ?? e) });
      });
      let captcha = await isCaptchaPage(page);
      let attempts: CaptchaAttemptRecord[] = [];
      let script: 'captcha-solved' | 'already-verified' = 'already-verified';
      // solve at most twice: a fresh captcha may appear when navigating to the destination
      for (let round = 0; round < 2; round++) {
        captcha = await isCaptchaPage(page);
        if (!captcha) break;
        await solveFocusCaptcha(page, cfg, logger).then((r) => {
          attempts = attempts.concat(r.attempts);
        });
        script = 'captcha-solved';
        // the widget calls /fbrs/captcha/verifyCaptcha and then redirects to srcUrl (~4-6s)
        const redirected = await waitForCaptchaRedirect(page, 20000);
        logger?.debug('session: post-solve state', {
          round,
          redirected,
          url: page.url().slice(0, 140),
          captcha: await isCaptchaPage(page),
        });
        if (!redirected || (await isCaptchaPage(page))) {
          await page.goto(targetUrl, { waitUntil: 'load', timeout: 90000 }).catch(() => undefined);
          await sleep(2500);
        }
      }
      captcha = await isCaptchaPage(page);
      if (captcha) {
        throw new AppError('NEED_HUMAN_VERIFICATION', 'still blocked by captcha/challenge after auto-solve', {
          stage: 'captcha',
          action: 'mic auth',
          reason: 'auto_solve_exhausted',
          url: targetUrl.slice(0, 200),
        });
      }
      const session = await exportSession(ctx, cfg);
      logger.info('browser: verified session exported', { cookie_count: session.cookie_count, script });
      return { verified: true as const, url: page.url(), script, session, captcha_attempts: attempts };
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}

/**
 * Fetch a fully-rendered HTML page through the verified browser session.
 * Used as the last-resort fallback when the HTTP path is still challenged after
 * captcha auto-solve (cookies alone may not satisfy the edge risk engine).
 */
export async function fetchHtmlViaBrowser(url: string, cfg: Config, logger: Logger): Promise<string> {
  const ctx = await getBrowserContext(cfg, logger);
  return withBrowserSession(async () => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 90000 }).catch((e: unknown) => {
        logger.warn('browser: fetch goto failed', { error: String((e as Error).message ?? e) });
      });
      for (let round = 0; round < 4; round++) {
        await sleep(2000);
        if (await isCaptchaPage(page)) {
          logger.info('browser: captcha detected while fetching HTML; auto-solving', { url: url.slice(0, 160), round });
          await solveFocusCaptcha(page, cfg, logger);
          await waitForCaptchaRedirect(page, 20000);
          continue;
        }
        const html = await page.content();
        if (html.length > 2000) {
          await exportSession(ctx, cfg);
          logger.info('browser: rendered HTML captured', { url: url.slice(0, 160), bytes: html.length });
          return html;
        }
        await sleep(1500);
      }
      throw new AppError('NEED_HUMAN_VERIFICATION', 'browser fallback could not render the page', {
        stage: 'browser_fetch',
        action: 'mic auth',
        url: url.slice(0, 200),
      });
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}

// ---------------------------------------------------------------------------
// `mic auth`
// ---------------------------------------------------------------------------

export interface OpenAuthBrowserOptions {
  mode?: 'verify' | 'login';
  timeoutSec?: number;
  onProgress?: (message: string) => void;
}

export interface AuthResult {
  profile: string;
  profile_dir: string;
  mode: 'verify' | 'login';
  verified: boolean;
  login: boolean | null;
  cookie_count: number;
  cookie_names: string[];
  storage_state_path: string;
  cookie_jar_path: string;
  last_auth_at: string;
  duration_ms: number;
}

function requireGraphicalSession(): void {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new AppError('CONFIG_ERROR', 'a graphical session is required for `mic auth` (DISPLAY is not set)', {
      reason: 'DISPLAY_MISSING',
      hint: 'run `mic auth` from a desktop terminal, or use `mic auth --mode check` for a headless probe',
    });
  }
}

/**
 * Open a visible browser for human verification/login and persist the session.
 * Focus Captcha is auto-solved first when possible; the user only intervenes if needed.
 */
export async function openAuthBrowser(cfg: Config, logger: Logger, opts: OpenAuthBrowserOptions = {}): Promise<AuthResult> {
  const mode = opts.mode ?? 'verify';
  const timeoutSec = Math.max(5, opts.timeoutSec ?? cfg.auth.timeout_s);
  requireGraphicalSession();
  ensureDirs(cfg);
  const started = Date.now();
  const progress = opts.onProgress ?? (() => undefined);
  const ctx = await getBrowserContext(cfg, logger, { headless: false });
  return withBrowserSession(async () => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);
    const deadline = Date.now() + timeoutSec * 1000;
    let autoTried = false;
    try {
      progress(`[2/4] opening ${mode === 'login' ? WWW_SITE : M_SITE}; complete verification in the browser window (max ${timeoutSec}s)`);
      await page.goto(mode === 'login' ? WWW_SITE : M_SITE, { waitUntil: 'load', timeout: 90000 }).catch(() => undefined);
      let solvedAuto = false;
      while (Date.now() < deadline) {
        const captcha = await isCaptchaPage(page);
        if (captcha && !autoTried) {
          autoTried = true;
          try {
            await solveFocusCaptcha(page, cfg, logger);
            solvedAuto = true;
          } catch (e) {
            logger.warn('auth: automatic captcha solve failed, waiting for human', {
              error: String((e as Error).message ?? e),
            });
          }
        }
        if (!captcha || solvedAuto) {
          if (mode === 'login') {
            const login = await checkLogin(ctx);
            if (login === true) break;
          } else if (!captcha) {
            break;
          }
        }
        await sleep(1500);
      }
      const captchaStill = await isCaptchaPage(page);
      const login = await checkLogin(ctx);
      if (captchaStill) {
        throw new AppError('NEED_HUMAN_VERIFICATION', 'human verification was not completed before the timeout', {
          stage: 'captcha',
          action: 'mic auth',
          reason: 'timeout',
          timeout_s: timeoutSec,
        });
      }
      if (mode === 'login' && login !== true) {
        throw new AppError('NEED_HUMAN_VERIFICATION', 'login was not completed before the timeout', {
          stage: 'login',
          action: 'mic auth --mode login',
          reason: 'timeout',
          timeout_s: timeoutSec,
        });
      }
      progress('[3/4] verifying session…');
      const session = await exportSession(ctx, cfg);
      progress('[4/4] session persisted');
      return {
        profile: path.basename(cfg.profile_dir),
        profile_dir: cfg.profile_dir,
        mode,
        verified: true,
        login,
        cookie_count: session.cookie_count,
        cookie_names: session.cookie_names,
        storage_state_path: session.storage_state_path,
        cookie_jar_path: session.cookie_jar_path,
        last_auth_at: session.last_auth_at,
        duration_ms: Date.now() - started,
      };
    } finally {
      await page.close().catch(() => undefined);
    }
  });
}
