#!/usr/bin/env node
/**
 * MCP stdio smoke test: spawn `mic mcp`, initialize, list tools/resources,
 * call the offline tools (list_regions / explain_membership). No upstream network.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';

const entry = path.resolve(process.cwd(), 'dist/cli.js');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry, 'mcp'],
  stderr: 'pipe',
  env: { ...process.env, MIC_LOG_LEVEL: 'warn' },
});
const client = new Client({ name: 'mic-smoke', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

let failures = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
  if (!cond) failures++;
};

const tools = await client.listTools();
ok('tools/list', tools.tools.length === 4, tools.tools.map((t) => t.name).join(','));
for (const t of tools.tools) ok(`tool schema ${t.name}`, Boolean(t.inputSchema?.type === 'object'), t.description?.slice(0, 50));

const resources = await client.listResources();
ok('resources/list', resources.resources.length >= 2, resources.resources.map((r) => r.uri).join(','));

const regions = await client.callTool({ name: 'list_regions', arguments: {} });
const regionEnvelope = JSON.parse(regions.content[0].text);
const regionPayload = regionEnvelope.data ?? regionEnvelope;
const provinces = regionPayload.provinces ?? [];
const hebei = provinces.find((p) => p.name === 'Hebei');
ok('list_regions', provinces.length >= 31 && hebei?.cities_complete === true, `provinces=${provinces.length} hebei_cities_complete=${hebei?.cities_complete}`);

const levels = await client.callTool({ name: 'explain_membership', arguments: {} });
const levelEnvelope = JSON.parse(levels.content[0].text);
const levelPayload = levelEnvelope.data ?? levelEnvelope;
const tiers = levelPayload.tiers ?? levelPayload.levels ?? [];
ok('explain_membership', Array.isArray(tiers) && tiers.length === 4 && tiers.some((t) => t.tier === 'diamond'), `tiers=${tiers.map((t) => t.tier).join(',')}`);

const bad = await client.callTool({ name: 'list_regions', arguments: { province: 'Atlantis' } });
ok('error mapping', bad.isError === true, JSON.stringify(bad.structuredContent ?? bad.content).slice(0, 120));

await client.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL MCP SMOKE CHECKS PASSED');
process.exit(failures ? 1 : 0);
