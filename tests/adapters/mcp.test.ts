import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { buildMcpServer, validateToolInput } from '../../src/adapters/mcp/server.js';
import { TOOL_DEFINITIONS } from '../../src/adapters/mcp/schemas.js';
import { AppError, type Meta } from '../../src/core/errors.js';
import type { CompanyDetail } from '../../src/core/models.js';
import {
  installMockFetch,
  jsonResponse,
  makeTestContext,
  rawSupplierItem,
  supplierSearchPayload,
  type MockFetch,
  type TestEnv,
} from './helpers.js';

interface McpHarness {
  client: Client;
  env: TestEnv;
  mock: MockFetch;
  close: () => Promise<void>;
}

let harness: McpHarness | null = null;

function fakeCompanyDetail(): CompanyDetail {
  return {
    account: 'xingchenglass',
    company_id: '1800987236',
    encode_com_id: 'UCJfyzwThnqK',
    company_name: 'Hebei Xingchen Glass Technology Co., Ltd.',
    province: 'Hebei',
    city: 'Langfang',
    country: 'China',
    address: null,
    established_at: '2015-10-30',
    main_products: ['Glass Cup'],
    business_types: ['Manufacturer/Factory'],
    membership: {
      tier: 'diamond',
      raw_cs_level: 50,
      raw_member_level: 'diamond',
      since_year: 2025,
      evidence: ['json:csLevel=50'],
      confidence: 'high',
    },
    audited: true,
    capability_stars: 2,
    system_certifications: ['ISO 9001'],
    employees: 21,
    turnover: null,
    plant_area: null,
    company_url: null,
    company_info_url: null,
    detail_source: 'json',
    include: [],
    enrichment: { audit: null, response: null, contacts: null, reviews: null },
    availability: [],
  };
}

async function createHarness(opts: {
  resources?: boolean;
  companyDetail?: (input: unknown, requestId: string) => Promise<{ data: CompanyDetail; meta: Meta }>;
  fetchHandler?: (url: string, init?: RequestInit) => Response | undefined;
} = {}): Promise<McpHarness> {
  const env = makeTestContext();
  const mock = installMockFetch((url, init) => {
    const response = opts.fetchHandler?.(url, init);
    if (!response) throw new Error(`unexpected upstream fetch in MCP test: ${url}`);
    return response;
  });
  const server = buildMcpServer(env.ctx, {
    resources: opts.resources,
    companyDetail: opts.companyDetail as never,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'mic-adapters-test', version: '0.0.1' });
  await client.connect(clientTransport);
  return {
    client,
    env,
    mock,
    close: async () => {
      await client.close().catch(() => undefined);
      await server.close().catch(() => undefined);
      mock.restore();
      env.close();
    },
  };
}

