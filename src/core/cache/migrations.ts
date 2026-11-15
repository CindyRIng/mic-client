/** SQLite migration 0001 (from docs/05 §6.2 DDL). Do not edit manually. */
export const MIGRATION_0001 = `-- =====================================================================
-- MIC Client SQLite schema v1（与 docs/03-rest-api.md §11 对齐；内部列标注）
-- 约定：时间 = INTEGER Unix 秒（UTC）；布尔 = INTEGER 0/1；JSON = TEXT。
-- 枚举：source(json|html|browser|cache)、status(success|partial|stale)、
--       tier(diamond|gold|free|unknown)、availability_reason(5 值)。
-- =====================================================================

-- 1) 迁移版本表 ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version      INTEGER PRIMARY KEY,                 -- 迁移序号
  name         TEXT    NOT NULL UNIQUE,             -- 如 0001_init
  applied_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  app_version  TEXT,
  checksum     TEXT                                 -- 迁移文件 sha256
);

-- 2) 运行期元数据（CacheStats.last_refresh_at/last_vacuum_at 等） --------
CREATE TABLE IF NOT EXISTS runtime_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER))
);

-- 3) 查询历史（SearchQuery 内部模型） ------------------------------------
CREATE TABLE IF NOT EXISTS search_queries (
  query_hash        TEXT PRIMARY KEY,               -- sha256(规范化查询，不含 page/refresh)
  params_json       TEXT NOT NULL,                  -- 规范化参数快照（含原始中文值）
  keyword           TEXT,                           -- 规范化后关键词（地区模式为 NULL）
  keyword_effective TEXT NOT NULL,                  -- 实际发上游 word
  province          TEXT,                           -- 英文规范名
  city              TEXT,                           -- 英文规范名（本地过滤）
  search_mode       TEXT NOT NULL
                    CHECK (search_mode IN ('keyword','region','mixed')),
  region_validated  INTEGER NOT NULL DEFAULT 0 CHECK (region_validated IN (0,1)),
  filters_json      TEXT NOT NULL DEFAULT '{}',
  page              INTEGER NOT NULL DEFAULT 1 CHECK (page BETWEEN 1 AND 100),
  page_size         INTEGER NOT NULL DEFAULT 20 CHECK (page_size BETWEEN 1 AND 100),
  refresh           INTEGER NOT NULL DEFAULT 0 CHECK (refresh IN (0,1)),
  created_at        INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  last_used_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)),
  use_count         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_search_queries_last_used ON search_queries(last_used_at);

-- 4) 搜索上游页缓存（1 行 = 上游 20 条/页） ------------------------------
CREATE TABLE IF NOT EXISTS search_page_cache (
  cache_key            TEXT PRIMARY KEY,            -- 'search:' || params_hash
  params_hash          TEXT NOT NULL,               -- sha256(规范化上游参数，含 page；不含 city/page_size)
  upstream_params_json TEXT NOT NULL,               -- 实际发上游参数
  word                 TEXT NOT NULL,               -- 小写规范化 word
  province             TEXT,
  filters_json         TEXT NOT NULL DEFAULT '{}',
  page                 INTEGER NOT NULL CHECK (page BETWEEN 1 AND 100),
  page_size            INTEGER NOT NULL DEFAULT 20 CHECK (page_size = 20),
  total                INTEGER NOT NULL CHECK (total >= 0),
  total_num_raw        TEXT,                        -- 上游 totalNum 原文（如 "2,000+"）
  total_capped         INTEGER NOT NULL DEFAULT 0 CHECK (total_capped IN (0,1)),
  total_page           INTEGER NOT NULL CHECK (total_page >= 0),
  item_count           INTEGER NOT NULL DEFAULT 0,
  payload_json         TEXT NOT NULL,               -- CompanyListItem[]（含广告行）
  upstream_url         TEXT,
  http_status          INTEGER,
  source               TEXT NOT NULL CHECK (source IN ('json','html','browser','cache')),
  result_status        TEXT NOT NULL DEFAULT 'success'
                       CHECK (result_status IN ('success','partial','stale')),
  warnings_json        TEXT NOT NULL DEFAULT '[]',
  fetched_at           INTEGER NOT NULL,
  expires_at           INTEGER NOT NULL,
  last_request_id      TEXT,
  hit_count            INTEGER NOT NULL DEFAULT 0,
  last_accessed_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_search_page_cache_expires ON search_page_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_search_page_cache_params  ON search_page_cache(params_hash, page);

-- 5) 搜索派生索引（city/audited 本地过滤扫描结果） -----------------------
CREATE TABLE IF NOT EXISTS search_indexes (
  index_key            TEXT PRIMARY KEY,            -- 'searchidx:' || sha256(上游参数+本地过滤+page_size)
  params_hash          TEXT NOT NULL,               -- 对应上游页参数 hash
  upstream_params_json TEXT NOT NULL,
  local_filters_json   TEXT NOT NULL DEFAULT '{}',  -- {"city":..,"audited":..}
  page_size            INTEGER NOT NULL CHECK (page_size BETWEEN 1 AND 100),
  total_matched        INTEGER NOT NULL DEFAULT 0 CHECK (total_matched >= 0),
  total_is_lower_bound INTEGER NOT NULL DEFAULT 0 CHECK (total_is_lower_bound IN (0,1)),
  scanned_pages        INTEGER NOT NULL DEFAULT 0,
  scan_budget          INTEGER NOT NULL DEFAULT 10,
  accounts_json        TEXT NOT NULL DEFAULT '[]',  -- 有序 account 列表（去重后）
  source               TEXT NOT NULL CHECK (source IN ('json','html','browser','cache')),
  result_status        TEXT NOT NULL DEFAULT 'success'
                       CHECK (result_status IN ('success','partial','stale')),
  warnings_json        TEXT NOT NULL DEFAULT '[]',
  fetched_at           INTEGER NOT NULL,
  expires_at           INTEGER NOT NULL,
  hit_count            INTEGER NOT NULL DEFAULT 0,
  last_accessed_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_search_indexes_expires ON search_indexes(expires_at);
CREATE INDEX IF NOT EXISTS idx_search_indexes_params  ON search_indexes(params_hash);

-- 6) 公司列表快照（CompanyListItem 投影） -------------------------------
CREATE TABLE IF NOT EXISTS companies (
  account                    TEXT PRIMARY KEY,      -- mainUserAccount（保持上游大小写）
  company_id                 INTEGER,               -- 上游数字 comId（输出时转 string）
  encode_com_id              TEXT,                  -- encodeComId
  company_name               TEXT NOT NULL,
  province                   TEXT,
  city                       TEXT,
  country                    TEXT,
  province_zh                TEXT,                  -- 内部派生（字典）
  city_zh                    TEXT,                  -- 内部派生（字典）
  main_products_json         TEXT NOT NULL DEFAULT '[]',
  main_product_text          TEXT,                  -- 内部：上游 mainProduct 原文
  products_json              TEXT NOT NULL DEFAULT '[]',  -- 内部：productReduce 精简
  business_types_json        TEXT NOT NULL DEFAULT '[]',
  system_certifications_json TEXT NOT NULL DEFAULT '[]',
  membership_tier            TEXT NOT NULL DEFAULT 'unknown'
                             CHECK (membership_tier IN ('diamond','gold','free','unknown')),
  raw_cs_level               INTEGER,
  since_year                 INTEGER,
  capability_stars           INTEGER CHECK (capability_stars BETWEEN 0 AND 5),
  audited                    INTEGER CHECK (audited IN (0,1)),
  employees                  INTEGER,
  turnover                   TEXT,
  plant_area                 TEXT,
  company_url                TEXT,
  company_info_url           TEXT,
  is_ad                      INTEGER NOT NULL DEFAULT 0 CHECK (is_ad IN (0,1)),
  detail_source              TEXT NOT NULL DEFAULT 'json'
                             CHECK (detail_source IN ('json','html','browser','cache')),
  -- 内部附加列（03 未暴露）：
  com_ownership              TEXT,
  production_lines           TEXT,
  rd_capacity_json           TEXT NOT NULL DEFAULT '[]',
  quick_response             INTEGER CHECK (quick_response IN (0,1)),
  fast_delivery              INTEGER CHECK (fast_delivery IN (0,1)),
  leading_factory            INTEGER CHECK (leading_factory IN (0,1)),
  minisite_url               TEXT,
  traffic_url                TEXT,
  ad_id                      TEXT,
  first_seen_at              INTEGER NOT NULL,
  last_seen_at               INTEGER NOT NULL,
  last_request_id            TEXT,
  raw_item_json              TEXT NOT NULL           -- 列表原始 item（证据）
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_company_id
  ON companies(company_id) WHERE company_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_encode_id
  ON companies(encode_com_id) WHERE encode_com_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_region    ON companies(province, city);
CREATE INDEX IF NOT EXISTS idx_companies_tier      ON companies(membership_tier);
CREATE INDEX IF NOT EXISTS idx_companies_audited   ON companies(audited);
CREATE INDEX IF NOT EXISTS idx_companies_last_seen ON companies(last_seen_at);

-- 7) 公司详情快照 -------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_details (
  account                   TEXT PRIMARY KEY
                            REFERENCES companies(account) ON DELETE CASCADE,
  company_name              TEXT NOT NULL,          -- 详情页公司名（校验/兜底）
  address                   TEXT,
  address_city              TEXT,                   -- 内部：地址解析
  address_province          TEXT,                   -- 内部：地址解析
  established_at            TEXT,                   -- YYYY-MM-DD
  employees                 INTEGER,
  employee_text             TEXT,                   -- 内部：正文原文
  business_types_json       TEXT NOT NULL DEFAULT '[]',
  main_products_json        TEXT NOT NULL DEFAULT '[]',
  system_certifications_json TEXT NOT NULL DEFAULT '[]',
  management_certifications_json TEXT NOT NULL DEFAULT '[]', -- 内部：详情 HTML 原文切分
  rd_capacity_json          TEXT NOT NULL DEFAULT '[]',
  online_trade_able         INTEGER CHECK (online_trade_able IN (0,1)),
  leading_factory           INTEGER CHECK (leading_factory IN (0,1)),
  logo_url                  TEXT,
  rating_value              REAL,                   -- 详情评分（与 reviews 交叉校验）
  rating_display            TEXT,
  review_list_url           TEXT,
  sgs_member                INTEGER CHECK (sgs_member IN (0,1)),
  field_sources_json        TEXT NOT NULL DEFAULT '{}',  -- {字段: json|html|derived}
  availability_json         TEXT NOT NULL DEFAULT '[]',  -- [{field,reason}]
  ssr_raw_json              TEXT,                   -- ssrData 原文（可选，≤64KB 截断）
  minisite_url              TEXT,
  fetched_at                INTEGER NOT NULL,
  expires_at                INTEGER NOT NULL,
  source                    TEXT NOT NULL CHECK (source IN ('json','html','browser','cache')),
  result_status             TEXT NOT NULL DEFAULT 'success'
                            CHECK (result_status IN ('success','partial','stale')),
  warnings_json             TEXT NOT NULL DEFAULT '[]',
  last_request_id           TEXT
);
CREATE INDEX IF NOT EXISTS idx_company_details_expires ON company_details(expires_at);

-- 8) 会员等级判定 -------------------------------------------------------
CREATE TABLE IF NOT EXISTS membership_info (
  account                TEXT PRIMARY KEY
                         REFERENCES companies(account) ON DELETE CASCADE,
  tier                   TEXT NOT NULL DEFAULT 'unknown'
                         CHECK (tier IN ('diamond','gold','free','unknown')),
  raw_cs_level           INTEGER,
  raw_member_level       TEXT CHECK (raw_member_level IN ('diamond','gold')),
  since_year             INTEGER CHECK (since_year BETWEEN 1999 AND 2100),
  evidence_json          TEXT NOT NULL DEFAULT '[]',   -- string[]
  confidence             TEXT NOT NULL DEFAULT 'low'
                         CHECK (confidence IN ('high','medium','low')),
  -- 内部附加列：
  member_type            INTEGER,
  is_diamond_member      INTEGER CHECK (is_diamond_member IN (0,1)),
  tier_source            TEXT NOT NULL DEFAULT 'none'
                         CHECK (tier_source IN ('detail_ssr','list_json','pc_badge','derived','none')),
  has_conflict           INTEGER NOT NULL DEFAULT 0 CHECK (has_conflict IN (0,1)),
  external_customer_tier TEXT,                        -- 外部口径预留（KA/SKA/优享…），默认 NULL
  updated_at             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_membership_tier ON membership_info(tier);

-- 9) 认证供应商 / 审核章节 ---------------------------------------------
CREATE TABLE IF NOT EXISTS audit_info (
  account                TEXT PRIMARY KEY
                         REFERENCES companies(account) ON DELETE CASCADE,
  audited                INTEGER CHECK (audited IN (0,1)),
  sections_json          TEXT NOT NULL DEFAULT '[]', -- [{name,audited}]
  audited_section_count  INTEGER CHECK (audited_section_count BETWEEN 0 AND 9),
  agency                 TEXT,                       -- 首期不抓，NULL
  report_no              TEXT,                       -- 首期不抓，NULL
  verify_url             TEXT,                       -- 首期不抓，NULL
  verified_items_count   INTEGER,                    -- 首期不抓，NULL
  evidence_json          TEXT NOT NULL DEFAULT '[]', -- 内部
  source                 TEXT CHECK (source IN ('json','html','browser','cache')),
  fetched_at             INTEGER,
  expires_at             INTEGER,
  result_status          TEXT DEFAULT 'success'
                         CHECK (result_status IN ('success','partial','stale')),
  warnings_json          TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_audit_info_expires ON audit_info(expires_at);

-- 10) 响应率（30 天窗口） ----------------------------------------------
CREATE TABLE IF NOT EXISTS response_info (
  account                TEXT PRIMARY KEY
                         REFERENCES companies(account) ON DELETE CASCADE,
  avg_response_hours     REAL CHECK (avg_response_hours IS NULL OR avg_response_hours >= 0),
  timely_reply_ratio     REAL CHECK (timely_reply_ratio IS NULL OR timely_reply_ratio BETWEEN 0 AND 1),
  top_avg_response_hours REAL CHECK (top_avg_response_hours IS NULL OR top_avg_response_hours >= 0),
  top_timely_reply_ratio REAL CHECK (top_timely_reply_ratio IS NULL OR top_timely_reply_ratio BETWEEN 0 AND 1),
  range_display          TEXT,
  window_days            INTEGER NOT NULL DEFAULT 30 CHECK (window_days = 30),
  as_of                  TEXT,                       -- YYYYMMDD
  source                 TEXT NOT NULL CHECK (source IN ('json','html','browser','cache')),
  fetched_at             INTEGER NOT NULL,
  expires_at             INTEGER NOT NULL,
  availability_reason    TEXT CHECK (availability_reason IN
                         ('not_provided_by_supplier','not_public_by_platform',
                          'no_reviews','fetch_blocked','needs_login')),
  result_status          TEXT NOT NULL DEFAULT 'success'
                         CHECK (result_status IN ('success','partial','stale')),
  warnings_json          TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_response_info_expires ON response_info(expires_at);

-- 11) 联系人 / 联系通道 -------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_info (
  account                   TEXT PRIMARY KEY
                            REFERENCES companies(account) ON DELETE CASCADE,
  persons_json              TEXT NOT NULL DEFAULT '[]',  -- [{name,id,title,department,online,chat_available}]
  primary_json              TEXT,                        -- 首期不抓，NULL
  channels_json             TEXT NOT NULL DEFAULT '{}',  -- 五通道 null + reason=not_public_by_platform
  inquiry_url               TEXT,
  source                    TEXT NOT NULL CHECK (source IN ('json','html','browser','cache')),
  fetched_at                INTEGER NOT NULL,
  expires_at                INTEGER NOT NULL,
  result_status             TEXT NOT NULL DEFAULT 'success'
                            CHECK (result_status IN ('success','partial','stale')),
  warnings_json             TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_contact_info_expires ON contact_info(expires_at);

-- 12) 评分 / 评价摘要 ---------------------------------------------------
CREATE TABLE IF NOT EXISTS review_summary (
  account             TEXT PRIMARY KEY
                      REFERENCES companies(account) ON DELETE CASCADE,
  rating_value        REAL CHECK (rating_value IS NULL OR rating_value BETWEEN 0 AND 5),
  rating_display      TEXT,
  review_count        INTEGER CHECK (review_count IS NULL OR review_count >= 0),
  items_json          TEXT NOT NULL DEFAULT '[]',   -- ≤10 条脱敏摘要
  source              TEXT NOT NULL CHECK (source IN ('json','html','browser','cache')),
  fetched_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  availability_reason TEXT CHECK (availability_reason IN
                      ('not_provided_by_supplier','not_public_by_platform',
                       'no_reviews','fetch_blocked','needs_login')),
  result_status       TEXT NOT NULL DEFAULT 'success'
                      CHECK (result_status IN ('success','partial','stale')),
  warnings_json       TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_review_summary_expires ON review_summary(expires_at);

-- 13) 地区字典：省 ------------------------------------------------------
CREATE TABLE IF NOT EXISTS regions_provinces (
  id                 INTEGER PRIMARY KEY,
  name_en            TEXT NOT NULL UNIQUE,          -- REST provinces[].name（MIC 英文展示名）
  name_zh            TEXT NOT NULL,                 -- 本地中文 seed
  api_value          TEXT NOT NULL UNIQUE,          -- m 站 province 参数值（特殊项不同）
  com_province_value TEXT,                          -- PC comProvince（兜底，部分待验证）
  seo_code           TEXT UNIQUE,                   -- C1--CP_Hebei
  city_count         INTEGER,                       -- 已收录城市数（NULL=未知）
  cities_complete    INTEGER NOT NULL DEFAULT 0 CHECK (cities_complete IN (0,1)),
  in_mobile_facet    INTEGER NOT NULL DEFAULT 0 CHECK (in_mobile_facet IN (0,1)),
  in_seo_facet       INTEGER NOT NULL DEFAULT 0 CHECK (in_seo_facet IN (0,1)),
  sort_order         INTEGER NOT NULL DEFAULT 0,
  source             TEXT NOT NULL DEFAULT 'bootstrap'
                     CHECK (source IN ('refine','seo_facet','static','bootstrap')),
  verified_at        INTEGER,
  updated_at         INTEGER NOT NULL
);

-- 14) 地区字典：市 ------------------------------------------------------
CREATE TABLE IF NOT EXISTS regions_cities (
  id          INTEGER PRIMARY KEY,
  province_id INTEGER NOT NULL
              REFERENCES regions_provinces(id) ON DELETE CASCADE,
  name_en     TEXT NOT NULL,                        -- REST cities[].name
  name_zh     TEXT,                                 -- REST cities[].name_zh
  seo_code    TEXT,                                 -- C1--CP_Hebei--CC_Hebei_Langfang
  aliases_json TEXT NOT NULL DEFAULT '[]',
  count_hint  INTEGER,
  source      TEXT NOT NULL DEFAULT 'seo_facet'
              CHECK (source IN ('seo_facet','static','derive')),
  verified    INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
  verified_at INTEGER,
  updated_at  INTEGER NOT NULL,
  UNIQUE (province_id, name_en),
  UNIQUE (province_id, seo_code)
);
CREATE INDEX IF NOT EXISTS idx_regions_cities_province ON regions_cities(province_id);

-- 15) 通用 KV 缓存（refine/suggest/region 快照/aux） --------------------
CREATE TABLE IF NOT EXISTS cache_entries (
  cache_key        TEXT PRIMARY KEY,
  scope            TEXT NOT NULL
                   CHECK (scope IN ('search','detail','enrich','regions','aux')),
  kind             TEXT NOT NULL,                  -- refine | suggest | region_snapshot | aux_json
  params_json      TEXT NOT NULL DEFAULT '{}',
  payload_json     TEXT,
  payload_encoding TEXT NOT NULL DEFAULT 'identity'
                   CHECK (payload_encoding IN ('identity','gzip-base64')),
  source           TEXT NOT NULL CHECK (source IN ('json','html','browser','cache')),
  result_status    TEXT NOT NULL DEFAULT 'success'
                   CHECK (result_status IN ('success','partial','stale')),
  fetched_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  size_bytes       INTEGER NOT NULL DEFAULT 0,
  hit_count        INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER,
  warnings_json    TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_cache_entries_scope_expires
  ON cache_entries(scope, expires_at);

-- 16) 原始快照（可选，默认关闭） ---------------------------------------
CREATE TABLE IF NOT EXISTS raw_snapshots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id        TEXT NOT NULL,
  url               TEXT NOT NULL,
  method            TEXT NOT NULL DEFAULT 'GET',
  http_status       INTEGER,
  content_type      TEXT,
  request_meta_json TEXT NOT NULL DEFAULT '{}',     -- 脱敏后请求信息（无 Cookie/Authorization）
  response_sha256   TEXT NOT NULL,
  body_path         TEXT NOT NULL,                  -- 相对 data_dir 的 gzip 文件
  body_bytes        INTEGER NOT NULL,
  body_encoding     TEXT NOT NULL DEFAULT 'gzip'
                    CHECK (body_encoding IN ('gzip','identity')),
  purpose           TEXT NOT NULL DEFAULT 'debug'
                    CHECK (purpose IN ('debug','parse_error','upstream_changed','captcha')),
  error_code        TEXT,                           -- 引用 README 错误码
  created_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_raw_snapshots_created ON raw_snapshots(created_at);
`;
