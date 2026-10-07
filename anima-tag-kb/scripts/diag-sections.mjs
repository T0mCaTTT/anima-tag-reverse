/** diag-sections.mjs —— 诊断为何某些 tag_group 页面抽不到小节/标签 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'data', 'taggroups-html');
for (const f of process.argv.slice(2)) {
  const h = fs.readFileSync(path.join(HTML, f), 'utf8');
  const body = (h.split('<div id="wiki-page-body"')[1] || h);
  const heads = [...body.matchAll(/<h([1-6])[^>]*>([\s\S]{0,90}?)<\/h\1>/g)]
    .map(m => `h${m[1]}: ${m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()}`).filter(x => x.length > 5 && !/Recent Changes|Options/.test(x));
  console.log('\n================', f, ' 长度', h.length);
  console.log('标题:', heads.slice(0, 14).join(' / '));
  const i = body.indexOf('dtext-');
  console.log('--- 首个 dtext 锚点后 900 字符 ---');
  console.log(body.slice(Math.max(0, i - 200), i + 900).replace(/\s+/g, ' '));
}