async function callTool(name: string, args?: Record<string, unknown>): Promise<{ isError: boolean; payload: Record<string, unknown> }> {
  const result = (await harness!.client.callTool({ name, arguments: args ?? {} })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  const text = result.content.find((c) => c.type === 'text')?.text ?? '{}';
  return { isError: result.isError === true, payload: JSON.parse(text) as Record<string, unknown> };
}

afterEach(async () => {
  if (harness) await harness.close();
  harness = null;
});

describe('MCP adapter — tools & schemas (docs/04 §3.4)', () => {
  it('lists the 4 contract tools with strict input schemas', async () => {
    harness = await createHarness();
    const { tools } = await harness.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['explain_membership', 'get_company', 'list_regions', 'search_factories']);
    for (const tool of tools) {
      const schema = tool.inputSchema as Record<string, unknown>;
      expect(schema['additionalProperties']).toBe(false);
      expect(schema['type']).toBe('object');
    }
    const search = tools.find((t) => t.name === 'search_factories')!;
    expect(Array.isArray((search.inputSchema as Record<string, unknown>)['anyOf'])).toBe(true);
    const company = tools.find((t) => t.name === 'get_company')!;
    expect(Array.isArray((company.inputSchema as Record<string, unknown>)['anyOf'])).toBe(true);
    expect(search.annotations?.readOnlyHint).toBe(true);
  });

  it('list_regions returns the 32-province dictionary (no network)', async () => {
    harness = await createHarness();
    const { isError, payload } = await callTool('list_regions');
    expect(isError).toBe(false);
    expect(payload['ok']).toBe(true);
    const data = payload['data'] as { count: number; provinces: Array<{ name: string; api_value: string }> };
    expect(data.count).toBe(32);
    expect(data.provinces.find((p) => p.name === 'Hebei')?.api_value).toBe('Hebei');
    expect(harness.mock.calls).toHaveLength(0);

    const hebei = await callTool('list_regions', { province: '河北' });
    const detail = hebei.payload['data'] as { province: { name: string }; cities: unknown[] };
    expect(detail.province.name).toBe('Hebei');
    expect(detail.cities).toHaveLength(10);
  });

  it('explain_membership returns tiers + KA/SKA clarification (no network)', async () => {
    harness = await createHarness();
    const { isError, payload } = await callTool('explain_membership');
    expect(isError).toBe(false);
    const data = payload['data'] as { tiers: Array<{ tier: string }>; not_mic_tiers: unknown[] };
    expect(data.tiers.map((t) => t.tier)).toEqual(['diamond', 'gold', 'free', 'unknown']);
    expect(data.not_mic_tiers).toHaveLength(3);
    expect(harness.mock.calls).toHaveLength(0);
  });
});

describe('MCP adapter — tool calls', () => {
  it('search_factories returns the envelope and normalizes items', async () => {
    harness = await createHarness({
      fetchHandler: (url) =>
        url.startsWith('https://m.made-in-china.com/search/supplier')
          ? jsonResponse(
              supplierSearchPayload({
                items: [rawSupplierItem({ account: 'glass-a' }), rawSupplierItem({ account: 'glass-b', csLevel: 30 })],
                total: 2,
              }),
            )
          : undefined,
    });
    const { isError, payload } = await callTool('search_factories', { keyword: 'glass', province: 'Hebei' });
    expect(isError).toBe(false);
    const data = payload['data'] as { items: Array<{ account: string; membership: { tier: string } }>; pagination: { total: number } };
    expect(data.pagination.total).toBe(2);
    expect(data.items[0]?.account).toBe('glass-a');
    expect(data.items[1]?.membership.tier).toBe('gold');
    const meta = payload['meta'] as { request_id: string; source: string };
    expect(meta.request_id).toMatch(/^req_/);
    expect(meta.source).toBe('json');
  });

  it('rejects unknown parameters with isError + INVALID_PARAM', async () => {
    harness = await createHarness();
    const unknown = await callTool('search_factories', { keyword: 'glass', foo: 'bar' });
    expect(unknown.isError).toBe(true);
    const error = unknown.payload['error'] as { code: string; details: Record<string, unknown> };
    expect(error.code).toBe('INVALID_PARAM');
    expect(error.details['reason']).toBe('UNKNOWN_QUERY_PARAM');
  });

  it('rejects missing discriminators and out-of-range values', async () => {
    harness = await createHarness();
    const missing = await callTool('search_factories', {});
    expect(missing.isError).toBe(true);
    expect((missing.payload['error'] as { details: Record<string, unknown> }).details['reason']).toBe('MISSING_REQUIRED_COMBO');

    const outOfRange = await callTool('search_factories', { keyword: 'glass', page: 101 });
    expect(outOfRange.isError).toBe(true);
    expect((outOfRange.payload['error'] as { details: Record<string, unknown> }).details['reason']).toBe('OUT_OF_RANGE');

    const badEnum = await callTool('search_factories', { keyword: 'glass', membership_tier: 'free' });
    expect(badEnum.isError).toBe(true);
    expect((badEnum.payload['error'] as { details: Record<string, unknown> }).details['reason']).toBe('INVALID_ENUM');
  });

  it('get_company uses the injected detail service and maps business errors', async () => {
    harness = await createHarness({
      companyDetail: async (_input, requestId) => ({
        data: fakeCompanyDetail(),
        meta: { request_id: requestId, cached: false, stale: false, fetched_at: '2026-11-15T23:00:00+08:00', source: 'json', warnings: [] },
      }),
    });
    const ok = await callTool('get_company', { account: 'xingchenglass', include: ['audit'] });
    expect(ok.isError).toBe(false);
    const data = ok.payload['data'] as { account: string; membership: { tier: string } };
    expect(data.account).toBe('xingchenglass');
    expect(data.membership.tier).toBe('diamond');

    await harness.close();
    harness = await createHarness({
      companyDetail: async () => {
        throw new AppError('NOT_FOUND', 'company not found by encode com id (not indexed locally)', {
          reason: 'ENCODE_COM_ID_NOT_INDEXED',
        });
      },
    });
    const notFound = await callTool('get_company', { encode_com_id: 'UCJfyzwThnqK' });
    expect(notFound.isError).toBe(true);
    const error = notFound.payload['error'] as { code: string; details: Record<string, unknown> };
    expect(error.code).toBe('NOT_FOUND');
    expect(error.details['reason']).toBe('ENCODE_COM_ID_NOT_INDEXED');
    expect(String(error.details['request_id'])).toMatch(/^req_/);
  });

  it('unknown tool raises a JSON-RPC MethodNotFound error', async () => {
    harness = await createHarness();
    await expect(harness.client.callTool({ name: 'unknown_tool', arguments: {} })).rejects.toBeInstanceOf(McpError);
  });
});

