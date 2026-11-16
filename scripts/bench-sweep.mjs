import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createContext, closeContext } from '../dist/core/container.js';

const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `mic-bench-${tag}-`));
const cfgOverride = (dir) => ({ data_dir: dir, log_level: 'error', cache: { enabled: true } });
const t = () => Date.now();

async function sequential(pages, dir) {
  const ctx = createContext({ configOverrides: cfgOverride(dir), jsonLogs: false });
  const times = []; const counts = [];
  try {
    for (const page of pages) {
      const s = t();
      const res = await ctx.search.search({ province: 'Hebei', page });
      times.push(t() - s); counts.push(res.data.items.length);
    }
  } finally { closeContext(ctx); }
  return { times, counts };
}

async function concurrent(pages, dir) {
  const ctx = createContext({ configOverrides: cfgOverride(dir), jsonLogs: false });
  const s = t();
  try {
    const out = await Promise.all(pages.map(async (page) => {
      const p0 = t();
      const res = await ctx.search.search({ province: 'Hebei', page });
      return { page, ms: t() - p0, items: res.data.items.length };
    }));
    return { wall: t() - s, out: out.sort((a, b) => a.page - b.page) };
  } finally { closeContext(ctx); }
}

// sequential 6 pages (fresh cache)
const seq = await sequential([1, 2, 3, 4, 5, 6], tmp('seq'));
console.log('SEQUENTIAL pages=6 total_ms=%d per_page=%j sum_items=%d', seq.times.reduce((a, b) => a + b, 0), seq.times.map((x) => Math.round(x)), seq.counts.reduce((a, b) => a + b, 0));

// concurrent 6 pages (fresh cache)
const con = await concurrent([1, 2, 3, 4, 5, 6], tmp('con'));
console.log('CONCURRENT pages=6 wall_ms=%d per_page=%j items=%d', con.wall, con.out.map((x) => Math.round(x.ms)), con.out.reduce((a, b) => a + b.items, 0));
