import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * FR-10 — CLI smoke tests (offline): version / regions / cache + validation errors.
 * Runs `node --import tsx src/cli.ts ...` in a child process so exit codes and
 * stdout/stderr separation are exercised exactly like a real user would.
 * Cases reference docs/06 TC-42..TC-45 and docs/04 CLI contract.
 */

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const CLI_ENTRY = path.join(ROOT, 'src', 'cli.ts');

let tmp: string;
let baseEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mic-cli-test-'));
  baseEnv = {
    ...process.env,
    MIC_CONFIG: path.join(tmp, 'no-such-config.json'),
    MIC_DATA_DIR: path.join(tmp, 'data'),
    MIC_LOG_DIR: path.join(tmp, 'logs'),
    MIC_PROFILE_DIR: path.join(tmp, 'profile'),
    MIC_LOG_LEVEL: 'error',
    MIC_RATE_MIN_MS: '0',
    MIC_RATE_MAX_MS: '0',
    NO_COLOR: '1',
  };
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--import', 'tsx', CLI_ENTRY, ...args], {
      cwd: ROOT,
      env: { ...baseEnv, ...env },
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string };
    return { code: Number(err.code ?? -1), stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function parseJson(output: string): Record<string, unknown> {
  const trimmed = output.trim();
  expect(trimmed.length).toBeGreaterThan(0);
  return JSON.parse(trimmed) as Record<string, unknown>;
}

describe('CLI: version (TC-42)', () => {
  it('version --json prints a valid JSON envelope', async () => {
    const r = await runCli(['version', '--json']);
    expect(r.code).toBe(0);
    const out = parseJson(r.stdout);
    expect(out['ok']).toBe(true);
    const data = out['data'] as Record<string, unknown>;
    expect(data['version']).toBe('0.1.0');
    expect(data['schema_version']).toBe(1);
    expect(String(data['node'])).toBe(process.version);
    expect(data['upstream_contract']).toBeTruthy();
  });

  it('--version prints only the version number on stdout', async () => {
    const r = await runCli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('0.1.0');
  });
});

describe('CLI: regions (TC-42/AC-33)', () => {
  it('regions --json returns 32 provinces with the Hebei city dictionary', async () => {
    const r = await runCli(['regions', '--json']);
    expect(r.code).toBe(0);
    const out = parseJson(r.stdout);
    expect(out['ok']).toBe(true);
    const provinces = (out['data'] as { provinces: Array<Record<string, unknown>> }).provinces;
    expect(provinces).toHaveLength(32);
    const hebei = provinces.find((p) => p['name'] === 'Hebei')!;
    expect((hebei['cities'] as unknown[]).length).toBe(10);
  });

  it('regions --province 河北 --json filters to one province (Chinese input)', async () => {
    const r = await runCli(['regions', '--province', '河北', '--json']);
    expect(r.code).toBe(0);
    const out = parseJson(r.stdout);
    const provinces = (out['data'] as { provinces: Array<{ name: string }> }).provinces;
    expect(provinces.map((p) => p.name)).toEqual(['Hebei']);
  });

  it('unknown province → exit code 2 and INVALID_PARAM on stderr', async () => {
    const r = await runCli(['regions', '--province', 'Atlantis', '--json']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('INVALID_PARAM');
    // JSON mode may also emit a machine-readable error envelope on stdout
    if (r.stdout.trim().startsWith('{')) {
      const out = JSON.parse(r.stdout) as { ok?: boolean; error?: { code?: string } };
      expect(out.ok).toBe(false);
      expect(out.error?.code).toBe('INVALID_PARAM');
    }
  });
});

describe('CLI: cache (TC-39)', () => {
  it('cache stats --json exposes schema version and TTLs', async () => {
    const r = await runCli(['cache', 'stats', '--json']);
    expect(r.code).toBe(0);
    const out = parseJson(r.stdout);
    const data = out['data'] as Record<string, unknown>;
    expect(data['schema_version']).toBe(1);
    expect(data['enabled']).toBe(true);
    expect((data['ttl_seconds'] as Record<string, number>)['list']).toBe(21600);
    expect(data['entries']).toBeTruthy();
  });

  it('cache stats (table) writes a human report to stdout', async () => {
    const r = await runCli(['cache', 'stats']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('schema_version');
    expect(r.stdout).toContain('ttl_seconds');
  });
});

describe('CLI: --pages / --format ndjson guards (TC-44/NDJSON)', () => {
  it('--pages without --format ndjson → exit 2 INVALID_PARAM (no network)', async () => {
    const r = await runCli(['search', '--province', 'Hebei', '--pages', '2-5', '--json']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('INVALID_PARAM');
    expect(r.stderr).toContain('--pages requires --format ndjson');
  });

  it('invalid --pages spec in ndjson mode → exit 2 INVALID_PARAM, no upstream request', async () => {
    const r = await runCli(['search', '--province', 'Hebei', '--format', 'ndjson', '--pages', 'abc']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('INVALID_PARAM');
    expect(r.stderr).toContain('INVALID_ENUM');
  });
});

describe('CLI: search validation (no network) (TC-45)', () => {
  it('search without keyword/region → exit 2 INVALID_PARAM', async () => {
    const r = await runCli(['search', '--json']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('INVALID_PARAM');
  });

  it('Chinese keyword → exit 2 NON_ENGLISH_KEYWORD', async () => {
    const r = await runCli(['search', '--keyword', '玻璃', '--json']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('INVALID_PARAM');
    expect(r.stderr).toContain('NON_ENGLISH_KEYWORD');
  });

  it('page out of range fails before any upstream request', async () => {
    const r = await runCli(['search', '--province', 'Hebei', '--page', '101', '--json']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('INVALID_PARAM');
    expect(r.stderr).toContain('OUT_OF_RANGE');
  });
});
