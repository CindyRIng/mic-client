/**
 * MCP tool/resource definitions (docs/04 §3.4/§3.5). JSON Schemas are verbatim from
 * the contract (draft-07 style, additionalProperties:false). Handlers validate input
 * manually so the same INVALID_PARAM envelope is returned by all three entries.
 */

export interface JsonObject {
  [key: string]: unknown;
}

export interface McpToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObject;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

export const TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'search_factories',
    title: 'Search Made-in-China factories',
    description:
      'Search Made-in-China suppliers (factories) by English keyword, Chinese province/city, or region-keyword mode (omit keyword and pass province/city). Returns normalized company list items with membership tier, audited flag, location, main products, stars and certifications. At least one of keyword/province/city is required. City and audited filters are client-side and may be non-exhaustive. include_ads defaults to true (entries are kept and marked is_ad); set false to filter ads and emit ADS_FILTERED. page_size>20 is emulated with extra upstream pages.',
    annotations: { ...READ_ONLY, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        keyword: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
          description:
            'English keyword, e.g. glass. Chinese keywords are rejected (NON_ENGLISH_KEYWORD) unless they map to a Chinese region name, in which case they switch to region mode. Omit when using region mode.',
        },
        province: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          description:
            'Province name in English (e.g. Hebei) or Chinese (e.g. 河北). Valid values: list_regions (32 provinces).',
        },
        city: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          description:
            'City name in English (e.g. Langfang) or Chinese (e.g. 廊坊). Province is inferred when omitted. City filtering is applied client-side.',
        },
        page: { type: 'integer', minimum: 1, maximum: 100, default: 1, description: '1-based page number.' },
        page_size: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 20,
          description:
            'Items per page. Upstream page size is fixed at 20; other values trigger extra upstream pages and a PAGE_SIZE_NOT_NATIVE warning.',
        },
        category_code: {
          type: 'string',
          pattern: '^[0-9]{6,12}$',
          description:
            'Upstream category code, e.g. 1500000000 (passed through by default; in strict_params mode an unknown code is rejected with CATEGORY_CODE_UNVERIFIED).',
        },
        membership_tier: {
          type: 'string',
          enum: ['diamond', 'gold'],
          description:
            'Filter by paid membership tier (upstream memberLevel 50/30). free/unknown are not filterable upstream (INVALID_PARAM).',
        },
        audited: {
          type: 'boolean',
          description:
            'true: only Audited Suppliers; false: exclude Audited Suppliers; omit: no filter. Applied client-side and may be non-exhaustive (CLIENT_SIDE_FILTER/NON_EXHAUSTIVE).',
        },
        management_certification: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          description:
            'Management-system certification code or name, e.g. -5 or ISO9001:2015. Distinct from audited. Unknown value: warning UNKNOWN_CERTIFICATION and the filter is ignored (no error).',
        },
        business_type: {
          type: 'string',
          enum: ['manufacturer', 'trading_company', 'group_corporation', 'other'],
          description: 'Upstream comBusinessType: manufacturer=1, trading_company=2, group_corporation=4, other=8.',
        },
        annual_revenue: {
          type: 'string',
          enum: ['under_1m_usd', '1m_2_5m_usd', '2_5m_5m_usd', '5m_10m_usd', '10m_50m_usd', '50m_100m_usd', 'over_100m_usd'],
          description: 'Annual revenue range mapped to upstream annualRevenue 1-7.',
        },
        rd_capacity: {
          type: 'string',
          enum: ['oem', 'odm', 'quick_response', 'fast_delivery', 'small_amount_payment'],
          description: 'Trade/R&D capacity mapped to upstream rdCapacity 4/5/01/02/03. Single value only in v1.',
        },
        refresh: {
          type: 'boolean',
          default: false,
          description: 'Bypass cached list data and re-fetch from upstream (write-through on success).',
        },
        include_ads: {
          type: 'boolean',
          default: true,
          description:
            'true: keep advertising entries in items (is_ad=true, 1:1 with upstream pagination); false: filter ads and emit ADS_FILTERED. CLI table hides ads by default regardless of this value.',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: 120000,
          description: 'Total call budget in milliseconds (queue wait + upstream + parse). Omit to use the tool default.',
        },
      },
      required: [],
      anyOf: [{ required: ['keyword'] }, { required: ['province'] }, { required: ['city'] }],
    },
  },
  {
    name: 'get_company',
    title: 'Get company profile',
    description:
      'Get a Made-in-China supplier profile: membership tier with evidence, audited flag, established date, employees, address, main products, certifications, and optional enrichment (audit sections, response metrics, TradeMessenger contacts, reviews). Identify the company by account (minisite subdomain or URL form), numeric com_id, or encode_com_id (encode ids must be known from a previous search). Enrichment failures return partial data with warnings, not errors. Phone/email/WhatsApp are not public on the platform and are always null.',
    annotations: { ...READ_ONLY, openWorldHint: true },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        account: {
          type: 'string',
          minLength: 1,
          maxLength: 200,
          description:
            'Minisite account, e.g. xingchenglass. Also accepts company- prefix, https://<account>.en.made-in-china.com/, or https://m.made-in-china.com/company-<account>/info.html forms.',
        },
        com_id: {
          type: 'string',
          pattern: '^[0-9]+$',
          description: 'Numeric company id, e.g. 1800987236. Resolved to an account via the mobile 301 redirect.',
        },
        encode_com_id: {
          type: 'string',
          pattern: '^[A-Za-z0-9]{6,32}$',
          description:
            'Opaque company id from list results, e.g. UCJfyzwThnqK. Must already be indexed locally (from a previous search); otherwise NOT_FOUND with reason ENCODE_COM_ID_NOT_INDEXED.',
        },
        include: {
          type: 'array',
          items: { type: 'string', enum: ['audit', 'response', 'contacts', 'reviews'] },
          uniqueItems: true,
          default: ['audit', 'response'],
          description:
            'Optional enrichments. Empty array = base profile only. REST equivalent: comma-separated include string (none/all/audit,response,contacts,reviews); unused enrichments are null and do not appear in availability.',
        },
        refresh: {
          type: 'boolean',
          default: false,
          description: 'Bypass cached base detail and requested enrichments, re-fetch from upstream.',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: 120000,
          description: 'Total call budget in milliseconds (queue wait + all upstream calls + parse).',
        },
      },
      required: [],
      anyOf: [{ required: ['account'] }, { required: ['com_id'] }, { required: ['encode_com_id'] }],
    },
  },
  {
    name: 'list_regions',
    title: 'List provinces and cities',
    description:
      'List the 32 Chinese provinces (including Qinghai) and known cities as understood by this client (English + Chinese names, dictionary completeness flags). Use it to validate province/city arguments before calling search_factories. Cities are client-side filters: the upstream JSON search has no city parameter. Data is a local materialized dictionary (no network) cached for 30 days.',
    annotations: { ...READ_ONLY, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        province: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          description: 'Optional province filter, English (Hebei) or Chinese (河北). Omit to list all 32 provinces.',
        },
        refresh: {
          type: 'boolean',
          default: false,
          description:
            'Re-validate/materialize the local region dictionary (same as REST /api/regions?refresh=true; does not directly access upstream).',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1000,
          maximum: 120000,
          description: 'Total call budget in milliseconds.',
        },
      },
    },
  },
  {
    name: 'explain_membership',
    title: 'Explain MIC membership tiers',
    description:
      'Explain Made-in-China membership semantics used by this client: diamond/gold/free/unknown tiers with official annual fees and evidence hints, the independent Audited Supplier flag, MIC big-customer programs (优享/尊享/MKA, not public badges), and the KA/SKA clarification (KA/SKA/GSKA are Alibaba.com segments and are never returned as MIC tiers). Pure static knowledge: no network call.',
    annotations: { ...READ_ONLY, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
  },
];

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const RESOURCE_DEFINITIONS: McpResourceDefinition[] = [
  {
    uri: 'mic://regions',
    name: 'Regions dictionary',
    description:
      '32 Chinese provinces with English/Chinese names, api_value and city-dictionary completeness flags (same data as list_regions).',
    mimeType: 'application/json',
  },
  {
    uri: 'mic://membership-levels',
    name: 'Membership levels',
    description:
      'MIC membership tiers (diamond/gold/free/unknown), Audited Supplier clarification, big-customer programs and the KA/SKA note (same data as explain_membership).',
    mimeType: 'application/json',
  },
];

export const TOOL_TIMEOUT_DEFAULTS: Record<string, number> = {
  search_factories: 30000,
  get_company: 45000,
  list_regions: 10000,
  explain_membership: 1000,
};
