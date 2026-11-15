import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Config } from '../config.js';
import { dbPath } from '../config.js';
import type { Logger } from '../logger.js';
import type { CompanyListItem } from '../models.js';
import { MIGRATION_0001 } from './migrations.js';

export interface CacheHit<T> {
  payload: T;
  fetchedAt: number;
  expiresAt: number;
  stale: boolean;
}

export interface SearchPageRow {
  cache_key: string;
  params_hash: string;
  page: number;
  payload_json: string;
  total: number;
  total_num_raw: string | null;
  total_capped: number;
  total_page: number;
  fetched_at: number;
  expires_at: number;
}

export class Cache {
  readonly db: Database.Database;
  readonly path: string;

  constructor(
    private readonly cfg: Config,
    private readonly logger: Logger,
  ) {
    this.path = dbPath(cfg);
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    this.db = new Database(this.path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma(`busy_timeout = ${cfg.cache.busy_timeout_ms}`);
    this.migrate();
  }

  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version < 1) {
      const tx = this.db.transaction(() => {
        this.db.exec(MIGRATION_0001);
        this.db.pragma('user_version = 1');
      });
      tx();
      this.logger.info('cache: migrated schema to v1', { db: this.path });
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* noop */
    }
  }

  get schemaVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number;
  }

  getSearchPage(cacheKey: string): (SearchPageRow & { stale: boolean }) | null {
    const row = this.db.prepare('SELECT * FROM search_page_cache WHERE cache_key = ?').get(cacheKey) as
      | SearchPageRow
      | undefined;
    if (!row) return null;
    const now = Math.floor(Date.now() / 1000);
    const stale = row.expires_at <= now;
    this.db.prepare('UPDATE search_page_cache SET hit_count = hit_count + 1, last_accessed_at = ? WHERE cache_key = ?').run(now, cacheKey);
    return { ...row, stale };
  }

  putSearchPage(opts: {
    cacheKey: string;
    paramsHash: string;
    upstreamParams: Record<string, unknown>;
    word: string;
    province: string | null;
    filters: Record<string, unknown>;
    page: number;
    total: number;
    totalNumRaw: string | null;
    totalCapped: boolean;
    totalPage: number;
    items: CompanyListItem[];
    source: 'json' | 'html' | 'browser' | 'cache';
    warnings: unknown[];
    requestId: string;
    upstreamUrl: string;
    httpStatus: number;
    ttlSeconds?: number;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    const ttl = opts.ttlSeconds ?? (opts.items.length === 0 ? Math.min(this.cfg.cache.ttl_empty_list_s, this.cfg.cache.ttl_list_s) : this.cfg.cache.ttl_list_s);
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO search_page_cache
            (cache_key, params_hash, upstream_params_json, word, province, filters_json, page, page_size,
             total, total_num_raw, total_capped, total_page, item_count, payload_json, upstream_url, http_status,
             source, result_status, warnings_json, fetched_at, expires_at, last_request_id, hit_count, last_accessed_at)
           VALUES (?,?,?,?,?,?,?,20,?,?,?,?,?,?,?,?,?, 'success', ?,?,?,?,0,?)`,
        )
        .run(
          opts.cacheKey,
          opts.paramsHash,
          JSON.stringify(opts.upstreamParams),
          opts.word.toLowerCase(),
          opts.province,
          JSON.stringify(opts.filters),
          opts.page,
          opts.total,
          opts.totalNumRaw,
          opts.totalCapped ? 1 : 0,
          opts.totalPage,
          opts.items.length,
          JSON.stringify(opts.items),
          opts.upstreamUrl,
          opts.httpStatus,
          opts.source,
          JSON.stringify(opts.warnings),
          now,
          now + ttl,
          opts.requestId,
          now,
        );
    } catch (e) {
      this.logger.warn('cache: failed to write search page', { error: String(e) });
    }
  }

  /** mark stale (used when serving stale data after upstream failure) */
  markStale(cacheKey: string): void {
    try {
      this.db.prepare("UPDATE search_page_cache SET result_status='stale' WHERE cache_key = ?").run(cacheKey);
    } catch {
      /* noop */
    }
  }

  getEntry<T>(key: string): CacheHit<T> | null {
    const row = this.db.prepare('SELECT payload_json, fetched_at, expires_at FROM cache_entries WHERE cache_key = ?').get(key) as
      | { payload_json: string | null; fetched_at: number; expires_at: number }
      | undefined;
    if (!row || row.payload_json === null) return null;
    try {
      return {
        payload: JSON.parse(row.payload_json) as T,
        fetchedAt: row.fetched_at,
        expiresAt: row.expires_at,
        stale: row.expires_at <= Math.floor(Date.now() / 1000),
      };
    } catch {
      return null;
    }
  }

  setEntry(key: string, scope: string, kind: string, payload: unknown, ttl: number, source = 'json'): void {
    const now = Math.floor(Date.now() / 1000);
    const json = JSON.stringify(payload);
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO cache_entries
            (cache_key, scope, kind, params_json, payload_json, payload_encoding, source, result_status, fetched_at, expires_at, size_bytes, hit_count, last_accessed_at, warnings_json)
           VALUES (?,?,?, '{}', ?, 'identity', ?, 'success', ?, ?, ?, 0, ?, '[]')`,
        )
        .run(key, scope, kind, json, source, now, now + ttl, Buffer.byteLength(json), now);
    } catch (e) {
      this.logger.warn('cache: failed to write entry', { error: String(e), key });
    }
  }

  upsertCompanies(items: CompanyListItem[], rawItems?: unknown[]): void {
    if (!items.length) return;
    const now = Math.floor(Date.now() / 1000);
    const stmt = this.db.prepare(
      `INSERT INTO companies
        (account, company_id, encode_com_id, company_name, province, city, country, main_products_json,
         business_types_json, system_certifications_json, membership_tier, raw_cs_level, since_year,
         capability_stars, audited, employees, turnover, plant_area, company_url, company_info_url, is_ad,
         detail_source, first_seen_at, last_seen_at, raw_item_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(account) DO UPDATE SET
         company_id=excluded.company_id, encode_com_id=excluded.encode_com_id, company_name=excluded.company_name,
         province=excluded.province, city=excluded.city, country=excluded.country,
         main_products_json=excluded.main_products_json, business_types_json=excluded.business_types_json,
         system_certifications_json=excluded.system_certifications_json, membership_tier=excluded.membership_tier,
         raw_cs_level=excluded.raw_cs_level, since_year=COALESCE(excluded.since_year, companies.since_year),
         capability_stars=excluded.capability_stars, audited=excluded.audited, employees=excluded.employees,
         turnover=excluded.turnover, plant_area=excluded.plant_area, company_url=excluded.company_url,
         company_info_url=excluded.company_info_url, is_ad=excluded.is_ad, detail_source=excluded.detail_source,
         last_seen_at=excluded.last_seen_at`,
    );
    const tx = this.db.transaction((rows: CompanyListItem[]) => {
      rows.forEach((c, idx) => {
        stmt.run(
          c.account,
          Number(c.company_id) || null,
          c.encode_com_id,
          c.company_name,
          c.province,
          c.city,
          c.country,
          JSON.stringify(c.main_products),
          JSON.stringify(c.business_types),
          JSON.stringify(c.system_certifications),
          c.membership.tier,
          c.membership.raw_cs_level,
          c.membership.since_year,
          c.capability_stars,
          c.audited === null ? null : c.audited ? 1 : 0,
          c.employees,
          c.turnover,
          c.plant_area,
          c.company_url,
          c.company_info_url,
          c.is_ad ? 1 : 0,
          c.detail_source,
          now,
          now,
          JSON.stringify(rawItems?.[idx] ?? {
            account: c.account,
            company_id: c.company_id,
            company_name: c.company_name,
            note: 'raw item not available at cache write',
          }).slice(0, 65536),
        );
      });
    });
    try {
      tx(items);
    } catch (e) {
      this.logger.warn('cache: failed to upsert companies', { error: String(e) });
    }
  }

  getRuntime(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM runtime_state WHERE key = ?').get(key) as { value: string | null } | undefined;
    return row?.value ?? null;
  }

  setRuntime(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO runtime_state (key, value, updated_at) VALUES (?,?,?)')
      .run(key, value, Math.floor(Date.now() / 1000));
  }

  stats() {
    const now = Math.floor(Date.now() / 1000);
    const count = (table: string) => (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    const stale = (
      this.db.prepare('SELECT COUNT(*) AS n FROM search_page_cache WHERE expires_at <= ?').get(now) as { n: number }
    ).n;
    let size = 0;
    try {
      size = fs.statSync(this.path).size;
    } catch {
      size = 0;
    }
    return {
      enabled: this.cfg.cache.enabled,
      db_path: this.path,
      schema_version: this.schemaVersion,
      entries: {
        search_page_cache: count('search_page_cache'),
        search_indexes: count('search_indexes'),
        companies: count('companies'),
        company_details: count('company_details'),
        cache_entries: count('cache_entries'),
        raw_snapshots: count('raw_snapshots'),
      },
      stale_entries: stale,
      db_size_bytes: size,
      ttl_seconds: {
        list: this.cfg.cache.ttl_list_s,
        search_index: this.cfg.cache.ttl_search_index_s,
        detail: this.cfg.cache.ttl_detail_s,
        audit: this.cfg.cache.ttl_audit_s,
        response: this.cfg.cache.ttl_response_s,
        contacts: this.cfg.cache.ttl_contacts_s,
        reviews: this.cfg.cache.ttl_reviews_s,
        regions: this.cfg.cache.ttl_regions_s,
      },
    };
  }

  clear(scope: 'all' | 'search' | 'detail' | 'regions' | 'raw' | 'enrich' = 'all'): number {
    let n = 0;
    const run = (sql: string, ...args: unknown[]) => {
      const r = this.db.prepare(sql).run(...args);
      n += r.changes;
    };
    if (scope === 'all' || scope === 'search') run('DELETE FROM search_page_cache');
    if (scope === 'all' || scope === 'search') run('DELETE FROM search_indexes');
    if (scope === 'all' || scope === 'detail') {
      run('DELETE FROM company_details');
      run('DELETE FROM membership_info');
    }
    if (scope === 'all' || scope === 'enrich') {
      for (const t of ['audit_info', 'response_info', 'contact_info', 'review_summary']) {
        try {
          run(`DELETE FROM ${t}`);
        } catch {
          /* table may not exist in older schema */
        }
      }
    }
    if (scope === 'all' || scope === 'regions') {
      run("DELETE FROM cache_entries WHERE scope = 'regions'");
      run('DELETE FROM regions_cities');
      run('DELETE FROM regions_provinces');
    }
    if (scope === 'all' || scope === 'raw') run('DELETE FROM raw_snapshots');
    return n;
  }
}
