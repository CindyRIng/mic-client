/**
 * MCP adapter (M3, docs/04 §3): stdio JSON-RPC server exposing 4 read-only tools and
 * 2 resources. stdout is reserved for the protocol (logs go to stderr via Logger).
 *
 * Input validation is done in the handlers (not by the SDK) so a bad argument returns
 * `isError:true` with the same INVALID_PARAM envelope as REST/CLI (docs/04 §3.2.3).
 */
import os from 'node:os';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
  type Implementation,
  type Resource,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import type { AppContext } from '../../core/container.js';
import { AppError, isAppError, type Meta } from '../../core/errors.js';
import { newRequestId } from '../../core/logger.js';
import { VERSION } from '../../version.js';
import {
  buildMembershipLevelsData,
  buildRegionsData,
  errorMeta,
  findAccountByEncodeComId,
  firstString,
  getCompanyDetail,
  nowIso,
  parseIncludeTokens,
  resolveCompanyPathInput,
  withTimeout,
  type CompanyLookupInput,
} from '../rest/shared.js';
import {
  RESOURCE_DEFINITIONS,
  TOOL_DEFINITIONS,
  TOOL_TIMEOUT_DEFAULTS,
  type JsonObject,
  type McpToolDefinition,
} from './schemas.js';

export interface McpServerOptions {
  /** Expose mic:// resources (default true; CLI `--no-resources` disables). */
  resources?: boolean;
  /** Injected company-detail implementation (tests); defaults to the M2 bridge. */
  companyDetail?: (input: CompanyLookupInput, requestId: string) => Promise<{ data: unknown; meta: Meta }>;
}

type ValidatedArgs = Record<string, unknown>;

function invalid(message: string, details: Record<string, unknown>): AppError {
  return new AppError('INVALID_PARAM', message, details);
}

function checkEnum(value: string, schema: JsonObject, pathName: string): void {
  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.includes(value)) {
    throw invalid(`invalid value for ${pathName}`, {
      param: pathName,
      reason: 'INVALID_ENUM',
      allowed,
      value,
    });
  }
}

function validateString(value: unknown, schema: JsonObject, pathName: string): string {
  if (typeof value !== 'string') {
    throw invalid(`${pathName} must be a string`, { param: pathName, reason: 'INVALID_ENUM', expected: 'string' });
  }
  if (typeof schema['minLength'] === 'number' && value.length < schema['minLength']) {
    throw invalid(`${pathName} is too short`, { param: pathName, reason: 'OUT_OF_RANGE', minLength: schema['minLength'] });
  }
  if (typeof schema['maxLength'] === 'number' && value.length > schema['maxLength']) {
    throw invalid(`${pathName} is too long`, { param: pathName, reason: 'OUT_OF_RANGE', maxLength: schema['maxLength'] });
  }
  if (typeof schema['pattern'] === 'string') {
    try {
      if (!new RegExp(schema['pattern']).test(value)) {
        throw invalid(`${pathName} does not match the required pattern`, {
          param: pathName,
          reason: 'INVALID_ENUM',
          pattern: schema['pattern'],
        });
      }
    } catch (e) {
      if (isAppError(e)) throw e;
    }
  }
  checkEnum(value, schema, pathName);
  return value;
}

function validateInteger(value: unknown, schema: JsonObject, pathName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalid(`${pathName} must be an integer`, { param: pathName, reason: 'INVALID_ENUM', expected: 'integer' });
  }
  if (typeof schema['minimum'] === 'number' && value < schema['minimum']) {
    throw invalid(`${pathName} is below the minimum`, { param: pathName, reason: 'OUT_OF_RANGE', min: schema['minimum'] });
  }
  if (typeof schema['maximum'] === 'number' && value > schema['maximum']) {
    throw invalid(`${pathName} is above the maximum`, { param: pathName, reason: 'OUT_OF_RANGE', max: schema['maximum'] });
  }
  checkEnum(value as unknown as string, schema, pathName);
  return value;
}

function validateBoolean(value: unknown, pathName: string): boolean {
  if (typeof value !== 'boolean') {
    throw invalid(`${pathName} must be a boolean`, { param: pathName, reason: 'INVALID_ENUM', expected: 'boolean' });
  }
  return value;
}

