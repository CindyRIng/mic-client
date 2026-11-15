import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildRestServer } from '../../src/adapters/rest/server.js';
import { VERSION } from '../../src/version.js';
import { makeTestContext, type TestEnv } from './helpers.js';
import { loadConfig } from '../../src/core/config.js';

let env: TestEnv | null = null;
let app: FastifyInstance | null = null;

function setup(): FastifyInstance {
  env = makeTestContext();
  app = buildRestServer(env.ctx);
  return app;
}

afterEach(async () => {
  if (app) await app.close();
  app = null;
  env?.close();
  env = null;
  vi.restoreAllMocks();
});

describe('REST self-describing docs (ADR-0008 / docs/03 §2.3)', () => {
  it('default REST port is 8899 (8787 is commonly occupied by other local services)', () => {
    const cfg = loadConfig({});
    expect(cfg.rest.port).toBe(8899);
  });

  it('GET /openapi.json returns an OpenAPI 3.1 document for exactly the 8 business endpoints', async () => {
    const server = setup();
    const res = await server.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json; charset=utf-8');

    const spec = res.json() as {
      openapi: string;
      info: { version: string; title: string };
      servers: Array<{ url: string }>;
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.version).toBe(VERSION);
    expect(spec.info.title).toContain('MIC Client');
    expect(spec.servers[0]?.url).toBe('http://127.0.0.1:8899');

    const methods: Record<string, string> = {};
    for (const [path, item] of Object.entries(spec.paths)) {
      methods[path] = Object.keys(item).join(',').toLowerCase();
    }
    expect(methods).toEqual({
      '/health': 'get',
      '/api/version': 'get',
      '/api/regions': 'get',
      '/api/search/factories': 'get',
      '/api/companies/{account}': 'get',
      '/api/membership/levels': 'get',
      '/api/cache/refresh': 'post',
      '/api/cache/stats': 'get',
    });
    // docs endpoints are auxiliary and must not appear in the API contract
    expect(spec.paths['/docs']).toBeUndefined();
    expect(spec.paths['/openapi.json']).toBeUndefined();

    for (const name of ['Meta', 'ErrorEnvelope', 'SearchResponse', 'CompanyDetail', 'ProvincesResponse', 'RefreshResult']) {
      expect(spec.components.schemas).toHaveProperty(name);
    }
  });

  it('all local $ref values resolve inside components.schemas', async () => {
    const server = setup();
    const spec = (await server.inject({ method: 'GET', url: '/openapi.json' })).json() as {
      components: { schemas: Record<string, unknown> };
      paths: unknown;
    };
    const seen: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === '$ref' && typeof v === 'string') seen.push(v);
          else walk(v);
        }
      }
    };
    walk(spec.paths);
    walk(spec.components.schemas);
    expect(seen.length).toBeGreaterThan(10);
    for (const refValue of seen) {
      const name = refValue.replace('#/components/schemas/', '');
      expect(spec.components.schemas, refValue).toHaveProperty(name);
    }
    // every schema with a $ref survives JSON round-trip (serializable)
    expect(() => JSON.stringify(spec)).not.toThrow();
  });

  it('GET /docs serves a self-contained HTML page (no external CDN/scripts/fonts)', async () => {
    const server = setup();
    const res = await server.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html; charset=utf-8');
    const html = res.body;
    expect(html).toContain('MIC Client · REST API Docs');
    expect(html).toContain('/openapi.json');
    expect(html).toContain('docs/03-rest-api.md');
    // self-contained: no external script/style/font sources
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/i);
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/i);
    expect(html).not.toMatch(/@import\s+url\(/i);
    // still has the inline renderer + try-it logic
    expect(html).toContain("fetch(SPEC_URL");
    expect(html).toContain('Try it');
  });

  it('docs endpoints obey the loopback Host guard', async () => {
    const server = setup();
    for (const url of ['/docs', '/openapi.json']) {
      const res = await server.inject({ method: 'GET', url, headers: { host: 'evil.example.com' } });
      expect(res.statusCode).toBe(400);
      const body = res.json() as { ok: boolean; error: { code: string; details: { reason: string } } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('INVALID_PARAM');
      expect(body.error.details.reason).toBe('HOST_NOT_ALLOWED');
    }
  });
});
