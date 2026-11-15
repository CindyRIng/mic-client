/**
 * Offline test environment: temp data/log/profile dirs + real SQLite cache +
 * SearchService wired to the global fetch (installed per test via mock-fetch).
 *
 * Determinism: rate limiting is disabled (0 ms), timers/logs stay local to the
 * temp dir, and no real network/browser is touched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureDirs, loadConfig, type Config } from '../../src/core/config.js';
import { Logger } from '../../src/core/logger.js';
import { Cache } from '../../src/core/cache/cache.js';
import { HttpClient } from '../../src/core/http/client.js';
import { SupplierSearchApi } from '../../src/core/api/search.js';
import { SearchService } from '../../src/core/search/service.js';

export interface TestEnv {
  dir: string;
  cfg: Config;
  logger: Logger;
  cache: Cache;
  http: HttpClient;
  api: SupplierSearchApi;
  search: SearchService;
  /** close DB and remove the temp dir (idempotent) */
  close(): void;
}

export interface CreateTestEnvOptions {
  overrides?: Record<string, unknown>;
  /** keep cache enabled (default) or disable it for a pure-upstream test */
  cache?: boolean;
}

export function createTestEnv(opts: CreateTestEnvOptions = {}): TestEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mic-test-'));
  const cfg = loadConfig({
    data_dir: path.join(dir, 'data'),
    log_dir: path.join(dir, 'logs'),
    profile_dir: path.join(dir, 'profile'),
    log_level: 'error',
    upstream: {
      timeout_ms: 5000,
      rate_min_ms: 0,
      rate_max_ms: 0,
      max_concurrency: 1,
      queue_max_wait_ms: 5000,
      html_enabled: false,
      browser_enabled: false,
    },
    cache: { enabled: opts.cache ?? true, allow_stale: true },
    search: { scan_max_pages: 10, default_page_size: 20 },
    ...(opts.overrides ?? {}),
  });
  ensureDirs(cfg);
  const logger = new Logger({ level: 'error', json: false });
  const cache = new Cache(cfg, logger);
  const http = new HttpClient(cfg, logger);
  const api = new SupplierSearchApi(http, logger);
  const search = new SearchService(cfg, logger, cache, api);
  let closed = false;
  return {
    dir,
    cfg,
    logger,
    cache,
    http,
    api,
    search,
    close() {
      if (closed) return;
      closed = true;
      cache.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A SearchService whose upstream/cache dependencies are never touched; used to
 * unit-test `normalize()` (pure parameter/region logic) without SQLite.
 */
export function createNormalizerService(overrides: Record<string, unknown> = {}): SearchService {
  const cfg = loadConfig({
    log_level: 'error',
    upstream: { rate_min_ms: 0, rate_max_ms: 0 },
    search: { scan_max_pages: 10, default_page_size: 20 },
    ...overrides,
  });
  const logger = new Logger({ level: 'error', json: false });
  const cache = {} as Cache;
  const api = {} as SupplierSearchApi;
  return new SearchService(cfg, logger, cache, api);
}
