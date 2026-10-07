/** diag-hierarchy.mjs —— 检查构建结果：大类目样例、缺中文家族分布 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPLIT = path.join(ROOT, '画师类');
const man = JSON.parse(fs.readFileSync(path.join(SPLIT, 'manifest.json'), 'utf8'));
const F = man.meta.field_map;
const read = c => c.files.flatMap(f => JSON.parse(fs.readFileSync(path.join(SPLIT, f), 'utf8')).items);

const want = process.argv.slice(2);
for (const c of man.categories) {
  if (want.length && !want.some(w => c.id.includes(w) || c.name.includes(w))) continue;
  const items = read(c);
  console.log(`\n===== ${c.name} (${c.id}) ${items.length} 条 / ${c.subs.length} 小类`);
  console.log('小类:', c.subs.map(s => `${s.name}(${s.count})`).join(' '));
  const bySub = new Map();
  for (const it of items) { const s = it[F.sub] || '?'; if (!bySub.has(s)) bySub.set(s, []); if (bySub.get(s).length < 6) bySub.get(s).push(it[F.tag]); }
  for (const [s, arr] of [...bySub].slice(0, 8)) console.log(`  [${s}] ${arr.join(' | ')}`);
}

// 缺中文家族
const miss = [];
for (const c of man.categories) for (const it of read(c)) if (!it[F.zh]) miss.push(it[F.tag]);
const fam = new Map();
const bump = (k, t) => { if (!fam.has(k)) fam.set(k, []); if (fam.get(k).length < 8) fam.get(k).push(t); };
for (const t of miss) {
  if (!/[A-Za-z]/.test(t)) bump('无字母（颜文字/符号/纯数字）', t);
  else if (/^\d{4}s?\b/.test(t) || /^\d{4}\b/.test(t) || /^~/.test(t)) bump('年份/年代开头', t);
  else if (/fifa|olympic|uefa|copa|world cup|champions|nba|nfl|mlb|world series|super bowl|grand prix|formula/i.test(t)) bump('赛事', t);
  else if (/\b(fashion|style)\b$/.test(t)) bump('时尚年代', t);
  else if (/^(the )?[a-z]+( [a-z]+){0,2}$/.test(t)) bump('普通英文短语', t);
  else bump('其他', t);
}
console.log('\n===== 缺中文', miss.length, '条，家族分布');
for (const [k, arr] of [...fam].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${k}: ${arr.join(' | ')}`);
