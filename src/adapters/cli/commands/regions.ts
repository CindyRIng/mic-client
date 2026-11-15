import type { Command } from 'commander';
import type { GlobalOptions } from '../output.js';
import { envelope, fail, formatTable, printJson, useJson, withContext } from '../output.js';
import { buildRegionsData } from '../../../core/services/static.js';
import { newRequestId } from '../../../core/logger.js';
import { makeMeta } from '../../../core/errors.js';

export function registerRegionsCommand(program: Command): void {
  program
    .command('regions')
    .description('list province/city dictionary used for region search')
    .option('--province <name>', 'only show one province (English or Chinese)')
    .action(async (cmdOpts) => {
      const opts = program.opts<GlobalOptions>();
      try {
        await withContext(opts, async () => {
          const data = buildRegionsData(cmdOpts.province);
          if (useJson(opts)) {
            printJson(envelope(data, makeMeta({ request_id: newRequestId(), source: 'cache' })));
            return;
          }
          if ('provinces' in data) {
            const rows = data.provinces.map((p, i) => [
              String(i + 1),
              p.name,
              p.name_zh,
              p.city_count === null ? '-' : String(p.city_count),
              p.cities_complete ? '完整' : '不完整',
            ]);
            process.stdout.write(
              formatTable(rows, ['#', '省份（英）', '中文', '城市数', '城市字典']) + '\n' +
                `\n省份（共 ${data.count}；城市过滤为客户端执行）\n` +
                '提示：`mic regions --province Hebei` 查看城市列表；不完整字典的城市名按 docs/03 §7.3 透传处理\n' +
                '注意：`Inner Mongolia`/`Hongkong S.A.R.`/`Taiwan, China` 的 api_value 为 `InnerMongolia`/`Hongkong`/`Taiwan`\n',
            );
            return;
          }
          const p = data.province;
          process.stdout.write(
            `${p.name_zh} / ${p.name}（${p.city_count ?? 0} 个城市；${p.source}；cities_complete=${p.cities_complete}）\n`,
          );
          const rows = data.cities.map((c, i) => [
            String(i + 1),
            c.name,
            c.name_zh,
            c.count_hint === null ? '-' : String(c.count_hint),
          ]);
          process.stdout.write(formatTable(rows, ['#', '城市（英）', '中文', '参考结果数(SEO)']) + '\n');
          process.stdout.write('\ncount_hint 仅作参考（SEO 与 JSON 口径不同，不可混用，docs/03 §5）。\n');
        });
      } catch (e) {
        fail(e);
      }
    });
}
