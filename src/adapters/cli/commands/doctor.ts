import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { envelope, fail, formatTable, printJson, useJson } from '../output.js';
import { contextFromOptions } from '../output.js';
import { closeContext } from '../../../core/container.js';
import { AppError, isAppError, makeMeta } from '../../../core/errors.js';
import { newRequestId } from '../../../core/logger.js';
import { configPath } from '../../../core/config.js';
import { sessionPaths, sessionState } from '../../../core/session/browser.js';
import {
  buildRegionsData,
  companyServiceReady,
  getCompanyDetail,
  toIsoCst,
} from '../../rest/shared.js';
import { VERSION } from '../../../version.js';

type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'INFO' | 'SKIP';

interface DoctorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  code?: string;
}

interface DoctorOptions {
  deep: boolean;
  contract: boolean;
  network: boolean;
}

const UPSTREAM_HOSTS = ['m.made-in-china.com', 'www.made-in-china.com', 'captcha.made-in-china.com'];

function pass(id: string, label: string, detail: string): DoctorCheck {
  return { id, label, status: 'PASS', detail };
}
function warn(id: string, label: string, detail: string): DoctorCheck {
  return { id, label, status: 'WARN', detail };
}
function failCheck(id: string, label: string, detail: string, code?: string): DoctorCheck {
  return { id, label, status: 'FAIL', detail, ...(code ? { code } : {}) };
}
function skip(id: string, label: string, detail = 'not enabled'): DoctorCheck {
  return { id, label, status: 'SKIP', detail };
}

