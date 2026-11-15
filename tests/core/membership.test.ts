import { describe, expect, it } from 'vitest';
import {
  auditedFromDetail,
  auditedFromList,
  assertSupportedTierFilter,
  listMembership,
  mergeAudited,
  mergeMembership,
  parseSinceYear,
  parseStars,
  tierFromCsLevel,
  tierRank,
} from '../../src/core/membership/tiers.js';
import { loadFixture } from '../helpers/fixtures.js';

/**
 * FR-06 — membership tier / audited / since_year evidence rules (no guessing).
 * Cases reference docs/06 TC-20/TC-30/TC-31/TC-32 and docs/research/membership-tiers.md §4.
 */

interface SsrContent {
  memberLevel?: string;
  memberSince?: string | number;
  sgsMember?: boolean;
  establishment?: string;
  mainProducts?: string[];
}

function ssrContent(account: string): SsrContent {
  const fixture = loadFixture<{ companyInfo: { content: SsrContent } }>(
    `mobile-company/${account}-info-ssrData.json`,
  );
  return fixture.companyInfo.content;
}

describe('listMembership: csLevel 50/30/missing (TC-20)', () => {
  it('csLevel=50 → diamond (high)', () => {
    const m = listMembership({ csLevel: 50 });
    expect(m.tier).toBe('diamond');
    expect(m.raw_cs_level).toBe(50);
    expect(m.confidence).toBe('high');
    expect(m.evidence).toEqual(['json:csLevel=50']);
  });

  it('csLevel=30 → gold (high)', () => {
    const m = listMembership({ csLevel: 30 });
    expect(m.tier).toBe('gold');
    expect(m.raw_cs_level).toBe(30);
    expect(m.evidence).toEqual(['json:csLevel=30']);
  });

  it('csLevel missing → unknown, low confidence, explicit absent evidence', () => {
    const m = listMembership({});
    expect(m.tier).toBe('unknown');
    expect(m.raw_cs_level).toBeNull();
    expect(m.confidence).toBe('low');
    expect(m.evidence).toEqual(['json:csLevel=absent']);
  });

  it('unexpected csLevel keeps raw value and falls back to unknown', () => {
    const m = listMembership({ csLevel: 99 });
    expect(m.tier).toBe('unknown');
    expect(m.raw_cs_level).toBe(99);
    expect(m.evidence).toEqual(['json:csLevel=99']);
  });

  it('tierFromCsLevel handles null/string input', () => {
    expect(tierFromCsLevel(null)).toMatchObject({ tier: null, raw: null, confidence: 'low' });
    expect(tierFromCsLevel('50')).toMatchObject({ tier: 'diamond', raw: 50 });
  });
});

describe('mergeMembership: detail wins, conflicts are surfaced (TC-30)', () => {
  it('list + detail agree → high confidence with both evidence lines', () => {
    const list = listMembership({ csLevel: 50 });
    const merged = mergeMembership(list, { memberLevel: 'diamond', memberSince: '2025' });
    expect(merged.membership.tier).toBe('diamond');
    expect(merged.membership.confidence).toBe('high');
    expect(merged.membership.since_year).toBe(2025);
    expect(merged.membership.evidence).toContain('json:csLevel=50');
    expect(merged.membership.evidence).toContain('json:memberLevel=diamond');
    expect(merged.conflict).toBe(false);
  });

  it('list gold vs detail diamond → detail wins, confidence medium, conflict warning', () => {
    const merged = mergeMembership(listMembership({ csLevel: 30 }), { memberLevel: 'diamond' });
    expect(merged.membership.tier).toBe('diamond');
    expect(merged.membership.confidence).toBe('medium');
    expect(merged.conflict).toBe(true);
    expect(merged.warnings[0]!.code).toBe('MEMBER_EVIDENCE_CONFLICT');
  });

  it('detail isDiamondMember=true upgrades an unknown list tier to diamond (medium)', () => {
    const merged = mergeMembership(listMembership({}), { isDiamondMember: true });
    expect(merged.membership.tier).toBe('diamond');
    expect(merged.membership.confidence).toBe('medium');
    expect(merged.membership.evidence).toContain('json:isDiamondMember=true');
  });

  it('full detail with no badge and unknown list → free (medium), never diamond/gold', () => {
    const merged = mergeMembership(listMembership({}), { isDiamondMember: false });
    expect(merged.membership.tier).toBe('free');
    expect(merged.membership.confidence).toBe('medium');
    expect(merged.membership.evidence).toContain('json:no-member-badge');
  });

  it('fixture signals: xingchenglass diamond/since 2025, hnfinsulation gold', () => {
    const xingchen = ssrContent('xingchenglass');
    const merged = mergeMembership(listMembership({ csLevel: 50 }), {
      memberLevel: xingchen.memberLevel,
      memberSince: xingchen.memberSince,
      isDiamondMember: true,
    });
    expect(merged.membership.tier).toBe('diamond');
    expect(merged.membership.since_year).toBe(2025);
    expect(merged.membership.evidence).toContain('json:memberLevel=diamond');

    const hnf = ssrContent('hnfinsulation');
    const merged2 = mergeMembership(listMembership({ csLevel: 30 }), {
      memberLevel: hnf.memberLevel,
      memberSince: hnf.memberSince,
    });
    expect(merged2.membership.tier).toBe('gold');
    expect(merged2.membership.since_year).toBe(2025);
  });

  it('detail fields are the only source of since_year (not establishment)', () => {
    const merged = mergeMembership(null, { memberLevel: 'diamond' });
    expect(merged.membership.since_year).toBeNull();
  });
});

