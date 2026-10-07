/** recon-hier.mjs —— 评估 WeiLin 二级分类与 Danbooru 直采数据对「层级重构 + 扩充」的可用度。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = path.join(ROOT, 'data', 'sources');
const norm = s => String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

const w = JSON.parse(fs.readFileSync(path.join(S, 'weilin-tags.json'), 'utf8'));
const U = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'unified-tags.json'), 'utf8'));
const have = new Set(U.tags.map(t => norm(t.tag).replace(/^@/, '')));
const gName = id => (w.groups.find(g => g.id === +id) || {}).name || '?';
const sgName = id => (w.subgroups.find(s => s.id === +id) || {}).name || '?';

const bySub = new Map(), byGroup = new Map();
let curatedInKb = 0, curatedNew = 0;
for (const v of w.tag_rows) {
  const k = norm(v[2]);
  if (have.has(k)) curatedInKb++; else curatedNew++;
  // 列序: [id_index, subgroup_id, tag, translate, color, create_time, p_uuid, g_uuid]
  const sgObj = w.subgroups.find(s => s.id === +v[1]);
  const g = sgObj ? gName(sgObj.group_id) : '未映射';
  const sg = sgObj ? sgObj.name : '未映射';
  byGroup.set(g, (byGroup.get(g) || 0) + 1);
  bySub.set(g + '>' + sg, (bySub.get(g + '>' + sg) || 0) + 1);
}
console.log('WeiLin 策展标签:', w.tag_rows.length, ' 本地已有:', curatedInKb, ' 本地没有:', curatedNew);
console.log('\n一级分类分布:', [...byGroup.entries()].map(([k, v]) => `${k}:${v}`).join('  '));
console.log('\n二级分类数:', bySub.size);
console.log('二级分类（按标签数 top 40）:');
console.log([...bySub.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k}(${v})`).join(' | '));

// 131 个二级分类清单
console.log('\n全部二级分类名:');
console.log(w.subgroups.map(s => `${gName(s.group_id)}>${s.name}`).join(' | '));
