import { loadConfig, ensureDirs, type Config } from './config.js';
import { Logger, type LogLevel } from './logger.js';
import { HttpClient, type Cookie } from './http/client.js';
import { Cache } from './cache/cache.js';
import { SupplierSearchApi } from './api/search.js';
import { SearchService } from './search/service.js';

export interface AppContext {
  cfg: Config;
  logger: Logger;
  http: HttpClient;
  cache: Cache;
  supplierApi: SupplierSearchApi;
  search: SearchService;
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
  const http = new HttpClient(cfg, logger, opts.cookies);
  const cache = new Cache(cfg, logger);
  const supplierApi = new SupplierSearchApi(http, logger);
  const search = new SearchService(cfg, logger, cache, supplierApi);
  return { cfg, logger, http, cache, supplierApi, search, startedAt: Date.now() };
}

export function closeContext(ctx: AppContext): void {
  ctx.cache.close();
}
