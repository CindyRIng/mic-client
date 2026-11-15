/**
 * OpenAPI 3.1 description of the MIC Client REST API (docs/03 §2.3, ADR-0008).
 *
 * The document is generated in-process so `/openapi.json` and `/docs` share the
 * exact same source of truth (no external Swagger file to drift). Paths here are
 * deliberately limited to the 8 business endpoints; the auxiliary `/docs` and
 * `/openapi.json` endpoints are not part of the API contract.
 */
import { VERSION } from '../../version.js';

type Json = Record<string, unknown>;

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });

const okResponse = (description: string, schema: string): Json => ({
  description,
  content: { 'application/json': { schema: ref(schema) } },
});

const errorResponse = (description: string): Json => ({
  description,
  content: { 'application/json': { schema: ref('ErrorEnvelope') } },
});

const q = (name: string, schema: Json, description: string, required = false): Json => ({
  name,
  in: 'query',
  required,
  schema,
  description,
});

const pathParam = (name: string, description: string): Json => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description,
});

function componentSchemas(): Record<string, Json> {
  return {
    Meta: {
      type: 'object',
      required: ['request_id', 'cached', 'stale', 'fetched_at', 'source', 'warnings'],
      properties: {
        request_id: { type: 'string', pattern: '^req_[a-z0-9]+$', examples: ['req_m3x9q1k2c8'] },
        cached: { type: 'boolean' },
        stale: { type: 'boolean' },
        fetched_at: { type: ['string', 'null'], format: 'date-time', examples: ['2026-11-15T22:59:00+08:00'] },
        source: { type: 'string', enum: ['json', 'html', 'browser', 'cache'] },
        warnings: { type: 'array', items: ref('Warning') },
      },
    },
    Warning: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          description: 'canonical warning code (docs/README §3.5; 22 codes)',
          examples: ['CITY_FILTERED_LOCALLY'],
        },
        message: { type: 'string' },
        details: { type: ['object', 'null'], additionalProperties: true },
      },
      additionalProperties: false,
    },
    ErrorObject: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          enum: [
            'INVALID_PARAM',
            'NOT_FOUND',
            'UPSTREAM_CHANGED',
            'UPSTREAM_UNAVAILABLE',
            'RATE_LIMITED',
            'CAPTCHA_REQUIRED',
            'CAPTCHA_SOLVE_FAILED',
            'NEED_HUMAN_VERIFICATION',
            'PARSE_ERROR',
            'CONFIG_ERROR',
            'INTERNAL_ERROR',
          ],
        },
        message: { type: 'string' },
        details: { type: ['object', 'null'], additionalProperties: true },
      },
    },
    ErrorEnvelope: {
      type: 'object',
      required: ['ok', 'error', 'meta'],
      properties: {
        ok: { const: false },
        error: ref('ErrorObject'),
        meta: ref('Meta'),
      },
    },
    Pagination: {
      type: 'object',
      required: [
        'page',
        'page_size',
        'total',
        'total_page',
        'has_more',
        'total_capped',
        'total_display',
        'page_clamped',
        'total_is_lower_bound',
      ],
      properties: {
        page: { type: 'integer', minimum: 1, maximum: 100, description: 'requested page (echo)' },
        page_size: { type: 'integer', minimum: 1, maximum: 100 },
        total: { type: 'integer', minimum: 0, description: 'upstream total; 2000 when capped (lower bound)' },
        total_page: { type: 'integer', minimum: 1 },
        has_more: { type: 'boolean' },
        total_capped: { type: 'boolean' },
        total_display: { type: 'string', examples: ['670', '2,000+'] },
        page_clamped: { type: 'boolean', description: 'requested page exceeded total_page and was clamped to the last page' },
        total_is_lower_bound: { type: 'boolean', description: 'true when a local city/audited scan was not exhaustive' },
      },
    },
    MembershipInfo: {
      type: 'object',
      required: ['tier', 'raw_cs_level', 'raw_member_level', 'since_year', 'evidence', 'confidence'],
      properties: {
        tier: { type: 'string', enum: ['diamond', 'gold', 'free', 'unknown'] },
        raw_cs_level: { type: ['integer', 'null'], description: 'upstream csLevel (50=diamond, 30=gold)' },
        raw_member_level: { type: ['string', 'null'], enum: ['diamond', 'gold', null] },
        since_year: { type: ['integer', 'null'], description: 'membership start year (memberSince), not establishment' },
        evidence: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
    CompanyListItem: {
      type: 'object',
      required: ['account', 'company_name', 'membership', 'audited', 'is_ad'],
      properties: {
        account: { type: 'string', examples: ['xingchenglass'] },
        company_id: { type: ['string', 'null'] },
        encode_com_id: { type: ['string', 'null'] },
        company_name: { type: 'string' },
        province: { type: ['string', 'null'] },
        city: { type: ['string', 'null'] },
        country: { type: ['string', 'null'] },
        main_products: { type: 'array', items: { type: 'string' } },
        business_types: { type: 'array', items: { type: 'string' } },
        membership: ref('MembershipInfo'),
        audited: { type: ['boolean', 'null'], description: 'Audited Supplier (orthogonal to membership tier)' },
        capability_stars: { type: ['integer', 'null'], minimum: 0, maximum: 5 },
        system_certifications: { type: 'array', items: { type: 'string' } },
        employees: { type: ['integer', 'null'] },
        turnover: { type: ['string', 'null'] },
        plant_area: { type: ['string', 'null'] },
        company_url: { type: ['string', 'null'] },
        company_info_url: { type: ['string', 'null'] },
        detail_source: { type: 'string', enum: ['json', 'html', 'browser', 'cache'] },
        is_ad: { type: 'boolean', description: 'advertisement slot item' },
      },
    },
    SearchQuery: {
      type: 'object',
      properties: {
        keyword: { type: ['string', 'null'] },
        keyword_effective: { type: 'string' },
        province: { type: ['string', 'null'] },
        province_zh: { type: ['string', 'null'] },
        city: { type: ['string', 'null'] },
        city_zh: { type: ['string', 'null'] },
        search_mode: { type: 'string', enum: ['keyword', 'region', 'mixed'] },
        region_validated: { type: 'boolean' },
        filters: { type: 'object', additionalProperties: true },
        page: { type: 'integer' },
        page_size: { type: 'integer' },
        refresh: { type: 'boolean' },
        include_ads: { type: 'boolean' },
      },
    },
    SearchResult: {
      type: 'object',
      required: ['query', 'pagination', 'items'],
      properties: {
        query: ref('SearchQuery'),
        pagination: ref('Pagination'),
        items: { type: 'array', items: ref('CompanyListItem') },
      },
    },
    SearchResponse: {
      type: 'object',
      required: ['ok', 'data', 'meta'],
      properties: { ok: { const: true }, data: ref('SearchResult'), meta: ref('Meta') },
    },
    AvailabilityItem: {
      type: 'object',
      required: ['field', 'reason'],
      properties: {
        field: { type: 'string', examples: ['employees'] },
        reason: {
          type: 'string',
          enum: [
            'not_provided_by_supplier',
            'not_public_by_platform',
            'no_reviews',
            'fetch_blocked',
            'not_indexed_locally',
          ],
        },
      },
    },
    EnrichmentSection: {
      type: ['object', 'null'],
      additionalProperties: true,
      description: 'audit / response / contacts / reviews section (docs/03 §11.6–§11.9); null when not requested',
    },
    CompanyDetail: {
      type: 'object',
      required: [
        'account',
        'company_name',
        'membership',
        'audited',
        'main_products',
        'availability',
        'include',
        'detail_source',
      ],
      properties: {
        account: { type: 'string' },
        company_id: { type: ['string', 'null'] },
        encode_com_id: { type: ['string', 'null'] },
        company_name: { type: 'string' },
        province: { type: ['string', 'null'] },
        city: { type: ['string', 'null'] },
        country: { type: ['string', 'null'] },
        address: { type: ['string', 'null'] },
        established_at: { type: ['string', 'null'], examples: ['2015-10-30'] },
        main_products: { type: 'array', items: { type: 'string' } },
        business_types: { type: 'array', items: { type: 'string' } },
        membership: ref('MembershipInfo'),
        audited: { type: ['boolean', 'null'] },
        capability_stars: { type: ['integer', 'null'] },
        system_certifications: { type: 'array', items: { type: 'string' } },
        employees: { type: ['integer', 'null'] },
        turnover: { type: ['string', 'null'] },
        plant_area: { type: ['string', 'null'] },
        company_url: { type: ['string', 'null'] },
        company_info_url: { type: ['string', 'null'] },
        detail_source: { type: 'string', enum: ['json', 'html', 'browser', 'cache'] },
        include: { type: 'array', items: { type: 'string', enum: ['audit', 'response', 'contacts', 'reviews'] } },
        enrichment: {
          type: 'object',
          properties: {
            audit: ref('EnrichmentSection'),
            response: ref('EnrichmentSection'),
            contacts: ref('EnrichmentSection'),
            reviews: ref('EnrichmentSection'),
          },
        },
        availability: { type: 'array', items: ref('AvailabilityItem') },
      },
    },
    CompanyResponse: {
      type: 'object',
      required: ['ok', 'data', 'meta'],
      properties: { ok: { const: true }, data: ref('CompanyDetail'), meta: ref('Meta') },
    },
    RegionProvince: {
      type: 'object',
      required: ['name', 'name_zh', 'api_value', 'city_count', 'cities_complete'],
      properties: {
        name: { type: 'string', examples: ['Hebei'] },
        name_zh: { type: 'string', examples: ['河北'] },
        api_value: { type: 'string', examples: ['Hebei'] },
        city_count: { type: ['integer', 'null'], examples: [10] },
        cities_complete: { type: 'boolean' },
        source: { type: 'string', enum: ['refine', 'seo_facet', 'static'] },
        verified_at: { type: 'string', format: 'date-time' },
      },
    },
    RegionCity: {
      type: 'object',
      required: ['name', 'name_zh', 'province', 'verified'],
      properties: {
        name: { type: 'string', examples: ['Langfang'] },
        name_zh: { type: 'string', examples: ['廊坊'] },
        province: { type: 'string' },
        source: { type: 'string' },
        verified: { type: 'boolean' },
        count_hint: { type: ['integer', 'null'] },
      },
    },
    ProvincesResult: {
      type: 'object',
      required: ['count', 'provinces'],
      properties: {
        count: { type: 'integer', examples: [32] },
        provinces: { type: 'array', items: ref('RegionProvince') },
      },
    },
    ProvinceDetailResult: {
      type: 'object',
      required: ['province', 'cities'],
      properties: {
        province: ref('RegionProvince'),
        cities: { type: 'array', items: ref('RegionCity') },
      },
    },
    ProvincesResponse: {
      type: 'object',
      required: ['ok', 'data', 'meta'],
      properties: { ok: { const: true }, data: ref('ProvincesResult'), meta: ref('Meta') },
    },
    ProvinceDetailResponse: {
      type: 'object',
      required: ['ok', 'data', 'meta'],
      properties: { ok: { const: true }, data: ref('ProvinceDetailResult'), meta: ref('Meta') },
    },
    MembershipTier: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['diamond', 'gold', 'free', 'unknown'] },
        label: { type: 'string' },
        description: { type: 'string' },
        price_cny_per_year: { type: ['integer', 'null'] },
        visible_on_page: { type: 'boolean' },
      },
    },
    MembershipLevelsResult: {
      type: 'object',
      required: ['tiers'],
      properties: {
        tiers: { type: 'array', items: ref('MembershipTier') },
        audit: { type: 'object', additionalProperties: true },
        big_customer_programs: { type: 'array', items: { type: 'object' } },
        not_mic_tiers: { type: 'array', items: { type: 'object' } },
        notes: { type: 'array', items: { type: 'string' } },
      },
    },
    MembershipLevelsResponse: {
      type: 'object',
      required: ['ok', 'data', 'meta'],
      properties: { ok: { const: true }, data: ref('MembershipLevelsResult'), meta: ref('Meta') },
    },
    HealthResult: {
      type: 'object',
      required: ['status', 'version', 'api_version', 'uptime_seconds', 'started_at'],
      properties: {
        status: { type: 'string', enum: ['ok', 'degraded'] },
        version: { type: 'string' },
        api_version: { type: 'string', examples: ['v1'] },
        uptime_seconds: { type: 'integer' },
        started_at: { type: 'string', format: 'date-time' },
        session: { type: 'object', additionalProperties: true },
        cache: { type: 'object', additionalProperties: true },
        upstream: { type: 'object', additionalProperties: true },
      },
    },
    HealthResponse: {
      type: 'object',
      required: ['ok', 'data', 'meta'],
      properties: { ok: { const: true }, data: ref('HealthResult'), meta: ref('Meta') },
    },
    VersionResult: {
      type: 'object',
      required: ['version', 'node', 'schema_version'],
      properties: {
        version: { type: 'string' },
        node: { type: 'string' },
        schema_version: { type: 'integer' },
        upstream_contract: { type: 'object', additionalProperties: true },
      },
    },
    VersionResponse: {
      type: 'object',
      required: ['ok', 'data', 'meta'],
      properties: { ok: { const: true }, data: ref('VersionResult'), meta: ref('Meta') },
    },
    CacheStats: {
      type: 'object',
      required: ['enabled', 'db', 'entries', 'stale_entries', 'ttl_seconds'],
      properties: {
        enabled: { type: 'boolean' },
        db: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            schema_version: { type: 'integer' },
            size_bytes: { type: 'integer' },
            wal_size_bytes: { type: 'integer' },
            ok: { type: 'boolean' },
          },
        },
        entries: {
          type: 'object',
          properties: {
            search_pages: { type: 'integer' },
            search_indexes: { type: 'integer' },
            companies: { type: 'integer' },
            company_details: { type: 'integer' },
            enrichment: { type: 'integer' },
            regions: { type: 'integer' },
            total: { type: 'integer' },
          },
        },
        stale_entries: { type: 'integer' },
        hit_stats: { type: 'object', additionalProperties: true },
        ttl_seconds: { type: 'object', additionalProperties: { type: 'integer' } },
      },
    },
    CacheStatsResponse: {
      type: 'object',
      required: ['ok', 'data', 'meta'],
      properties: { ok: { const: true }, data: ref('CacheStats'), meta: ref('Meta') },
    },
    CacheRefreshRequest: {
      type: 'object',
      required: ['scope'],
      properties: {
        scope: { type: 'string', enum: ['search', 'company', 'regions', 'all'] },
        wait: { type: 'boolean', default: false, description: 'true = synchronously refetch after invalidation' },
        target: {
          type: ['object', 'null'],
          additionalProperties: true,
          description: 'search: query params; company: account/include; required unless scope=all',
        },
      },
    },
    InvalidatedCounts: {
      type: 'object',
      properties: {
        search_pages: { type: 'integer' },
        search_indexes: { type: 'integer' },
        companies: { type: 'integer' },
        company_details: { type: 'integer' },
        enrichment: { type: 'integer' },
        regions: { type: 'integer' },
        total: { type: 'integer' },
      },
    },
    RefreshResult: {
      type: 'object',
      required: ['scope', 'wait', 'enabled', 'target', 'invalidated', 'result'],
      properties: {
        scope: { type: 'string', enum: ['search', 'company', 'regions', 'all'] },
        wait: { type: 'boolean' },
        enabled: { type: 'boolean' },
        target: { type: ['object', 'null'], additionalProperties: true },
        invalidated: ref('InvalidatedCounts'),
        result: { type: ['object', 'null'], additionalProperties: true },
      },
    },
    RefreshResponse: {
      type: 'object',
      required: ['ok', 'data', 'meta'],
      properties: { ok: { const: true }, data: ref('RefreshResult'), meta: ref('Meta') },
    },
  };
}