async function probeUpstream(): Promise<{ ok: boolean; status: number | null; ms: number; error: string | null }> {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch('https://www.made-in-china.com/', {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'mic-client-doctor/1.0' },
    });
    clearTimeout(timer);
    const ok = res.status >= 200 && res.status < 500;
    return { ok, status: res.status, ms: Date.now() - started, error: null };
  } catch (e) {
    return { ok: false, status: null, ms: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}

async function checkDeepProbe(
  ctx: ReturnType<typeof contextFromOptions>,
): Promise<{ checks: DoctorCheck[]; contract: { ok: boolean; detail: string } | null }> {
  const checks: DoctorCheck[] = [];
  let contractOk = true;
  let contractDetail = 'search + company payloads parsed with expected fields';
  try {
    const res = await ctx.search.search({ keyword: 'glass', page: 1, page_size: 20, refresh: true, request_id: newRequestId() });
    const totalOk = typeof res.data.pagination.total === 'number';
    const itemsOk = Array.isArray(res.data.items) && res.data.items.length > 0;
    const envelopeOk = typeof res.meta.request_id === 'string' && res.meta.request_id.length > 0;
    if (!totalOk || !itemsOk || !envelopeOk) {
      contractOk = false;
      contractDetail = 'search payload missing pagination.total / items / meta.request_id';
      checks.push(failCheck('deep_probe', 'deep data probe', `search payload unexpected: ${contractDetail}`, 'UPSTREAM_CHANGED'));
    } else {
      checks.push(
        pass(
          'deep_probe',
          'deep data probe',
          `search ok: total=${res.data.pagination.total} items=${res.data.items.length} cached=${res.meta.cached}`,
        ),
      );
    }
  } catch (e) {
    const error = isAppError(e) ? e : new AppError('UPSTREAM_UNAVAILABLE', String((e as Error)?.message ?? e));
    checks.push(failCheck('deep_probe', 'deep data probe', `search failed: ${error.code} ${error.message}`, error.code));
    contractOk = false;
    contractDetail = `search failed: ${error.code}`;
    return { checks, contract: { ok: contractOk, detail: contractDetail } };
  }
  // company probe (SKIP/WARN while M2 is not ready)
  if (!(await companyServiceReady(ctx))) {
    checks.push(skip('deep_probe_company', 'deep company probe', 'company detail service (M2) not available yet'));
    return { checks, contract: { ok: contractOk, detail: contractDetail } };
  }
  try {
    const detail = await getCompanyDetail(ctx, { account: 'xingchenglass', include: [] }, newRequestId());
    const ok = Boolean(detail.data && detail.data.account && detail.data.membership);
    checks.push(
      ok
        ? pass('deep_probe_company', 'deep company probe', `company ok: ${detail.data.account} tier=${detail.data.membership.tier}`)
        : failCheck('deep_probe_company', 'deep company probe', 'company payload missing account/membership', 'UPSTREAM_CHANGED'),
    );
    contractOk = contractOk && ok;
    if (!ok) contractDetail = 'company payload missing account/membership';
  } catch (e) {
    const error = isAppError(e) ? e : new AppError('UPSTREAM_UNAVAILABLE', String((e as Error)?.message ?? e));
    checks.push(failCheck('deep_probe_company', 'deep company probe', `company failed: ${error.code} ${error.message}`, error.code));
    contractOk = false;
    contractDetail = `company failed: ${error.code}`;
  }
  return { checks, contract: { ok: contractOk, detail: contractDetail } };
}

async function runChecks(ctx: ReturnType<typeof contextFromOptions>, opts: DoctorOptions): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // node
  const major = Number(process.versions.node.split('.')[0] ?? 0);
  checks.push(
    major >= 22
      ? pass('node', 'node', `${process.version} (required >=22)`)
      : major >= 20
        ? warn('node', 'node', `${process.version} (required >=22; upgrade recommended)`)
        : failCheck('node', 'node', `${process.version} (required >=22)`),
  );

  // cloak-run
  const cloakRun = path.join(os.homedir(), 'cloak-env', 'bin', 'cloak-run');
  try {
    fs.accessSync(cloakRun, fs.constants.X_OK);
    checks.push(pass('cloak_run', 'cloak_run', cloakRun));
  } catch {
    checks.push(warn('cloak_run', 'cloak_run', `missing ${cloakRun} (JSON main path still works; browser fallback unavailable)`));
  }

  // config
  const cfgPath = configPath();
  if (!fs.existsSync(cfgPath)) {
    checks.push(pass('config', 'config', `${cfgPath} (not found, defaults in use)`));
  } else {
    try {
      JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      checks.push(pass('config', 'config', cfgPath));
    } catch (e) {
      checks.push(failCheck('config', 'config', `invalid JSON: ${(e as Error).message}`, 'CONFIG_ERROR'));
    }
  }

  // data_dir + sqlite
  try {
    const probe = path.join(ctx.cfg.data_dir, '.doctor-probe');
    fs.mkdirSync(ctx.cfg.data_dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(probe, String(Date.now()), { mode: 0o600 });
    fs.rmSync(probe, { force: true });
    const mode = String(ctx.cache.db.pragma('journal_mode', { simple: true })).toLowerCase();
    checks.push(
      pass('data_dir', 'data_dir', `${ctx.cfg.data_dir} (${path.basename(ctx.cache.path)}, schema=${ctx.cache.schemaVersion}, ${mode})`),
    );
  } catch (e) {
    checks.push(failCheck('data_dir', 'data_dir', `not writable / sqlite error: ${(e as Error).message}`, 'CONFIG_ERROR'));
  }

  // profile
  const paths = sessionPaths(ctx.cfg);
  try {
    const st = fs.statSync(ctx.cfg.profile_dir);
    const mode = (st.mode & 0o777).toString(8);
    const hasState = fs.existsSync(paths.storageState);
    checks.push(
      st.isDirectory()
        ? pass('profile', 'profile', `${path.basename(ctx.cfg.profile_dir)} (${mode}${hasState ? ', storageState present' : ', no storageState'})`)
        : warn('profile', 'profile', `${ctx.cfg.profile_dir} is not a directory`),
    );
  } catch {
    checks.push(warn('profile', 'profile', `${ctx.cfg.profile_dir} missing (first \`mic auth\` creates it)`));
  }

  // session
  const session = sessionState(ctx.cfg);
  if (session.storage_state_present) {
    checks.push(
      pass(
        'session',
        'session',
        `cookies=${session.cookie_count} age=${session.storage_state_age_seconds ?? '?'}s login=${session.login === null ? 'unknown' : session.login}`,
      ),
    );
  } else {
    checks.push(warn('session', 'session', 'no session yet; run `mic auth` if challenged by captcha'));
  }

  // regions
  try {
    const data = buildRegionsData() as { count: number };
    const hebei = (buildRegionsData('Hebei') as { cities: unknown[] }).cities.length;
    checks.push(
      data.count === 32
        ? pass('regions', 'regions', `${data.count} provinces / ${hebei} Hebei cities (complete)`)
        : warn('regions', 'regions', `unexpected province count ${data.count}`),
    );
  } catch (e) {
    checks.push(failCheck('regions', 'regions', `dictionary error: ${(e as Error).message}`));
  }

  // disk
  try {
    const statfs = fs.statfsSync(ctx.cfg.data_dir);
    const freeBytes = Number(statfs.bavail) * Number(statfs.bsize);
    const freeGb = freeBytes / 1024 ** 3;
    checks.push(
      freeBytes >= 500 * 1024 ** 2
        ? pass('disk', 'disk', `${freeGb.toFixed(1)}GB free`)
        : freeBytes >= 100 * 1024 ** 2
          ? warn('disk', 'disk', `${freeGb.toFixed(1)}GB free (low)`)
          : failCheck('disk', 'disk', `${freeGb.toFixed(2)}GB free (<100MB)`),
    );
  } catch {
    checks.push(warn('disk', 'disk', 'unable to query filesystem stats'));
  }

  // logs
  try {
    fs.mkdirSync(ctx.cfg.log_dir, { recursive: true, mode: 0o700 });
    const probe = path.join(ctx.cfg.log_dir, '.doctor-probe');
    fs.writeFileSync(probe, 'ok', { mode: 0o600 });
    fs.rmSync(probe, { force: true });
    checks.push(pass('logs', 'logs', ctx.cfg.log_dir));
  } catch (e) {
    checks.push(failCheck('logs', 'logs', `not writable: ${(e as Error).message}`));
  }

  // browser package
  const browserPkg = path.join(process.cwd(), 'node_modules', 'cloakbrowser', 'package.json');
  if (fs.existsSync(browserPkg)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(browserPkg, 'utf8')) as { version?: string };
      checks.push(pass('browser', 'browser', `cloakbrowser ${pkg.version ?? '?'}`));
    } catch {
      checks.push(warn('browser', 'browser', 'cloakbrowser present but package.json unreadable'));
    }
  } else {
    checks.push(warn('browser', 'browser', 'cloakbrowser not installed (auth/captcha fallback unavailable)'));
  }

  // dns / upstream
  if (!opts.network) {
    checks.push(skip('dns', 'dns', '--no-network'));
    checks.push(skip('upstream', 'upstream', '--no-network'));
  } else {
    const dnsResults = await Promise.allSettled(UPSTREAM_HOSTS.map((h) => dns.lookup(h).then(() => h)));
    const failedHosts = dnsResults
      .map((r, i) => (r.status === 'rejected' ? UPSTREAM_HOSTS[i] : null))
      .filter((h): h is string => Boolean(h));
    checks.push(
      failedHosts.length === 0
        ? pass('dns', 'dns', UPSTREAM_HOSTS.join(', '))
        : failCheck('dns', 'dns', `lookup failed: ${failedHosts.join(', ')}`, 'UPSTREAM_UNAVAILABLE'),
    );
    const probe = await probeUpstream();
    checks.push(
      probe.ok
        ? pass('upstream', 'upstream', `${probe.status} in ${probe.ms}ms`)
        : failCheck(
            'upstream',
            'upstream',
            probe.error ? `error: ${probe.error}` : `HTTP ${probe.status} in ${probe.ms}ms`,
            'UPSTREAM_UNAVAILABLE',
          ),
    );
  }

  // deep probe (+ contract fields)
  let contractSection: DoctorCheck;
  if (!opts.deep) {
    checks.push(skip('deep_probe', 'deep_probe', 'not enabled (--deep)'));
    checks.push(skip('deep_probe_company', 'deep_probe_company', 'not enabled (--deep)'));
    contractSection = skip('contract', 'contract', 'not enabled (--contract)');
  } else {
    const deep = await checkDeepProbe(ctx);
    checks.push(...deep.checks);
    if (opts.contract) {
      contractSection = deep.contract?.ok
        ? pass('contract', 'contract', deep.contract.detail)
        : failCheck('contract', 'contract', deep.contract?.detail ?? 'contract probe failed', 'UPSTREAM_CHANGED');
    } else {
      contractSection = skip('contract', 'contract', 'not enabled (--contract)');
    }
  }
  if (!opts.deep && opts.contract) {
    // --contract also works standalone: run the same probe.
    const deep = await checkDeepProbe(ctx);
    checks.push(deep.contract?.ok
      ? pass('contract', 'contract', deep.contract.detail)
      : failCheck('contract', 'contract', deep.contract?.detail ?? 'contract probe failed', 'UPSTREAM_CHANGED'));
  } else {
    checks.push(contractSection);
  }

  return checks;
}

