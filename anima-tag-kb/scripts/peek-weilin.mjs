/** peek-weilin.mjs —— 查看 weilin-tags.json 的真实结构 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'sources', 'weilin-tags.json'), 'utf8'));
console.log('顶层键:', Object.keys(j).join(' | '));
for (const [k, v] of Object.entries(j)) {
  if (Array.isArray(v)) console.log(`\n${k}: 数组 ${v.length} 项，首项 =`, JSON.stringify(v[0]).slice(0, 300));
  else if (v && typeof v === 'object') console.log(`\n${k}: 对象，键 =`, Object.keys(v).slice(0, 12).join(','), ' 样例 =', JSON.stringify(Object.values(v)[0]).slice(0, 220));
  else console.log(`\n${k}:`, String(v).slice(0, 120));
}
