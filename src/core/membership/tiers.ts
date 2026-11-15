import { AppError } from '../errors.js';
import type { MembershipInfo, MembershipTier } from '../models.js';

export interface ListMembershipSignals {
  csLevel?: number | string | null;
  memberType?: number | string | null;
}

export interface DetailMembershipSignals {
  memberLevel?: string | null;
  memberSince?: string | number | null;
  isDiamondMember?: boolean | null;
}

export interface ListAuditSignals {
  auditType?: number | string | null;
  showAuditLogo?: boolean | null;
  logoText?: string | null;
}

export interface DetailAuditSignals {
  sgsMember?: boolean | null;
  auditReportLogo?: { showAuditLogo?: boolean | null; logoText?: string | null } | null;
}

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normMemberLevel(v: unknown): 'diamond' | 'gold' | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'diamond' || s === 'diamondmember' || s === 'diamond member') return 'diamond';
  if (s === 'gold' || s === 'goldmember' || s === 'gold member') return 'gold';
  return null;
}

export function tierFromCsLevel(csLevel: number | string | null | undefined): {
  tier: MembershipTier | null;
  raw: number | null;
  evidence: string[];
  confidence: 'high' | 'medium' | 'low';
} {
  const raw = toInt(csLevel);
  if (raw === null) return { tier: null, raw: null, evidence: [], confidence: 'low' };
  if (raw === 50) return { tier: 'diamond', raw, evidence: ['json:csLevel=50'], confidence: 'high' };
  if (raw === 30) return { tier: 'gold', raw, evidence: ['json:csLevel=30'], confidence: 'high' };
  return { tier: 'unknown', raw, evidence: [`json:csLevel=${raw}`], confidence: 'low' };
}

export function listMembership(signals: ListMembershipSignals): MembershipInfo {
  const fromCs = tierFromCsLevel(signals.csLevel);
  return {
    tier: fromCs.tier ?? 'unknown',
    raw_cs_level: fromCs.raw,
    raw_member_level: null,
    since_year: null,
    evidence: fromCs.evidence.length ? fromCs.evidence : ['json:csLevel=absent'],
    confidence: fromCs.tier === 'diamond' || fromCs.tier === 'gold' ? 'high' : 'low',
  };
}

const TIER_RANK: Record<MembershipTier, number> = { unknown: 0, free: 1, gold: 2, diamond: 3 };

/**
 * Merge list + detail evidence. Detail fields win; conflicting evidence lowers confidence
 * and adds MEMBER_EVIDENCE_CONFLICT (caller can surface as warning).
 */
export function mergeMembership(list: MembershipInfo | null, detail: DetailMembershipSignals): {
  membership: MembershipInfo;
  conflict: boolean;
  warnings: Array<{ code: 'MEMBER_EVIDENCE_CONFLICT'; message: string; details: Record<string, unknown> }>;
} {
  const base: MembershipInfo =
    list ??
    ({
      tier: 'unknown',
      raw_cs_level: null,
      raw_member_level: null,
      since_year: null,
      evidence: [],
      confidence: 'low',
    } as MembershipInfo);

  const detailLevel = normMemberLevel(detail.memberLevel);
  const since = parseSinceYear(detail.memberSince);
  const evidence = [...base.evidence];
  let tier = base.tier;
  let confidence = base.confidence;
  let conflict = false;

  if (detailLevel) {
    evidence.push(`json:memberLevel=${detailLevel}`);
    if (base.tier !== 'unknown' && base.tier !== detailLevel) {
      conflict = true;
      // 高优先级：详情 memberLevel 覆盖列表 csLevel（research/membership-tiers.md §4）
      tier = detailLevel;
      confidence = 'medium';
    } else {
      tier = detailLevel;
      confidence = 'high';
    }
  }
  if (since !== null) evidence.push(`json:memberSince=${since}`);
  if (detail.isDiamondMember === true && tier === 'unknown') {
    tier = 'diamond';
    evidence.push('json:isDiamondMember=true');
    confidence = 'medium';
  }
  // free 只能由详情"完整且无徽章"推断：列表 unknown 且详情明确无 memberLevel
  if (!detailLevel && detail.isDiamondMember === false && base.tier === 'unknown') {
    tier = 'free';
    evidence.push('json:no-member-badge');
    confidence = 'medium';
  }

  const warnings = conflict
    ? [
        {
          code: 'MEMBER_EVIDENCE_CONFLICT' as const,
          message: `membership evidence conflict: list=${base.tier}, detail=${detailLevel}`,
          details: { list_tier: base.tier, detail_tier: detailLevel },
        },
      ]
    : [];

  return {
    membership: {
      tier,
      raw_cs_level: base.raw_cs_level,
      raw_member_level: detailLevel,
      since_year: since ?? base.since_year,
      evidence,
      confidence,
    },
    conflict,
    warnings,
  };
}

export function parseSinceYear(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const m = String(v).match(/(19|20)\d{2}/);
  if (!m) return null;
  const n = Number(m[0]);
  return n >= 1999 && n <= 2100 ? n : null;
}

/** audited: any true signal wins; explicit false only when all signals are explicitly negative. */
export function auditedFromList(signals: ListAuditSignals): boolean | null {
  const auditType = toInt(signals.auditType);
  const logoText = (signals.logoText ?? '').toLowerCase();
  if (auditType !== null && auditType > 0) return true;
  if (signals.showAuditLogo === true) return true;
  if (logoText.includes('audited supplier') || logoText.includes('audited')) return true;
  if (auditType === 0 && signals.showAuditLogo === false) return false;
  if (signals.showAuditLogo === false) return false;
  return null;
}

export function auditedFromDetail(signals: DetailAuditSignals): boolean | null {
  if (signals.sgsMember === true) return true;
  const logo = signals.auditReportLogo;
  if (logo?.showAuditLogo === true) return true;
  if ((logo?.logoText ?? '').toLowerCase().includes('audited')) return true;
  if (signals.sgsMember === false) return false;
  return null;
}

export function mergeAudited(
  listAudited: boolean | null,
  detailAudited: boolean | null,
): { audited: boolean | null; conflict: boolean } {
  if (detailAudited === null) return { audited: listAudited, conflict: false };
  if (listAudited !== null && listAudited !== detailAudited) {
    return { audited: detailAudited, conflict: true };
  }
  return { audited: detailAudited, conflict: false };
}

export function parseStars(v: unknown): number | null {
  const n = toInt(v);
  if (n === null || n < 0 || n > 5) return null;
  return n;
}

export function assertSupportedTierFilter(tier: string): 'diamond' | 'gold' {
  if (tier === 'diamond' || tier === 'gold') return tier;
  throw new AppError('INVALID_PARAM', `unsupported membership tier filter: ${tier}`, {
    param: 'membership_tier',
    reason: 'UNSUPPORTED_MEMBERSHIP_FILTER',
    hint: 'upstream only supports diamond/gold filters; free/unknown cannot be filtered',
  });
}

export function tierRank(t: MembershipTier): number {
  return TIER_RANK[t] ?? 0;
}
