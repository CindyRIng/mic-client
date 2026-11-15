#!/usr/bin/env node
/**
 * Live smoke test against the real (anonymous) Made-in-China upstream.
 *
 * ⚠️ This script makes REAL network requests. It is intended for manual runs
 * (weekly / pre-release), not CI. It uses the production rate limiter
 * (MIC_RATE_MIN_MS=1500 / MIC_RATE_MAX_MS=2500) and a throw-away cache dir, so
 * the request budget is small and sequential:
 *   1 search (glass+Hebei) + 1 cache-hit replay + ≤N scanned pages (region mode)
 *   + 1 company detail (skipped until M2 is wired) + 2 offline negative checks.
 *
 * Usage:
 *   node scripts/e2e/live-smoke.mjs [options]
 *
 * Options:
 *   --src                 force running src/cli.ts via tsx (default: dist/cli.js if built)
 *   --no-company          skip the company detail step
 *   --scan-pages=<n>      client-side scan budget for region mode (default 2)
 *   --timeout-ms=<n>      per-command timeout (default 180000)
 *   --keep-data           keep the temporary data dir (printed on start)
 *   --json                machine-readable result summary on stdout
 *   --help
 *
 * Exit code: 0 = no FAIL (SKIP/WARN allowed), 1 = at least one FAIL.
 *
 * Baselines: docs/06 §3.2 (B-02 glass+Hebei=669, B-17 langfang scan) and
 * docs/06 §4.6/§4.7. Live totals drift over time — assertions use ranges and
 * record the observed values. Verification of upstream changes:
 *   bash recon/artifacts/api/request-examples.sh
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DIST_ENTRY = path.join(ROOT, 'dist', 'cli.js');
const SRC_ENTRY = path.join(ROOT, 'src', 'cli.ts');
const TSX_AVAILABLE = fs.existsSync(path.join(ROOT, 'node_modules', '.bin', 'tsx'));

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const help = argv.includes('--help') || argv.includes('-h');
const jsonMode = argv.includes('--json');
const forceSrc = argv.includes('--src');
const noCompany = argv.includes('--no-company');
const keepData = argv.includes('--keep-data');
const argValue = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};
const scanPages = argValue('scan-pages', 2);
const timeoutMs = argValue('timeout-ms', 180_000);

if (help) {
  console.log(
    fs
      .readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('*/')[0]
      .replace(/^#!.*\n/, '')
      .replace(/^\/\*\*\s*\n?/, '')
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .trimEnd(),
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Environment: isolated cache/profile dirs + production-like rate limiting
// ---------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mic-live-smoke-'));
const env = {
  ...process.env,
  MIC_CONFIG: path.join(tmp, 'no-such-config.json'),
  MIC_DATA_DIR: path.join(tmp, 'data'),
  MIC_LOG_DIR: path.join(tmp, 'logs'),
  MIC_PROFILE_DIR: path.join(tmp, 'profile'),
  MIC_LOG_LEVEL: 'error',
  MIC_RATE_MIN_MS: '1500',
  MIC_RATE_MAX_MS: '2500',
  MIC_UPSTREAM_TIMEOUT_MS: '20000',
  MIC_SCAN_MAX_PAGES: String(Math.max(1, scanPages)),
  NO_COLOR: '1',
};

const useDist = !forceSrc && fs.existsSync(DIST_ENTRY);
const entry = useDist ? DIST_ENTRY : SRC_ENTRY;
const nodeArgs = useDist ? [entry] : ['--import', 'tsx', entry];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const results = [];

function runCli(args) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [...nodeArgs, ...args], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, durationMs: Date.now() - started });
    });
  });
}