describe('MCP adapter — resources', () => {
  it('lists and reads mic://regions and mic://membership-levels', async () => {
    harness = await createHarness();
    const { resources } = await harness.client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(['mic://membership-levels', 'mic://regions']);

    const regions = await harness.client.readResource({ uri: 'mic://regions' });
    const regionsPayload = JSON.parse((regions.contents[0] as { text: string }).text) as {
      ok: boolean;
      data: { count: number };
    };
    expect(regionsPayload.ok).toBe(true);
    expect(regionsPayload.data.count).toBe(32);

    const levels = await harness.client.readResource({ uri: 'mic://membership-levels' });
    const levelsPayload = JSON.parse((levels.contents[0] as { text: string }).text) as { data: { tiers: unknown[] } };
    expect(levelsPayload.data.tiers).toHaveLength(4);
  });

  it('returns InvalidParams (-32602) for an unknown resource URI', async () => {
    harness = await createHarness();
    await expect(harness.client.readResource({ uri: 'mic://unknown' })).rejects.toMatchObject({ code: -32602 });
  });

  it('--no-resources exposes tools only', async () => {
    harness = await createHarness({ resources: false });
    const { tools } = await harness.client.listTools();
    expect(tools).toHaveLength(4);
    await expect(harness.client.listResources()).rejects.toBeInstanceOf(McpError);
  });
});

describe('MCP adapter — inputSchema validation helper', () => {
  it('accepts valid input and rejects unknown/additional properties', () => {
    const search = TOOL_DEFINITIONS.find((t) => t.name === 'search_factories')!;
    const validated = validateToolInput(search, { keyword: 'glass', page: 2, include_ads: false });
    expect(validated['keyword']).toBe('glass');
    expect(validated['page']).toBe(2);

    expect(() => validateToolInput(search, { keyword: 'glass', extra: 1 })).toThrowError(AppError);
    expect(() => validateToolInput(search, { keyword: 'glass', page: 0 })).toThrowError(AppError);
    expect(() => validateToolInput(search, {})).toThrowError(AppError);
  });

  it('validates include arrays (uniqueItems / enum)', () => {
    const company = TOOL_DEFINITIONS.find((t) => t.name === 'get_company')!;
    expect(validateToolInput(company, { account: 'x', include: ['audit', 'reviews'] })['include']).toEqual(['audit', 'reviews']);
    expect(() => validateToolInput(company, { account: 'x', include: ['audit', 'audit'] })).toThrowError(AppError);
    expect(() => validateToolInput(company, { account: 'x', include: ['phone'] })).toThrowError(AppError);
  });
});
