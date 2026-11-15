#!/usr/bin/env node
/**
 * MCP stdio smoke test: spawn `mic mcp`, initialize, list tools/resources,
 * call the offline tools (list_regions / explain_membership). No upstream network.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';

// Prefer the installed thin launcher (runs through cloak-run, so browser fallback works).
const launcher = process.env.MIC_BIN || path.join(process.env.HOME || '', '.local', 'bin', 'mic');
const transport = new StdioClientTransport({
  command: launcher,
  args: ['mcp'],
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

// ---- real upstream calls through MCP ----
const search = await client.callTool({ name: 'search_factories', arguments: { keyword: 'glass', province: 'Hebei', page: 1 } });
const searchEnvelope = JSON.parse(search.content[0].text);
const sdata = searchEnvelope.data ?? searchEnvelope;
const stotal = (sdata.pagination || {}).total || 0;
ok('search_factories (live)', searchEnvelope.ok === true && 600 <= stotal <= 800 && (sdata.items || []).length >= 15, `total=${stotal} items=${(sdata.items || []).length}`);

const company = await client.callTool({ name: 'get_company', arguments: { account: 'xingchenglass', include: ['audit', 'response'] } });
const companyEnvelope = JSON.parse(company.content[0].text);
const cdata = companyEnvelope.data ?? companyEnvelope;
ok('get_company (live/cached)', companyEnvelope.ok === true && (cdata.membership || {}).tier === 'diamond' && cdata.established_at === '2015-10-30', `tier=${(cdata.membership || {}).tier} est=${cdata.established_at}`);

const hebeiRegion = await client.callTool({ name: 'list_regions', arguments: { province: '河北' } });
const hebeiEnvelope = JSON.parse(hebeiRegion.content[0].text);
const hebeiData = hebeiEnvelope.data ?? hebeiEnvelope;
ok('list_regions province', hebeiData.province?.name === 'Hebei' && (hebeiData.cities || []).length === 10, `cities=${(hebeiData.cities || []).length}`);

const resList = await client.listResources();
const readRegions = await client.readResource({ uri: 'mic://regions' });
const rr = JSON.parse(readRegions.contents[0].text);
ok('resource mic://regions', resList.resources.length >= 2 && (rr.provinces || rr.data?.provinces || []).length === 32, `provinces=${(rr.provinces || rr.data?.provinces || []).length}`);
const readLevels = await client.readResource({ uri: 'mic://membership-levels' });
const rl = JSON.parse(readLevels.contents[0].text);
const resourceTiers = rl.tiers || rl.data?.tiers || [];
ok('resource mic://membership-levels', resourceTiers.length === 4, `tiers=${resourceTiers.map((t) => t.tier).join(',')}`);

const bad = await client.callTool({ name: 'list_regions', arguments: { province: 'Atlantis' } });
ok('error mapping', bad.isError === true, JSON.stringify(bad.structuredContent ?? bad.content).slice(0, 120));

const badArg = await client.callTool({ name: 'search_factories', arguments: { keyword: 'glass', nope: 1 } });
ok('unknown tool arg -> isError', badArg.isError === true, JSON.stringify(badArg.structuredContent ?? badArg.content).slice(0, 120));

await client.close();
console.log(failures ? `\n${failures} FAILED` : '\nALL MCP SMOKE CHECKS PASSED');
process.exit(failures ? 1 : 0);
