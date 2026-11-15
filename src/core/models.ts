import { z } from 'zod';

export const membershipTierSchema = z.enum(['diamond', 'gold', 'free', 'unknown']);
export type MembershipTier = z.infer<typeof membershipTierSchema>;

export const sourceSchema = z.enum(['json', 'html', 'browser', 'cache']);
export type DataSource = z.infer<typeof sourceSchema>;

export const availabilityReasonSchema = z.enum([
  'not_provided_by_supplier',
  'not_public_by_platform',
  'no_reviews',
  'fetch_blocked',
  'needs_login',
]);
export type AvailabilityReason = z.infer<typeof availabilityReasonSchema>;

export const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).nullable().default(null),
});
export type WarningInfo = z.infer<typeof warningSchema>;

export const membershipInfoSchema = z.object({
  tier: membershipTierSchema,
  raw_cs_level: z.number().int().nullable(),
  raw_member_level: z.string().nullable(),
  since_year: z.number().int().nullable(),
  evidence: z.array(z.string()),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type MembershipInfo = z.infer<typeof membershipInfoSchema>;

export const companyListItemSchema = z.object({
  account: z.string(),
  company_id: z.string(),
  encode_com_id: z.string().nullable(),
  company_name: z.string(),
  province: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  main_products: z.array(z.string()),
  business_types: z.array(z.string()),
  membership: membershipInfoSchema,
  audited: z.boolean().nullable(),
  capability_stars: z.number().int().min(0).max(5).nullable(),
  system_certifications: z.array(z.string()),
  employees: z.number().int().nullable(),
  turnover: z.string().nullable(),
  plant_area: z.string().nullable(),
  company_url: z.string().nullable(),
  company_info_url: z.string().nullable(),
  detail_source: sourceSchema,
  is_ad: z.boolean(),
});
export type CompanyListItem = z.infer<typeof companyListItemSchema>;

export const auditSectionSchema = z.object({ name: z.string(), audited: z.boolean() });

export const auditInfoSchema = z.object({
  audited: z.boolean(),
  sections: z.array(auditSectionSchema),
  audited_section_count: z.number().int().min(0).max(9),
  agency: z.string().nullable(),
  report_no: z.string().nullable(),
  verify_url: z.string().nullable(),
  verified_items_count: z.number().int().nullable(),
  source: sourceSchema,
  fetched_at: z.string(),
});
export type AuditInfo = z.infer<typeof auditInfoSchema>;

export const responseInfoSchema = z.object({
  avg_response_hours: z.number().nullable(),
  timely_reply_ratio: z.number().nullable(),
  top_avg_response_hours: z.number().nullable(),
  top_timely_reply_ratio: z.number().nullable(),
  range_display: z.string().nullable(),
  window_days: z.number().int(),
  as_of: z.string(),
  source: sourceSchema,
  fetched_at: z.string(),
});
export type ResponseInfo = z.infer<typeof responseInfoSchema>;

export const contactPersonSchema = z.object({
  name: z.string(),
  id: z.string(),
  title: z.string().nullable(),
  department: z.string().nullable(),
  online: z.boolean().nullable(),
  chat_available: z.boolean(),
});
export type ContactPerson = z.infer<typeof contactPersonSchema>;

export const contactInfoSchema = z.object({
  persons: z.array(contactPersonSchema),
  primary: z.record(z.unknown()).nullable(),
  channels: z.object({
    phone: z.null(),
    email: z.null(),
    whatsapp: z.null(),
    skype: z.null(),
    wechat: z.null(),
    reason: z.literal('not_public_by_platform'),
  }),
  inquiry_url: z.string().nullable(),
  source: sourceSchema,
  fetched_at: z.string(),
});
export type ContactInfo = z.infer<typeof contactInfoSchema>;

export const reviewItemSchema = z.object({
  review_id: z.string(),
  rating: z.number().int(),
  title: z.string().nullable(),
  content: z.string().nullable(),
  sender_name: z.string().nullable(),
  sender_country: z.string().nullable(),
  created_at: z.string().nullable(),
  product_title: z.string().nullable(),
  product_url: z.string().nullable(),
});

export const reviewSummarySchema = z.object({
  rating_value: z.number().nullable(),
  rating_display: z.string().nullable(),
  review_count: z.number().int().nullable(),
  items: z.array(reviewItemSchema),
  source: sourceSchema,
  fetched_at: z.string(),
});
export type ReviewSummary = z.infer<typeof reviewSummarySchema>;

export const enrichmentSchema = z.object({
  audit: auditInfoSchema.nullable(),
  response: responseInfoSchema.nullable(),
  contacts: contactInfoSchema.nullable(),
  reviews: reviewSummarySchema.nullable(),
});
export type Enrichment = z.infer<typeof enrichmentSchema>;

export const availabilityItemSchema = z.object({ field: z.string(), reason: availabilityReasonSchema });

export const companyDetailSchema = companyListItemSchema.omit({ is_ad: true }).extend({
  address: z.string().nullable(),
  established_at: z.string().nullable(),
  include: z.array(z.enum(['audit', 'response', 'contacts', 'reviews'])),
  enrichment: enrichmentSchema,
  availability: z.array(availabilityItemSchema),
});
export type CompanyDetail = z.infer<typeof companyDetailSchema>;

export const paginationSchema = z.object({
  page: z.number().int().min(1),
  page_size: z.number().int().min(1),
  total: z.number().int().min(0),
  total_page: z.number().int().min(1),
  has_more: z.boolean(),
  total_capped: z.boolean(),
  total_display: z.string(),
  page_clamped: z.boolean(),
  total_is_lower_bound: z.boolean(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const searchQuerySchema = z.object({
  keyword: z.string().nullable(),
  keyword_effective: z.string(),
  province: z.string().nullable(),
  province_zh: z.string().nullable(),
  city: z.string().nullable(),
  city_zh: z.string().nullable(),
  search_mode: z.enum(['keyword', 'region', 'mixed']),
  region_validated: z.boolean(),
  filters: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  page: z.number().int(),
  page_size: z.number().int(),
  refresh: z.boolean(),
  include_ads: z.boolean(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResultSchema = z.object({
  query: searchQuerySchema,
  pagination: paginationSchema,
  items: z.array(companyListItemSchema),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const citySchema = z.object({
  name: z.string(),
  name_zh: z.string(),
  seo_cc: z.string().nullable(),
});
export type City = z.infer<typeof citySchema>;

export const provinceSchema = z.object({
  name: z.string(),
  name_zh: z.string(),
  api_value: z.string(),
  cities_complete: z.boolean(),
  cities: z.array(citySchema.nullable()).nullable(),
});
export type Province = z.infer<typeof provinceSchema>;

export const regionsResultSchema = z.object({
  provinces: z.array(provinceSchema),
});
export type RegionsResult = z.infer<typeof regionsResultSchema>;

export const membershipLevelsResultSchema = z.object({
  levels: z.array(
    z.object({
      tier: membershipTierSchema,
      label: z.string(),
      description: z.string(),
      price_cny_per_year: z.number().nullable(),
      visible_on_page: z.boolean(),
    }),
  ),
  notes: z.array(z.string()),
});
export type MembershipLevels = z.infer<typeof membershipLevelsResultSchema>;

export const cacheStatsSchema = z.object({
  enabled: z.boolean(),
  db_path: z.string(),
  schema_version: z.number().int(),
  entries: z.record(z.number().int()),
  stale_entries: z.number().int(),
  db_size_bytes: z.number().int(),
  ttl_seconds: z.record(z.number().int()),
});
export type CacheStats = z.infer<typeof cacheStatsSchema>;

export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptime_s: z.number(),
  profile: z.object({ path: z.string(), exists: z.boolean() }),
  cache: z.object({ enabled: z.boolean(), db_path: z.string(), writable: z.boolean() }),
  upstream: z.object({ reachable: z.boolean().nullable(), checked_at: z.string().nullable(), error: z.string().nullable() }),
  login: z.object({ logged_in: z.boolean().nullable() }),
});
export type Health = z.infer<typeof healthSchema>;

export const versionResultSchema = z.object({
  version: z.string(),
  node: z.string(),
  schema_version: z.number().int(),
  upstream_contract: z.object({
    supplier_search: z.string(),
    company_info: z.string(),
    checked_at: z.string().nullable(),
  }),
});
export type VersionResult = z.infer<typeof versionResultSchema>;

export const refreshResultSchema = z.object({
  scope: z.string(),
  refreshed: z.number().int(),
  skipped: z.number().int(),
});
export type RefreshResult = z.infer<typeof refreshResultSchema>;