export function buildOpenApiDocument(): Json {
  return {
    openapi: '3.1.0',
    info: {
      title: 'MIC Client REST API',
      version: VERSION,
      license: { name: 'MIT', identifier: 'MIT' },
      description:
        'Made-in-China local client REST API (docs/03-rest-api.md).\n\n' +
        '- Loopback-only (`127.0.0.1` / `localhost` / `[::1]`), no authentication.\n' +
        '- Successful responses use the unified envelope `{ok,data,meta}`; failures `{ok,error,meta}`.\n' +
        '- This document covers the 8 business endpoints only; `/docs` and `/openapi.json` are auxiliary.\n' +
        '- Contract: https://github.com/CindyRIng/mic-client/blob/main/docs/03-rest-api.md',
    },
    servers: [
      { url: 'http://127.0.0.1:8899', description: 'default local loopback' },
      { url: 'http://localhost:8899', description: 'localhost alias' },
    ],
    tags: [
      { name: 'System', description: 'health / version / diagnostics' },
      { name: 'Regions', description: 'province & city dictionary (local materialized, no upstream)' },
      { name: 'Search', description: 'supplier/factory search (JSON-first upstream)' },
      { name: 'Company', description: 'company detail, membership, audited, enrichment' },
      { name: 'Membership', description: 'membership tier semantics (diamond/gold/free/unknown; KA/SKA note)' },
      { name: 'Cache', description: 'local SQLite cache stats and invalidation/refresh' },
    ],
    paths: {
      '/health': {
        get: {
          tags: ['System'],
          operationId: 'getHealth',
          summary: 'Health check',
          description: 'Liveness check. `deep=true` performs DB/profile/upstream probes (slower).',
          parameters: [q('deep', { type: 'boolean', default: false }, 'deep probe (upstream + cache write)', false)],
          responses: {
            200: okResponse('healthy', 'HealthResponse'),
            400: errorResponse('invalid parameter'),
          },
        },
      },
      '/api/version': {
        get: {
          tags: ['System'],
          operationId: 'getVersion',
          summary: 'Version and schema info',
          responses: {
            200: okResponse('version info', 'VersionResponse'),
          },
        },
      },
      '/api/regions': {
        get: {
          tags: ['Regions'],
          operationId: 'listRegions',
          summary: 'List provinces or one province with cities',
          description:
            'Without `province`: `ProvincesResult {count, provinces[]}`. With `province`: ' +
            '`ProvinceDetailResult {province, cities[]}`. Local materialized dictionary; no upstream call.',
          parameters: [
            q('province', { type: 'string' }, 'English (Hebei) or Chinese (河北) province name'),
            q('refresh', { type: 'boolean', default: false }, 'invalidate local regions cache before reading'),
          ],
          responses: {
            200: {
              description: 'province dictionary',
              content: {
                'application/json': { schema: { oneOf: [ref('ProvincesResponse'), ref('ProvinceDetailResponse')] } },
              },
            },
            400: errorResponse('unknown province / invalid parameter'),
          },
        },
      },
      '/api/search/factories': {
        get: {
          tags: ['Search'],
          operationId: 'searchFactories',
          summary: 'Search supplier factories',
          description:
            'Keyword and/or province/city (at least one required). City and audited filters are applied ' +
            'client-side due to upstream limitations; non-exhaustive totals are flagged via warnings.',
          parameters: [
            q('keyword', { type: 'string' }, 'English keyword / region word (e.g. glass, hebei, langfang)'),
            q('province', { type: 'string' }, 'province (English or Chinese)'),
            q('city', { type: 'string' }, 'city (English or Chinese; client-side filter)'),
            q('category_code', { type: 'string', pattern: '^[0-9]{6,12}$' }, 'upstream category code'),
            q('membership_tier', { type: 'string', enum: ['diamond', 'gold'] }, 'membership filter'),
            q('audited', { type: 'boolean' }, 'only Audited Suppliers (client-side filter)'),
            q('management_certification', { type: 'string' }, 'upstream certification code, e.g. -5'),
            q(
              'business_type',
              { type: 'string', enum: ['manufacturer', 'trading_company', 'group_corporation', 'other'] },
              'business type filter',
            ),
            q(
              'annual_revenue',
              {
                type: 'string',
                enum: [
                  'under_1m_usd',
                  '1m_2_5m_usd',
                  '2_5m_5m_usd',
                  '5m_10m_usd',
                  '10m_50m_usd',
                  '50m_100m_usd',
                  'over_100m_usd',
                ],
              },
              'annual revenue bucket',
            ),
            q(
              'rd_capacity',
              {
                type: 'string',
                enum: ['oem', 'odm', 'quick_response', 'fast_delivery', 'small_amount_payment'],
              },
              'R&D / service capability',
            ),
            q('page', { type: 'integer', minimum: 1, maximum: 100, default: 1 }, 'page number (echoed; clamped to last page)'),
            q('page_size', { type: 'integer', minimum: 1, maximum: 100, default: 20 }, 'page size (upstream native = 20)'),
            q('refresh', { type: 'boolean', default: false }, 'skip cache read, force upstream fetch'),
            q('include_ads', { type: 'boolean', default: true }, 'keep advertisement items (is_ad=true)'),
          ],
          responses: {
            200: okResponse('search result', 'SearchResponse'),
            400: errorResponse('invalid parameter'),
            429: errorResponse('rate limited (QueueTimeout); honour Retry-After)'),
            502: errorResponse('upstream unavailable / captcha challenge'),
            504: errorResponse('upstream timeout'),
          },
        },
      },
      '/api/companies/{account}': {
        get: {
          tags: ['Company'],
          operationId: 'getCompany',
          summary: 'Company detail (membership + audited + optional enrichment)',
          description:
            'Accepts account (`xingchenglass`), numeric comId, encodeComId (locally indexed), or a company URL. ' +
            'Anonymous public profile only: phone/email channels are null with `not_public_by_platform`.',
          parameters: [
            pathParam('account', 'account / numeric comId / encodeComId / URL'),
            q(
              'include',
              { type: 'string', default: 'audit,response' },
              'comma list: audit,response,contacts,reviews | all | none',
            ),
            q('refresh', { type: 'boolean', default: false }, 'skip detail cache and refetch'),
          ],
          responses: {
            200: okResponse('company detail', 'CompanyResponse'),
            400: errorResponse('invalid parameter / include'),
            404: errorResponse('company not found'),
            502: errorResponse('upstream unavailable / captcha challenge'),
            504: errorResponse('upstream timeout'),
          },
        },
      },
      '/api/membership/levels': {
        get: {
          tags: ['Membership'],
          operationId: 'listMembershipLevels',
          summary: 'Membership tier semantics',
          description:
            'diamond/gold/free/unknown + audited note; KA/SKA are Alibaba International terms, not MIC tiers.',
          responses: {
            200: okResponse('membership levels', 'MembershipLevelsResponse'),
          },
        },
      },
      '/api/cache/refresh': {
        post: {
          tags: ['Cache'],
          operationId: 'refreshCache',
          summary: 'Invalidate (and optionally synchronously refetch) cache entries',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: ref('CacheRefreshRequest') } },
          },
          responses: {
            200: okResponse('refresh result', 'RefreshResponse'),
            400: errorResponse('invalid scope/target/JSON body'),
          },
        },
      },
      '/api/cache/stats': {
        get: {
          tags: ['Cache'],
          operationId: 'getCacheStats',
          summary: 'Cache statistics',
          responses: {
            200: okResponse('cache stats', 'CacheStatsResponse'),
          },
        },
      },
    },
    components: { schemas: componentSchemas() },
  };
}
