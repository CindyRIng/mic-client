import { loadConfig, ensureDirs, type Config } from './config.js';
import { Logger, type LogLevel } from './logger.js';
import { HttpClient, type Cookie } from './http/client.js';
import { Cache } from './cache/cache.js';
import { SupplierSearchApi } from './api/search.js';
import { SearchService } from './search/service.js';
import { CompanyDetailApi } from './api/company.js';
import { CompanyEnricher } from './api/enrich.js';
import { CompanyService } from './company/service.js';
import { loadSessionCookies } from './session/browser.js';

export interface AppContext {
  cfg: Config;
  logger: Logger;
  http: HttpClient;
  cache: Cache;
  supplierApi: SupplierSearchApi;
  search: SearchService;
  company: CompanyService;
  startedAt: number;
}

export interface CreateContextOptions {
  configOverrides?: Record<string, unknown>;
  logLevel?: LogLevel;
  cookies?: Cookie[];
  jsonLogs?: boolean;
}

export function createContext(opts: CreateContextOptions = {}): AppContext {
  const cfg = loadConfig(opts.configOverrides ?? {});
  ensureDirs(cfg);
  const logger = new Logger({ level: opts.logLevel ?? cfg.log_level, json: opts.jsonLogs ?? true });
  const cookies = opts.cookies ?? loadSessionCookies(cfg);
  const http = new HttpClient(cfg, logger, cookies);
  const cache = new Cache(cfg, logger);
  const supplierApi = new SupplierSearchApi(http, logger);
  const search = new SearchService(cfg, logger, cache, supplierApi);
  const company = new CompanyService(
    cfg,
    logger,
    cache,
    new CompanyDetailApi(http, logger),
    new CompanyEnricher(http, logger),
  );
  return { cfg, logger, http, cache, supplierApi, search, company, startedAt: Date.now() };
}

export function closeContext(ctx: AppContext): void {
  ctx.cache.close();
}