describe('audited tri-state (TC-27/TC-31)', () => {
  it('list: auditType>0 or logo text → true; explicit negative flags → false; else null', () => {
    expect(auditedFromList({ auditType: 1 })).toBe(true);
    expect(auditedFromList({ auditType: '1' })).toBe(true);
    expect(auditedFromList({ showAuditLogo: true })).toBe(true);
    expect(auditedFromList({ logoText: 'Audited Supplier' })).toBe(true);
    expect(auditedFromList({ auditType: 0, showAuditLogo: false })).toBe(false);
    expect(auditedFromList({})).toBeNull();
  });

  it('detail: sgsMember / auditReportLogo signals', () => {
    expect(auditedFromDetail({ sgsMember: true })).toBe(true);
    expect(auditedFromDetail({ sgsMember: false })).toBe(false);
    expect(auditedFromDetail({ auditReportLogo: { showAuditLogo: true } })).toBe(true);
    expect(auditedFromDetail({ auditReportLogo: { logoText: 'Audited Supplier' } })).toBe(true);
    expect(auditedFromDetail({})).toBeNull();
  });

  it('mergeAudited prefers detail and flags conflicts', () => {
    expect(mergeAudited(true, null)).toEqual({ audited: true, conflict: false });
    expect(mergeAudited(true, false)).toEqual({ audited: false, conflict: true });
    expect(mergeAudited(null, null)).toEqual({ audited: null, conflict: false });
  });

  it('audited is independent from tier: unknown tier + audited=true is valid', () => {
    const merged = mergeMembership(listMembership({}), {});
    expect(merged.membership.tier).toBe('unknown');
    expect(mergeAudited(auditedFromList({ auditType: 1 }), null).audited).toBe(true);
  });
});

describe('helpers: since_year / stars / tier filters', () => {
  it('parseSinceYear extracts 4-digit years in plausible range', () => {
    expect(parseSinceYear('2025')).toBe(2025);
    expect(parseSinceYear('Since 2011')).toBe(2011);
    expect(parseSinceYear(2026)).toBe(2026);
    expect(parseSinceYear('999')).toBeNull();
    expect(parseSinceYear('1800')).toBeNull();
    expect(parseSinceYear(null)).toBeNull();
    expect(parseSinceYear('')).toBeNull();
  });

  it('parseStars validates 0..5 and null otherwise', () => {
    expect(parseStars('0')).toBe(0);
    expect(parseStars('2')).toBe(2);
    expect(parseStars(5)).toBe(5);
    expect(parseStars('6')).toBeNull();
    expect(parseStars(-1)).toBeNull();
    expect(parseStars(null)).toBeNull();
  });

  it('only diamond/gold are accepted as membership tier filters', () => {
    expect(assertSupportedTierFilter('diamond')).toBe('diamond');
    expect(assertSupportedTierFilter('gold')).toBe('gold');
    for (const bad of ['free', 'unknown', 'ka', '']) {
      expect(() => assertSupportedTierFilter(bad)).toThrowError(
        expect.objectContaining({ code: 'INVALID_PARAM' }),
      );
    }
  });

  it('tierRank ordering is unknown < free < gold < diamond', () => {
    expect(tierRank('unknown')).toBeLessThan(tierRank('free'));
    expect(tierRank('free')).toBeLessThan(tierRank('gold'));
    expect(tierRank('gold')).toBeLessThan(tierRank('diamond'));
  });
});