function validateArray(value: unknown, schema: JsonObject, pathName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalid(`${pathName} must be an array`, { param: pathName, reason: 'INVALID_ENUM', expected: 'array' });
  }
  const itemSchema = schema['items'];
  const items: unknown[] =
    itemSchema && typeof itemSchema === 'object'
      ? value.map((item, index) => validateValue(item, itemSchema as JsonObject, `${pathName}[${index}]`))
      : [...value];
  if (schema['uniqueItems'] === true) {
    const seen = new Set<string>();
    for (const item of items) {
      const key = JSON.stringify(item);
      if (seen.has(key)) {
        throw invalid(`${pathName} must contain unique items`, { param: pathName, reason: 'INVALID_ENUM' });
      }
      seen.add(key);
    }
  }
  return items;
}

function validateValue(value: unknown, schema: JsonObject, pathName: string): unknown {
  const type = schema['type'];
  if (type === 'string' || (type === undefined && Array.isArray(schema['enum']))) return validateString(value, schema, pathName);
  if (type === 'integer') return validateInteger(value, schema, pathName);
  if (type === 'boolean') return validateBoolean(value, pathName);
  if (type === 'array') return validateArray(value, schema, pathName);
  if (type === 'object') return validateObject(value, schema, pathName);
  return value;
}

