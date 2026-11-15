import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Config {
  profile_dir: string;
  data_dir: string;
  log_dir: string;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  rest: { host: string; port: number; strict_params: boolean };
  upstream: {
    timeout_ms: number;
    rate_min_ms: number;
    rate_max_ms: number;
    max_concurrency: number;
    queue_max_wait_ms: number;
    html_enabled: boolean;
    browser_enabled: boolean;
  };
  cache: {
    enabled: boolean;
    ttl_list_s: number;
    ttl_search_index_s: number;
    ttl_detail_s: number;
    ttl_audit_s: number;
    ttl_response_s: number;
    ttl_contacts_s: number;
    ttl_reviews_s: number;
    ttl_regions_s: number;
    ttl_empty_list_s: number;
    allow_stale: boolean;
    busy_timeout_ms: number;
  };
  captcha: { autosolve: boolean; max_attempts: number; solve_timeout_s: number };
  auth: { timeout_s: number };
  search: { scan_max_pages: number; default_page_size: number };
  browser: { headless: boolean };
  raw_snapshot: { enabled: boolean; retention_days: number };
  db_file: string;
}

export const DEFAULT_CONFIG: Config = {
  profile_dir: path.join(os.homedir(), '.mic-client', 'profiles', 'default'),
  data_dir: path.join(os.homedir(), '.mic-client', 'data'),
  log_dir: path.join(os.homedir(), '.mic-client', 'logs'),
  log_level: 'info',
  rest: { host: '127.0.0.1', port: 8787, strict_params: false },
  upstream: {
    timeout_ms: 15000,
    rate_min_ms: 1500,
    rate_max_ms: 2500,
    max_concurrency: 1,
    queue_max_wait_ms: 5000,
    html_enabled: false,
    browser_enabled: true,
  },
  cache: {
    enabled: true,
    ttl_list_s: 21600,
    ttl_search_index_s: 21600,
    ttl_detail_s: 86400,
    ttl_audit_s: 604800,
    ttl_response_s: 21600,
    ttl_contacts_s: 86400,
    ttl_reviews_s: 43200,
    ttl_regions_s: 2592000,
    ttl_empty_list_s: 3600,
    allow_stale: true,
    busy_timeout_ms: 5000,
  },
  captcha: { autosolve: true, max_attempts: 5, solve_timeout_s: 30 },
  auth: { timeout_s: 300 },
  search: { scan_max_pages: 10, default_page_size: 20 },
  browser: { headless: true },
  raw_snapshot: { enabled: false, retention_days: 7 },
  db_file: 'mic.sqlite',
};

const ENV_MAP: Array<[string, (c: Config, v: string) => void]> = [
  ['MIC_PROFILE_DIR', (c, v) => (c.profile_dir = v)],
  ['MIC_DATA_DIR', (c, v) => (c.data_dir = v)],
  ['MIC_LOG_DIR', (c, v) => (c.log_dir = v)],
  ['MIC_LOG_LEVEL', (c, v) => (c.log_level = v as Config['log_level'])],
  ['MIC_REST_HOST', (c, v) => (c.rest.host = v)],
  ['MIC_REST_PORT', (c, v) => (c.rest.port = Number(v))],
  ['MIC_UPSTREAM_TIMEOUT_MS', (c, v) => (c.upstream.timeout_ms = Number(v))],
  ['MIC_RATE_MIN_MS', (c, v) => (c.upstream.rate_min_ms = Number(v))],
  ['MIC_RATE_MAX_MS', (c, v) => (c.upstream.rate_max_ms = Number(v))],
  ['MIC_CACHE_TTL_LIST_S', (c, v) => (c.cache.ttl_list_s = Number(v))],
  ['MIC_CACHE_TTL_SEARCH_INDEX_S', (c, v) => (c.cache.ttl_search_index_s = Number(v))],
  ['MIC_CACHE_TTL_DETAIL_S', (c, v) => (c.cache.ttl_detail_s = Number(v))],
  ['MIC_CACHE_TTL_AUDIT_S', (c, v) => (c.cache.ttl_audit_s = Number(v))],
  ['MIC_CACHE_TTL_RESPONSE_S', (c, v) => (c.cache.ttl_response_s = Number(v))],
  ['MIC_CACHE_TTL_CONTACTS_S', (c, v) => (c.cache.ttl_contacts_s = Number(v))],
  ['MIC_CACHE_TTL_REVIEWS_S', (c, v) => (c.cache.ttl_reviews_s = Number(v))],
  ['MIC_CACHE_TTL_REGIONS_S', (c, v) => (c.cache.ttl_regions_s = Number(v))],
  ['MIC_CACHE_TTL_EMPTY_LIST_S', (c, v) => (c.cache.ttl_empty_list_s = Number(v))],
  ['MIC_CAPTCHA_AUTOSOLVE', (c, v) => (c.captcha.autosolve = v !== 'false' && v !== '0')],
  ['MIC_CAPTCHA_MAX_ATTEMPTS', (c, v) => (c.captcha.max_attempts = Number(v))],
  ['MIC_AUTH_TIMEOUT_S', (c, v) => (c.auth.timeout_s = Number(v))],
  ['MIC_RAW_SNAPSHOT', (c, v) => (c.raw_snapshot.enabled = v !== 'false' && v !== '0')],
  ['MIC_RAW_RETENTION_DAYS', (c, v) => (c.raw_snapshot.retention_days = Number(v))],
  ['MIC_SCAN_MAX_PAGES', (c, v) => (c.search.scan_max_pages = Number(v))],
  ['MIC_BROWSER_HEADLESS', (c, v) => (c.browser.headless = v !== 'false' && v !== '0')],
];

function mergeDeep<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch as T;
  if (typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = mergeDeep((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

export function configPath(): string {
  return process.env.MIC_CONFIG ?? path.join(os.homedir(), '.mic-client', 'config.json');
}

export function loadConfig(overrides: Record<string, unknown> = {}): Config {
  let cfg: Config = structuredClone(DEFAULT_CONFIG);
  const file = configPath();
  try {
    if (fs.existsSync(file)) {
      cfg = mergeDeep(cfg, JSON.parse(fs.readFileSync(file, 'utf8')));
    }
  } catch {
    // invalid config file: keep defaults, surfaced by `mic doctor`
  }
  for (const [key, fn] of ENV_MAP) {
    const v = process.env[key];
    if (v !== undefined && v !== '') fn(cfg, v);
  }
  cfg = mergeDeep(cfg, overrides);
  cfg.db_file = cfg.db_file || 'mic.sqlite';
  return cfg;
}

export function ensureDirs(cfg: Config): void {
  for (const dir of [cfg.data_dir, cfg.log_dir, cfg.profile_dir, path.join(cfg.data_dir, 'session')]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function dbPath(cfg: Config): string {
  return path.join(cfg.data_dir, cfg.db_file);
}
