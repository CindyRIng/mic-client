import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { envelope, fail, printJson, useJson, withContext } from '../output.js';
import { CompanyDetailApi } from '../../../core/api/company.js';
import { CompanyEnricher } from '../../../core/api/enrich.js';
import { CompanyService, type CompanyInput } from '../../../core/company/service.js';
import type { CompanyDetail } from '../../../core/models.js';
import type { Meta } from '../../../core/errors.js';

interface CompanyCommandOptions {
  account?: string;
  comId?: string;
  encodeComId?: string;
  include?: string;
}

export function registerCompanyCommand(program: Command): void {
  program
    .command('company [lookup]')
    .description('get company detail: profile + membership/audited + optional enrichments (audit/response/contacts/reviews)')
    .option('--account <account>', 'mainUserAccount / minisite subdomain (also accepts URL forms)')
    .option('--com-id <digits>', 'numeric Made-in-China company id (resolved via 301)')
    .option('--encode-com-id <code>', 'encrypted comId (must already be indexed locally by a prior search/detail)')
    .option('--include <list>', 'comma list: audit,response,contacts,reviews | all | none (default: audit,response)')
    .action(async (lookup: string | undefined, cmdOpts: CompanyCommandOptions) => {
      const opts = program.opts<GlobalOptions>();
      try {
        const result = await withContext(opts, async (ctx) => {
          const service = new CompanyService(
            ctx.cfg,
            ctx.logger,
            ctx.cache,
            new CompanyDetailApi(ctx.http, ctx.logger),
            new CompanyEnricher(ctx.http, ctx.logger),
          );
          const input: CompanyInput = {
            lookup,
            account: cmdOpts.account,
            com_id: cmdOpts.comId,
            encode_com_id: cmdOpts.encodeComId,
            include: cmdOpts.include,
            refresh: opts.refresh,
            onCaptcha: async (srcUrl: string) => {
              const session = await import('../../../core/session/browser.js');
              await session.ensureVerifiedSession(srcUrl, ctx.cfg, ctx.logger);
              ctx.http.cookies.load(session.loadSessionCookies(ctx.cfg));
            },
            onBrowserFetch: async (url: string) => {
              const session = await import('../../../core/session/browser.js');
              const html = await session.fetchHtmlViaBrowser(url, ctx.cfg, ctx.logger);
              ctx.http.cookies.load(session.loadSessionCookies(ctx.cfg));
              return html;
            },
          };
          return service.get(input);
        });
        if (useJson(opts)) {
          printJson(envelope(result.data, result.meta));
          return;
        }
        process.stdout.write(renderCompanySummary(result.data, result.meta) + '\n');
        if (result.meta.warnings.length) {
          process.stderr.write('warnings: ' + result.meta.warnings.map((w) => w.code).join(', ') + '\n');
        }
      } catch (e) {
        fail(e);
      }
    });
}

function dash(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  const s = String(v).trim();
  return s.length ? s : '-';
}

function availabilityReason(data: CompanyDetail, field: string): string | null {
  return data.availability.find((a) => a.field === field)?.reason ?? null;
}

function withReason(value: string | null, reason: string | null): string {
  if (value !== null) return value;
  return reason ? `-（${reason}）` : '-';
}

/**
 * 人类可读摘要（docs/04 §2.7.2）。`--json` 输出与 REST `data` 逐字段一致（CC-01）。
 */
export function renderCompanySummary(data: CompanyDetail, meta: Meta): string {
  const lines: string[] = [];
  lines.push(`公司：${data.company_name}`);
  lines.push(
    `账号：${data.account}   comId：${dash(data.company_id)}   encodeComId：${dash(data.encode_com_id)}`,
  );
  const region = [data.province, data.city, data.country].filter((v): v is string => Boolean(v)).join(' / ');
  lines.push(`地区：${region || '-'}`);
  const member = data.membership;
  const evidence = member.evidence.length ? `；evidence: ${member.evidence.join(', ')}` : '';
  lines.push(
    `会员：${member.tier}（Since ${dash(member.since_year)}；confidence ${member.confidence}${evidence}）`,
  );
  const audit = data.enrichment.audit;
  if (audit) {
    lines.push(
      `认证：${audit.audited ? 'Audited Supplier' : '未认证 / 无审核报告'}（enrichment.audit：已审章节 ` +
        `${audit.audited_section_count}/${audit.sections.length || 9}；机构/报告号/核验链接 -（首期不抓，待验证））`,
    );
  } else if (data.audited === true) {
    lines.push('认证：Audited Supplier（未请求 enrichment.audit）');
  } else if (data.audited === false) {
    lines.push('认证：未认证（Audited Supplier = false）');
  } else {
    lines.push('认证：-（未知）');
  }
  lines.push(`主营：${data.main_products.length ? data.main_products.join(', ') : '-'}`);
  lines.push(
    `成立：${dash(data.established_at)}   员工：${withReason(
      data.employees === null ? null : String(data.employees),
      availabilityReason(data, 'employees'),
    )}   厂房：${withReason(data.plant_area, availabilityReason(data, 'plant_area'))}   营收：${withReason(
      data.turnover,
      availabilityReason(data, 'turnover'),
    )}`,
  );
  lines.push(`认证体系：${data.system_certifications.length ? data.system_certifications.join(', ') : '-'}`);
  const reviews = data.enrichment.reviews;
  const ratingDisplay = reviews?.rating_display ?? null;
  if (reviews) {
    lines.push(
      `评分：${ratingDisplay ?? '-'}（评论数 ${dash(reviews.review_count)}，enrichment.reviews）   星级：${
        data.capability_stars === null ? '-' : `${data.capability_stars}/5`
      }`,
    );
  } else {
    lines.push(`评分：-（未请求 enrichment.reviews）   星级：${data.capability_stars === null ? '-' : `${data.capability_stars}/5`}`);
  }
  const response = data.enrichment.response;
  if (response) {
    const avg = response.avg_response_hours === null ? '-' : `${response.avg_response_hours}h`;
    const ratio =
      response.timely_reply_ratio === null ? '-' : `${(response.timely_reply_ratio * 100).toFixed(2)}%`;
    lines.push(`响应：平均 ${avg}；及时率 ${ratio}（近 30 天，${dash(response.as_of)}，enrichment.response）`);
  } else {
    lines.push('响应：-（未请求 enrichment.response）');
  }
  const contacts = data.enrichment.contacts;
  if (contacts) {
    const persons = contacts.persons.length
      ? contacts.persons.map((p) => `${p.name}（${p.id}）`).join(', ')
      : '-';
    lines.push(`联系人：${persons}（TM 子账号；部门/职位/在线 -（首期不抓））`);
    lines.push('联系方式：电话/邮箱/WhatsApp/Skype/微信 = -（not_public_by_platform；平台不公开，只能站内询盘/聊天）');
  } else {
    lines.push('联系人：-（未请求 enrichment.contacts）');
  }
  lines.push(`链接：${dash(data.company_url)}`);
  const status = meta.stale ? 'stale' : meta.warnings.some((w) => w.code === 'ENRICHMENT_PARTIAL') ? 'partial' : 'success';
  lines.push(
    `状态：${status}   缓存：${meta.cached ? '命中' : '未命中'}   来源：${meta.source}   请求：${meta.request_id || '-'}`,
  );
  return lines.join('\n');
}