function validateObject(value: unknown, schema: JsonObject, pathName: string): ValidatedArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${pathName} must be an object`, { param: pathName, reason: 'INVALID_ENUM', expected: 'object' });
  }
  const input = value as Record<string, unknown>;
  const properties = (schema['properties'] as Record<string, JsonObject> | undefined) ?? {};
  const allowed = Object.keys(properties);
  if (schema['additionalProperties'] === false) {
    const unknownKeys = Object.keys(input).filter((k) => !allowed.includes(k));
    if (unknownKeys.length > 0) {
      throw invalid(`unknown parameter(s): ${unknownKeys.join(', ')}`, {
        param: pathName === 'arguments' ? unknownKeys[0] : pathName,
        reason: 'UNKNOWN_QUERY_PARAM',
        params: unknownKeys,
      });
    }
  }
  const out: ValidatedArgs = {};
  for (const [key, propSchema] of Object.entries(properties)) {
    if (input[key] !== undefined && input[key] !== null) out[key] = validateValue(input[key], propSchema, key);
  }
  const required = schema['required'];
  if (Array.isArray(required)) {
    for (const key of required) {
      if (typeof key === 'string' && out[key] === undefined) {
        throw invalid(`missing required parameter: ${key}`, { param: key, reason: 'MISSING_REQUIRED_COMBO' });
      }
    }
  }
  return out;
}

/** Validate one tool call against its inputSchema (draft-07 subset used by docs/04). */
export function validateToolInput(def: McpToolDefinition, rawArgs: unknown, toolName = def.name): ValidatedArgs {
  const args = rawArgs === undefined || rawArgs === null ? {} : rawArgs;
  const schema = def.inputSchema;
  const validated = validateObject(args, schema, 'arguments');
  const anyOf = schema['anyOf'];
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const satisfied = anyOf.some((entry) => {
      const required = (entry as JsonObject)['required'];
      return Array.isArray(required) && required.every((key) => typeof key !== 'string' || validated[key] !== undefined);
    });
    if (!satisfied) {
      const hint =
        toolName === 'get_company'
          ? 'provide at least one of account / com_id / encode_com_id'
          : 'provide at least one of keyword / province / city';
      throw invalid(`required discriminator missing for ${toolName}`, {
        param: toolName,
        reason: 'MISSING_REQUIRED_COMBO',
        hint,
      });
    }
  }
  return validated;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

interface ToolRunOutput {
  data: unknown;
  meta: Meta;
}

function okResult(output: ToolRunOutput): CallToolResult {
  const payload = { ok: true as const, data: output.data, meta: output.meta };
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function errorResult(error: AppError, requestId: string): CallToolResult {
  const details = error.details ? { ...error.details } : {};
  if (details['request_id'] === undefined) details['request_id'] = requestId;
  const payload = {
    ok: false as const,
    error: { code: error.code, message: error.message, details },
    meta: errorMeta(error.code, requestId),
  };
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: true };
}

function pickTimeout(args: ValidatedArgs, toolName: string): number {
  const raw = args['timeout_ms'];
  if (typeof raw === 'number') return raw;
  return TOOL_TIMEOUT_DEFAULTS[toolName] ?? 30000;
}

function successMeta(meta: Meta, requestId: string): Meta {
  return { ...meta, request_id: requestId };
}

async function runSearch(ctx: AppContext, args: ValidatedArgs, requestId: string): Promise<ToolRunOutput> {
  const result = await ctx.search.search({
    keyword: args['keyword'] as string | undefined,
    province: args['province'] as string | undefined,
    city: args['city'] as string | undefined,
    category_code: args['category_code'] as string | undefined,
    membership_tier: args['membership_tier'] as string | undefined,
    audited: args['audited'] as boolean | undefined,
    management_certification: args['management_certification'] as string | undefined,
    business_type: args['business_type'] as string | undefined,
    annual_revenue: args['annual_revenue'] as string | undefined,
    rd_capacity: args['rd_capacity'] as string | undefined,
    page: args['page'] as number | undefined,
    page_size: args['page_size'] as number | undefined,
    refresh: args['refresh'] as boolean | undefined,
    include_ads: args['include_ads'] as boolean | undefined,
    request_id: requestId,
  });
  return { data: result.data, meta: successMeta(result.meta, requestId) };
}

async function runCompany(ctx: AppContext, args: ValidatedArgs, requestId: string, options: McpServerOptions): Promise<ToolRunOutput> {
  const includeRaw = args['include'];
  let include: string[] = [...parseIncludeTokens(undefined)];
  if (Array.isArray(includeRaw)) {
    include = includeRaw.map(String);
  } else if (typeof includeRaw === 'string') {
    include = parseIncludeTokens(includeRaw);
  }
  const input: CompanyLookupInput = {
    include,
    refresh: args['refresh'] as boolean | undefined,
  };
  const accountRaw = firstString(args['account']);
  if (accountRaw) {
    const resolved = resolveCompanyPathInput(accountRaw);
    Object.assign(input, resolved);
    if (input.account) {
      const indexed = findAccountByEncodeComId(ctx, input.account);
      if (indexed) {
        input.account = indexed;
        input.encode_com_id = accountRaw;
      }
    }
  }
  const comId = firstString(args['com_id']);
  if (comId) input.com_id = comId;
  const encode = firstString(args['encode_com_id']);
  if (encode) input.encode_com_id = encode;
  const result = options.companyDetail
    ? await options.companyDetail(input, requestId)
    : await getCompanyDetail(ctx, input, requestId);
  return { data: result.data, meta: successMeta(result.meta, requestId) };
}

async function runListRegions(ctx: AppContext, args: ValidatedArgs, requestId: string): Promise<ToolRunOutput> {
  if (args['refresh'] === true) ctx.cache.clear('regions');
  const province = firstString(args['province']);
  const data = buildRegionsData(province);
  const meta: Meta = { request_id: requestId, cached: true, stale: false, fetched_at: nowIso(), source: 'cache', warnings: [] };
  return { data, meta };
}

async function runExplainMembership(requestId: string): Promise<ToolRunOutput> {
  const meta: Meta = { request_id: requestId, cached: true, stale: false, fetched_at: nowIso(), source: 'cache', warnings: [] };
  return { data: buildMembershipLevelsData(), meta };
}

async function dispatchTool(
  ctx: AppContext,
  def: McpToolDefinition,
  args: ValidatedArgs,
  requestId: string,
  options: McpServerOptions,
): Promise<ToolRunOutput> {
  const timeoutMs = pickTimeout(args, def.name);
  const run = async (): Promise<ToolRunOutput> => {
    switch (def.name) {
      case 'search_factories':
        return runSearch(ctx, args, requestId);
      case 'get_company':
        return runCompany(ctx, args, requestId, options);
      case 'list_regions':
        return runListRegions(ctx, args, requestId);
      case 'explain_membership':
        return runExplainMembership(requestId);
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${def.name}`);
    }
  };
  return withTimeout(run(), timeoutMs, 'timeout');
}

// ---------------------------------------------------------------------------
// Server factory / lifecycle
// ---------------------------------------------------------------------------

function toolLoad(): Tool[] {
  return TOOL_DEFINITIONS as unknown as Tool[];
}

/**
 * Build the MCP server (no transport). Exposed for tests (in-memory transport) and for
 * `mic mcp`. Local initialization only: no upstream request, no browser launch.
 */