function parseEnvelope(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function record(status, step, detail) {
  const row = { status, step, detail };
  results.push(row);
  if (!jsonMode) {
    const tag = `[${status}]`.padEnd(6);
    console.log(`${tag} ${step}${detail ? ' — ' + detail : ''}`);
  }
}

function pass(step, detail) {
  record('PASS', step, detail);
}
function skip(step, detail) {
  record('SKIP', step, detail);
}
function warn(step, detail) {
  record('WARN', step, detail);
}
function fail(step, detail) {
  record('FAIL', step, detail);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
async function stepCliGuard() {
  const r = await runCli(['version', '--json']);
  const envl = parseEnvelope(r.stdout);
  if (r.code !== 0 || !envl || envl.ok !== true) {
    fail('CLI guard (version --json)', `exit=${r.code} ${r.stderr.trim().slice(0, 300)}`);
    return false;
  }
  pass('CLI guard (version --json)', `version=${envl.data?.version} node=${envl.data?.node} entry=${path.basename(entry)}`);
  return true;
}

async function stepSearchHebei() {
  const args = ['search', '--keyword', 'glass', '--province', 'Hebei', '--page', '1', '--json'];
  let r = await runCli(args);
  let envl = parseEnvelope(r.stdout);
  if (r.code !== 0 || !envl || envl.ok !== true) {
    fail('search glass+Hebei', `exit=${r.code} stderr=${r.stderr.trim().slice(0, 300)}`);
    return null;
  }
  const pagination = envl.data?.pagination ?? {};
  const items = envl.data?.items ?? [];
  const total = Number(pagination.total);
  const provinces = [...new Set(items.map((i) => i.province).filter(Boolean))];
  const detail = `total=${pagination.total_display ?? total} items=${items.length} mode=${envl.data?.query?.search_mode}`;
  if (!Number.isFinite(total) || total < 600 || total > 2000) {
    warn('search glass+Hebei', `${detail} (expected total 600–2000; upstream drift? re-check request-examples.sh)`);
  } else if (items.length === 0) {
    fail('search glass+Hebei', `${detail} (empty items)`);
  } else if (pagination.total_capped === true) {
    warn('search glass+Hebei', `${detail} (upstream capped at 2,000+; province-scoped query is broader than the 669 baseline)`);
  } else if (provinces.some((p) => p !== 'Hebei')) {
    fail('search glass+Hebei', `${detail} provinces=${JSON.stringify(provinces)} (expected all Hebei)`);
  } else {
    pass('search glass+Hebei', detail);
  }
  return { args, firstAccounts: items.slice(0, 3).map((i) => i.account), total };
}

async function stepCacheHit(searchResult) {
  if (!searchResult) {
    skip('cache hit on repeat search', 'previous search failed');
    return;
  }
  const second = await runCli(searchResult.args);
  const envl = parseEnvelope(second.stdout);
  if (second.code !== 0 || !envl || envl.ok !== true) {
    fail('cache hit on repeat search', `exit=${second.code} stderr=${second.stderr.trim().slice(0, 300)}`);
    return;
  }
  const meta = envl.meta ?? {};
  if (meta.cached === true && meta.source === 'cache') {
    pass('cache hit on repeat search', 'meta.cached=true source=cache (no upstream request)');
  } else {
    fail('cache hit on repeat search', `meta.cached=${meta.cached} source=${meta.source}`);
  }
}

async function stepRegionLangfang() {
  // Region mode: no keyword → derives word=langfang + province filter, then
  // client-side city filter over the configured scan budget.
  const r = await runCli(['search', '--province', '河北', '--city', '廊坊', '--json']);
  const envl = parseEnvelope(r.stdout);
  if (r.code !== 0 || !envl || envl.ok !== true) {
    // A human-verification / rate-limit result is a warning, not a failure.
    const hint = `${r.stderr} ${r.stdout}`;
    if (/NEED_HUMAN_VERIFICATION|CAPTCHA|RATE_LIMITED/.test(hint)) {
      warn('region mode langfang', `upstream risk control: ${hint.trim().slice(0, 200)}`);
    } else {
      fail('region mode langfang', `exit=${r.code} stderr=${r.stderr.trim().slice(0, 300)}`);
    }
    return;
  }
  const items = envl.data?.items ?? [];
  const query = envl.data?.query ?? {};
  const cities = [...new Set(items.map((i) => i.city).filter(Boolean))];
  if (items.length === 0) {
    skip(
      'region mode langfang',
      `0 matches within scan budget=${scanPages} (upstream result drift; try --scan-pages=5) warnings=` +
        JSON.stringify((envl.meta?.warnings ?? []).map((w) => w.code)),
    );
    return;
  }
  if (query.search_mode !== 'region') {
    warn('region mode langfang', `search_mode=${query.search_mode} (expected region)`);
  } else if (cities.length !== 1 || cities[0] !== 'Langfang') {
    fail('region mode langfang', `items=${items.length} cities=${JSON.stringify(cities)} (expected all Langfang)`);
  } else {
    pass('region mode langfang', `items=${items.length} scanned_pages=${(envl.meta?.warnings ?? []).find((w) => w.code === 'CITY_FILTERED_LOCALLY')?.details?.scanned_pages ?? '?'}`);
  }
}

async function stepCompany(skipReason) {
  if (skipReason) {
    skip('company xingchenglass', skipReason);
    return;
  }
  const r = await runCli(['company', 'xingchenglass', '--json']);
  const envl = parseEnvelope(r.stdout);
  if (r.code !== 0 || !envl || envl.ok !== true) {
    const hint = `${r.stderr} ${r.stdout}`;
    if (r.code === 5 || /NEED_HUMAN_VERIFICATION|CAPTCHA/.test(hint)) {
      warn('company xingchenglass', `upstream risk control / human verification required (run \`mic auth\`)`);
    } else if (r.code === 1 && /not wired yet|M2 in progress/i.test(hint)) {
      skip('company xingchenglass', 'M2 company detail not wired yet');
    } else {
      fail('company xingchenglass', `exit=${r.code} stderr=${r.stderr.trim().slice(0, 300)}`);
    }
    return;
  }
  const data = envl.data ?? {};
  const tier = data.membership?.tier;
  const since = data.membership?.since_year ?? data.membership?.member_since_year ?? null;
  const main = data.main_products ?? [];
  const detail = `tier=${tier} since_year=${since} established_at=${data.established_at} main_products=${main.length}`;
  if (tier === 'diamond' && since === 2025 && main.length > 0) {
    pass('company xingchenglass', detail);
  } else {
    warn('company xingchenglass', `${detail} (expected diamond/2025/main_products>0; upstream drift or partial enrichment)`);
  }
}

async function stepNegative() {
  const empty = await runCli(['search', '--json']);
  const emptyHint = `${empty.stdout} ${empty.stderr}`;
  if (empty.code === 2 && /INVALID_PARAM/.test(emptyHint)) {
    pass('negative: empty keyword/region', 'INVALID_PARAM exit=2 (no upstream request)');
  } else {
    fail('negative: empty keyword/region', `exit=${empty.code} hint=${emptyHint.trim().slice(0, 200)}`);
  }

  const cjk = await runCli(['search', '--keyword', '玻璃', '--json']);
  const cjkHint = `${cjk.stdout} ${cjk.stderr}`;
  if (cjk.code === 2 && /INVALID_PARAM/.test(cjkHint) && /NON_ENGLISH_KEYWORD/.test(cjkHint)) {
    pass('negative: Chinese keyword', 'INVALID_PARAM reason=NON_ENGLISH_KEYWORD exit=2');
  } else {
    fail('negative: Chinese keyword', `exit=${cjk.code} hint=${cjkHint.trim().slice(0, 200)}`);
  }
}

async function detectCompanyWired() {
  // Cheap probe: `mic company --help` never touches network; the stub only
  // exists until M2 replaces commands/company.ts with a real registration.
  const r = await runCli(['company', '--help']);
  const text = `${r.stdout}\n${r.stderr}`;
  return !/implemented in M2/i.test(text) && /--include/.test(text);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (!jsonMode) {
  console.log(`MIC live smoke — entry=${path.relative(ROOT, entry)} scan-pages=${scanPages}`);
  console.log(`temp data dir: ${tmp}${keepData ? ' (kept)' : ''}`);
  console.log('real requests: sequential, rate-limited 1.5–2.5s; baselines per docs/06 §3.2');
  console.log('');
}

try {
  const cliOk = await stepCliGuard();
  if (!cliOk) {
    // still run offline negatives to report something useful
    await stepNegative();
  } else {
    const search = await stepSearchHebei();
    await stepCacheHit(search);
    await stepRegionLangfang();
    let companySkipReason = null;
    if (noCompany) {
      companySkipReason = 'disabled by --no-company';
    } else if (!(await detectCompanyWired())) {
      companySkipReason = 'M2 company detail not wired in this build (stub) — rerun after M2';
    }
    await stepCompany(companySkipReason);
    await stepNegative();
  }
} finally {
  if (!keepData) fs.rmSync(tmp, { recursive: true, force: true });
}

const counts = results.reduce((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
const failed = counts.FAIL ?? 0;

if (jsonMode) {
  console.log(
    JSON.stringify(
      {
        ok: failed === 0,
        entry: path.relative(ROOT, entry),
        summary: counts,
        results,
      },
      null,
      2,
    ),
  );
} else {
  console.log('');
  console.log(
    `summary: ${results.length} steps — PASS=${counts.PASS ?? 0} WARN=${counts.WARN ?? 0} SKIP=${counts.SKIP ?? 0} FAIL=${failed}`,
  );
  if (failed > 0) {
    console.log('FAILED — check stderr above; for upstream drift see recon/artifacts/api/request-examples.sh');
  }
}

process.exit(failed > 0 ? 1 : 0);