function summarize(checks: DoctorCheck[]): {
  pass: number;
  warn: number;
  fail: number;
  info: number;
  skip: number;
  exit_code: number;
} {
  const count = (s: CheckStatus): number => checks.filter((c) => c.status === s).length;
  const failChecks = checks.filter((c) => c.status === 'FAIL');
  let exitCode = 0;
  if (failChecks.some((c) => c.code === 'UPSTREAM_UNAVAILABLE' || c.code === 'UPSTREAM_CHANGED')) exitCode = 4;
  else if (failChecks.length > 0) exitCode = 1;
  return {
    pass: count('PASS'),
    warn: count('WARN'),
    fail: count('FAIL'),
    info: count('INFO'),
    skip: count('SKIP'),
    exit_code: exitCode,
  };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('environment / session / network / upstream contract self-check')
    .option('--deep', 'run real upstream data probes (search + company detail)')
    .option('--contract', 'validate upstream JSON contract fields (UPSTREAM_CHANGED on miss)')
    .option('--no-network', 'skip DNS / upstream / deep / contract checks')
    .action(async (cmdOpts) => {
      const opts = program.opts<GlobalOptions>();
      try {
        const network = cmdOpts.network !== false;
        const deep = Boolean(cmdOpts.deep);
        const contract = Boolean(cmdOpts.contract);
        if (!network && (deep || contract)) {
          throw new AppError('INVALID_PARAM', '--no-network cannot be combined with --deep/--contract', {
            param: 'network',
            reason: 'UNSUPPORTED_FILTER_COMBINATION',
          });
        }
        const ctx = contextFromOptions(opts);
        try {
          const checks = await runChecks(ctx, { deep, contract, network });
          const summary = summarize(checks);
          const data = {
            version: VERSION,
            node: process.version,
            checks: checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail, ...(c.code ? { code: c.code } : {}) })),
            summary,
          };
          if (useJson(opts)) {
            printJson(
              envelope(data, {
                request_id: newRequestId(),
                cached: false,
                stale: false,
                fetched_at: toIsoCst(),
                source: 'cache',
                warnings: [],
              }),
            );
          } else {
            const rows = checks.map((c, i) => [String(i + 1), c.label, c.status, c.detail]);
            process.stdout.write(formatTable(rows, ['#', 'check', 'result', 'detail']) + '\n');
            const failed = checks.filter((c) => c.status === 'FAIL').length;
            process.stdout.write(
              `\nsummary: ${summary.pass} PASS / ${summary.warn} WARN / ${failed} FAIL / ${summary.skip} SKIP` +
                (summary.exit_code === 0 ? '  hint: run `mic doctor --contract` to check the upstream contract' : '') +
                '\n',
            );
          }
          if (summary.exit_code !== 0) process.exitCode = summary.exit_code;
        } finally {
          closeContext(ctx);
        }
      } catch (e) {
        fail(e);
      }
    });
}
