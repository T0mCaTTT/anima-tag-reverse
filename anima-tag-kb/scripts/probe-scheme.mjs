/* 排查：cb:scheme 里的条目如何映射到三个数据集的 preview 图 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const load = (file, varName) => {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(DATA, file), 'utf8').replace(/export\s*\{[^}]*\};?/g, '') + `\n;globalThis.__v = ${varName};`, ctx);
  return ctx.__v;
};
const bg = load('background_data.js', 'backgroundData');
const pose = load('pose_data.js', 'poseData');
const cloth = JSON.parse(fs.readFileSync(path.join(DATA, 'clothing_data.json'), 'utf8'));

const sets = [
  { key: 'bg', arr: bg, sub: '背景方案库' },
  { key: 'pose', arr: pose, sub: '姿势方案库' },
  { key: 'cloth', arr: cloth, sub: '服装方案库' },
];

const scheme = JSON.parse(fs.readFileSync(path.join(ROOT, '画师类', 'bigs', 'cb-scheme.json'), 'utf8'));
const items = scheme.items;
console.log('scheme 条目:', items.length, '| subs:', JSON.stringify(scheme.subs));
const bySub = {};
for (const it of items) bySub[it[12]] = (bySub[it[12]] || 0) + 1;
console.log('各小分类:', JSON.stringify(bySub));

for (const { key, arr, sub } of sets) {
  const mine = items.filter(it => it[12] === sub);
  let hitTag = 0, hitZh = 0, miss = [];
  for (const it of mine) {
    const tag = it[0], zh = String(it[1] || '');
    let a = arr.find(e => String(e.tags || '').split(',').map(s => s.trim()).includes(tag));
    let b = arr.find(e => zh.startsWith(String(e.name_zh || '@@')));
    if (a) hitTag++; else if (b) hitZh++; else if (miss.length < 5) miss.push(tag + ' / ' + zh.slice(0, 20));
  }
  console.log(`${key}: ${mine.length} 条 → 按 tag 命中 ${hitTag}，按 name_zh 前缀命中 ${hitZh}，未命中样例 ${JSON.stringify(miss)}`);
  const e = mine[0];
  if (e) {
    const ex = arr.find(x => String(x.tags || '').split(',').map(s => s.trim()).includes(e[0]));
    console.log('  首条示例:', e[0], '|', String(e[1]).slice(0, 30), '→', ex ? ex.id + ' | ' + ex.preview : '无匹配');
  }
}