export function buildMcpServer(ctx: AppContext, options: McpServerOptions = {}): Server {
  const resourcesEnabled = options.resources !== false;
  const capabilities = {
    tools: { listChanged: false },
    ...(resourcesEnabled ? { resources: { subscribe: false, listChanged: false } } : {}),
  };
  const serverInfo = {
    name: 'mic-client',
    title: 'MIC Client（Made-in-China 本地工厂检索）',
    version: VERSION,
  } as Implementation;
  const server = new Server(serverInfo, {
    capabilities,
    instructions:
      'Read-only local client for Made-in-China supplier discovery. Prefer search_factories then get_company. Anonymous data only; phone/email are not public. First calls may be slower (upstream rate limits / captcha fallback). Errors use the documented codes; NEED_HUMAN_VERIFICATION means the user should run `mic auth`.',
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolLoad() }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const requestId = newRequestId();
    const name = request.params.name;
    const def = TOOL_DEFINITIONS.find((d) => d.name === name);
    if (!def) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    try {
      const args = validateToolInput(def, request.params.arguments);
      const output = await dispatchTool(ctx, def, args, requestId, options);
      return okResult(output);
    } catch (e) {
      if (e instanceof McpError) throw e;
      const error = isAppError(e)
        ? e
        : new AppError('INTERNAL_ERROR', e instanceof Error ? e.message : String(e), undefined, { cause: e });
      ctx.logger.debug('mcp: tool call failed', { tool: name, code: error.code, request_id: requestId });
      return errorResult(error, requestId);
    }
  });

  if (resourcesEnabled) {
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: RESOURCE_DEFINITIONS as unknown as Resource[],
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const requestId = newRequestId();
      if (uri === 'mic://regions') {
        const data = buildRegionsData();
        const meta: Meta = { request_id: requestId, cached: true, stale: false, fetched_at: nowIso(), source: 'cache', warnings: [] };
        return {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ ok: true, data, meta }) }],
        };
      }
      if (uri === 'mic://membership-levels') {
        const data = buildMembershipLevelsData();
        const meta: Meta = { request_id: requestId, cached: true, stale: false, fetched_at: nowIso(), source: 'cache', warnings: [] };
        return {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ ok: true, data, meta }) }],
        };
      }
      throw new McpError(ErrorCode.InvalidParams, `Resource not found: ${uri}`);
    });
  }

  return server;
}

/**
 * Run the MCP server over stdio until the client closes stdin or the process receives
 * SIGINT/SIGTERM. Never writes to stdout outside the protocol.
 */
export async function runMcpServer(ctx: AppContext, options: McpServerOptions = {}): Promise<void> {
  const server = buildMcpServer(ctx, options);
  const transport = new StdioServerTransport();
  let resolveClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  transport.onclose = () => resolveClosed();
  const shutdown = (): void => {
    void server
      .close()
      .catch(() => undefined)
      .finally(() => resolveClosed());
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await server.connect(transport);
    ctx.logger.info('mcp: server ready on stdio', { version: VERSION, resources: options.resources !== false });
    await closed;
  } finally {
    process.removeListener('SIGINT', shutdown);
    process.removeListener('SIGTERM', shutdown);
    await server.close().catch(() => undefined);
  }
}

/** Claude Code / MCP client configuration snippet (`mic mcp --print-config`). */
export function mcpClientConfig(entryScript?: string): Record<string, unknown> {
  const entry = path.resolve(entryScript ?? process.argv[1] ?? 'dist/cli.js');
  const cloakRun = process.env['MIC_CLOAK_RUN'] ?? path.join(os.homedir(), 'cloak-env', 'bin', 'cloak-run');
  return {
    mcpServers: {
      mic: {
        type: 'stdio',
        command: cloakRun,
        args: ['node', entry, 'mcp'],
        env: {
          MIC_PROFILE_DIR: process.env['MIC_PROFILE_DIR'] ?? path.join(os.homedir(), '.mic-client', 'profiles', 'default'),
          MIC_DATA_DIR: process.env['MIC_DATA_DIR'] ?? path.join(os.homedir(), '.mic-client', 'data'),
          MIC_LOG_LEVEL: process.env['MIC_LOG_LEVEL'] ?? 'warn',
        },
      },
    },
  };
}
